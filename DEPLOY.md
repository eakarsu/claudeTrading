# Deployment

This guide covers running the paper-trading server in a real environment.
The repo ships a Dockerfile + `docker-compose.yml` that together produce a
single process exposing the API and the built React client on port `3001`.

The app is intended for personal / small-team use. It is **not** hardened
for multi-tenant SaaS exposure on the public internet — see
[Limitations](#limitations) below.

---

## 1. Prerequisites

- Docker 24+ and Docker Compose v2
- A Postgres 14+ database (the default compose file brings one up)
- An Alpaca account (paper keys are fine — and are the default)
- Optional: Anthropic API key for AI features, Resend API key for alert email

## 2. Environment variables

Create a `.env` file at the repo root using the list below. **Every secret
must be set explicitly** — the server refuses to start with an unset
`JWT_SECRET`.

| Variable | Required | Purpose |
|---|---|---|
| `JWT_SECRET` | yes | HMAC key for session tokens. Generate with `openssl rand -hex 32`. |
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | yes | Postgres connection. |
| `SERVER_PORT` | no (default `3001`) | Listen port inside the container. |
| `CORS_ORIGIN` | yes in prod | Comma-separated list of allowed browser origins. |
| `ALLOW_REGISTRATION` | no | Set to `false` in prod after your users sign up. |
| `ALPACA_API_KEY` / `ALPACA_API_SECRET` | yes | Alpaca credentials. |
| `ALPACA_BASE_URL` | no | `https://paper-api.alpaca.markets` (default) or `https://api.alpaca.markets`. |
| `ALPACA_LIVE_TRADING` | no | Must be `true` AND the user must confirm `modeAcknowledged=live` before any live order is routed. |
| `ANTHROPIC_API_KEY` | no | Enables AI analysis + chat endpoints. |
| `RESEND_API_KEY` / `RESEND_FROM` | no | Enables transactional email (password reset, alerts). |
| `TOTP_ISSUER` | no | Label shown in authenticator apps (default `claudeTrading`). |
| `SSE_MAX_PER_USER` | no | Cap on concurrent price streams per user (default 4). |
| `TRADE_SIGNAL_TTL_HOURS` | no | How long a generated signal stays `active` (default 72). |

## 3. First run (compose)

```bash
# Generate a secret
echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env
# Fill in the rest of .env from the table above.
docker compose up --build -d
docker compose logs -f app
```

Once the app logs `Server running on http://localhost:3001`, open
`http://localhost:3001` in a browser and register the first user. Then set
`ALLOW_REGISTRATION=false` in `.env` and `docker compose up -d` again.

## 4. Database migrations

The server calls `sequelize.sync()` on startup for dev ergonomics, but for
production upgrades you should run migrations explicitly instead:

```bash
docker compose exec app node migrations/umzug.js up
```

Migrations are in `server/migrations/scripts/` and are idempotent — safe to
re-run against an already-synced DB.

## 5. Health + observability

- `GET /api/health` — liveness (no DB hit). Use for load-balancer checks.
- `GET /api/ready` — readiness (authenticates DB). Use for k8s readiness probe.
- `GET /api/metrics` — Prometheus scrape target. No auth; restrict via ingress.

Example Prometheus scrape config:

```yaml
scrape_configs:
  - job_name: claudetrading
    metrics_path: /api/metrics
    static_configs:
      - targets: ["app.example.internal:3001"]
```

Logs are structured JSON via pino — pipe them into Loki / Datadog / etc. via
the container stdout stream.

## 6. Running behind a reverse proxy

You'll want TLS and a hardened front door. Minimal nginx example:

```nginx
server {
  listen 443 ssl http2;
  server_name trading.example.com;

  ssl_certificate     /etc/letsencrypt/live/trading.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/trading.example.com/privkey.pem;

  # Block /api/metrics from the public internet — scrape it over the internal
  # network instead.
  location = /api/metrics { deny all; return 403; }

  # SSE needs a long read timeout and no response buffering.
  location /api/market-data/stream {
    proxy_pass http://app:3001;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_read_timeout 1h;
  }

  location / {
    proxy_pass http://app:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Set `CORS_ORIGIN=https://trading.example.com` to match.

## 7. Backups

The only stateful component is Postgres. Back it up the usual way:

```bash
docker compose exec db pg_dump -U trading trading > backup-$(date +%F).sql
```

The app itself is stateless — you can redeploy/rebuild the container freely.

## 8. Upgrading

```bash
git pull
docker compose build app
docker compose up -d app
docker compose exec app node migrations/umzug.js up
```

The graceful-shutdown handler flushes in-flight auto-trader ticks before
exiting, so a rolling restart won't orphan positions (but you should still
check the status page after any restart).

## 9. Enabling live trading

1. Set `ALPACA_LIVE_TRADING=true` and restart the app.
2. Replace `ALPACA_BASE_URL` with the live URL.
3. The auto-trader `/start` endpoint now requires `config.modeAcknowledged=live`
   in the request body. Without it the endpoint returns 400 — the client UI
   shows a confirmation checkbox that sets this.
4. **Verify 2FA is enabled on every user account first.** An attacker with a
   stolen session cookie can route real orders.

## Limitations

- Alpaca positions/orders are shared across all users of this deployment
  because they live at the broker-account level. Multi-user isolation is at
  the DB layer only. Use a separate Alpaca account per environment.
- Rate limits are per-process; a multi-replica deploy needs a shared store
  (Redis) — not supplied here.
- The notifier throttles per-process as well; replicas can each emit one
  copy of an event. Run a single replica or put a Redis-backed queue in
  front if this matters.
