import { createServer } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { pathToFileURL } from "node:url";
import { createDemoLedger } from "./src/ledger.js";
import { createFileStore } from "./src/file-store.js";
import { createPostgresStore } from "./src/postgres-store.js";
import { createAuthService, readCookies } from "./src/auth.js";
import { createAccountLedger } from "./src/accounts.js";
import { parseTipCommand } from "./src/core.js";
import { createXProcessor } from "./src/x-processor.js";
import { createRateLimiter } from "./src/rate-limit.js";
import { createDevnetDepositVerifier } from "./src/devnet-deposit.js";
import { readinessReport } from "./src/readiness.js";
import { createDepositReceipts } from "./src/deposit-receipts.js";
import { createXReplySender } from "./src/x-replies.js";
import { operationsSummary } from "./src/ops-summary.js";

const port = Number(process.env.PORT || 4173);
const root = process.cwd();
const databaseUrl = process.env.DATABASE_URL || "";
if (process.env.VERCEL && !databaseUrl) throw new Error("DATABASE_URL is required on Vercel.");
const storageType = databaseUrl ? "postgres" : "file";
const store = databaseUrl ? createPostgresStore(databaseUrl) : createFileStore(process.env.DEMO_DATA_FILE || join(root, "data", "demo-ledger.json"));
let ledger = createDemoLedger(await store.load());
let requestQueue = Promise.resolve();
let queuedRequests = 0;
const rateLimiter = createRateLimiter();
const suppliedSecret = process.env.X_PROCESSOR_SECRET || "";
const processorSecret = suppliedSecret.length >= 32 && !suppliedSecret.startsWith("replace-") ? suppliedSecret : "";
const authorizedProcessor = request => Boolean(processorSecret && typeof request.headers.authorization === "string" && timingSafeEqual(
  createHash("sha256").update(request.headers.authorization).digest(), createHash("sha256").update(`Bearer ${processorSecret}`).digest()));
const authStore = databaseUrl ? createPostgresStore(databaseUrl, "identity") : createFileStore(process.env.AUTH_DATA_FILE || join(root, "data", "identity.json"));
const auth = createAuthService({ store: authStore, clientId: process.env.X_CLIENT_ID,
  clientSecret: process.env.X_CLIENT_SECRET, origin: process.env.APP_ORIGIN,
  botHandle: process.env.X_BOT_HANDLE, tokenEncryptionKey: process.env.X_BOT_TOKEN_ENCRYPTION_KEY });
const accountStore = databaseUrl ? createPostgresStore(databaseUrl, "accounts-sandbox") : createFileStore(process.env.ACCOUNT_DATA_FILE || join(root, "data", "accounts-sandbox.json"));
const workerStore = databaseUrl ? createPostgresStore(databaseUrl, "x-worker") : createFileStore(process.env.WORKER_DATA_FILE || join(root, "data", "x-worker.json"));
const receiptStore = databaseUrl ? createPostgresStore(databaseUrl, "deposit-evidence") : createFileStore(process.env.RECEIPT_DATA_FILE || join(root, "data", "deposit-evidence.json"));
const depositVerifier = createDevnetDepositVerifier({ rpcUrl: process.env.SOLANA_RPC_URL,
  treasuryTokenAccount: process.env.DEVNET_TREASURY_TOKEN_ACCOUNT, treasuryOwner: process.env.DEVNET_TREASURY_OWNER });
const worker = createXProcessor({ token: process.env.X_BEARER_TOKEN, botId: process.env.X_BOT_USER_ID,
  botHandle: process.env.X_BOT_HANDLE, initialSinceId: process.env.X_START_SINCE_ID,
  enabled: process.env.X_PROCESSOR_ENABLED === "true", store: workerStore, appOrigin: process.env.APP_ORIGIN,
  async applyEvent(event) {
    const user = await auth.findId(event.senderId);
    if (!user) return { status: "blocked", reason: "Sender has not linked their X identity." };
    const accounts = createAccountLedger(await accountStore.load());
    accounts.reconcile(); accounts.touch(user);
    try {
      const result = accounts.send({ ...event, eventId: `x-${event.tweetId}` });
      accounts.reconcile(); await accountStore.save(accounts.export());
      return { status: result.duplicate ? "duplicate" : "accepted", tipId: result.tip.id };
    } catch (error) {
      if (error.code === "ACCOUNT_RULE") return { status: "blocked", reason: error.message };
      throw error;
    }
  },
});
const replySender = createXReplySender({ token: process.env.X_BOT_USER_ACCESS_TOKEN,
  enabled: process.env.X_REPLY_ENABLED === "true", store: workerStore });
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
    if (size > 16384) { const error = new Error("Request body exceeds 16KB."); error.code = "BODY_TOO_LARGE"; throw error; }
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
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "X-Frame-Options": "DENY",
};

async function handleRequest(request, response) {
  Object.entries(securityHeaders).forEach(([name, value]) => response.setHeader(name, value));
  const parsedUrl = new URL(request.url, `http://${request.headers.host}`);
  const rewrittenPath = parsedUrl.pathname === "/api/index" ? parsedUrl.searchParams.get("path") : null;
  const requestPath = rewrittenPath ? `/api/${rewrittenPath}` : parsedUrl.pathname;
  if (process.env.VERCEL) response.setHeader("Strict-Transport-Security", "max-age=31536000");
  if (requestPath.startsWith("/api/") && !requestPath.startsWith("/api/ops/") && requestPath !== "/api/health") {
    const ip = process.env.VERCEL ? String(request.headers["x-forwarded-for"] || request.socket?.remoteAddress || "unknown").split(",")[0].trim() : request.socket?.remoteAddress || "unknown";
    const limited = rateLimiter.check(`${requestPath.startsWith("/api/auth/x/") ? "login" : "api"}:${ip}`, requestPath.startsWith("/api/auth/x/") ? 10 : 120);
    if (!limited.allowed) { response.setHeader("Retry-After", limited.retryAfter); return json(response, 429, { ok: false, reason: "Too many requests. Please wait before trying again." }); }
  }
  if (request.method === "POST" && request.headers.origin) {
    const expectedOrigin = process.env.APP_ORIGIN || `${process.env.VERCEL ? "https" : "http"}://${request.headers.host}`;
    if (request.headers.origin !== expectedOrigin) return json(response, 403, { ok: false, reason: "Origin not allowed." });
  }

  if (requestPath.startsWith("/api/ops/")) {
    if (!authorizedProcessor(request)) return json(response, 401, { ok: false, reason: "Processor authorization required." });
    if (requestPath === "/api/ops/bot-status" && request.method === "GET") return json(response, 200, await auth.botStatus());
    if (requestPath === "/api/ops/process-x" && request.method === "POST") {
      if (!worker.configured) return json(response, 503, { ok: false, reason: "X processor is disabled or not configured." });
      return json(response, 200, await worker.run());
    }
    if (requestPath === "/api/ops/process-replies" && request.method === "POST") {
      if (process.env.X_REPLY_ENABLED === "true" && auth.botConfigured) {
        const token = await auth.botAccessToken();
        return json(response, 200, await createXReplySender({ token, enabled: true, store: workerStore }).run());
      }
      if (!replySender.configured) return json(response, 503, { ok: false, reason: "X reply sender is disabled or not configured." });
      return json(response, 200, await replySender.run());
    }
    if (requestPath === "/api/ops/reconcile" && request.method === "GET") {
      const accounts = createAccountLedger(await accountStore.load());
      return json(response, 200, { ...accounts.reconcile(), mode: "sandbox", realFundsEnabled: false });
    }
    if (requestPath === "/api/ops/expire" && request.method === "POST") {
      const accounts = createAccountLedger(await accountStore.load()); accounts.reconcile(); accounts.expire(); accounts.reconcile();
      await accountStore.save(accounts.export());
      return json(response, 200, { ok: true, mode: "sandbox" });
    }
    if (requestPath === "/api/ops/status" && request.method === "GET") {
      const bot = await auth.botStatus();
      return json(response, 200, { ok: true, workerConfigured: worker.configured,
        replySenderConfigured: Boolean(process.env.X_REPLY_ENABLED === "true" && (replySender.configured || bot.connected)), bot,
        checkpoint: await workerStore.load(), realFundsEnabled: false });
    }
    if (requestPath === "/api/ops/queues" && request.method === "GET") {
      return json(response, 200, operationsSummary({ checkpoint: await workerStore.load(), accounts: await accountStore.load() }));
    }
    if (requestPath === "/api/ops/readiness" && request.method === "GET") return json(response, 200, readinessReport());
    if (requestPath === "/api/ops/verify-devnet-deposit" && request.method === "POST") {
      if (!depositVerifier.configured) return json(response, 503, { ok: false, reason: "Devnet treasury evidence verifier is not configured." });
      const body = await readJson(request);
      const accounts = createAccountLedger(await accountStore.load()); accounts.reconcile();
      const verifiedWallet = accounts.snapshot(body.accountId).account.verifiedWallet;
      if (!verifiedWallet) return json(response, 422, { ok: false, reason: "Account must verify its wallet first." });
      let evidence;
      try { evidence = await depositVerifier.verify({ signature: body.signature, depositorWallet: verifiedWallet }); }
      catch { return json(response, 422, { ok: false, reason: "Devnet deposit evidence could not be verified. No ledger credit occurred." }); }
      const receipts = createDepositReceipts(await receiptStore.load() || {});
      let result;
      try { result = receipts.record(body.accountId, evidence); }
      catch { return json(response, 409, { ok: false, reason: "Deposit evidence conflicts with an existing receipt. No ledger credit occurred." }); }
      await receiptStore.save(receipts.export());
      return json(response, 200, { ...evidence, receiptStatus: result.receipt.status, duplicate: result.duplicate });
    }
    return json(response, 404, { ok: false, reason: "Not found." });
  }

  if (requestPath.startsWith("/api/auth/")) {
    const cookies = readCookies(request.headers.cookie);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    if (requestPath === "/api/auth/me" && request.method === "GET") {
      const account = await auth.me(cookies.tagtip_session);
      const isBot = account && account.username.toLowerCase() === String(process.env.X_BOT_HANDLE || "").toLowerCase();
      const bot = isBot ? await auth.botStatus() : null;
      return json(response, 200, { configured: auth.configured, account, botSetupAvailable: Boolean(isBot && auth.botConfigured),
        botConnected: Boolean(bot?.connected && bot.account.id === account.id), realFundsEnabled: false });
    }
    if (requestPath === "/api/auth/logout" && request.method === "POST") {
      if (!process.env.APP_ORIGIN || request.headers.origin !== process.env.APP_ORIGIN) return json(response, 403, { ok: false, reason: "Origin required." });
      response.setHeader("Set-Cookie", await auth.logout(cookies.tagtip_session));
      return json(response, 200, { ok: true });
    }
    if (requestPath === "/api/auth/x/start" && request.method === "GET") {
      if (!auth.configured) return json(response, 503, { ok: false, reason: "X login is not configured yet." });
      const result = await auth.start();
      response.setHeader("Set-Cookie", result.cookie);
      return response.writeHead(302, { Location: result.url }).end();
    }
    if (requestPath === "/api/auth/x/bot-start" && request.method === "POST") {
      if (!process.env.APP_ORIGIN || request.headers.origin !== process.env.APP_ORIGIN) return json(response, 403, { ok: false, reason: "Same-origin request required." });
      const user = await auth.me(cookies.tagtip_session);
      if (!user || user.username.toLowerCase() !== String(process.env.X_BOT_HANDLE || "").toLowerCase()) return json(response, 403, { ok: false, reason: "Sign in as the configured bot account first." });
      if (!auth.botConfigured) return json(response, 503, { ok: false, reason: "Bot token encryption is not configured." });
      const result = await auth.start({ bot: true });
      response.setHeader("Set-Cookie", result.cookie);
      return json(response, 200, { url: result.url });
    }
    if (requestPath === "/api/auth/x/callback" && request.method === "GET") {
      try {
        const result = await auth.callback({ code: parsedUrl.searchParams.get("code"), nonce: parsedUrl.searchParams.get("state"), browser: cookies.tagtip_oauth });
        response.setHeader("Set-Cookie", result.cookies);
        return response.writeHead(303, { Location: result.bot ? "/account.html?bot=connected" : "/account.html?login=success" }).end();
      } catch {
        return json(response, 400, { ok: false, reason: "X login failed or expired. Please start again." });
      }
    }
    return json(response, 404, { ok: false, reason: "Not found." });
  }

  if (requestPath === "/api/account" || requestPath.startsWith("/api/account/")) {
    const user = await auth.me(readCookies(request.headers.cookie).tagtip_session);
    if (!user) return json(response, 401, { ok: false, reason: "Sign in with X first." });
    if (request.method === "POST" && (!process.env.APP_ORIGIN || request.headers.origin !== process.env.APP_ORIGIN)) {
      return json(response, 403, { ok: false, reason: "Same-origin request required." });
    }
    try {
      const accounts = createAccountLedger(await accountStore.load());
      accounts.reconcile(); accounts.touch(user);
      let result = {};
      if (requestPath === "/api/account" && request.method === "GET") {
        // Snapshot below only exposes this authenticated user's records.
      } else if (requestPath === "/api/account/fund" && request.method === "POST") {
        accounts.fund(user.id);
      } else if (requestPath === "/api/account/policy" && request.method === "POST") {
        const body = await readJson(request);
        accounts.policy(user.id, body.perTip, body.perDay, body.paused);
      } else if (requestPath === "/api/account/tips" && request.method === "POST") {
        const body = await readJson(request);
        if (typeof body.command !== "string") return json(response, 400, { ok: false, reason: "Command must be text." });
        const parsed = parseTipCommand(body.command);
        if (!parsed.ok) return json(response, 422, parsed);
        const recipient = await auth.findHandle(parsed.recipient.slice(1));
        if (!recipient) return json(response, 422, { ok: false, reason: "For this sandbox, the recipient must sign in with X first. Unregistered-recipient resolution will be handled by the X processor." });
        accounts.touch(recipient);
        result = accounts.send({ senderId: user.id, recipientId: recipient.id, recipientHandle: recipient.username,
          amount: String(parsed.amount), eventId: typeof body.requestId === "string" ? `web-${user.id}-${body.requestId}` : body.requestId });
      } else if (requestPath === "/api/account/withdrawals" && request.method === "POST") {
        const body = await readJson(request);
        result.withdrawal = accounts.withdraw(user.id, body.amount, body.wallet, body.requestId);
      } else if (requestPath === "/api/account/wallet/challenge" && request.method === "POST") {
        const body = await readJson(request);
        result.challenge = accounts.walletChallenge(user.id, body.wallet, process.env.APP_ORIGIN);
      } else if (requestPath === "/api/account/wallet/verify" && request.method === "POST") {
        const body = await readJson(request);
        accounts.verifyWallet(user.id, body.signature);
      } else if (requestPath === "/api/account/devnet/deposits" && request.method === "POST") {
        if (!depositVerifier.configured) return json(response, 503, { ok: false, reason: "Devnet deposits are not configured yet." });
        const body = await readJson(request);
        const verifiedWallet = accounts.snapshot(user.id).account.verifiedWallet;
        if (!verifiedWallet) return json(response, 422, { ok: false, reason: "Verify the depositing wallet first." });
        let evidence;
        try { evidence = await depositVerifier.verify({ signature: body.signature, depositorWallet: verifiedWallet }); }
        catch { return json(response, 422, { ok: false, reason: "Finalized devnet USDC deposit could not be verified. No balance was credited." }); }
        result = accounts.creditDevnetDeposit(user.id, evidence);
      } else if (requestPath === "/api/account/devnet/withdrawals" && request.method === "POST") {
        const body = await readJson(request);
        result = accounts.reserveDevnetWithdrawal(user.id, body.amount, body.wallet, body.requestId);
      } else {
        const claim = requestPath.match(/^\/api\/account\/tips\/([a-f0-9-]{36})\/claim$/);
        const cancel = requestPath.match(/^\/api\/account\/withdrawals\/([a-f0-9-]{36})\/cancel$/);
        const cancelDevnet = requestPath.match(/^\/api\/account\/devnet\/withdrawals\/([a-f0-9-]{36})\/cancel$/);
        if (claim && request.method === "POST") result.tip = accounts.claim(claim[1], user.id);
        else if (cancelDevnet && request.method === "POST") accounts.cancelDevnetWithdrawal(cancelDevnet[1], user.id);
        else if (cancel && request.method === "POST") accounts.cancelWithdrawal(cancel[1], user.id);
        else return json(response, 404, { ok: false, reason: "Not found." });
      }
      const snapshot = accounts.snapshot(user.id);
      accounts.reconcile();
      await accountStore.save(accounts.export());
      return json(response, 200, { ok: true, ...result, state: { ...snapshot, devnetDepositEnabled: depositVerifier.configured } });
    } catch (error) {
      if (error.code === "LEDGER_CONFLICT") throw error;
      if (error.code === "ACCOUNT_RULE") return json(response, 422, { ok: false, reason: error.message });
      if (error instanceof SyntaxError) return json(response, 400, { ok: false, reason: "Invalid JSON body." });
      throw error;
    }
  }

  if (requestPath.startsWith("/api/") && requestPath !== "/api/health") {
    ledger = createDemoLedger(await store.load());
  }

  if (requestPath === "/api/health" && request.method === "GET") {
    const bot = await auth.botStatus();
    return json(response, 200, { ok: true, service: "tagtip", storage: storageType, mode: "sandbox",
      demoIngestionEnabled: Boolean(processorSecret), processorEnabled: worker.configured,
      replySenderEnabled: Boolean(process.env.X_REPLY_ENABLED === "true" && (replySender.configured || bot.connected)),
      xLoginConfigured: auth.configured, realFundsEnabled: false });
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
      if (error.code === "BODY_TOO_LARGE") throw error;
      if (error.code === "LEDGER_CONFLICT") throw error;
      return json(response, 400, { ok: false, reason: "Invalid JSON body." });
    }
  }

  if (requestPath === "/api/x/events" && request.method === "POST") {
    if (!processorSecret) return json(response, 503, { ok: false, reason: "Processor is not configured." });
    if (!authorizedProcessor(request)) {
      return json(response, 401, { ok: false, reason: "Invalid processor authorization." });
    }
    try {
      const body = await readJson(request);
      if (typeof body.tweetId !== "string" || !body.tweetId || body.tweetId.length > 100 || typeof body.text !== "string") return json(response, 400, { ok: false, reason: "tweetId and text must be valid strings." });
      const result = ledger.createTip(body.text, { source: "x", sourceId: String(body.tweetId) });
      return persist(response, result.ok ? (result.duplicate ? 200 : 201) : 422, result);
    } catch (error) {
      if (error.code === "BODY_TOO_LARGE") throw error;
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
  const publicFiles = new Set(["index.html", "send.html", "claim.html", "account.html", "style.css", "src/app.js", "src/claim.js", "src/account-ui.js", "src/core.js"]);
  if (!publicFiles.has(relative)) return response.writeHead(404).end("Not found");
  const filePath = normalize(join(root, process.env.VERCEL ? "public" : "", relative));

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
  if (queuedRequests >= 200) return json(response, 503, { ok: false, reason: "Service busy. Please retry later." });
  queuedRequests++;
  const run = requestQueue.then(() => handleRequest(request, response)).catch((error) => {
    if (!response.headersSent) json(response, error.code === "BODY_TOO_LARGE" ? 413 : error.code === "LEDGER_CONFLICT" ? 409 : 503, {
      ok: false,
      reason: error.code === "BODY_TOO_LARGE" ? "Request body exceeds 16KB." : error.code === "LEDGER_CONFLICT" ? "Another request updated this balance. Please retry." : "Service temporarily unavailable.",
    });
  });
  run.finally(() => { queuedRequests--; });
  requestQueue = run;
  return run;
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  createServer(requestHandler).listen(port, () => {
    console.log(`TagTip preview: http://localhost:${port}`);
  });
}
