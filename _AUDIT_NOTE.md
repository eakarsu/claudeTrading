# Audit Apply Notes — claudeTrading

Source: `_AUDIT/reports/batch_09.md` § claudeTrading

## Original audit recommendations

Audit verdict: **SUBSTANTIVE** — comprehensive quant trading platform with sophisticated backtesting infrastructure. 49 routes, 8 AI endpoints. No "Missing AI counterparts" section was raised — only forward-looking ideas.

### Missing non-AI features
- Live trading execution (paper trading exists)
- Regulatory compliance reporting (FINRA)
- Tax lot tracking

### Custom feature ideas
- Predictive equity curve (likely drawdown, recovery time)
- Strategy correlation analysis (avoid redundant strategies)
- Walk-forward analysis automation (curve-fitting detection)
- Trade journal NLP (extract lessons from trade notes)
- Integration with broker APIs for live trading
- Real-time strategy monitoring with anomaly alerts
- Community strategy marketplace with performance filtering
- Regulatory reporting automation

## Implemented this pass

**None.** This pass is backlog-only.

Reason: every recommendation here is either NEEDS-CREDS (broker live-trade integration, FINRA reporting), TOO-RISKY (predictive equity curve and walk-forward automation interact with live capital and would need careful test coverage), or NEEDS-PRODUCT-DECISION (community marketplace, anomaly thresholds, tax-lot accounting method FIFO/LIFO/SpecID). The constraints disallow new SDKs, frontend, and `npm install`, which rules out the broker SDK additions that the live-trade items would actually need.

The existing AI surface (`/chat`, `/market-summary`, `/portfolio-review`, `/trade-idea`, `/risk-report`, `/options-strategy`, `/politician-analysis`, `/theme-manifesto`) already covers the conversational and review use cases recommended in the audit text. Adding new endpoints without product decisions on scope (e.g. live trading governance, tax-jurisdiction selection) would be premature.

## Backlog (not implemented)

### Needs creds / external deps (forbidden this pass)
- Live broker integrations (Alpaca live trading, IBKR, etc. — Alpaca is already wired but only paper).
- FINRA/SEC regulatory reporting feeds.

### Needs product decision
- Tax lot tracking — FIFO vs LIFO vs Spec-ID, multi-jurisdiction; needs accounting policy.
- Community strategy marketplace — needs IP/sharing/pricing model.
- Real-time anomaly alerts — needs SLO/threshold definition.
- Strategy correlation analysis — needs definition of "redundant".

### Larger AI work
- Predictive equity-curve modelling (drawdown/recovery forecasting) — needs a model + walk-forward backtest harness.
- Walk-forward automation with curve-fitting detection — non-trivial statistical infrastructure.
- Trade journal NLP extraction — needs structured taxonomy for "lessons".

## Categorisation

- MECHANICAL: none safely identified given existing depth and lack of audit "missing AI counterpart" items.
- NEEDS-CREDS: live broker, regulatory feeds.
- NEEDS-PRODUCT-DECISION: tax lots, marketplace, anomaly thresholds, correlation definition.
- TOO-RISKY: predictive equity curve, walk-forward automation, live execution.

## Apply pass 3 (frontend)

FE already wired. `client/src/api.js` exports wrappers for all 8 `/api/ai/*` endpoints (`/chat`, `/market-summary`, `/portfolio-review`, `/trade-idea`, `/risk-report`, `/options-strategy`, `/politician-analysis`, `/theme-manifesto`) using its custom fetch wrapper with Bearer auth. `pages/AICenter.jsx` and `pages/Docs.jsx` (grounded `/ai/chat` with `feature='docs'`) consume them. No new FE pages required — pass-2 was backlog-only and added no new endpoints.

## Apply pass 4 (mechanical backlog)

**No new work.** Per pass-2 categorisation, **no items are tagged MECHANICAL** for this project. All forward-looking ideas remain `NEEDS-CREDS` (Alpaca live, IBKR, FINRA), `NEEDS-PRODUCT-DECISION` (tax-lot accounting policy, marketplace IP/pricing, anomaly thresholds, redundancy definition), or `TOO-RISKY` (predictive equity curve, walk-forward automation, live execution). The 8 existing AI endpoints already cover the conversational / review surface called out in the audit. No-op for this pass.
