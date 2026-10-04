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

No real wallet permission, X API request, token transfer, or custom Solana program is used yet. Local state is stored in `data/demo-ledger.json` and is intentionally ignored by Git. The X-event endpoint is disabled unless `X_PROCESSOR_SECRET` is set; requests must supply that secret as a Bearer token. This protects demo ingestion only, not real sender authorization. Health always reports demo mode and real funds disabled.

Set DATABASE_URL to use the Neon/Postgres adapter. It creates a shared prototype state table and rejects conflicting writes instead of overwriting balances. Vercel requires DATABASE_URL; local development falls back to the JSON store. The hosted adapter has not yet been verified against a live database.

The financial flow remains a shared demo with simulated identities and wallet claims. The database adapter is for prototype persistence, not a production custody ledger. X login is implemented separately below; connecting authenticated users to their own balances, transaction accounting, and USDC settlement remains necessary before real funds are supported.

## X identity login (implemented, live verification pending)

Set `APP_ORIGIN`, `X_CLIENT_ID`, and `X_CLIENT_SECRET` for a confidential X web app. Register the exact callback `${APP_ORIGIN}/api/auth/x/callback` in the X console. Open `/api/auth/x/start` to sign in. Only `tweet.read users.read` scopes are requested; user posting permissions and offline access are not requested.

The callback verifies identity with X, creates an account keyed by immutable X user ID, and issues a 24-hour HttpOnly session cookie. OAuth state is browser-bound, expires after ten minutes, and is consumed once. Session tokens are hashed in storage. X access tokens are not persisted. `GET /api/auth/me` returns the signed-in profile; same-origin `POST /api/auth/logout` revokes the local session. Hosted deployments must use HTTPS.

Identity data is stored separately from demo funds (`identity` Postgres row or ignored local `data/identity.json`). Signing in does not grant ownership of any shared demo balance or tip. Live X configuration, bot authorization, and real settlement remain pending.

## Personal financial sandbox

Open `/account.html`. Signed-in users receive separate accounts keyed by their X user IDs. Each may add 25 test USDC once, configure limits, pause tipping, create pending tips, claim incoming tips, and reserve/cancel mock withdrawals. All amounts use integer millionths of USDC; a balanced journal records every movement. Reconciliation runs before and after account mutations.

Only the authenticated recipient ID may claim a tip. Claiming credits the recipient's internal test balance. Seven-day expiry refunds both amount and reserved fee; fees become earned only on claim. Web sandbox recipients must sign in first. The ledger also supports pending recipients resolved to an X ID before registration, for processor integration.

`accounts-sandbox` Postgres state or ignored local `data/accounts-sandbox.json` is independent of the shared demo and identity state. It remains a snapshot-based sandbox, not a production treasury ledger. Withdrawals never create or submit Solana transactions. Do not send real USDC to this prototype.

## X processor and operations

The sandbox mention worker is disabled by default. Configure `X_BEARER_TOKEN`, `X_BOT_USER_ID`, `X_BOT_HANDLE`, and a deliberate recent `X_START_SINCE_ID`, then set `X_PROCESSOR_ENABLED=true`. Invoke `POST /api/ops/process-x` with `Authorization: Bearer <X_PROCESSOR_SECRET>`. This reads X API data and may consume paid API credits; no calls occur unless explicitly enabled and invoked. No posts/replies are published yet.

The worker fetches at most three mention pages and makes at most ten X requests per invocation. It processes oldest-first, checks the post's actual author ID, resolves recipient IDs through X, and applies sandbox reservations only for linked senders with available funds. Partial progress is checkpointed; retries do not repeat debits. A 429 response defers work until reset, and successful runs wait at least one minute before another poll. A backlog larger than three pages is rejected for operator review.

Other protected endpoints: `GET /api/ops/status`, `GET /api/ops/reconcile`, and `POST /api/ops/expire`. No scheduler is installed automatically, so there are no surprise recurring API charges. Use your scheduler to POST only after validating configuration and setting a budget.

Run `npm run build` for Vercel. It copies only nine allowlisted browser assets into `public/`; backend modules and local data are not public deployment assets. Vercel still requires `DATABASE_URL`. Hosted database, OAuth, and worker integrations require live verification.
