import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { pathToFileURL } from "node:url";
import { createDemoLedger } from "./src/ledger.js";
import { createFileStore } from "./src/file-store.js";
import { createPostgresStore } from "./src/postgres-store.js";

const port = Number(process.env.PORT || 4173);
const root = process.cwd();
const databaseUrl = process.env.DATABASE_URL || "";
if (process.env.VERCEL && !databaseUrl) throw new Error("DATABASE_URL is required on Vercel.");
const storageType = databaseUrl ? "postgres" : "file";
const store = databaseUrl ? createPostgresStore(databaseUrl) : createFileStore(join(root, "data", "demo-ledger.json"));
let ledger = createDemoLedger(await store.load());
let requestQueue = Promise.resolve();
const processorSecret = process.env.X_PROCESSOR_SECRET || "";
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

const json = (response, status, payload) => {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
};

const readJson = async (request) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16384) throw new Error("Request body exceeds 16KB.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

const persist = async (response, status, payload) => {
  await store.save(ledger.snapshot());
  return json(response, status, payload);
};

const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

async function handleRequest(request, response) {
  Object.entries(securityHeaders).forEach(([name, value]) => response.setHeader(name, value));
  const parsedUrl = new URL(request.url, `http://${request.headers.host}`);
  const rewrittenPath = parsedUrl.searchParams.get("path");
  const requestPath = rewrittenPath ? `/api/${rewrittenPath}` : parsedUrl.pathname;

  if (requestPath.startsWith("/api/") && requestPath !== "/api/health") {
    ledger = createDemoLedger(await store.load());
  }

  if (requestPath === "/api/health" && request.method === "GET") {
    return json(response, 200, { ok: true, service: "tagtip", storage: storageType, mode: processorSecret ? "protected" : "demo" });
  }
  if (requestPath === "/api/demo" && request.method === "GET") return json(response, 200, ledger.snapshot());
  if (requestPath === "/api/demo/setup" && request.method === "POST") return persist(response, 200, ledger.setup());
  if (requestPath === "/api/demo/pause" && request.method === "POST") return persist(response, 200, ledger.pause());
  if (requestPath === "/api/demo/revoke" && request.method === "POST") return persist(response, 200, ledger.revoke());
  if (requestPath === "/api/demo/reset" && request.method === "POST") return persist(response, 200, ledger.reset());
  if (requestPath === "/api/demo/expire" && request.method === "POST") {
    const result = ledger.expirePending();
    return persist(response, 200, result);
  }
  if (requestPath === "/api/demo/tips" && request.method === "POST") {
    try {
      const body = await readJson(request);
      if (typeof body.command !== "string") return json(response, 400, { ok: false, reason: "command must be text." });
      const result = ledger.createTip(body.command);
      return persist(response, result.ok ? 201 : 422, result);
    } catch (error) {
      if (error.code === "LEDGER_CONFLICT") throw error;
      return json(response, 400, { ok: false, reason: "Invalid JSON body." });
    }
  }

  if (requestPath === "/api/x/events" && request.method === "POST") {
    if (processorSecret && request.headers.authorization !== `Bearer ${processorSecret}`) {
      return json(response, 401, { ok: false, reason: "Invalid processor authorization." });
    }
    try {
      const body = await readJson(request);
      if (typeof body.tweetId !== "string" || !body.tweetId || body.tweetId.length > 100 || typeof body.text !== "string") return json(response, 400, { ok: false, reason: "tweetId and text must be valid strings." });
      const result = ledger.createTip(body.text, { source: "x", sourceId: String(body.tweetId) });
      return persist(response, result.ok ? (result.duplicate ? 200 : 201) : 422, result);
    } catch (error) {
      if (error.code === "LEDGER_CONFLICT") throw error;
      return json(response, 400, { ok: false, reason: "Invalid JSON body." });
    }
  }

  const tipLookup = requestPath.match(/^\/api\/tips\/([^/]+)$/);
  if (tipLookup && request.method === "GET") {
    const tip = ledger.getTip(tipLookup[1]);
    return tip ? json(response, 200, { ok: true, tip }) : json(response, 404, { ok: false, reason: "Tip not found." });
  }

  const tipAction = requestPath.match(/^\/api\/demo\/tips\/([^/]+)\/(verify|wallet|claim)$/);
  if (tipAction && request.method === "POST") {
    const [, id, action] = tipAction;
    let result;
    if (action === "verify") result = ledger.verify(id);
    if (action === "wallet") result = ledger.connectWallet(id);
    if (action === "claim") result = ledger.claim(id);
    return result ? persist(response, 200, result) : json(response, 409, { ok: false, reason: "That claim step is not available." });
  }

  const relative = requestPath === "/" ? "index.html" : requestPath.slice(1);
  const publicFiles = new Set(["index.html", "send.html", "claim.html", "style.css", "src/app.js", "src/claim.js", "src/core.js"]);
  if (!publicFiles.has(relative)) return response.writeHead(404).end("Not found");
  const filePath = normalize(join(root, relative));

  if (!filePath.startsWith(root)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  try {
    const file = await readFile(filePath);
    response.writeHead(200, { "Content-Type": types[extname(filePath)] || "application/octet-stream" });
    response.end(file);
  } catch {
    response.writeHead(404).end("Not found");
  }
}

export function requestHandler(request, response) {
  const run = requestQueue.then(() => handleRequest(request, response)).catch((error) => {
    if (!response.headersSent) json(response, error.code === "LEDGER_CONFLICT" ? 409 : 503, {
      ok: false,
      reason: error.code === "LEDGER_CONFLICT" ? "Another request updated this balance. Please retry." : "Service temporarily unavailable.",
    });
  });
  requestQueue = run;
  return run;
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  createServer(requestHandler).listen(port, () => {
    console.log(`TagTip preview: http://localhost:${port}`);
  });
}
