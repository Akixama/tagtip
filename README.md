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

No real wallet permission, X API request, token transfer, or custom Solana program is used yet. Local state is stored in `data/demo-ledger.json` and is intentionally ignored by Git. Set `X_PROCESSOR_SECRET` to protect the X-event ingestion endpoint outside demo mode.

The remaining production integrations are external: move the ledger to Postgres/Neon, supply X API credentials to the command processor, and connect a test USDC treasury on Solana devnet.
