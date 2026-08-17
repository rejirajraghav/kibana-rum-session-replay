#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; RESET='\033[0m'
ok()   { echo -e "  ${GREEN}✓${RESET}  $1"; }
warn() { echo -e "  ${YELLOW}⚠${RESET}  $1"; }
fail() { echo -e "  ${RED}✗${RESET}  $1"; }
hdr()  { echo -e "\n${BOLD}$1${RESET}"; }

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║   ElasticShop Session Replay Demo  —  External Plugin    ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}"
echo ""

# ── Docker check ──────────────────────────────────────────────────────────────
if ! docker info > /dev/null 2>&1; then
  fail "Docker is not running. Start Docker Desktop and try again."
  exit 1
fi

# ── Plugin build check ────────────────────────────────────────────────────────
BUILD_OUT="$SCRIPT_DIR/kibana-src/plugins/rum-session-replay/build/kibana/rumSessionReplay"
if [ ! -f "$BUILD_OUT/target/public/rumSessionReplay.plugin.js" ]; then
  echo -e "${YELLOW}Plugin not built yet. Running build-plugin.sh first...${RESET}"
  echo ""
  ./build-plugin.sh
fi

# ── Start Docker stack ────────────────────────────────────────────────────────
hdr "Starting services..."
docker compose up -d --build 2>&1 \
  | grep -v "^time=" \
  | grep -E "(Starting|Started|Healthy|Building|build|Error|error)" \
  || true

# ── Wait for Elasticsearch ────────────────────────────────────────────────────
hdr "Waiting for Elasticsearch..."
ATTEMPTS=0
until curl -sf http://localhost:9200/_cluster/health 2>/dev/null | grep -qE '"status":"(green|yellow)"'; do
  ATTEMPTS=$((ATTEMPTS + 1))
  if [ $ATTEMPTS -gt 40 ]; then
    fail "Elasticsearch did not become healthy after 2 minutes."
    echo -e "  ${DIM}Check logs: docker compose logs elasticsearch${RESET}"
    exit 1
  fi
  printf "${DIM}.${RESET}"
  sleep 3
done
echo ""

sleep 4

# ── Per-service health check ──────────────────────────────────────────────────
hdr "Checking all services..."

check_http() {
  local url=$1 label=$2
  if curl -sf --max-time 5 "$url" > /dev/null 2>&1; then
    ok "$label"
  else
    warn "$label  ${DIM}(may still be starting)${RESET}"
  fi
}

check_http "http://localhost:9200/_cluster/health" "Elasticsearch       http://localhost:9200"
check_http "http://localhost:3000"                 "Frontend (shop)     http://localhost:3000"
check_http "http://localhost:3001/api/products"    "Catalog API         http://localhost:3001"
check_http "http://localhost:3002/api/orders"      "Orders API          http://localhost:3002"
check_http "http://localhost:3003"                 "Replay Player       http://localhost:3003"

if nc -z localhost 4321 2>/dev/null; then
  ok "OTLP Collector      localhost:4321  ${DIM}(browser → collector)${RESET}"
else
  warn "OTLP Collector      localhost:4321  ${DIM}(may still be starting)${RESET}"
fi

hdr "Kibana status..."
warn "Kibana is starting (60–90 sec)...  ${DIM}http://localhost:5601${RESET}"
echo -e "     ${DIM}Check: docker compose logs -f kibana${RESET}"

# ── ES info ───────────────────────────────────────────────────────────────────
ES_STATUS=$(curl -sf http://localhost:9200/_cluster/health 2>/dev/null | python3 -c "import sys,json; h=json.load(sys.stdin); print(h['status'])" 2>/dev/null || echo "unknown")
ES_NODES=$(curl -sf http://localhost:9200/_cluster/health 2>/dev/null | python3 -c "import sys,json; h=json.load(sys.stdin); print(h['number_of_nodes'])" 2>/dev/null || echo "?")

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║                    STACK SUMMARY                         ║${RESET}"
echo -e "${BOLD}╠══════════════════════════════════════════════════════════╣${RESET}"
echo -e "${BOLD}║${RESET}                                                          ${BOLD}║${RESET}"
echo -e "${BOLD}║${RESET}  ${CYAN}${BOLD}ElasticShop UI${RESET}      →  ${GREEN}http://localhost:3000${RESET}           ${BOLD}║${RESET}"
echo -e "${BOLD}║${RESET}  ${CYAN}${BOLD}Session Replay Player${RESET} →  ${GREEN}http://localhost:3003${RESET}           ${BOLD}║${RESET}"
echo -e "${BOLD}║${RESET}  ${CYAN}${BOLD}Kibana (starting...)${RESET} →  ${GREEN}http://localhost:5601${RESET}           ${BOLD}║${RESET}"
echo -e "${BOLD}║${RESET}  ${CYAN}${BOLD}RUM Plugin${RESET}          →  ${GREEN}http://localhost:5601/app/rum-session-replay${RESET}"
echo -e "${BOLD}║${RESET}  ${CYAN}${BOLD}Elasticsearch${RESET}        →  ${GREEN}http://localhost:9200${RESET}           ${BOLD}║${RESET}"
echo -e "${BOLD}║${RESET}                                                          ${BOLD}║${RESET}"
echo -e "${BOLD}╠══════════════════════════════════════════════════════════╣${RESET}"
echo -e "${BOLD}║${RESET}  ${DIM}Cluster status: ${ES_STATUS}  •  Nodes: ${ES_NODES}${RESET}                          ${BOLD}║${RESET}"
echo -e "${BOLD}║${RESET}  ${DIM}Catalog API:   http://localhost:3001${RESET}                    ${BOLD}║${RESET}"
echo -e "${BOLD}║${RESET}  ${DIM}Orders API:    http://localhost:3002${RESET}                    ${BOLD}║${RESET}"
echo -e "${BOLD}║${RESET}  ${DIM}OTLP Collector: localhost:4321${RESET}                          ${BOLD}║${RESET}"
echo -e "${BOLD}╠══════════════════════════════════════════════════════════╣${RESET}"
echo -e "${BOLD}║${RESET}  ${BOLD}Quick start:${RESET}                                              ${BOLD}║${RESET}"
echo -e "${BOLD}║${RESET}  1. Open ${GREEN}http://localhost:3000${RESET} in ${BOLD}Chrome${RESET}               ${BOLD}║${RESET}"
echo -e "${BOLD}║${RESET}  2. Browse the shop — add items, place an order        ${BOLD}║${RESET}"
echo -e "${BOLD}║${RESET}  3. Once Kibana is ready, open:                        ${BOLD}║${RESET}"
echo -e "${BOLD}║${RESET}     ${GREEN}http://localhost:5601/app/rum-session-replay${RESET}      ${BOLD}║${RESET}"
echo -e "${BOLD}║${RESET}                                                          ${BOLD}║${RESET}"
echo -e "${BOLD}║${RESET}  ${DIM}Logs:  docker compose logs -f${RESET}                          ${BOLD}║${RESET}"
echo -e "${BOLD}║${RESET}  ${DIM}Stop:  ./stop.sh${RESET}                                       ${BOLD}║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}"
echo ""
