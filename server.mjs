import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { createDemoLedger } from "./src/ledger.js";
import { createFileStore } from "./src/file-store.js";

const port = Number(process.env.PORT || 4173);
const root = process.cwd();
const store = createFileStore(join(root, "data", "demo-ledger.json"));
const ledger = createDemoLedger(await store.load());
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
  for await (const chunk of request) chunks.push(chunk);
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

createServer(async (request, response) => {
  Object.entries(securityHeaders).forEach(([name, value]) => response.setHeader(name, value));
  const requestPath = new URL(request.url, `http://${request.headers.host}`).pathname;

  if (requestPath === "/api/health" && request.method === "GET") {
    return json(response, 200, { ok: true, service: "tagtip", storage: "file", mode: processorSecret ? "protected" : "demo" });
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
      const result = ledger.createTip(body.command || "");
      return persist(response, result.ok ? 201 : 422, result);
    } catch {
      return json(response, 400, { ok: false, reason: "Invalid JSON body." });
    }
  }

  if (requestPath === "/api/x/events" && request.method === "POST") {
    if (processorSecret && request.headers.authorization !== `Bearer ${processorSecret}`) {
      return json(response, 401, { ok: false, reason: "Invalid processor authorization." });
    }
    try {
      const body = await readJson(request);
      if (!body.tweetId || !body.text) return json(response, 400, { ok: false, reason: "tweetId and text are required." });
      const result = ledger.createTip(body.text, { source: "x", sourceId: String(body.tweetId) });
      return persist(response, result.ok ? (result.duplicate ? 200 : 201) : 422, result);
    } catch {
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
}).listen(port, () => {
  console.log(`TagTip preview: http://localhost:${port}`);
});
