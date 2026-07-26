#!/bin/bash
set -e

# Colors
# Local demo credential bridge (managed by tools/fix_demo_autofill.mjs)
demo_credentials_project_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if [ -f "$demo_credentials_project_dir/.env" ]; then
  while IFS= read -r demo_credentials_line || [ -n "$demo_credentials_line" ]; do
    case "$demo_credentials_line" in ''|'#'*) continue ;; esac
    demo_credentials_line="${demo_credentials_line#export }"
    demo_credentials_key="${demo_credentials_line%%=*}"
    demo_credentials_value="${demo_credentials_line#*=}"
    case "$demo_credentials_key" in
      NODE_ENV|ENABLE_DEMO_CREDENTIAL_AUTOFILL|DEMO_EMAIL|DEMO_PASSWORD|SEED_ADMIN_EMAIL|SEED_ADMIN_PASSWORD|SEED_USER_EMAIL|SEED_USER_PASSWORD|PROVISION_ADMIN_EMAIL|PROVISION_ADMIN_PASSWORD|BOOTSTRAP_ADMIN_EMAIL|BOOTSTRAP_ADMIN_PASSWORD|ADMIN_EMAIL|ADMIN_PASSWORD|DEFAULT_EMAIL|DEFAULT_PASSWORD|DEMO_TENANT|BOOTSTRAP_TENANT_SLUG|GOVERNANCE_TENANT_ID|TENANT_ID) ;;
      *) continue ;;
    esac
    [ -n "${!demo_credentials_key+x}" ] && continue
    demo_credentials_first="${demo_credentials_value:0:1}"
    demo_credentials_last="${demo_credentials_value: -1}"
    if { [ "$demo_credentials_first" = '"' ] && [ "$demo_credentials_last" = '"' ]; } || { [ "$demo_credentials_first" = "'" ] && [ "$demo_credentials_last" = "'" ]; }; then
      demo_credentials_value="${demo_credentials_value:1:${#demo_credentials_value}-2}"
    fi
    export "$demo_credentials_key=$demo_credentials_value"
  done < "$demo_credentials_project_dir/.env"
fi
demo_credentials_email=""
demo_credentials_password=""
demo_credentials_tenant="${DEMO_TENANT:-${BOOTSTRAP_TENANT_SLUG:-${GOVERNANCE_TENANT_ID:-${TENANT_ID:-}}}}"
demo_credentials_tenant="${DEMO_TENANT:-${BOOTSTRAP_TENANT_SLUG:-${GOVERNANCE_TENANT_ID:-${TENANT_ID:-}}}}"
demo_credentials_tenant="${DEMO_TENANT:-${BOOTSTRAP_TENANT_SLUG:-${GOVERNANCE_TENANT_ID:-${TENANT_ID:-}}}}"
if [ -n "${PROVISION_ADMIN_EMAIL:-}" ] && [ -n "${PROVISION_ADMIN_PASSWORD:-}" ]; then
  demo_credentials_email="$PROVISION_ADMIN_EMAIL"
  demo_credentials_password="$PROVISION_ADMIN_PASSWORD"
elif [ -n "${BOOTSTRAP_ADMIN_EMAIL:-}" ] && [ -n "${BOOTSTRAP_ADMIN_PASSWORD:-}" ]; then
  demo_credentials_email="$BOOTSTRAP_ADMIN_EMAIL"
  demo_credentials_password="$BOOTSTRAP_ADMIN_PASSWORD"
elif [ -n "${SEED_ADMIN_EMAIL:-}" ] && [ -n "${SEED_ADMIN_PASSWORD:-}" ]; then
  demo_credentials_email="$SEED_ADMIN_EMAIL"
  demo_credentials_password="$SEED_ADMIN_PASSWORD"
elif [ -n "${SEED_USER_EMAIL:-}" ] && [ -n "${SEED_USER_PASSWORD:-}" ]; then
  demo_credentials_email="$SEED_USER_EMAIL"
  demo_credentials_password="$SEED_USER_PASSWORD"
elif [ -n "${DEMO_EMAIL:-}" ] && [ -n "${DEMO_PASSWORD:-}" ]; then
  demo_credentials_email="$DEMO_EMAIL"
  demo_credentials_password="$DEMO_PASSWORD"
elif [ -n "${ADMIN_EMAIL:-}" ] && [ -n "${ADMIN_PASSWORD:-}" ]; then
  demo_credentials_email="$ADMIN_EMAIL"
  demo_credentials_password="$ADMIN_PASSWORD"
elif [ -n "${DEFAULT_EMAIL:-}" ] && [ -n "${DEFAULT_PASSWORD:-}" ]; then
  demo_credentials_email="$DEFAULT_EMAIL"
  demo_credentials_password="$DEFAULT_PASSWORD"
fi
if [ "${NODE_ENV:-development}" != production ] && [ "${ENABLE_DEMO_CREDENTIAL_AUTOFILL:-true}" = true ] && [ -n "$demo_credentials_email" ] && [ -n "$demo_credentials_password" ]; then
  export NEXT_PUBLIC_ENABLE_DEMO_CREDENTIAL_AUTOFILL=true
  export NEXT_PUBLIC_DEMO_EMAIL="$demo_credentials_email"
  export NEXT_PUBLIC_DEMO_PASSWORD="$demo_credentials_password"
  export VITE_ENABLE_DEMO_CREDENTIAL_AUTOFILL=true
  export VITE_DEMO_EMAIL="$demo_credentials_email"
  export VITE_DEMO_PASSWORD="$demo_credentials_password"
  export REACT_APP_ENABLE_DEMO_CREDENTIAL_AUTOFILL=true
  export REACT_APP_DEMO_EMAIL="$demo_credentials_email"
  export REACT_APP_DEMO_PASSWORD="$demo_credentials_password"
  if [ -n "$demo_credentials_tenant" ]; then
    export NEXT_PUBLIC_DEMO_TENANT="$demo_credentials_tenant"
    export VITE_DEMO_TENANT="$demo_credentials_tenant"
    export REACT_APP_DEMO_TENANT="$demo_credentials_tenant"
  else
    unset NEXT_PUBLIC_DEMO_TENANT VITE_DEMO_TENANT REACT_APP_DEMO_TENANT
  fi
else
  export NEXT_PUBLIC_ENABLE_DEMO_CREDENTIAL_AUTOFILL=false
  export VITE_ENABLE_DEMO_CREDENTIAL_AUTOFILL=false
  export REACT_APP_ENABLE_DEMO_CREDENTIAL_AUTOFILL=false
  unset NEXT_PUBLIC_DEMO_EMAIL NEXT_PUBLIC_DEMO_PASSWORD NEXT_PUBLIC_DEMO_TENANT
  unset VITE_DEMO_EMAIL VITE_DEMO_PASSWORD VITE_DEMO_TENANT
  unset REACT_APP_DEMO_EMAIL REACT_APP_DEMO_PASSWORD REACT_APP_DEMO_TENANT
fi
unset demo_credentials_email demo_credentials_password demo_credentials_tenant demo_credentials_project_dir demo_credentials_line demo_credentials_key demo_credentials_value demo_credentials_first demo_credentials_last

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Resolve the repo root (the directory this script lives in). Every path
# below is anchored here so we can identify "our" node processes by CWD
# regardless of what directory the user invoked start.sh from.
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT"
PIDFILE="$REPO_ROOT/.start.pid"

# Recursive process-tree killer. macOS has no `setsid`/`kill -- -PGID` the
# way Linux does, so instead we walk children with pgrep -P and signal
# leaves first. This catches nodemon's grandchild `node index.js` and
# vite's esbuild helpers — the processes that actually hold the port.
kill_tree() {
  local pid="$1"
  local sig="${2:-TERM}"
  [ -z "$pid" ] && return
  local child
  for child in $(pgrep -P "$pid" 2>/dev/null); do
    kill_tree "$child" "$sig"
  done
  kill "-$sig" "$pid" 2>/dev/null || true
}

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}   Claude Trading Platform - Startup    ${NC}"
echo -e "${CYAN}========================================${NC}"

# Load .env (handles values containing spaces/quotes correctly)
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

SERVER_PORT=${SERVER_PORT:-3001}
CLIENT_PORT=${CLIENT_PORT:-5173}

# Flags are explicit maintenance operations; default startup mutates no schema or seed data.
RESEED=0
SEED=0
MIGRATE=0
for arg in "$@"; do
  case "$arg" in
    --seed) SEED=1 ;;
    --reseed|--reset) RESEED=1; SEED=1 ;;
    --migrate) MIGRATE=1 ;;
    -h|--help)
      echo "Usage: ./start.sh [--migrate] [--seed|--reseed]"
      echo "  --migrate  Apply reviewed migrations to the configured isolated database."
      echo "  --seed     Seed a new empty installation."
      echo "  --reseed   Drop and re-insert demo data (destructive and explicit)."
      exit 0
      ;;
  esac
done

# Step 1: refuse an already-running instance or occupied port.
echo -e "\n${YELLOW}[1/6] Checking previous instances and ports...${NC}"

if [ -f "$PIDFILE" ]; then
  OLD_PID="$(cat "$PIDFILE" 2>/dev/null || true)"
  OLD_CMD="$(ps -p "$OLD_PID" -o command= 2>/dev/null || true)"
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null && [[ "$OLD_CMD" == *"$REPO_ROOT/start.sh"* ]]; then
    echo -e "${RED}  This checkout is already running as pid $OLD_PID; refusing to terminate it.${NC}" >&2
    exit 1
  fi
  rm -f "$PIDFILE"
fi

if lsof -tiTCP:"$SERVER_PORT" -sTCP:LISTEN >/dev/null 2>&1 || lsof -tiTCP:"$CLIENT_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo -e "${RED}  Required port is already in use. Stop its owner explicitly or choose different SERVER_PORT/CLIENT_PORT values.${NC}"
  exit 1
fi
echo -e "${GREEN}  Cleanup complete.${NC}"

# Record our own PID so the next invocation can find + kill our process
# tree (nodemon + vite + their children) even if we died without cleanup.
echo "$$" > "$PIDFILE"

# Step 2: Check PostgreSQL
echo -e "\n${YELLOW}[2/6] Checking PostgreSQL...${NC}"
if ! command -v psql &> /dev/null; then
  echo -e "${RED}  PostgreSQL not found. Install with: brew install postgresql@16${NC}"
  exit 1
fi

# Startup never installs or starts a system database service.
if [ -z "${DATABASE_URL:-}" ]; then
  echo -e "${RED}  DATABASE_URL is required.${NC}" >&2
  exit 1
fi
if ! pg_isready -d "$DATABASE_URL" -q 2>/dev/null; then
  echo -e "${RED}  PostgreSQL is unavailable; provision the configured isolated database first.${NC}" >&2
  exit 1
fi

if ! psql "$DATABASE_URL" -tAc "SELECT 1" 2>/dev/null | grep -q 1; then
  echo -e "${RED}  The configured PostgreSQL database is unavailable.${NC}" >&2
  exit 1
fi
echo -e "${GREEN}  Database ready.${NC}"

# Steps 3/4: require reproducibly bootstrapped dependencies.
echo -e "\n${YELLOW}[3/6] Checking dependencies...${NC}"
for dependency_dir in server/node_modules client/node_modules; do
  [ -d "$dependency_dir" ] || { echo -e "${RED}  Missing $dependency_dir; run the documented bootstrap step first.${NC}" >&2; exit 1; }
done
echo -e "${GREEN}  Dependencies are present.${NC}"

# Step 5: migrate and optionally seed the database.
# Run migrations BEFORE an explicitly requested seed. Migrations are idempotent and add any columns
# that an older installation is missing (e.g. the per-user `userId` columns
# added in 0002, or the 2FA / token-revocation artifacts added in 0003).
# Without this, a DB created under a prior schema will fail the seed with
# errors like `column "userId" does not exist`.
echo -e "\n${YELLOW}[5/6] Checking explicit database maintenance flags...${NC}"
cd server
if [ "$MIGRATE" = "1" ]; then
  node migrations/umzug.js up
fi
if [ "$RESEED" = "1" ]; then
  echo -e "  ${YELLOW}--reseed flag set — forcing seed reset.${NC}"
  node seed.js --reset
elif [ "$SEED" = "1" ]; then
  node seed.js
fi
cd ..

# Refuse a race rather than killing whichever process acquired a port.
if lsof -tiTCP:"$SERVER_PORT" -sTCP:LISTEN >/dev/null 2>&1 || lsof -tiTCP:"$CLIENT_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo -e "${RED}Required port became busy during setup; aborting without terminating it.${NC}"
  exit 1
fi

# Step 6: Start both servers with hot reload
echo -e "\n${YELLOW}[6/6] Starting servers with hot reload...${NC}"
echo -e "${GREEN}  Backend:  http://localhost:$SERVER_PORT${NC}"
echo -e "${GREEN}  Frontend: http://localhost:$CLIENT_PORT${NC}"
echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  Press Ctrl+C to stop all servers      ${NC}"
echo -e "${CYAN}========================================${NC}\n"

# Trap: on Ctrl+C / SIGTERM / normal exit, kill the ENTIRE descendant
# tree — not just the two direct children we backgrounded. `kill $(jobs -p)`
# was insufficient: it only hit `npx nodemon` and `npx vite`, leaving
# nodemon's grandchild `node index.js` running, which kept :3001 bound
# across restarts and caused EADDRINUSE the next time start.sh ran.
cleanup() {
  trap - SIGINT SIGTERM EXIT
  echo -e "\n${YELLOW}Shutting down...${NC}"
  [ -n "$BACKEND_PID"  ] && kill_tree "$BACKEND_PID"  TERM
  [ -n "$FRONTEND_PID" ] && kill_tree "$FRONTEND_PID" TERM
  sleep 1
  [ -n "$BACKEND_PID"  ] && kill_tree "$BACKEND_PID"  KILL
  [ -n "$FRONTEND_PID" ] && kill_tree "$FRONTEND_PID" KILL
  rm -f "$PIDFILE"
  exit 0
}
trap cleanup SIGINT SIGTERM EXIT

SERVER_DIR="$REPO_ROOT/server"
CLIENT_DIR="$REPO_ROOT/client"
if [ -n "${RUNTIME_PROJECT_SOURCE:-}" ] && [ -d "$RUNTIME_PROJECT_SOURCE/server" ] && [ -d "$RUNTIME_PROJECT_SOURCE/client" ]; then
  SERVER_DIR="$RUNTIME_PROJECT_SOURCE/server"
  CLIENT_DIR="$RUNTIME_PROJECT_SOURCE/client"
fi
(cd "$SERVER_DIR" && exec env SERVER_HOST=127.0.0.1 SERVER_PORT="$SERVER_PORT" CLIENT_PORT="$CLIENT_PORT" node index.js) &
BACKEND_PID=$!
(cd "$CLIENT_DIR" && exec env SERVER_PORT="$SERVER_PORT" ./node_modules/.bin/vite --host 127.0.0.1 --port "$CLIENT_PORT") &
FRONTEND_PID=$!

wait
