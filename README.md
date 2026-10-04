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

Identity data is stored separately from demo funds (`identity` Postgres row or ignored local `data/identity.json`). Signing in does not grant ownership of any demo balance or tip. Individual balances, authenticated recipient claims, bot account authorization, rate limiting, and live X configuration are still pending. The current financial screens remain explicitly simulated.
