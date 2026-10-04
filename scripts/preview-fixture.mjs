import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createFileStore } from "../src/file-store.js";
import { createAccountLedger } from "../src/accounts.js";
import { testWallet } from "../tests/helpers/wallet.js";

// Local-only visual QA with temporary sample data. Never deploy this entrypoint.
if (process.env.VERCEL || process.env.NODE_ENV === "production") throw new Error("Fixture preview cannot run in production.");
const directory = await mkdtemp(join(tmpdir(), "tagtip-visual-qa-"));
const port = Number(process.env.FIXTURE_PORT || 4179);
process.env.APP_ORIGIN = `http://localhost:${port}`;
process.env.DATABASE_URL = "";
process.env.X_PROCESSOR_ENABLED = "false";
process.env.X_CLIENT_ID = "";
process.env.X_CLIENT_SECRET = "";
process.env.DEMO_DATA_FILE = join(directory, "demo.json");
process.env.AUTH_DATA_FILE = join(directory, "identity.json");
process.env.ACCOUNT_DATA_FILE = join(directory, "accounts.json");
const session = "isolated-local-fixture-alice";
await createFileStore(process.env.AUTH_DATA_FILE).save({ accounts: {
  "1": { id: "1", username: "alice", name: "Alice (sample)" }, "2": { id: "2", username: "bob", name: "Bob (sample)" },
}, flows: {}, sessions: { [createHash("sha256").update(session).digest("base64url")]: { accountId: "1", expiresAt: Date.now() + 86_400_000 } } });
const ledger = createAccountLedger();
ledger.touch({ id: "1", username: "alice" }); ledger.touch({ id: "2", username: "bob" }); ledger.fund("2");
ledger.send({ senderId: "2", recipientId: "1", recipientHandle: "alice", amount: "5", eventId: "sample-incoming" });
const wallet = testWallet();
const challenge = ledger.walletChallenge("1", wallet.address, process.env.APP_ORIGIN);
ledger.verifyWallet("1", wallet.sign(challenge.message));
await createFileStore(process.env.ACCOUNT_DATA_FILE).save(ledger.export());
const { requestHandler } = await import("../server.mjs");
createServer((request, response) => {
  request.headers.cookie = `tagtip_session=${session}`;
  return requestHandler(request, response);
}).listen(port, "127.0.0.1", () => console.log(`Isolated sample-account preview: http://localhost:${port}/account.html (NO real X account or funds)`));
