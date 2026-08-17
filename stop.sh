#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

GREEN='\033[0;32m'; BOLD='\033[1m'; DIM='\033[2m'; RESET='\033[0m'

echo ""
echo -e "${BOLD}Stopping ElasticShop Session Replay Demo (External Plugin)...${RESET}"
echo ""

docker compose down 2>&1 | grep -v "^time=" || true
echo -e "  ${GREEN}✓${RESET}  All Docker containers stopped"

echo ""
echo -e "${DIM}  ES data preserved in Docker volume.${RESET}"
echo -e "${DIM}  Wipe all data:  docker compose down -v${RESET}"
echo -e "${DIM}  Restart:        ./start.sh${RESET}"
echo ""
