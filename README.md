# TagTip

TagTip is a working-name prototype for sending USDC from an X post. This vertical slice uses a shared server-side demo ledger: it proves command parsing, capped fees, budget rules, pause/revoke controls, pending tips, and the complete recipient claim state machine before any X API credits or real funds are used.

## Run it

```bash
npm test
npm run dev
```

Open `http://localhost:4173`.

## Phase 1 scope

- Demo X identity linking
- A $25 test allowance
- `@TagTip send $5 to @recipient` command parsing
- 0.5% service fee, $0.01 minimum, $1 maximum
- $10 per-tip and $25 daily test limits
- Success and blocked receipts
- A pending tip created on the sender page appears on the recipient page
- Verify → choose wallet → claim state transitions
- Persistent local ledger across server restarts
- Idempotent X-event ingestion at `POST /api/x/events`
- Seven-day pending-tip expiry and automatic demo-balance return
- Direct claim links such as `/claim.html?tip=TT-2048`
- Health endpoint at `GET /api/health`
- Pause and revoke controls

The shared demo uses no real wallet permission, X API request, token transfer, or custom Solana program. Local state is stored in `data/demo-ledger.json` and is intentionally ignored by Git. Its legacy `/api/x/events` endpoint is disabled unless a strong `X_PROCESSOR_SECRET` is set; requests must supply that secret as a Bearer token. This protects demo ingestion only, not real sender authorization. Health reports sandbox mode, real funds disabled, and separate flags for demo ingestion, X login, and the actual mention worker.

Set DATABASE_URL to use the Neon/Postgres adapter. It creates a shared prototype state table and rejects conflicting writes instead of overwriting balances. Vercel requires DATABASE_URL; local development falls back to the JSON store. The hosted adapter has not yet been verified against a live database.

The financial flow remains a shared demo with simulated identities and wallet claims. The database adapter is for prototype persistence, not a production custody ledger. X login is implemented separately below; connecting authenticated users to their own balances, transaction accounting, and USDC settlement remains necessary before real funds are supported.

## X identity login (implemented, live verification pending)

Set `APP_ORIGIN`, `X_CLIENT_ID`, and `X_CLIENT_SECRET` for a confidential X web app. Register the exact callback `${APP_ORIGIN}/api/auth/x/callback` in the X console. Open `/api/auth/x/start` to sign in. Only `tweet.read users.read` scopes are requested; user posting permissions and offline access are not requested.

The callback verifies identity with X, creates an account keyed by immutable X user ID, and issues a 24-hour HttpOnly session cookie. OAuth state is browser-bound, expires after ten minutes, and is consumed once. Session tokens are hashed in storage. X access tokens are not persisted. `GET /api/auth/me` returns the signed-in profile; same-origin `POST /api/auth/logout` revokes the local session. Hosted deployments must use HTTPS.

Identity data is stored separately from demo funds (`identity` Postgres row or ignored local `data/identity.json`). Signing in does not grant ownership of any shared demo balance or tip. Live X configuration, bot authorization, and real settlement remain pending.

## Personal financial sandbox

Open `/account.html`. Signed-in users receive separate accounts keyed by their X user IDs. Each may add 25 test USDC once, configure limits, pause tipping, create pending tips, claim incoming tips, and reserve/cancel mock withdrawals. All amounts use integer millionths of USDC; a balanced journal records every movement. Reconciliation runs before and after account mutations.

Withdrawal destinations require a Phantom ownership message. The server verifies Ed25519 signatures against the exact public key. Challenges include app origin, X user ID, wallet, expiry and nonce; expire after five minutes; and cannot be reused. No private key, recovery phrase, spending approval or blockchain transaction is requested.

Only the authenticated recipient ID may claim a tip. Claiming credits the recipient's internal test balance. Seven-day expiry refunds both amount and reserved fee; fees become earned only on claim. Web sandbox recipients must sign in first. The ledger also supports pending recipients resolved to an X ID before registration, for processor integration.

`accounts-sandbox` Postgres state or ignored local `data/accounts-sandbox.json` is independent of the shared demo and identity state. It remains a snapshot-based sandbox, not a production treasury ledger. Withdrawals never create or submit Solana transactions. Do not send real USDC to this prototype.

## X processor and operations

The sandbox mention worker is disabled by default. Configure `X_BEARER_TOKEN`, `X_BOT_HANDLE`, and either a deliberate recent `X_START_SINCE_ID` or a UTC `X_START_TIME` (`YYYY-MM-DDTHH:mm:ssZ`). The bot's stable ID is taken from its saved OAuth connection; `X_BOT_USER_ID` is a fallback for environments without that connection. After verifying the preview, set `X_PROCESSOR_ENABLED=true` and invoke `POST /api/ops/process-x` with `Authorization: Bearer <X_PROCESSOR_SECRET>`. Reads may consume paid X API credits; no calls occur unless explicitly invoked. Replies remain separately disabled.

Before enabling processing, invoke protected `POST /api/ops/preview-x` (or `npm run ops -- preview-x`). It makes exactly one potentially billable X mention read for up to ten recent mentions after the saved checkpoint or start boundary, reports potential commands, and never resolves recipients, reserves tips, advances the checkpoint, or posts replies. It works while `X_PROCESSOR_ENABLED=false`. Choose a recent start boundary first so old mentions are excluded; inspect `moreAvailable` before enabling the full worker. Repeating the preview repeats the read.

No X credits are needed to build or run the local sandbox tests. For a live X test, first check the developer account's available credits, then run one preview; only turn on processing after reviewing that result. The worker resolves the saved bot identity at each operation, so a newly linked bot does not require an app restart. `GET /api/ops/readiness` also recognizes saved bot OAuth for replies; it does not require a second, legacy `X_BOT_USER_ACCESS_TOKEN` when the bot is connected.

The worker fetches at most three mention pages and makes at most ten X requests per invocation. It processes oldest-first, checks the post's actual author ID, resolves recipient IDs through X, and applies sandbox reservations only for linked senders with available funds. Partial progress is checkpointed; retries do not repeat debits. A 429 response defers work until reset, and successful runs wait at least one minute before another poll. A backlog larger than three pages is rejected for operator review.

Accepted commands also create bounded, durable acknowledgement records in the worker checkpoint. They are not posted yet: a future bot-authorized sender must deliver and reconcile that outbox without creating duplicate replies.

The reply sender is separately disabled by default. With bot-only user authorization, `X_REPLY_ENABLED=true` and `X_BOT_USER_ACCESS_TOKEN`, an operator can invoke `npm run ops -- process-replies`. Successful replies are recorded once, rate limits defer pending work, and network/5xx/interrupted outcomes are marked unknown instead of being retried automatically.

For renewable bot authorization, set a dedicated `X_BOT_TOKEN_ENCRYPTION_KEY` (32 random bytes, hex encoded) as a Production secret. Sign into the website as the configured `X_BOT_HANDLE`, then use the bot-only authorization button on Account. The existing callback remains unchanged. This separate flow requests write/offline scopes, rejects any other handle, pins the stable bot ID once connected, and stores AES-256-GCM encrypted tokens. The protected `GET /api/ops/bot-status` exposes only connection status and public identity. Reply operations refresh the encrypted authorization when needed; connecting does not enable the worker, replies, payments, or schedules. Losing or rotating the encryption key requires reconnecting the bot. Website user login remains read-only and does not store user X tokens.

Other protected endpoints: `GET /api/ops/status`, `GET /api/ops/queues`, `GET /api/ops/reconcile`, and `POST /api/ops/expire`. `npm run ops -- queues` returns count-only alerts for ambiguous X replies and reserved withdrawals without exposing balances or secrets. No scheduler is installed automatically, so there are no surprise recurring API charges. Use your scheduler to POST only after validating configuration and setting a budget.

Run `npm run build` for Vercel. It copies only nine allowlisted browser assets into `public/`; backend modules and local data are not public deployment assets. Vercel still requires `DATABASE_URL`. Hosted database, OAuth, and worker integrations require live verification.

The devnet evidence verifier accepts finalized legacy SPL `transferChecked` deposits of Circle's devnet USDC mint only. It checks network genesis, signer, token-account ownership, decimals, treasury destination and net balance change. Signed-in users can submit a signature to `POST /api/account/devnet/deposits` after proving wallet ownership. Valid evidence credits a separate devnet balance exactly once; it never changes demo credits and cannot enable a mainnet payout. The protected operations endpoint remains evidence-only. Configure a dedicated devnet treasury owner and token account before using either route. Never send mainnet funds.

Devnet withdrawals can be reserved against that balance after a wallet proof less than 15 minutes old. Reservations are idempotent, capped at 100 devnet USDC and cancellable until a future custody worker records a broadcast. The current application does not sign or submit transactions.

Use Node 24+. `npm run dev`, `npm run check-config`, and `npm run ops -- status` load an ignored `.env` if present. The configuration checker prints missing variable names, never values. Operation choices are `status`, `readiness`, `reconcile`, `expire`, and `process-x`. Do not invoke `process-x` until you have approved your X API credit budget.

Per-instance request limits, content-security policy, anti-framing headers, and 16KB body limits are applied. These are sandbox safeguards, not substitutes for distributed edge protection or a security review.

For isolated visual QA only: `node scripts/preview-fixture.mjs` starts sample Alice/Bob accounts on loopback port 4179 using temporary data. It deliberately injects a sample session and refuses production/Vercel. It must never be deployed or exposed beyond localhost. Normal `npm run dev` does not use fixture authentication.
