#!/bin/bash
set -e

# Colors
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

# Flags:
#   --reseed   Force the seed to reset existing rows. Without this flag the
#              seed skips when any users exist (so it's safe to restart
#              start.sh without clobbering local data). Use --reseed after
#              pulling a migration that added a column the seed populates.
RESEED=0
for arg in "$@"; do
  case "$arg" in
    --reseed|--reset) RESEED=1 ;;
    -h|--help)
      echo "Usage: ./start.sh [--reseed]"
      echo "  --reseed   Drop and re-insert all seed data (equivalent to 'node seed.js --reset')."
      exit 0
      ;;
  esac
done

# Step 1: Cleanup — three passes, in order.
#
#   1a. If a previous start.sh is still running (pidfile), kill its whole
#       process group. This is the real fix for EADDRINUSE: killing by port
#       only catches the listener, not the nodemon parent that will
#       immediately spawn a fresh one.
#   1b. Kill any `nodemon`/`node index.js` that belongs to THIS repo, in
#       case the pidfile is stale or was never written (hard kill / reboot).
#   1c. Finally, sweep the ports — belt + suspenders.
echo -e "\n${YELLOW}[1/6] Cleaning up previous instances...${NC}"

if [ -f "$PIDFILE" ]; then
  OLD_PID="$(cat "$PIDFILE" 2>/dev/null || true)"
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo -e "  Found previous start.sh (pid $OLD_PID) — stopping its tree."
    kill_tree "$OLD_PID" TERM
    # Give it 3s to exit gracefully, then SIGKILL the tree.
    for _ in 1 2 3; do
      kill -0 "$OLD_PID" 2>/dev/null || break
      sleep 1
    done
    kill_tree "$OLD_PID" KILL
  fi
  rm -f "$PIDFILE"
fi

# Kill any stray server/client processes from THIS repo by matching the
# working directory (prevents nuking an unrelated Node app on the same box).
if command -v pgrep >/dev/null 2>&1; then
  for PID in $(pgrep -f "nodemon.*index.js" 2>/dev/null) $(pgrep -f "node .*${REPO_ROOT}/server/index.js" 2>/dev/null) $(pgrep -f "vite.*--port ${CLIENT_PORT:-5173}" 2>/dev/null); do
    PCWD="$(lsof -p "$PID" 2>/dev/null | awk '$4=="cwd"{print $NF; exit}')"
    case "$PCWD" in
      "$REPO_ROOT"*) kill -9 "$PID" 2>/dev/null || true ;;
    esac
  done
fi

lsof -ti:${SERVER_PORT:-3001} 2>/dev/null | xargs kill -9 2>/dev/null || true
lsof -ti:${CLIENT_PORT:-5173} 2>/dev/null | xargs kill -9 2>/dev/null || true
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

# Start postgres if not running
if ! pg_isready -q 2>/dev/null; then
  echo -e "  Starting PostgreSQL..."
  brew services start postgresql@16 2>/dev/null || brew services start postgresql 2>/dev/null || true
  sleep 2
fi

# Create database if not exists
echo -e "  Creating database claude_trading..."
psql postgres -tc "SELECT 1 FROM pg_database WHERE datname = 'claude_trading'" 2>/dev/null | grep -q 1 || \
  createdb claude_trading 2>/dev/null || \
  psql -U postgres -tc "SELECT 1 FROM pg_database WHERE datname = 'claude_trading'" 2>/dev/null | grep -q 1 || \
  createdb -U postgres claude_trading 2>/dev/null || true
echo -e "${GREEN}  Database ready.${NC}"

# Step 3: Install server dependencies
echo -e "\n${YELLOW}[3/6] Installing server dependencies...${NC}"
cd server
npm install --silent
cd ..

# Step 4: Install client dependencies
echo -e "\n${YELLOW}[4/6] Installing client dependencies...${NC}"
cd client
npm install --silent
cd ..

# Step 5: Migrate + seed database
# Run migrations BEFORE seed. Migrations are idempotent and add any columns
# that an older installation is missing (e.g. the per-user `userId` columns
# added in 0002, or the 2FA / token-revocation artifacts added in 0003).
# Without this, a DB created under a prior schema will fail the seed with
# errors like `column "userId" does not exist`.
echo -e "\n${YELLOW}[5/6] Migrating + seeding database...${NC}"
cd server
node migrations/umzug.js up
if [ "$RESEED" = "1" ]; then
  echo -e "  ${YELLOW}--reseed flag set — forcing seed reset.${NC}"
  node seed.js --reset
else
  # seed.js is a no-op if users already exist, so this is safe to re-run.
  node seed.js
fi
cd ..

# Clean ports again right before starting (seed.js or leftover processes may have grabbed them)
lsof -ti:$SERVER_PORT | xargs kill -9 2>/dev/null || true
lsof -ti:$CLIENT_PORT | xargs kill -9 2>/dev/null || true
sleep 1

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
  # Final port sweep — defensive, catches anything we missed.
  lsof -ti:${SERVER_PORT:-3001} 2>/dev/null | xargs kill -9 2>/dev/null || true
  lsof -ti:${CLIENT_PORT:-5173} 2>/dev/null | xargs kill -9 2>/dev/null || true
  rm -f "$PIDFILE"
  exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# Start backend with nodemon (hot reload). Capture its PID so kill_tree
# can walk its descendants on shutdown.
cd server
npx nodemon --watch . --ext js,json index.js &
BACKEND_PID=$!
cd ..

# Start frontend with Vite (hot reload built-in)
cd client
npx vite --port $CLIENT_PORT &
FRONTEND_PID=$!
cd ..

wait
