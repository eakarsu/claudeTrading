# Live-trading control runbook

Live trading is disabled by default and the unattended strategy loop is
paper-only. This runbook describes the controlled gateway; it is not legal,
investment, or regulatory advice.

## Activation prerequisites

All items are mandatory:

- Written jurisdiction-specific legal/compliance approval, including whether
  KYC/AML, suitability, best-execution, licensing, or customer-funds rules apply.
- Licensed, point-in-time, survivorship-safe data provenance.
- At least five walk-forward windows, explicit commissions, slippage and market
  impact, passing gap/volatility/delayed-fill/liquidity stress scenarios, at
  least 30 monitored paper days and 100 paper trades, and no more than 15%
  paper drawdown.
- A unique live broker account, verified broker-side exposure/loss/leverage and
  order controls, and a fresh account reconciliation with no orphan orders.
- TOTP enabled and a re-authentication performed within five minutes.
- Acceptance of the server's current versioned disclosure.
- Approval by two distinct identities: an operator and compliance reviewer.
- `LIVE_TRADING_ENABLED=true` only for the approved, 24-hour activation window.

Roles cannot be self-assigned through HTTP. A database administrator grants
them under change control, for example:

```sql
UPDATE "Users" SET role = 'operator' WHERE email = 'operator@example.com';
UPDATE "Users" SET role = 'compliance' WHERE email = 'compliance@example.com';
```

Record the ticket/change identifier in the external supervision log and never
grant either role to the activation requester.

AI and LLM output is informational. It is never an input to order authorization
or hard-limit evaluation.

## Normal supervision

- Review failed and orphan-order reconciliation runs at least daily.
- Alert on active kill switches, `pending_unknown` order outcomes, stale
  reconciliations, rejection spikes, and repeated API throttling.
- Reconcile every active account at startup and at least every 60 seconds.
- Review concentration, gross exposure, daily loss, leverage and per-minute
  order counts against both application and independently configured broker
  limits.
- Expire activation rather than extending it silently. Require a new disclosure,
  re-authentication, reconciliation and dual approval.

## Incident kill switch

1. Activate the connection kill switch. This blocks new submissions first.
2. Cancel all open orders in that isolated broker account.
3. Flatten positions only if the incident commander authorizes it; record
   market-closed or partial-fill results.
4. Preserve logs, durable order/event rows, reconciliation runs and broker
   statements. Do not edit order history.
5. Reconcile until broker and local state match. Any orphan keeps the switch on.
6. Complete incident review and legal/compliance notification assessment.
7. A reset requires current reconciliation and places the connection into
   `reauth_required`; re-authentication and activation approval are repeated.

Run a simulated drill quarterly. The drill verifies cancel/flatten adapter
contracts without transmitting destructive broker requests and records the
result in `KillSwitchDrills`.

## Record retention

Retain immutable audit logs, broker connections (without exposed plaintext
secrets), activations/approvals, disclosure acceptance, validations and data
provenance, order/event ledgers, reconciliation runs, kill-switch drills,
broker statements, operator communications, incidents and customer notices.

The application preserves these records and never cascades account deletion
through them. The final retention period, legal hold process, storage immutability
and export format are jurisdiction-dependent external controls. Configure a
documented retention schedule and tested archival/export process before a pilot.

## Credential-key rotation

The database stores AES-256-GCM envelopes bound to user, environment and account.
Store `BROKER_CREDENTIALS_KEY` in a secrets manager, not source or image layers.
For rotation, deploy code that can decrypt the old key version and re-encrypt to
the new version in a transaction, verify every envelope, then retire the old key.
Do not simply replace the environment value; that correctly makes old envelopes
unreadable and trading fail closed.
