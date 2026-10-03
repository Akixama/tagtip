# TagTip

TagTip is a working-name prototype for sending USDC from an X post. This first vertical slice is deliberately a local simulator: it proves command parsing, capped fees, budget rules, pause/revoke controls, and payment receipts before any X API credits or real funds are used.

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
- Pause and revoke controls

No real wallet permission, X API request, token transfer, or custom Solana program is used yet. The next milestone replaces the simulated allowance with a devnet SPL-token delegate approval.
