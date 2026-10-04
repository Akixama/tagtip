# TagTip launch gates

TagTip is a custodial-product sandbox, not a deployed custody service. No custom Solana program is required by this architecture. No real funds, treasury key, automatic public posting, or paid scheduler is enabled.

## Implemented and tested offline

- Dark landing page, separate demo sender/recipient pages, personal account page.
- X OAuth PKCE login, immutable X-ID accounts, browser-bound one-time state, hashed 24-hour sessions and logout.
- Separate user balances in integer USDC base units; balanced journal and reconciliation.
- One-time test funding, spending controls, pause, pending tips, recipient-only claims and seven-day refunds including fees.
- Wallet-ownership challenges with Ed25519 verification and replay/expiry checks.
- Idempotent mock withdrawal reservations and cancellations; no transfers submitted.
- Local persistence and Neon snapshot adapter with monotonic compare-and-swap revisions.
- Disabled-by-default X mention reader with chronological processing, recipient-ID lookup, cursor checkpoints, request budgets and rate-limit backoff.
- Protected operation endpoints, bounded per-instance rate limits and queues, body limits and browser security headers.
- Finalized devnet USDC deposit evidence checks with account-bound signature receipts, duplicate protection and a separate devnet balance. No demo-credit conversion or mainnet payout is possible. Receipts cover the whole supported transaction, not individual instructions.
- Devnet withdrawal reservations require a recent wallet proof, enforce a pilot cap, retain idempotency and can be cancelled before broadcast. No transaction signer is configured.
- Allowlisted Vercel public build and GitHub test/build workflow.

Mocked tests do not prove external-service behavior. Browser QA uses isolated Alice/Bob fixtures, not live X identities.

## Must complete before a real-money pilot

1. **Configure and verify identity/persistence.** Use TagTip-specific X app settings and a separate database. Test OAuth success/denial/replay, logout, cold starts, restarts, and concurrent writes on the hosted system.
2. **Verify the mention worker with a credit budget.** Set a deliberate start post ID so historical posts cannot initiate tips. Confirm bot handle/ID, actual author IDs, blocked commands, pagination and 429 behavior. No automatic scheduler until cost limits are decided.
3. **Replace snapshot financial storage.** Use transactional normalized accounts, balances, immutable journal entries, event IDs and chain receipts. Add database constraints, row-level locking, migration/backup procedures and independent reconciliation. Do not relabel sandbox credits as backed USDC.
4. **Finish production deposit accounting.** The devnet pilot has wallet attribution, unique signature receipts and finalized balance checks. Production still needs normalized transactional rows, instruction-level receipts, independent indexing and custody reconciliation before any mainnet balance can exist.
5. **Implement custody settlement.** Select a managed signing/custody setup. Never put a treasury private key in browser code, Git or a general demo environment. Persist a signed transaction before broadcast, use the same transaction on retries, reconcile signatures independently, and keep ambiguous outcomes reserved instead of sending again.
6. **Protect withdrawals.** Require fresh authentication, verified destinations, address-change safeguards, amount limits and explicit fee disclosure. A wallet proof alone does not protect against a compromised X account.
7. **Add bot receipts and operations.** Implement bot-only posting authorization, a durable reply outbox and unknown-outcome handling. Add distributed edge limits, expiry scheduling, alerting, support/refund tools, retention/deletion policy and security review.
8. **Run a devnet end-to-end pilot.** Test real login → test deposit → X command → unregistered recipient joins → claim → devnet withdrawal → reconciliation. Then consider a separately approved, tightly capped mainnet pilot.

## What needs the owner

- TagTip's X client ID/secret, bot bearer token, bot user ID and callback origin.
- A TagTip database and hosting project; don't reuse TipOnSol's production financial data.
- An X API spend limit and polling frequency.
- Dedicated devnet treasury addresses and a custody/signing choice before transfer implementation.

Run `npm run check-config` to list missing configuration without exposing credentials. Store values in ignored local `.env` or the host's secret manager, not chat, screenshots or committed files.

## Primary integration references

- [X OAuth PKCE](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code)
- [X mentions](https://docs.x.com/x-api/posts/timelines/quickstart/user-mention-quickstart)
- [Phantom ownership messages](https://docs.phantom.com/solana/signing-a-message)
- [Solana transaction evidence](https://solana.com/docs/rpc/http/gettransaction)
- [Circle USDC mint addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses)
