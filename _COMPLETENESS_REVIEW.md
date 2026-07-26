# Completeness Review: claudeTrading

**Review date:** 2026-07-18

## Assessment basis

Static inspection of project-owned source, configuration, broker/risk services, tests, CI, and deployment files only; no build, database migration, market-data request, broker call, backtest, or runtime launch was performed.

## Classification

**Complete local scope**

This is a coherent paper-trading application with Alpaca adapters, idempotent order identifiers, strategy/backtest services, deterministic guardrails, audit/metrics routes, server tests, browser smoke tests, CI, and container deployment material. It is complete for local/paper evaluation, not certified for live trading or customer funds.

## Why it is not production-ready

- The auto-trader documents that positions and orders are shared at the broker-account level; live multi-user operation requires isolated per-user brokerage credentials and custody boundaries.
- Account retrieval can degrade without tripping a drawdown guard, which is not an acceptable fail-safe posture for live automated execution.
- Backtests and paper fills do not prove realistic liquidity, slippage, market-impact, corporate-action, outage, or partial-fill behavior.
- Generated gap pages and LLM readiness/risk summaries must not be treated as deterministic broker, compliance, or risk controls.
- Live use would require legal/compliance scope, licensed data terms, KYC/AML where applicable, recordkeeping, supervision, and incident procedures.

## Needed features

1. Implement encrypted per-user broker connections, explicit paper/live separation, live-trading re-authentication, dual approval, and account-scoped order/position reconciliation.
2. Make risk checks fail closed on stale/missing account or market data and enforce broker-side plus application-side limits for exposure, loss, leverage, concentration, and order rate.
3. Add a durable order ledger and reconciliation worker for duplicate requests, rejects, partial fills, bracket fills, cancels, reconnects, and out-of-order webhooks.
4. Validate strategies with walk-forward testing, survivorship-safe licensed data, realistic costs/slippage, stress scenarios, and a monitored paper-trading promotion gate.
5. Add regulatory record retention, operator supervision, customer disclosures, incident/kill-switch drills, and jurisdiction-specific compliance review before live activation.
6. Extend CI with broker-contract simulations and chaos tests for stale quotes, API throttling, network partitions, delayed fills, and recovery after restart.

## Risks or launch blockers

- A shared broker account can mix users' positions and make flatten/cancel operations affect the wrong owner.
- The current best-effort account fetch can leave execution active when risk state is unknown.
- Automated trading can cause direct financial loss; LLM output must remain outside order authorization and hard-limit enforcement.
- Demo credentials/data and paper-mode behavior must never be silently promoted to a live configuration.

## Evidence inspected

- `server/services/autoTrader.js:2`
- `server/services/autoTrader.js:9`
- `server/services/autoTrader.js:508`
- `server/services/alpaca.js:24`
- `server/test/autoTraderGuardrails.test.js:84`
- `.github/workflows/ci.yml`

## Recommended next action

Keep production disabled and build an isolated broker-contract test environment that proves fail-closed risk checks, per-account reconciliation, and restart recovery before considering any live-trading pilot.

## Implementation progress (2026-07-19)

Implemented the source-actionable controls while keeping production live
trading disabled by default:

- Added encrypted, authenticated per-user broker credential envelopes bound to
  user/account/environment, unique account ownership, fixed official paper/live
  endpoints, a Broker Governance UI, and a paper-only unattended strategy loop.
- Added the separately governed live gateway with current TOTP/password
  re-authentication, versioned disclosure acceptance, current strategy
  validation, recent reconciliation, broker-limit attestation, a 24-hour
  activation, and approvals from distinct operator/compliance identities.
- Added non-disableable application risk ceilings for fresh quotes, gross
  exposure, daily loss, leverage, concentration, per-order notional, buying
  power and order rate. Missing/invalid account, position, quote, or
  reconciliation state now fails closed; AI output is not in the authorization
  path.
- Added an idempotent durable order ledger and append-only broker event stream.
  Duplicate submits return the existing row, ambiguous network outcomes remain
  `pending_unknown`, partial/bracket/late events advance monotonically, and
  reconciliation detects unowned broker orders and activates the account kill
  switch. Account and position snapshots are retained per run.
- Added startup and periodic account-scoped reconciliation before strategy
  resume, incident kill switches, non-destructive quarterly drills, and an
  explicit reset requiring a current reconciliation and new re-authentication.
- Added the deterministic promotion gate for licensed point-in-time,
  survivorship-safe data, walk-forward windows, realistic commission/slippage/
  impact, four stress scenarios, and monitored paper duration/trade/drawdown
  evidence.
- Added additive restart-safe migrations `0008` and `0009`, automatic migration
  execution before model startup, Docker/CI database wiring, safe startup that
  does not seed/reset or kill unknown port owners, production dependency audit
  gates, and operator/retention/incident/key-rotation documentation.
- Verification: 64/64 server tests passed, including eight tests against a
  disposable real PostgreSQL database and broker-contract/chaos coverage for
  stale quotes, throttling, network partition, duplicate submission, partial
  fills, out-of-order events, restart migration replay, orphan orders, and dual
  approval. Server and client lint completed with zero errors, the client
  production build passed, client and server audits reported zero
  vulnerabilities, Compose configuration and
  shell syntax validated, and the disposable database was removed afterward.

External launch blockers remain: qualified jurisdiction-specific legal and
regulatory review; determination and implementation of applicable KYC/AML,
suitability, best-execution, licensing and reporting obligations; executed
licensed-data and broker agreements; an approved immutable archival/retention
system; independently configured and evidenced broker-side limits; and a
supervised broker sandbox/paper pilot with operator drills. Keep
`LIVE_TRADING_ENABLED=false` until those external controls are complete. A
local container image build also remains to be re-run when the Docker/Colima
daemon is available; both Compose configurations validated and CI retains its
Docker image-build gate.

## Runtime acceptance (2026-07-20)

The non-suite validator passed the complete disposable runtime journey on
PostgreSQL `55633`, API `6080`, and UI `6081` at `2026-07-20T20:32:49Z`:
`API_VERIFIED / startup_login_session_api`. Two recorded diagnostic attempts
preceded it: the first exposed missing base tables and the second exposed a
missing model import in the explicit bootstrap migration. After those fixes,
startup, environment-provisioned login, persisted session validation, and an
authenticated API request all passed. No demo seed or repository password was
used.
