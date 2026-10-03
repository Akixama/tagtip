# Production readiness

The website now proves the complete product state machine without touching real money:

1. A sender funds a controlled balance.
2. An X command creates one idempotent pending tip.
3. The recipient opens a tip-specific claim link.
4. Verification and wallet selection must happen in order.
5. A claim closes the record; expiry returns an unclaimed reservation.

## External work still required

### 1. Durable database

Replace the local JSON adapter with Neon/Postgres. Preserve the ledger API and store senders, tips, processor events, claims, and immutable status transitions. Add row-level locking around balance reservations.

### 2. X command processor

Poll mentions or receive the configured X event stream, normalize each post into `{ tweetId, text, author }`, and call `POST /api/x/events` with the processor bearer secret. The endpoint already rejects repeat `tweetId` values without charging twice.

### 3. Identity verification

Use X OAuth on the claim page. The authenticated X user ID—not only the editable handle—must match the recipient ID captured when the command was processed.

### 4. Custodial USDC settlement

Use a dedicated treasury wallet with a small operating balance. Keep its signing key in a managed secret/KMS, never in the repository or browser. Record the Solana signature before marking a claim paid, and reconcile signatures independently.

### 5. Operations

- Schedule pending-tip expiry.
- Alert on failed transfers and balance mismatches.
- Rate-limit public endpoints.
- Add admin review for unusually large or suspicious activity.
- Keep the service fee capped and disclose it before funding.

## Deployment order

Postgres → X ingestion in read-only/test mode → X OAuth claims → devnet USDC → monitored mainnet pilot.
