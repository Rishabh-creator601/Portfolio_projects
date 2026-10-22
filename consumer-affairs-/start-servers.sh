#!/usr/bin/env bash
#
# LM-Verify - start the local stack.
#
#   ./start-servers.sh          start everything
#   ./start-servers.sh stop     stop everything this script started
#   ./start-servers.sh status   show what is running
#
# Three services, started in dependency order:
#
#   vision  :8001   OCR + Gemini extraction sidecar
#   backend :5000   Express API (needs vision for every capture)
#   frontend:3000   Next.js dev server (needs backend)
#
# MongoDB is expected to be running already - see MONGODB_CONNECTION.txt.
#
# Written for Git Bash on Windows and for Linux/macOS alike.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOGS="$ROOT/logs"
PIDS="$LOGS/pids"

VISION_PORT="${VISION_PORT:-8001}"
BACKEND_PORT="${BACKEND_PORT:-5000}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
MONGO_PORT="${MONGO_PORT:-27017}"

# How long to wait for each service to answer its health check.
READY_TIMEOUT="${READY_TIMEOUT:-120}"

BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'
GREEN=$'\033[32m'; YELLOW=$'\033[33m'; CYAN=$'\033[36m'; OFF=$'\033[0m'

info()  { printf '%s\n' "  $*"; }
good()  { printf '%s\n' "  ${GREEN}OK${OFF}    $*"; }
warn()  { printf '%s\n' "  ${YELLOW}WARN${OFF}  $*"; }
fail()  { printf '%s\n' "  ${RED}FAIL${OFF}  $*"; }
# Not named head(): that would shadow the head command, and port_pid pipes
# through `head -1`.
section() { printf '\n%s\n' "${BOLD}$*${OFF}"; }

# --- port helpers ------------------------------------------------------------
# netstat is the one tool present on Git Bash, macOS and most Linux images.

port_pid() {
  local port="$1"
  if command -v netstat >/dev/null 2>&1; then
    netstat -ano 2>/dev/null \
      | grep -E "[:.]${port}[[:space:]]+.*LISTEN" \
      | awk '{print $NF}' | head -1 | tr -d '\r'
  fi
}

port_open() { [ -n "$(port_pid "$1")" ]; }

wait_for_url() {
  local url="$1" name="$2" waited=0
  while [ "$waited" -lt "$READY_TIMEOUT" ]; do
    if curl -fsS -m 3 "$url" >/dev/null 2>&1; then return 0; fi
    sleep 2
    waited=$((waited + 2))
    if [ $((waited % 20)) -eq 0 ]; then
      info "${DIM}still waiting for $name (${waited}s)...${OFF}"
    fi
  done
  return 1
}

record_pid() { printf '%s %s\n' "$1" "$2" >> "$PIDS"; }

# --- commands ----------------------------------------------------------------

do_status() {
  section "LM-Verify - service status"
  local any=0
  for entry in "mongodb:$MONGO_PORT" "vision:$VISION_PORT" \
               "backend:$BACKEND_PORT" "frontend:$FRONTEND_PORT"; do
    local name="${entry%%:*}" port="${entry##*:}" pid
    pid="$(port_pid "$port")"
    if [ -n "$pid" ]; then
      good "$(printf '%-9s' "$name") :$port  (pid $pid)"
      any=1
    else
      info "${DIM}      $(printf '%-9s' "$name") :$port  not running${OFF}"
    fi
  done
  [ "$any" -eq 1 ] || info "${DIM}nothing is running${OFF}"
  printf '\n'
}

do_stop() {
  section "Stopping services"

  # Ports first: that reaches anything holding them, including a server started
  # by hand outside this script.
  for entry in "frontend:$FRONTEND_PORT" "backend:$BACKEND_PORT" "vision:$VISION_PORT"; do
    local name="${entry%%:*}" port="${entry##*:}" pid
    pid="$(port_pid "$port")"
    if [ -n "$pid" ]; then
      if taskkill //PID "$pid" //F >/dev/null 2>&1 || kill -9 "$pid" >/dev/null 2>&1; then
        good "stopped $name (pid $pid)"
      else
        fail "could not stop $name (pid $pid) - try closing it manually"
      fi
    else
      info "${DIM}$name was not running${OFF}"
    fi
  done

  # MongoDB is deliberately left alone: it is usually a shared Windows service
  # and other projects on this machine use it.
  info "${DIM}MongoDB left running (shared service)${OFF}"
  rm -f "$PIDS"
  printf '\n'
}

do_start() {
  mkdir -p "$LOGS"
  : > "$PIDS"

  section "LM-Verify - starting the local stack"

  # --- prerequisites ---------------------------------------------------------
  local missing=0
  command -v node   >/dev/null 2>&1 || { fail "node is not on PATH";   missing=1; }
  command -v python >/dev/null 2>&1 || { fail "python is not on PATH"; missing=1; }
  command -v curl   >/dev/null 2>&1 || { fail "curl is not on PATH";   missing=1; }
  [ "$missing" -eq 0 ] || { printf '\n'; exit 1; }

  [ -d "$ROOT/backend/node_modules" ]  || warn "backend/node_modules missing - run: cd backend && npm install"
  [ -d "$ROOT/frontend/node_modules" ] || warn "frontend/node_modules missing - run: cd frontend && npm install"

  if [ ! -f "$ROOT/.env" ]; then
    warn ".env not found. Copy .env.example to .env and set your keys."
  fi

  if port_open "$MONGO_PORT"; then
    good "mongodb        :$MONGO_PORT already running"
  else
    warn "mongodb        :$MONGO_PORT is NOT running - the API will fall back to in-memory storage"
    info "${DIM}      see MONGODB_CONNECTION.txt${OFF}"
  fi

  # --- 1. vision service -----------------------------------------------------
  section "1/3  vision service"
  if port_open "$VISION_PORT"; then
    good "already running on :$VISION_PORT"
  else
    ( cd "$ROOT/vision-service" && \
      nohup python -m uvicorn main:app --host 0.0.0.0 --port "$VISION_PORT" \
        > "$LOGS/vision.log" 2>&1 & echo $! > "$LOGS/.vision.pid" )
    record_pid vision "$(cat "$LOGS/.vision.pid" 2>/dev/null || echo '?')"

    if wait_for_url "http://localhost:$VISION_PORT/health" "vision"; then
      good "listening on :$VISION_PORT"
      curl -fsS -m 5 "http://localhost:$VISION_PORT/health" 2>/dev/null \
        | python -c "
import sys, json
try:
    d = json.load(sys.stdin); c = d.get('capabilities', {}); g = c.get('gemini_extraction', {})
    print(f\"        mode: {c.get('extraction_mode')}  |  gemini configured: {g.get('configured')}  |  model: {g.get('model')}\")
except Exception:
    pass
" 2>/dev/null
    else
      fail "did not become healthy - see logs/vision.log"
      tail -5 "$LOGS/vision.log" 2>/dev/null | sed 's/^/        /'
    fi
  fi

  # --- 2. backend ------------------------------------------------------------
  section "2/3  backend API"
  if port_open "$BACKEND_PORT"; then
    good "already running on :$BACKEND_PORT"
  else
    ( cd "$ROOT/backend" && \
      nohup node src/server.js > "$LOGS/backend.log" 2>&1 & echo $! > "$LOGS/.backend.pid" )
    record_pid backend "$(cat "$LOGS/.backend.pid" 2>/dev/null || echo '?')"

    if wait_for_url "http://localhost:$BACKEND_PORT/api/health" "backend"; then
      good "listening on :$BACKEND_PORT"
      grep -m1 'MongoDB Connected' "$LOGS/backend.log" 2>/dev/null | sed 's/^/        /'
    else
      fail "did not become healthy - see logs/backend.log"
      tail -5 "$LOGS/backend.log" 2>/dev/null | sed 's/^/        /'
    fi
  fi

  # --- 3. frontend -----------------------------------------------------------
  section "3/3  frontend"
  if port_open "$FRONTEND_PORT"; then
    good "already running on :$FRONTEND_PORT"
  else
    # next dev writes to .next-dev (see next.config.js), so a concurrent
    # `next build` cannot overwrite the chunks it is serving.
    ( cd "$ROOT/frontend" && \
      nohup npx next dev > "$LOGS/frontend.log" 2>&1 & echo $! > "$LOGS/.frontend.pid" )
    record_pid frontend "$(cat "$LOGS/.frontend.pid" 2>/dev/null || echo '?')"

    if wait_for_url "http://localhost:$FRONTEND_PORT" "frontend"; then
      good "listening on :$FRONTEND_PORT"
    else
      fail "did not become ready - see logs/frontend.log"
      tail -5 "$LOGS/frontend.log" 2>/dev/null | sed 's/^/        /'
    fi
  fi

  # --- summary ---------------------------------------------------------------
  section "Ready"
  printf '%s\n' "  ${CYAN}Open  http://localhost:$FRONTEND_PORT${OFF}"
  printf '\n'
  info "API        http://localhost:$BACKEND_PORT/api/health"
  info "Vision     http://localhost:$VISION_PORT/health"
  info "Logs       logs/{frontend,backend,vision}.log"
  printf '\n'
  info "${DIM}Seeded sign-in (local testing only):${OFF}"
  info "${DIM}  admin@lmverify.gov.in      / Password123!   (Controller)${OFF}"
  info "${DIM}  inspector@lmverify.gov.in  / Password123!   (Senior Inspector)${OFF}"
  printf '\n'
  info "Stop with:  ./start-servers.sh stop"
  printf '\n'
}

case "${1:-start}" in
  start)  do_start  ;;
  stop)   do_stop   ;;
  status) do_status ;;
  restart) do_stop; do_start ;;
  *)
    printf 'Usage: %s [start|stop|restart|status]\n' "$(basename "$0")"
    exit 1
    ;;
esac
