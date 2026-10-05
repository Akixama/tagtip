const operation = process.argv[2] || "status";
const routes = { status: ["GET", "/api/ops/status"], queues: ["GET", "/api/ops/queues"], reconcile: ["GET", "/api/ops/reconcile"],
  readiness: ["GET", "/api/ops/readiness"], expire: ["POST", "/api/ops/expire"], "process-x": ["POST", "/api/ops/process-x"],
  "process-replies": ["POST", "/api/ops/process-replies"] };
if (!routes[operation]) throw new Error("Use: status, queues, readiness, reconcile, expire, process-x, or process-replies.");
const origin = process.env.APP_ORIGIN, secret = process.env.X_PROCESSOR_SECRET;
if (!origin || !secret || secret.startsWith("replace-")) throw new Error("Set APP_ORIGIN and X_PROCESSOR_SECRET first.");
const url = new URL(origin);
if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error("Operations require HTTPS outside localhost.");
const [method, path] = routes[operation];
const response = await fetch(new URL(path, origin), { method, signal: AbortSignal.timeout(60_000), headers: { Authorization: `Bearer ${secret}` } });
const body = await response.json();
if (!response.ok) { console.error(body.reason || "Operation failed."); process.exitCode = 1; }
else console.log(JSON.stringify(body, null, 2));
