# claudeTrading

A React and Node/PostgreSQL trading workbench with an explicitly paper-only
automated strategy runner and a separately governed broker gateway.

Broker execution is isolated per user/account/environment. Credentials use
AES-256-GCM envelopes, orders are written to a durable idempotent ledger before
submission, risk checks fail closed on unknown or stale state, and startup
reconciliation runs before persisted strategies resume.

Live execution remains disabled by default. It requires current 2FA
re-authentication, broker-limit attestation, strategy promotion evidence,
versioned disclosure acceptance, fresh reconciliation, and approvals by two
different supervision roles. See [DEPLOY.md](DEPLOY.md) and
[the live-trading runbook](docs/LIVE_TRADING_RUNBOOK.md).

```bash
npm run install:all
cd server && npm run migrate && cd ..
npm run dev:server
npm run dev:client
```

Use `./start.sh --seed` only for a new local demo database. The default startup
does not seed or reset data.
