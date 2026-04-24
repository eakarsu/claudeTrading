# Deploy to a Hostinger VPS

End-to-end steps for building the image on your Mac and running it behind
Caddy + Postgres on a Hostinger KVM VPS. Assumes Ubuntu 22.04/24.04.

## 0. One-time prep

- DNS: point an `A` record (e.g. `app.example.com`) at the VPS public IPv4.
  Let's Encrypt will fail if the domain doesn't resolve yet.
- A container registry you can push to. Docker Hub is simplest:
  `docker login` on your Mac if you haven't already.
- SSH access to the VPS as root or a sudoer.

## 1. Build + push the image (on your Mac)

Single command — buildx cross-compiles for the VPS target. Hostinger KVM VPSes
are linux/amd64; the arm64 build is optional for future portability.

```bash
cd /path/to/claudeTrading

# Replace YOUR_DOCKER_HUB_USERNAME (or ghcr.io/<org>/... for GHCR).
IMAGE=docker.io/YOUR_DOCKER_HUB_USERNAME/claude-trading:latest

docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --tag "$IMAGE" \
  --push \
  .
```

The build takes ~2–5 min. On success the image is available on the registry.

## 2. Prepare the VPS

SSH in once and install Docker + compose:

```bash
ssh root@<VPS_IP>

# Install Docker (Ubuntu)
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

# Firewall (Hostinger VPS ships with ufw installed)
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable

# Create app directory
mkdir -p /opt/claude-trading
```

## 3. Copy deployment artifacts to the VPS

From your Mac:

```bash
cd /path/to/claudeTrading/deploy

scp compose.prod.yml Caddyfile env.prod.example root@<VPS_IP>:/opt/claude-trading/
```

On the VPS, create the real `.env` from the template:

```bash
cd /opt/claude-trading
cp env.prod.example .env
chmod 600 .env
nano .env       # fill in every secret — IMAGE, DOMAIN, CORS_ORIGIN, JWT_SECRET,
                # DB_PASSWORD, ALPACA_*, ANTHROPIC_API_KEY, etc.
```

Key vars to double-check before starting:

| Var | Value |
|---|---|
| `IMAGE` | `docker.io/YOUR_DOCKER_HUB_USERNAME/claude-trading:latest` |
| `DOMAIN` | `app.example.com` (must already resolve to this VPS) |
| `CORS_ORIGIN` | `https://app.example.com` |
| `JWT_SECRET` | `openssl rand -hex 48` |
| `DB_PASSWORD` | a strong random string |
| `ALLOW_REGISTRATION` | `false` after you seed your account |

## 4. Start the stack

```bash
cd /opt/claude-trading
docker login                                       # if registry is private
docker compose -f compose.prod.yml pull
docker compose -f compose.prod.yml up -d
docker compose -f compose.prod.yml ps
docker compose -f compose.prod.yml logs -f app     # watch for DB connect + "Server running"
```

Caddy will request a TLS cert on first request. Visit `https://<DOMAIN>` — the
cert should issue within a few seconds. If it doesn't, check:

```bash
docker compose -f compose.prod.yml logs caddy
```

## 5. Seed the first user

The app allows registration on first boot if `ALLOW_REGISTRATION=true`. Register
your account via the UI, then:

```bash
# Lock down further registrations
nano /opt/claude-trading/.env                      # set ALLOW_REGISTRATION=false
docker compose -f compose.prod.yml up -d           # picks up the env change
```

## 6. Subsequent deploys

On your Mac — rebuild + push:

```bash
docker buildx build --platform linux/amd64,linux/arm64 --tag "$IMAGE" --push .
```

On the VPS:

```bash
cd /opt/claude-trading
docker compose -f compose.prod.yml pull
docker compose -f compose.prod.yml up -d
```

The compose file sets `restart: unless-stopped`, so the stack also comes back
up automatically after a reboot.

## 7. Backups

Postgres volume is `db-data`. A cheap cron on the VPS:

```bash
# /etc/cron.daily/pg-backup
#!/bin/sh
docker exec $(docker compose -f /opt/claude-trading/compose.prod.yml ps -q db) \
  pg_dump -U trading trading | gzip > /root/backups/trading-$(date +%F).sql.gz
find /root/backups -name "trading-*.sql.gz" -mtime +14 -delete
```

Don't forget `chmod +x /etc/cron.daily/pg-backup` and `mkdir -p /root/backups`.
