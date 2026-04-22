# Claude Trading Platform — User Manual

A paper-trading sandbox powered by Alpaca's paper API, Express, React, and
Postgres. This manual walks through every feature, how to log in, and how to
drive the auto-trader safely.

---

## 1. Getting started

### 1.1 Start the app locally

```bash
./start.sh
```

This script cleans ports 3001 / 5173, starts PostgreSQL (via Homebrew),
creates the `claude_trading` database if missing, installs both server and
client deps, runs migrations, seeds demo data, and launches both servers
with hot reload.

- Backend API: http://localhost:3001
- Frontend: http://localhost:5173
- Press `Ctrl+C` in the terminal to stop both servers.

`start.sh` writes a pidfile at `.start.pid` and kills the previous
instance's process tree on the next launch — so running it twice (or
after a crashed shutdown) will never EADDRINUSE on port 3001. Ctrl+C
now also kills nodemon's child `node` process, not just nodemon itself.

**Flags:**

| Flag | Purpose |
|------|---------|
| `--reseed` | Force `node seed.js --reset` (drops all seed rows and re-inserts). Use this after pulling a migration that added a column the seed populates — e.g. the 0006 `MarketNews.url` column. Without this flag, `seed.js` is a no-op when any user exists, so normal restarts preserve your local data. |
| `-h`, `--help` | Print usage and exit. |

### 1.2 Demo login

After seeding, a single demo user is available:

- Email: `trader@claude.ai`
- Password: `trading123`

Override with `E2E_EMAIL` / `E2E_PASSWORD` when seeding your own account
or change the password from **Account → Security** after logging in.

The seeded demo user ships with a handful of sample rows so the UI
isn't blank on first login: an active auto-trader config, ~20 past
fills across several strategies, a couple of price alerts, and 6
notifications (auto-trader fills, a price alert trigger, a security
event, a welcome `info` row, and a `[DRY]` simulated fill) — one per
notification type so `/notifications` demonstrates every filter tab.

### 1.3 First-run checklist

1. Open http://localhost:5173 and sign in with the demo credentials.
2. (Optional) Enable 2FA: **Account → Security → Enable 2FA**, scan the QR in
   Google Authenticator / 1Password, and save the backup codes — they are
   shown only once.
3. Configure Alpaca paper keys in `.env` (see `DEPLOY.md`) if you want live
   paper fills rather than the seeded mock data.

---

## 2. Navigation overview

The left sidebar contains all features. Sections are grouped by workflow:

| Group              | Pages                                                                                            |
|--------------------|--------------------------------------------------------------------------------------------------|
| Overview           | Dashboard                                                                                        |
| Positions & orders | Trailing Stops, Portfolio, Alpaca Trading                                                        |
| Research           | Watchlist, Stock Screener, Market News, Sentiment, Options Chain                                 |
| Signals & strategy | Trade Signals, Signal Charts, Strategy Lab, Copy Trading, Wheel Strategy                         |
| Journaling         | Trade Journal, Trade Replay                                                                      |
| Alerts & events    | Price Alerts, Event Calendar, Notifications                                                      |
| Risk               | Risk Calculator                                                                                  |
| Automation         | AI Center, Audit Log                                                                             |
| Account            | Account (profile / security / active sessions / danger zone)                                     |

The **Notifications** link shows a red unread-count badge that polls the
server every 30 s.

A logout button sits at the bottom of the sidebar; it revokes the session
token server-side and clears local storage.

---

## 3. Authentication

### 3.1 Login

Open `/login`. Submit email + password. On success you are redirected to `/`.
If the account has 2FA enabled, the server returns a short-lived challenge
token and the UI prompts for a 6-digit code.

**Rate limit:** 10 login attempts per IP per 15 minutes. The 11th attempt
returns `429 Too Many Requests` with a retry-in-minutes hint. The same
counter applies to failed **and** successful logins to slow password-spray
attacks; stop typing for a few minutes if you hit it.

### 3.2 Two-factor authentication (TOTP)

**Enable:**
1. Go to **Account → Security**.
2. Click **Enable 2FA**.
3. Scan the QR code (or copy the secret) into your authenticator.
4. Enter the current 6-digit code.
5. Copy + save the 10 backup codes shown. Each is one-shot.

**Disable:** **Account → Security → Disable 2FA** (requires current TOTP or a
backup code).

**Lost device:** Use a backup code on the 2FA challenge screen, then
re-enroll from Account settings to rotate the secret.

### 3.3 Password management

**Strength rules (register + reset):**
- Minimum **10 characters**
- Must contain at least **one letter** (A–Z / a–z)
- Must contain at least **one digit** (0–9)

Change-password on an existing account only enforces the legacy 8-char
minimum so older accounts can still rotate without a forced uplift, but
you should still use a 10+ char password.

- **Change password:** **Account → Security → Change password.** You must
  re-enter the current password.
- **Reset password (forgot):** Not wired to email in local dev; the API
  endpoint `POST /api/auth/forgot-password` issues a one-shot reset token.
  Call it via the provided form on `/login` and redeem via
  `POST /api/auth/reset-password`.

### 3.4 Logout

Click the sidebar logout button. The JWT is hashed and added to a revocation
list server-side so the token cannot be reused even if a copy leaked.

### 3.5 Active sessions

Every successful login stamps a **Session** row (user agent, IP, last-seen
timestamp, token expiry). View and manage them at **Account → Active
sessions**.

- Your current device is highlighted and cannot be self-revoked (use the
  sidebar **Logout** button instead).
- Click **Revoke** on any other row to kill that device's JWT immediately.
  The token is hashed and added to the server revocation blocklist, so the
  device's next API call returns `401` even if it still has the raw token.
- Rows are pruned automatically when the JWT expires (default 7 days).
- `lastSeenAt` updates at most once per minute per session to avoid DB
  thrash.

### 3.6 Delete account

**Account → Danger zone → Delete account.** You must type `DELETE` to
confirm. This is irreversible and removes all per-user data.

---

## 4. Dashboard

`/` shows:

- **Portfolio value, daily P&L, positions count, win rate** (top KPI cards).
- **Auto-Trader status** — running/stopped, active strategy, consecutive
  losses, kill reason (if tripped).
- **Recent trades** — 5 latest auto-trader fills; click a row to jump into
  **Trade Replay** for that trade.
- **Upcoming events** — earnings and macro events in the next 14 days
  (FOMC, CPI, NFP, custom).

The cards poll every ~30 s; refresh the page to force an update.

---

## 5. Positions & orders

### 5.1 Trailing Stops (`/trailing-stops`)

Manage per-symbol trailing-stop rules. Each entry holds entry price,
highest price seen, stop-loss %, trailing %, and a computed floor price.
The auto-trader's trailing-stop reconciler consumes active rows and places
matching Alpaca trailing-stop orders when the option is enabled.

Create / edit / delete rows from the page. Status transitions to `stopped`
when the floor is hit.

### 5.2 Portfolio (`/portfolio`)

Holdings view with quantity, avg price, current price, P&L, and allocation
percentage. This is a per-user table — updates are persistent.

### 5.3 Alpaca Trading (`/alpaca-trading`)

Direct interface to the paper-brokerage:

- Account summary (cash, buying power, equity).
- Live positions (pulled from Alpaca, not the local DB).
- Open orders (cancellable).
- Manual order entry — symbol, side, qty, type (market / limit / stop /
  trailing-stop), TIF.
- **Per-position "Close"** button — Alpaca liquidates the full quantity at
  market. Confirmation prompt is non-skippable. If the close is blocked
  by a pending order reserving the qty (`insufficient qty available` —
  common when a bracket-stop was auto-placed on entry), the UI offers a
  one-click retry via the `close-safely` endpoint.
- **Per-position "Force"** button — explicit `POST /api/alpaca/positions/:symbol/close-safely`.
  Cancels every open order for the symbol server-side first, then closes.
  Use when you already know a bracket / pending order is reserving qty
  and want to skip the plain-close round trip.
- **"Flatten all"** button (header) — `DELETE /api/alpaca/positions/close-all`,
  closes every position **and** cancels every open order in one call.
  Also confirmation-gated. Use when a session goes sideways and you want
  the book flat immediately.

All close/flatten actions are written to the **Audit Log** with action
keys `alpaca.position.close`, `alpaca.position.close-safely`, and
`alpaca.positions.close-all`.

All orders hit the Alpaca paper endpoint; nothing touches live capital.

---

## 6. Research tools

### 6.1 Watchlist (`/watchlist`)

Symbol list with notes, sector, change %. Click a symbol to pull fresh
quote + AI commentary.

### 6.2 Stock Screener (`/stock-screener`)

Filter candidates by sector, market cap, P/E, dividend yield, and AI score.
Screener rows are seedable — your edits persist per user.

### 6.3 Market News (`/market-news`)

Aggregated headlines tagged with symbol + sentiment. Each row shows
title, summary, source, published date, and an **optional outbound link**
(the `url` column, added in migration `0006`). When a row has a URL the
title becomes clickable and a "Read article ↗" link appears in the card
footer — both open in a new tab with `rel="noopener noreferrer"`. Rows
with no URL render as plain text, so hand-authored entries still work.

Only `http(s)` URLs are rendered as links (enforced client-side in
`MarketNews.jsx`), so pasted junk in the URL field gracefully degrades to
the no-link layout rather than producing a broken anchor.

**Seed content vs. real news.** The seeded rows point at **stable
destinations** — regulator sites (Federal Reserve FOMC, SEC EDGAR, US
Treasury press) and company **investor-relations** portals (Apple,
NVIDIA, Tesla, etc.). These pages don't rot or 404, but they're *not*
dated articles — they're the authoritative hubs where real filings and
press releases are published. To pull actual dated articles:

1. Set `NEWS_PROVIDER=finnhub` and `FINNHUB_API_KEY=...` in `.env` (free
   tier works; see `https://finnhub.io/register`).
2. Click **Sync real news** at the top of `/market-news`. The button
   calls `POST /api/market-news/sync`, which hits
   `finnhub.io/api/v1/news?category=general` and inserts each headline
   with its canonical `url`, `source`, and `publishedAt`. De-dup is on
   (title, publishedAt) so re-running the sync is cheap.
3. Wire the same endpoint into a nightly cron if you want a rolling feed
   without clicking.

Also supports `POST /api/market-news/sync` with `{ "symbol": "AAPL" }`
to pull company-specific news for a single ticker over a 7-day window.

### 6.4 Sentiment (`/sentiment`)

Per-symbol sentiment with source (Twitter/X, Reddit, news, analyst), a
normalized score, and bullish/bearish %. Useful input when the auto-trader
is running a sentiment-weighted strategy.

### 6.5 Options Chain (`/options-chain`)

Calls/puts with strike, expiration, premium, IV, delta, open interest.
Sortable by any column; filter by symbol.

---

## 7. Signals & strategy

### 7.1 Trade Signals (`/trade-signals`)

Curated technical signals (MACD, Golden Cross, RSI bounce, Bollinger, chart
patterns, Fibonacci, VWAP, Stochastic, Ichimoku). Each signal has
confidence, entry, target, stop, timeframe.

### 7.2 Signal Charts (`/signal-charts`)

Inline SVG price chart for a chosen symbol with overlays for the indicators
the signal engine reports. No external charting library — renders from
Alpaca bars.

### 7.3 Strategy Lab (`/strategy-lab`)

Backtest harness. Pick a symbol, strategy, date range, and parameters. The
backend replays historical bars and returns equity curve, drawdown, trade
count, win rate, and Sharpe. Good for sanity-checking before putting a
strategy on the auto-trader.

### 7.4 Copy Trading (`/copy-trades`)

Congressional and notable-investor disclosures. Each row has politician,
symbol, action, trade date, qty, total value. Use as an idea pipeline —
marking a row as executed copies it to your journal.

### 7.5 Wheel Strategy (`/wheel-strategies`)

Put-sell → assignment → call-sell cycle tracker. Each row holds stage,
strike, expiration, premium, cost basis, contracts. Useful for running the
classic wheel without a spreadsheet.

---

## 8. Journaling & replay

### 8.1 Trade Journal (`/trade-journal`)

Manual log of trades with entry/exit, P&L, notes, and strategy tag. Add
rows directly or copy from Trade Signals / Copy Trades.

### 8.2 Trade Replay (`/trade-replay`)

Two-pane view:

- **Left:** filterable list of auto-trader fills (by symbol, strategy, tag).
- **Right:** detail panel with an SVG price chart centered on the entry
  bar, entry-context snapshot (the indicator values recorded when the bot
  pulled the trigger), editable tags, and a "copy to journal" button.
  A **timeframe dropdown** (1 Min / 5 Min / 15 Min / 1 Hour / Daily) lets
  you zoom the replay chart in or out — the chart re-queries the same
  deterministic seed so flipping timeframes shows the same trade at a
  different resolution.

Use this to post-mortem bot trades: why did the strategy fire, and was the
setup legit?

---

## 9. Alerts & events

### 9.1 Price Alerts (`/price-alerts`)

Rules like "TSLA above 280" or "AAPL below 180". The alert evaluator
service runs every 30 s on the server, compares latest quote to each
active rule, and marks triggered rules (notification delivery is pluggable).

### 9.2 Event Calendar (`/event-calendar`)

Upcoming earnings and macro events. Use the **Sync earnings** button to
pull the next N days from Finnhub (requires `FINNHUB_API_KEY`). Macro
events (FOMC, CPI, NFP) can be added manually.

Events also act as **blackout windows** for the auto-trader: configure it
to avoid opening new positions in a symbol within X hours of earnings.

**Add-event validation:** Earnings events require a symbol; custom events
require a symbol OR a note. Both the form and the API reject blank rows,
so the calendar no longer gets polluted with empty entries.

### 9.3 Notifications (`/notifications`)

In-app notification feed. Sources that write here:

| Type          | When it fires                                                  | External fanout |
|---------------|----------------------------------------------------------------|-----------------|
| `price-alert` | A `PriceAlert` crosses its threshold                           | Slack + Discord + email (already via the alert path) |
| `auto-trader` | Auto-trader fills a buy/sell, or a dry-run cycle produces one  | Slack + Discord + email (via `notifier.orderFilled`) |
| `security`    | Kill switch triggered, session revoked, password changed       | Slack + Discord + email |
| `info`        | Generic catch-all (manual `createNotification` calls)          | Slack + Discord + email |

Page controls:

- **Unread only** checkbox — filters to unread rows.
- **Mark all read** — single-click clears the unread badge.
- Per-row **mark-read** (check icon) and **delete** (trash icon).
- **Pagination:** 50 per page, Previous / Next.

Unread counts:

- The sidebar badge polls `/api/notifications/unread-count` every 30 s.
- Opening the page does **not** auto-mark rows as read — click the check
  icon or **Mark all read** to clear them.

Dry-run auto-trader fills are prefixed `[DRY]` in the title so the feed
is visually distinct from real paper fills.

---

## 10. Risk Calculator (`/risk-assessments`)

Per-symbol risk profile: position size, risk level, max loss, risk/reward
ratio, volatility. Useful as a reference table before sizing a new trade.

---

## 11. Automation

### 11.1 AI Center (`/ai-center`)

Centralized controls for every AI-assisted feature:

- **Claude analysis usage:** per-day token and cost tracking.
- **Daily budget guardrail:** configurable spend cap (requests are blocked
  once exceeded).
- **Per-feature toggles:** enable/disable AI commentary on Watchlist,
  Signals, Sentiment, Options, and the Auto-Trader.

### 11.2 Auto-Trader

Configuration lives in the Dashboard "Auto-Trader" card and full controls
on the **Alpaca Trading** / AI Center pages:

- **Start / stop:** toggles the run loop.
- **Active strategy:** one of the backtestable strategies.
- **Symbol universe:** comma-separated tickers to scan.
- **Config JSON:** per-strategy params, risk caps, trailing-stop opt-in,
  earnings-blackout window.
- **Kill switches:** several, all optional (set to `null` or `0` to
  disable). When any trips, the bot self-stops, records `killedReason`,
  and writes a `security` notification to the owning user's feed:
  - `stopOnConsecutiveLosses` — consecutive-loss cap
  - `stopOnDailyLossPct` — daily-P&L floor (as fraction of equity)
  - `stopOnDrawdownPct` — equity drawdown since `last_equity` (e.g. `0.05` = −5%)
  - `maxShortExposureDollars` — cap on aggregate short notional (absolute $)
  - `maxTotalExposureDollars` — cap on aggregate long+short notional
  - `maxShortPositions` — cap on count of open short positions

**Dry-run mode** (`"dryRun": true` in the config JSON, per-symbol override
supported):

- Full strategy loop runs — indicators compute, signals fire, position
  sizing and blackout checks apply.
- `alpaca.placeOrder` is **not** called. A synthetic order ID prefixed
  `dry-` is recorded instead.
- Trade log rows are created (with `| DRY RUN` appended to `reason`) so
  Trade Replay still works.
- Notifications still fire, tagged `[DRY]` in the title, and the Slack /
  Discord / email fanout still happens — useful for sanity-checking a
  strategy config end-to-end before you let it touch the paper broker.
- Flip `dryRun` back to `false` to resume real paper fills; no restart
  required, next tick honors the new flag.

> ✅ **Dry-run trades are gated out of the kill switches.** The `if
> (!dryRunSell)` guard at `server/services/autoTrader.js:681` skips the
> `dailyPnl` / `consecutiveLosses` update when a sell is simulated, so a
> bad simulation cannot self-stop the bot. Real paper fills still trip the
> kill switches normally.

**Per-symbol overrides.** `config.perSymbol.<SYMBOL>` (e.g.
`config.perSymbol.AAPL.dryRun = true`) merges into the strategy config for
that symbol only. Root-level values still apply to every other symbol in
the universe. Useful for dry-running a single ticker while the rest of the
book trades live paper, or for per-symbol risk/trail tweaks.

**Tick cadence.** The poll interval is derived from the strategy's
timeframe, not a fixed value: `1Min` → 15 s, `5Min` → 30 s, `15Min` → 60 s,
`1H` → 120 s, `1Day` → 300 s. Override with `config.checkIntervalMs` if
you need a custom rate.

**Kill-switch counters reset on start.** `POST /auto-trader/start` zeros
`consecutiveLosses`, `dailyPnl`, and `killedReason` before the first tick
(`autoTrader.js:713-715`). Stopping and restarting the bot is therefore a
full reset — intentional, but worth knowing if you expected the daily
counter to survive a restart.

On every cycle the bot: fetches positions, re-evaluates strategy signals,
places new entries (respecting blackouts), and reconciles trailing stops.
Every fill is written to `AutoTraderTrade` with an entry-context snapshot.

**Fill notifications:** each real (and dry-run) fill writes a per-user row
to `Notifications` with type `auto-trader`, linking back to
`/auto-trader`. The sidebar badge updates within 30 s.

### 11.3 Audit Log (`/audit-log`)

Read-only, append-only record of every mutating action. Filter by user,
action, or date. Common `action` keys:

| Area           | Action keys                                                  |
|----------------|---------------------------------------------------------------|
| Auth           | `auth.login`, `auth.verify-totp`, `auth.register`, `auth.logout`, `auth.change-password`, `auth.delete-account` |
| 2FA            | `auth.2fa.enroll`, `auth.2fa.verify`, `auth.2fa.disable`     |
| Sessions       | `auth.session.revoke`                                         |
| Alpaca orders  | `alpaca.order.place`, `alpaca.order.cancel`                   |
| Alpaca positions | `alpaca.position.close`, `alpaca.positions.close-all`       |
| Auto-trader    | `auto-trader.start`, `auto-trader.stop`                       |

Secrets, tokens, and passwords are scrubbed from the logged request body
before persistence.

---

## 12. Account (`/account`)

Five sections:

1. **Profile** — email, display name, account age.
2. **Security** — change password, 2FA enroll/disable, backup codes.
3. **Active sessions** — list of every device signed into this account
   with user-agent, IP, last-seen time, and a **Revoke** button per row.
   The current device is flagged and cannot self-revoke. See §3.5 for
   mechanics.
4. **Webhook ingress** — shows the per-user ingress URL
   (`/api/webhooks/in/<userId>`), whether a secret is currently set, and
   **Generate / Rotate / Remove** buttons. On rotate, the new secret is
   displayed exactly once — copy it immediately into your external tool's
   secret manager. An expandable "Example payload & signing" block shows
   the required headers (`X-Signature: sha256=<hex>`, optional
   `X-Timestamp`) and a Python HMAC snippet. See §20.5 for the ingress
   endpoint contract.
5. **Danger zone** — delete account (type `DELETE` to confirm).

---

## 13. CSV exports

Most CRUD resources expose a one-click CSV download at
`GET /api/<resource>/export.csv`. Output is scoped to the signed-in user
and capped at 5000 rows (newest first).

| Page / resource  | Endpoint                                    |
|------------------|---------------------------------------------|
| Trade Journal    | `/api/trade-journal/export.csv`             |
| Portfolio        | `/api/portfolio/export.csv`                 |
| Watchlist        | `/api/watchlist/export.csv`                 |
| Price Alerts     | `/api/price-alerts/export.csv`              |
| Trade Signals    | `/api/trade-signals/export.csv`             |
| Trailing Stops   | `/api/trailing-stops/export.csv`            |
| Copy Trades      | `/api/copy-trades/export.csv`               |
| Wheel Strategies | `/api/wheel-strategies/export.csv`          |
| Risk Assessments | `/api/risk-assessments/export.csv`          |
| Stock Screener   | `/api/stock-screener/export.csv`            |
| Sentiment        | `/api/sentiment/export.csv`                 |
| Options Chain    | `/api/options-chain/export.csv`             |
| Market News      | `/api/market-news/export.csv`               |
| Auto-trader fills| `/api/auto-trader/trades/export.csv`        |
| Audit log        | `/api/audit-log/export.csv`                 |

The CSV is emitted with `Content-Disposition: attachment` so browsers
download instead of rendering. Each file is timestamped
(`trade-journal-<epoch>.csv`).

---

## 14. External notification channels

The notifier fans out auto-trader events and price-alert triggers to any
channel that has credentials configured:

| Channel | Enable by setting             | Behavior                                               |
|---------|--------------------------------|--------------------------------------------------------|
| Slack   | `SLACK_WEBHOOK_URL`            | Posts to the incoming webhook's default channel        |
| Discord | `DISCORD_WEBHOOK_URL`          | Posts to the webhook's target channel (`content` field)|
| Email   | `RESEND_API_KEY` + `ALERT_EMAIL_TO` | Resend HTTP API; `ALERT_EMAIL_FROM` overrides sender |

Channels are **additive** — configuring all three sends to all three.

**Throttle table** (`server/services/notifier.js:109-116`). Counted
in-memory per process, sliding window:

| Event kind            | Window | Max events | Fires on                                          |
|-----------------------|--------|------------|---------------------------------------------------|
| `orderFilled`         | 60 s   | 10         | Every auto-trader buy/sell (real and dry-run)     |
| `killSwitchTriggered` | 60 s   | 1          | Consecutive-loss cap or daily-P&L floor tripped   |
| `started`             | 60 s   | 3          | `POST /auto-trader/start`                         |
| `stopped`             | 60 s   | 3          | `POST /auto-trader/stop` or kill switch           |
| `raw`                 | 60 s   | 20         | Generic `notifier.raw()` passthroughs             |

When a window saturates, the first drop logs `Notifier throttle engaged`;
the next flush logs a `suppressed` count so you can tell how many messages
were dropped.

To test a channel without running the auto-trader, trip a price alert
whose target is already satisfied — the evaluator will fire within 30 s.

---

## 15. Keyboard & UI conventions

- **Tables:** header click = sort; secondary-click same header = reverse.
- **Forms:** `Enter` submits, `Esc` closes a modal.
- **Cards:** hover for quick actions (edit / delete / open detail).
- **Sidebar badge:** the red pill next to **Notifications** shows unread
  count; caps at `99+`. Refreshes every 30 s or after any list action.
- **Dark mode:** automatic — follows OS preference.

---

## 16. Troubleshooting

| Symptom                                                  | Fix                                                                                                   |
|----------------------------------------------------------|-------------------------------------------------------------------------------------------------------|
| `./start.sh` fails on seed with `column "userId" does not exist` | DB predates the per-user migration. Drop and recreate: `dropdb claude_trading && createdb claude_trading`, then re-run `./start.sh`. |
| `Seed error: relation "..._user_id" already exists`      | Sequelize index-name collision. Recreate the DB as above; the model factory now prevents recurrence. |
| Port already in use / `EADDRINUSE :::3001`                | Re-run `./start.sh` — it kills the previous instance's full process tree via its pidfile (`.start.pid`). If that fails (e.g. pidfile pointing at a reused PID), run `lsof -ti:3001 \| xargs kill -9` (and 5173) manually. |
| `Sync rate limit exceeded` 429 on Market News / earnings sync | You hit the per-user limit (10 syncs / 5 min). The ceiling protects the shared Finnhub/earnings-provider API key. Wait the `Retry-After` header's worth of seconds.        |
| Alpaca ECONNRESET spam from alert evaluator              | Check `GET /api/health/alpaca`. Returns `{reason:"no_keys"}` if `.env` is missing keys, `{reason:"network"}` if Alpaca is unreachable (firewall/VPN), `{reason:"auth_or_upstream"}` otherwise. Set `ALERT_POLL_INTERVAL_MS=0` in `.env` to disable the evaluator while debugging. |
| Login returns 401                                         | Wrong password or 2FA code. Reset seed: `node server/seed.js --reset`.                                |
| Alpaca endpoints 403                                      | Missing `ALPACA_API_KEY` / `ALPACA_API_SECRET` in `.env`. Paper-API keys work fine.                    |
| AI endpoints 429                                          | Daily Claude budget exceeded. Raise the cap in AI Center or wait for UTC midnight.                     |
| Frontend loads but all data is empty                      | Backend unreachable. Check http://localhost:3001/api/health and server log output.                    |
| Login returns 429 "Too many login attempts"               | IP-based rate limit (10 / 15 min). Wait the suggested number of minutes or restart the server to clear the in-process counter. |
| `/api/notifications` returns 404                          | Server running an older build. Restart `server/index.js` so the new routes mount.                     |
| Notifications sidebar badge never updates                 | Unread-count poll is silent-fail. Open browser devtools → Network → filter `unread-count` and check the response; 401 usually means the token is stale — sign out and back in. |
| Active sessions list shows duplicate rows                 | Each distinct token hash is one session. Revoking uses the `id` column, not `tokenHash` — safe to kill one without affecting the other device. |
| "Flatten all" returns empty body                          | Normal when there are no positions. Alpaca returns `[]`; the UI reloads and the table stays empty.    |
| Close errors with `insufficient qty available for order`  | A pending order (usually a bracket-stop auto-placed on entry) has reserved the full qty. Click **Force** on the position row, or hit `POST /api/alpaca/positions/:symbol/close-safely` — cancels the pending order(s) server-side, then closes. |
| Auto-trader logs "DRY RUN" forever                        | `dryRun: true` is set somewhere — check the root config **and** `perSymbol.<SYMBOL>.dryRun`. Per-symbol beats root. |
| Discord notifications never arrive                        | Verify `DISCORD_WEBHOOK_URL` is the full `.../webhooks/<id>/<token>` URL. A missing token returns 401 silently; check the server log for `Discord notify failed`. |

---

## 17. Environment variables (quick reference)

See `DEPLOY.md` for the full list. The essentials for local dev:

| Var                     | Purpose                                         |
|-------------------------|-------------------------------------------------|
| `DATABASE_URL`          | Postgres connection string                      |
| `JWT_SECRET`            | JWT signing key (required — set anything long) |
| `ALPACA_API_KEY/SECRET` | Paper-brokerage keys                            |
| `ALPACA_ENDPOINT`       | Override the Alpaca base URL (default paper endpoint) |
| `ALPACA_LIVE_TRADING`   | `true` flips `TRADING_MODE=live`. `/auto-trader/start` will refuse unless the config explicitly acknowledges `modeAcknowledged: 'live'`. |
| `OPENROUTER_API_KEY`    | Primary AI provider. If set, the AI Center routes through OpenRouter |
| `OPENROUTER_MODEL`      | Model slug passed to OpenRouter (e.g. `anthropic/claude-haiku-4.5`) |
| `ANTHROPIC_API_KEY`     | Optional fallback. Used when OpenRouter isn't configured, or when an OpenRouter call fails upstream |
| `ANTHROPIC_MODEL`       | Model id passed to the Anthropic Messages API (default `claude-haiku-4-5-20251001`) |
| `AI_DAILY_TOKEN_LIMIT`  | Daily per-user token cap enforced by AI Center guardrail |
| `ALLOW_REGISTRATION`    | Gate the public `/register` endpoint (`true` opens signup) |
| `FINNHUB_API_KEY`       | Enables earnings-calendar sync and Market News `/sync` |
| `EARNINGS_PROVIDER`     | Switch earnings data source (default Finnhub)   |
| `NEWS_PROVIDER`         | `finnhub` to enable real-article ingestion on the Market News page; `none` (default) keeps the seeded stable-URL rows only |
| `SERVER_PORT`           | API port (default 3001)                         |
| `CLIENT_PORT`           | Vite dev port (default 5173)                    |
| `CORS_ORIGIN`           | Comma-separated allow-list for CORS (defaults to the two localhost ports) |
| `LOG_LEVEL`             | Pino log level (`debug` / `info` / `warn` / `error`) |
| `SLACK_WEBHOOK_URL`     | Slack incoming-webhook for notifier fanout      |
| `DISCORD_WEBHOOK_URL`   | Discord webhook for notifier fanout             |
| `RESEND_API_KEY`        | Enables Resend-based email fanout               |
| `ALERT_EMAIL_TO`        | Shared recipient for notifier emails            |
| `ALERT_EMAIL_FROM`      | From-address on notifier emails (default `alerts@claudetrading.local`) |
| `ALERT_POLL_INTERVAL_MS`| Price-alert evaluator tick interval in ms (default `30000`). Set to `0` to disable the evaluator entirely — useful when offline/behind a firewall that blocks Alpaca. |
| `TRADE_SIGNAL_TTL_HOURS`| Hours before active `TradeSignal` rows auto-expire (default `72`) |
| `TOTP_ISSUER`           | Issuer string embedded in the 2FA QR code       |
| `PRICE_CACHE_TTL_MS`    | In-process quote cache TTL                      |
| `PRICE_CACHE_BREAKER_THRESHOLD` | Consecutive upstream failures before the quote cache opens its circuit breaker (default `3`) |
| `PRICE_CACHE_BREAKER_COOLDOWN_MS` | Cooldown before the breaker tries upstream again (default `60000`). During cooldown, stale cache is served and warnings are demoted to debug. |
| `BARS_CACHE_TTL_MS`     | Historical-bar cache TTL                        |
| `INDEX_QUOTE_TTL_MS`    | Index quote cache TTL (SPY/QQQ etc.)            |
| `INDEX_BARS_TTL_MS`     | Index bars cache TTL                            |
| `MARKET_STREAM_INTERVAL_MS` | Per-client tick rate for the `/api/market-data/stream` SSE feed |
| `SSE_MAX_PER_USER`      | Max concurrent SSE streams a single user can open |

---

## 18. Safety notes

- The app only calls **Alpaca paper** endpoints. No live trading wiring is
  present. To point at live, swap base URLs in `server/services/alpaca.js`
  and re-read the live-trading checklist in `DEPLOY.md` first.
- AI spend is capped per-user per-day by the AI Center guardrail. Rate-limit
  headers are surfaced in the UI.
- Secrets are never logged; audit-log `meta` scrubs tokens/passwords before
  persisting.
- All per-user tables are scoped by `userId` on read/write — you cannot
  see another user's data even if you guess an ID.

---

## 19. Support

- API reference (Swagger): http://localhost:3001/api/docs
- Health: http://localhost:3001/api/health
- Prometheus metrics: http://localhost:3001/api/metrics
- Source: `server/`, `client/`, migrations in `server/migrations/scripts/`.

---

## 20. Additional API endpoints (beyond CRUD + CSV)

The Swagger page at `/api/docs` is canonical; this section highlights
endpoints that are not obvious from the UI and are not covered by §13's
CSV table.

### 20.1 Real-time quote stream (SSE)

`GET /api/market-data/stream?symbols=AAPL,TSLA`

Server-Sent Events feed that emits the latest quote for each subscribed
symbol on a server-side interval (`MARKET_STREAM_INTERVAL_MS`). The token
can be supplied via the `Authorization` header or a `?token=...` query
param (the query form exists because `EventSource` can't set headers).
Concurrent streams per user are capped by `SSE_MAX_PER_USER`.

### 20.2 Performance analytics

| Endpoint                          | Returns                                               |
|-----------------------------------|-------------------------------------------------------|
| `GET /api/performance/summary`    | Totals: realized P&L, win rate, trade count, Sharpe   |
| `GET /api/performance/by-symbol`  | Rollup per symbol — net P&L, wins, losses, trade count|
| `GET /api/performance/monthly`    | Calendar-month buckets with P&L and trade count       |

All three are per-user and derived from `AutoTraderTrade` rows; useful for
building custom dashboards on top of bot activity.

### 20.3 Strategy discovery

`GET /api/strategies` — list of every backtestable strategy key the server
knows about, with display name and the config schema each strategy
accepts. The Strategy Lab and Auto-Trader pages populate their dropdowns
from this endpoint.

### 20.4 Auto-trader trade management

| Endpoint                                           | Purpose                                           |
|----------------------------------------------------|---------------------------------------------------|
| `PATCH /api/auto-trader/trades/:id/tags`           | Replace the tag list on a bot fill (Trade Replay) |
| `POST /api/auto-trader/trades/:id/journal`         | Copy a bot fill into the manual `TradeJournal`    |
| `GET /api/auto-trader/trades/:id`                  | Detail view including the entry-context snapshot  |

### 20.5 Webhook ingress

`POST /api/webhooks` — HMAC-validated entry point for third-party signal
providers. **No JWT is required**; the caller must sign the body with the
shared secret. If you don't use this, leave the signing secret unset and
the endpoint rejects every request.

---

## 21. FAQ

**Does any of this touch real money?**
Only if you explicitly opt in. The default `TRADING_MODE` is `paper` and
hits Alpaca's paper endpoint. Setting `ALPACA_LIVE_TRADING=true` flips the
mode, but `/auto-trader/start` additionally requires
`config.modeAcknowledged: 'live'` or it throws a 400. See
`autoTrader.js:699-706`.

**Will a dry-run simulation trip the kill switch?**
No. Dry-run sells are excluded from `dailyPnl` / `consecutiveLosses`
updates via an `if (!dryRunSell)` guard at `autoTrader.js:681`, so a
losing simulation won't auto-stop the bot. Real paper fills still trip
the kill switches normally. See §11.2.

**Does stopping and restarting the bot wipe the loss counters?**
Yes. `POST /auto-trader/start` resets `consecutiveLosses`, `dailyPnl`, and
`killedReason` to zero before the first tick (`autoTrader.js:713-715`).

**Why is `/api/notifications` not clearing the unread badge when I open it?**
By design — opening the page doesn't mark rows read. Use **Mark all read**
or the per-row check icon (§9.3). The sidebar badge polls every 30 s and
will catch up.

**Which AI provider does the server call?**
OpenRouter is the primary path (`OPENROUTER_API_KEY` + `OPENROUTER_MODEL`).
`ANTHROPIC_API_KEY` + `ANTHROPIC_MODEL` are read as an automatic fallback —
used when OpenRouter isn't configured or its upstream call fails. Set
either (or both) in `.env`. §17 has the full list.

**Can two users share a watchlist / journal / signals?**
No. Every domain table is scoped by `userId` on read and write. Export to
CSV (§13) and re-import under the other account if you need to share.

**What happens to a JWT after logout?**
The token's hash is inserted into a revocation list. The server keeps a
60 s in-memory cache of the blocklist and falls back to the DB
(`RevokedToken`) on a miss, so revocation is effectively immediate on the
same process and at most ~60 s stale across processes. Expired entries
are pruned hourly.

**How wide is the 2FA code window?**
The TOTP verifier accepts the previous, current, and next 30-second
timestep (±~30 s tolerance), so a slightly desynced authenticator still
works.

---

## 22. Glossary

| Term                 | Meaning                                                                                              |
|----------------------|------------------------------------------------------------------------------------------------------|
| Auto-Trader          | Per-user `setInterval` run loop (`server/services/autoTrader.js`) that evaluates the active strategy on each tick and places orders via Alpaca. |
| Blackout window      | Time range around an event (earnings, FOMC, CPI, NFP, or a custom date) during which the auto-trader will not open a new position in the affected symbol. Configured via the `skip*` flags and `skipDates`. |
| Dry run              | Strategy executes end-to-end but `alpaca.placeOrder` is skipped; fills get synthetic `dry-`-prefixed IDs, `[DRY]` notification titles, and `\| DRY RUN` appended to the trade reason. P&L still counts toward kill switches. |
| Entry-context snapshot | Indicator values frozen at the moment of a fill, persisted with the `AutoTraderTrade` row for Trade Replay. |
| Kill switch          | Automatic self-stop when `consecutiveLosses` ≥ `maxConsecutiveLosses` or `dailyPnl` ≤ `-dailyLossLimit`. Writes `killedReason` and a `security` notification. Counters reset on every `/auto-trader/start`. |
| Modes                | `TRADING_MODE` is `paper` unless `ALPACA_LIVE_TRADING=true`. Even in live mode, `/auto-trader/start` requires an explicit `modeAcknowledged: 'live'` in the config. |
| Per-symbol override  | `config.perSymbol.<SYMBOL>.<field>` merges into strategy config for that symbol only; root values still apply to the rest of the universe. |
| Revocation blocklist | Hybrid in-memory (60 s TTL) + DB-backed (`RevokedToken`) set of JWT hashes that are rejected even when cryptographically valid. Populated on logout and session revoke; pruned hourly. |
| Session row          | DB record stamped on successful login (user-agent, IP, `lastSeenAt`, token expiry). `lastSeenAt` is throttled to update at most once every 60 s. Drives the **Active sessions** UI and per-device revoke. |
| Tick interval        | Auto-trader poll cadence derived from strategy timeframe (`1Min`→15 s, `5Min`→30 s, `15Min`→60 s, `1H`→120 s, `1Day`→300 s), overridable via `config.checkIntervalMs`. |
| Trailing-stop reconciler | `reconcileTrailingStops()` in `autoTrader.js` — on each tick, enumerates open Alpaca positions, and for any not already protected by a trailing-stop order, places one at `trailingStopPct * 100`. Runs only when `config.useTrailingStop === true`. |
| Wheel                | Options strategy cycling cash-secured puts → assignment → covered calls, tracked in `/wheel-strategies`. |
