#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'
CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; RESET='\033[0m'

ok()   { echo -e "  ${GREEN}✓${RESET}  $1"; }
warn() { echo -e "  ${YELLOW}⚠${RESET}  $1"; }
fail() { echo -e "  ${RED}✗${RESET}  $1"; }
hdr()  { echo -e "\n${BOLD}── $1 ──────────────────────────────────────────${RESET}"; }
step() { echo -e "\n${CYAN}[$(date '+%H:%M:%S')]${RESET} ${BOLD}$1${RESET}"; }

print_banner() {
  echo ""
  echo -e "${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}"
  echo -e "${BOLD}║   ElasticShop Session Replay Demo  —  External Plugin    ║${RESET}"
  echo -e "${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}"
  echo ""
}

# ── Container status helper ────────────────────────────────────────────────────
# Prints one line per service: icon + name + state
print_container_status() {
  local services=(elasticsearch otel-collector catalog-service orders-service frontend player kibana)
  local names=("Elasticsearch" "EDOT Collector" "Catalog API" "Orders API" "Frontend" "Player" "Kibana")
  echo ""
  for i in "${!services[@]}"; do
    local svc="${services[$i]}"
    local name="${names[$i]}"
    local state
    state=$(docker inspect --format '{{.State.Health.Status}}' "$svc" 2>/dev/null || echo "")
    if [ -z "$state" ]; then
      state=$(docker inspect --format '{{.State.Status}}' "$svc" 2>/dev/null || echo "absent")
    fi
    case "$state" in
      healthy)  echo -e "  ${GREEN}●${RESET} $name" ;;
      running)  echo -e "  ${YELLOW}●${RESET} $name  ${DIM}(running — no healthcheck)${RESET}" ;;
      starting) echo -e "  ${YELLOW}●${RESET} $name  ${DIM}(starting…)${RESET}" ;;
      absent)   echo -e "  ${DIM}●${RESET} $name  ${DIM}(not started)${RESET}" ;;
      *)        echo -e "  ${RED}●${RESET} $name  ${DIM}($state)${RESET}" ;;
    esac
  done
  echo ""
}

# ── Kibana readiness check ─────────────────────────────────────────────────────
kibana_ready() {
  local status
  status=$(curl -sf --max-time 3 http://localhost:5601/api/status 2>/dev/null \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status',{}).get('overall',{}).get('level',''))" 2>/dev/null || echo "")
  [ "$status" = "available" ]
}

# ── Kibana log tail (last non-empty line) ──────────────────────────────────────
kibana_last_log() {
  docker logs kibana 2>&1 | grep -v "^$" | tail -1 2>/dev/null || echo ""
}

print_banner

# ── 1. Docker running? ─────────────────────────────────────────────────────────
if ! docker info > /dev/null 2>&1; then
  fail "Docker is not running. Start Docker Desktop and try again."
  exit 1
fi
ok "Docker is running"

# ── 2. Plugin build check ──────────────────────────────────────────────────────
BUILD_OUT="$SCRIPT_DIR/kibana-src/plugins/rum-session-replay/build/kibana/rumSessionReplay"
if [ ! -f "$BUILD_OUT/target/public/rumSessionReplay.plugin.js" ]; then
  echo ""
  echo -e "${YELLOW}${BOLD}Plugin not built yet — running build-plugin.sh first.${RESET}"
  echo -e "${DIM}This is a one-time step that takes 25–45 minutes.${RESET}"
  echo ""
  ./build-plugin.sh
fi
ok "Plugin bundle ready"

# ── 3. Start all services ─────────────────────────────────────────────────────
step "Starting all Docker services..."
docker compose up -d --build 2>&1 | grep -v "^time=" | grep -vE "^\s*$" || true

# ── 4. Live status loop ────────────────────────────────────────────────────────
step "Waiting for services to become healthy..."
echo -e "  ${DIM}(Updates every 8 seconds — Ctrl+C exits this watch but keeps services running)${RESET}"

ELAPSED=0
MAX_WAIT=300  # 5 minutes total before giving up on Kibana
ES_UP=false
KIBANA_UP=false

while true; do
  sleep 8
  ELAPSED=$((ELAPSED + 8))

  # ── Elasticsearch ────────────────────────────────────────────────────────────
  if [ "$ES_UP" = false ]; then
    if curl -sf http://localhost:9200/_cluster/health 2>/dev/null | grep -qE '"status":"(green|yellow)"'; then
      ES_UP=true
      ES_STATUS=$(curl -sf http://localhost:9200/_cluster/health 2>/dev/null \
        | python3 -c "import sys,json; h=json.load(sys.stdin); print(h['status'])" 2>/dev/null || echo "ok")
      echo ""
      ok "Elasticsearch is ${GREEN}${ES_STATUS}${RESET}"
    else
      echo -e "  ${YELLOW}[${ELAPSED}s]${RESET} Waiting for Elasticsearch..."
      if [ $ELAPSED -ge 120 ]; then
        fail "Elasticsearch did not start after 2 minutes. Check: docker compose logs elasticsearch"
        exit 1
      fi
      continue
    fi
  fi

  # ── Other services (quick pass after ES is up) ────────────────────────────────
  FRONTEND_UP=false
  CATALOG_UP=false
  ORDERS_UP=false
  PLAYER_UP=false
  COLLECTOR_UP=false

  curl -sf --max-time 3 http://localhost:3000 > /dev/null 2>&1 && FRONTEND_UP=true
  curl -sf --max-time 3 http://localhost:3001/api/products > /dev/null 2>&1 && CATALOG_UP=true
  curl -sf --max-time 3 http://localhost:3002/api/orders > /dev/null 2>&1 && ORDERS_UP=true
  curl -sf --max-time 3 http://localhost:3003 > /dev/null 2>&1 && PLAYER_UP=true
  nc -z localhost 4321 2>/dev/null && COLLECTOR_UP=true

  # ── Kibana ────────────────────────────────────────────────────────────────────
  if [ "$KIBANA_UP" = false ]; then
    if kibana_ready; then
      KIBANA_UP=true
    fi
  fi

  # ── Print status snapshot ─────────────────────────────────────────────────────
  echo ""
  echo -e "${CYAN}[$(date '+%H:%M:%S')] Status at ${ELAPSED}s:${RESET}"
  echo -e "  ${GREEN}●${RESET} Elasticsearch     http://localhost:9200  ${DIM}(${ES_STATUS})${RESET}"

  [ "$COLLECTOR_UP" = true ] \
    && echo -e "  ${GREEN}●${RESET} EDOT Collector    localhost:4321" \
    || echo -e "  ${YELLOW}●${RESET} EDOT Collector    localhost:4321  ${DIM}(starting…)${RESET}"

  [ "$CATALOG_UP" = true ] \
    && echo -e "  ${GREEN}●${RESET} Catalog API       http://localhost:3001" \
    || echo -e "  ${YELLOW}●${RESET} Catalog API       http://localhost:3001  ${DIM}(starting…)${RESET}"

  [ "$ORDERS_UP" = true ] \
    && echo -e "  ${GREEN}●${RESET} Orders API        http://localhost:3002" \
    || echo -e "  ${YELLOW}●${RESET} Orders API        http://localhost:3002  ${DIM}(starting…)${RESET}"

  [ "$FRONTEND_UP" = true ] \
    && echo -e "  ${GREEN}●${RESET} ElasticShop       http://localhost:3000" \
    || echo -e "  ${YELLOW}●${RESET} ElasticShop       http://localhost:3000  ${DIM}(starting…)${RESET}"

  [ "$PLAYER_UP" = true ] \
    && echo -e "  ${GREEN}●${RESET} Replay Player     http://localhost:3003" \
    || echo -e "  ${YELLOW}●${RESET} Replay Player     http://localhost:3003  ${DIM}(starting…)${RESET}"

  if [ "$KIBANA_UP" = true ]; then
    echo -e "  ${GREEN}●${RESET} Kibana            http://localhost:5601  ${GREEN}(ready)${RESET}"
  else
    KLOG=$(kibana_last_log)
    echo -e "  ${YELLOW}●${RESET} Kibana            http://localhost:5601  ${DIM}(booting…)${RESET}"
    [ -n "$KLOG" ] && echo -e "       ${DIM}↳ ${KLOG}${RESET}"
  fi

  # ── All up? Print the final box and exit ──────────────────────────────────────
  if [ "$KIBANA_UP" = true ] && [ "$FRONTEND_UP" = true ] && [ "$ES_UP" = true ]; then
    echo ""
    echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}"
    echo -e "${GREEN}${BOLD}║              EVERYTHING IS READY                         ║${RESET}"
    echo -e "${GREEN}${BOLD}╠══════════════════════════════════════════════════════════╣${RESET}"
    echo -e "${GREEN}${BOLD}║${RESET}                                                          ${GREEN}${BOLD}║${RESET}"
    echo -e "${GREEN}${BOLD}║${RESET}  ${CYAN}${BOLD}ElasticShop${RESET}    →  ${GREEN}http://localhost:3000${RESET}              ${GREEN}${BOLD}║${RESET}"
    echo -e "${GREEN}${BOLD}║${RESET}  ${CYAN}${BOLD}RUM Plugin${RESET}     →  ${GREEN}http://localhost:5601/app/rumSessionReplay${RESET}"
    echo -e "${GREEN}${BOLD}║${RESET}  ${CYAN}${BOLD}Kibana${RESET}         →  ${GREEN}http://localhost:5601${RESET}              ${GREEN}${BOLD}║${RESET}"
    echo -e "${GREEN}${BOLD}║${RESET}  ${CYAN}${BOLD}Player${RESET}         →  ${GREEN}http://localhost:3003${RESET}              ${GREEN}${BOLD}║${RESET}"
    echo -e "${GREEN}${BOLD}║${RESET}  ${CYAN}${BOLD}Elasticsearch${RESET}  →  ${GREEN}http://localhost:9200${RESET}              ${GREEN}${BOLD}║${RESET}"
    echo -e "${GREEN}${BOLD}║${RESET}                                                          ${GREEN}${BOLD}║${RESET}"
    echo -e "${GREEN}${BOLD}╠══════════════════════════════════════════════════════════╣${RESET}"
    echo -e "${GREEN}${BOLD}║${RESET}  ${BOLD}Quick start:${RESET}                                              ${GREEN}${BOLD}║${RESET}"
    echo -e "${GREEN}${BOLD}║${RESET}  1. Open ${GREEN}http://localhost:3000${RESET} in Chrome               ${GREEN}${BOLD}║${RESET}"
    echo -e "${GREEN}${BOLD}║${RESET}  2. Browse the shop — add items, place an order        ${GREEN}${BOLD}║${RESET}"
    echo -e "${GREEN}${BOLD}║${RESET}  3. Open ${GREEN}http://localhost:5601/app/rumSessionReplay${RESET}    ${GREEN}${BOLD}║${RESET}"
    echo -e "${GREEN}${BOLD}║${RESET}  4. Your session appears — click to replay             ${GREEN}${BOLD}║${RESET}"
    echo -e "${GREEN}${BOLD}║${RESET}                                                          ${GREEN}${BOLD}║${RESET}"
    echo -e "${GREEN}${BOLD}║${RESET}  ${DIM}Logs:  docker compose logs -f [service]${RESET}               ${GREEN}${BOLD}║${RESET}"
    echo -e "${GREEN}${BOLD}║${RESET}  ${DIM}Stop:  ./stop.sh${RESET}                                       ${GREEN}${BOLD}║${RESET}"
    echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}"
    echo ""
    exit 0
  fi

  # ── Timeout guard ─────────────────────────────────────────────────────────────
  if [ $ELAPSED -ge $MAX_WAIT ]; then
    echo ""
    warn "Timed out after ${MAX_WAIT}s. Services may still be starting."
    echo ""
    [ "$KIBANA_UP" = false ] && echo -e "  ${DIM}Kibana logs: docker compose logs -f kibana${RESET}"
    echo -e "  ${DIM}All logs:   docker compose logs -f${RESET}"
    echo ""
    echo -e "  Services that started are still running. Check URLs manually:"
    echo -e "  ${GREEN}http://localhost:3000${RESET}  ElasticShop"
    echo -e "  ${GREEN}http://localhost:5601${RESET}  Kibana"
    exit 0
  fi
done
