#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIBANA_TAG="v9.5.0"
KIBANA_SRC="$SCRIPT_DIR/kibana-src"
PLUGIN_SRC="$SCRIPT_DIR/plugin-src"
PLUGIN_DEST="$KIBANA_SRC/plugins/rum-session-replay"
BUILD_OUT="$PLUGIN_DEST/build/kibana/rumSessionReplay"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; DIM='\033[2m'; RESET='\033[0m'
ok()   { echo -e "  ${GREEN}✓${RESET}  $1"; }
warn() { echo -e "  ${YELLOW}⚠${RESET}  $1"; }
fail() { echo -e "  ${RED}✗${RESET}  $1"; }
hdr()  { echo -e "\n${BOLD}$1${RESET}"; }

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║      Build: RUM Session Replay External Plugin           ║${RESET}"
echo -e "${BOLD}║      Uses Kibana's @kbn/optimizer (plugin-helpers)       ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}"

# ── Find Node v24 ─────────────────────────────────────────────────────────────
hdr "Checking prerequisites..."
NODE_BIN=""
if [ -f "$SCRIPT_DIR/.node-bin" ]; then
  NODE_BIN="$(cat "$SCRIPT_DIR/.node-bin")"
fi
if [ -z "$NODE_BIN" ] || ! "$NODE_BIN" --version > /dev/null 2>&1; then
  for candidate in \
    "$(which node 2>/dev/null)" \
    "/opt/homebrew/Cellar/node@24/24.15.0/bin/node" \
    "/opt/homebrew/Cellar/node@24/24.14.1/bin/node" \
    "/usr/local/bin/node" \
    "/usr/bin/node" \
    "$HOME/.nvm/versions/node/$(ls "$HOME/.nvm/versions/node/" 2>/dev/null | grep '^v24' | tail -1)/bin/node" \
    "$HOME/.volta/bin/node"; do
    if [ -n "$candidate" ] && [ -f "$candidate" ]; then
      VER=$("$candidate" --version 2>/dev/null | grep -oE 'v[0-9]+' | head -1)
      if [ "$VER" = "v24" ]; then NODE_BIN="$candidate"; break; fi
    fi
  done
fi
if [ -z "$NODE_BIN" ]; then
  fail "Node v24 not found. Install it: brew install node@24  or  nvm install 24"
  exit 1
fi
echo "$NODE_BIN" > "$SCRIPT_DIR/.node-bin"
ok "Node $("$NODE_BIN" --version)  →  $NODE_BIN"

NODE_DIR="$(dirname "$NODE_BIN")"
YARN_BIN=""
for candidate in "$NODE_DIR/yarn" "$(which yarn 2>/dev/null)"; do
  if [ -x "$candidate" ]; then YARN_BIN="$candidate"; break; fi
done
if [ -z "$YARN_BIN" ]; then
  warn "yarn not found — installing..."
  "$NODE_BIN" "$NODE_DIR/npm" install -g yarn
  YARN_BIN="$NODE_DIR/yarn"
fi
ok "yarn at $YARN_BIN"

# ── Clone Kibana ──────────────────────────────────────────────────────────────
hdr "Kibana source..."
if [ -d "$KIBANA_SRC/.git" ]; then
  ok "Already cloned at ./kibana-src"
else
  echo -e "  ${DIM}Cloning Kibana $KIBANA_TAG — this takes several minutes...${RESET}"
  git clone --depth 1 --branch "$KIBANA_TAG" https://github.com/elastic/kibana.git "$KIBANA_SRC"
  ok "Kibana cloned"
fi

# ── Install Kibana dependencies ───────────────────────────────────────────────
hdr "Kibana dependencies..."
if [ -d "$KIBANA_SRC/node_modules" ]; then
  ok "node_modules already present — skipping (takes 20–40 min on first run)"
else
  echo -e "  ${YELLOW}Installing Kibana workspace dependencies — this takes 20–40 minutes...${RESET}"
  cd "$KIBANA_SRC"
  UNSAFE_DISABLE_NODE_VERSION_VALIDATION=true "$NODE_BIN" "$YARN_BIN" install
  cd "$SCRIPT_DIR"
  ok "Dependencies installed"
fi

# ── Copy plugin source into Kibana plugins/ ───────────────────────────────────
hdr "Copying plugin source..."
rm -rf "$PLUGIN_DEST"
mkdir -p "$PLUGIN_DEST"
cp -r "$PLUGIN_SRC/"* "$PLUGIN_DEST/"
ok "Plugin source → $PLUGIN_DEST"

# Write kibana.dev.yml so Kibana points to local ES
mkdir -p "$KIBANA_SRC/config"
cat > "$KIBANA_SRC/config/kibana.dev.yml" << 'EOF'
elasticsearch.hosts:
  - 'http://localhost:9200'
elasticsearch.ignoreVersionMismatch: true
EOF

# ── Install plugin's own dependencies ────────────────────────────────────────
hdr "Installing plugin dependencies (rrweb etc.)..."
cd "$PLUGIN_DEST"
UNSAFE_DISABLE_NODE_VERSION_VALIDATION=true "$NODE_BIN" "$YARN_BIN" install --legacy-peer-deps 2>&1 | tail -3
ok "Plugin dependencies installed"

# ── Build with plugin-helpers (@kbn/optimizer) ────────────────────────────────
hdr "Building plugin (this takes 2–5 minutes)..."
echo -e "  ${DIM}Running: yarn plugin-helpers build --skip-archive${RESET}"
echo -e "  ${DIM}Kibana's @kbn/optimizer produces rumSessionReplay.plugin.js${RESET}"
UNSAFE_DISABLE_NODE_VERSION_VALIDATION=true \
  "$NODE_BIN" "$KIBANA_SRC/node_modules/.bin/plugin-helpers" build --skip-archive 2>&1

cd "$SCRIPT_DIR"

# ── Verify output ──────────────────────────────────────────────────────────────
hdr "Verifying build output..."
MISSING=0
for f in kibana.json target/public/rumSessionReplay.plugin.js target/server/index.js; do
  if [ -f "$BUILD_OUT/$f" ]; then
    ok "$f"
  else
    fail "$f  (missing)"
    MISSING=1
  fi
done

if [ $MISSING -eq 1 ]; then
  fail "Build incomplete. Check output above."
  exit 1
fi

echo ""
echo -e "${GREEN}${BOLD}Plugin built successfully.${RESET}"
echo -e "  Output: ${DIM}$BUILD_OUT${RESET}"
echo -e "  Run ${CYAN}./start.sh${RESET} to start the full stack."
echo ""
