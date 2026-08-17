# EDOT Browser RUM — Session Replay Demo (External Plugin)

A fully local demo that captures real user sessions on a sample e-commerce site using **Elastic's EDOT Browser RUM SDK**, stores rrweb recordings in Elasticsearch, and lets you replay them inside **Kibana** via a custom external plugin.

No cloud accounts. No API keys. One command to start everything.

---

## What's inside

| Component | What it does |
|-----------|-------------|
| **ElasticShop** | Sample React e-commerce site instrumented with EDOT Browser RUM SDK |
| **EDOT Collector** | Receives OTel traces/logs from the browser, routes session replay events to Elasticsearch |
| **Elasticsearch 9.5** | Stores sessions, rrweb events, traces, and logs |
| **Kibana 9.5** | Hosts the custom RUM Session Replay plugin |
| **RUM Session Replay Plugin** | External Kibana plugin — lists sessions, plays back rrweb recordings, shows span timeline |
| **Standalone Player** | Lightweight fallback player (no Kibana needed) |
| **Catalog & Orders APIs** | Backend services instrumented with EDOT Node.js SDK |

```
Browser
  │  EDOT RUM SDK (rrweb + OTel)
  ▼
EDOT Collector (:4321)
  │
  ├── traces-generic.otel-default   ← page views, XHR, errors
  ├── logs-generic.otel-default     ← console logs
  └── logs-rum.replay-default       ← rrweb session events
                 │
                 ▼
         Elasticsearch (:9200)
                 │
         ┌───────┴──────────┐
         │                  │
      Kibana              Standalone
   RUM Plugin             Player
    (:5601)               (:3003)
```

---

## Prerequisites

| Requirement | Version | Install |
|-------------|---------|---------|
| Docker Desktop | latest | https://www.docker.com/products/docker-desktop |
| Node.js v24 | 24.x | `brew install node@24` or `nvm install 24` |
| yarn | 1.x | `npm install -g yarn` |
| git | any | pre-installed on macOS |

> **macOS only**: make sure Docker Desktop is running before you start.

---

## Quick Start

### First time (one-time setup — 25–45 min)

The plugin must be built from Kibana source using Kibana's own build toolchain (`@kbn/optimizer`). This only needs to happen once:

```bash
git clone https://github.com/rejirajraghav/kibana-rum-session-replay.git
cd kibana-rum-session-replay

# Build the plugin (clones Kibana ~2 GB, installs deps, builds bundle)
./build-plugin.sh
```

What `build-plugin.sh` does:
1. Clones `elastic/kibana` v9.5.0 into `./kibana-src/` (~2 GB, shallow clone)
2. Runs `yarn install` in the Kibana workspace (15–30 min, one-time)
3. Copies `plugin-src/` into `kibana-src/plugins/`
4. Builds via `yarn plugin-helpers build --skip-archive` — produces `rumSessionReplay.plugin.js` using `@kbn/optimizer`

### Start the stack

```bash
./start.sh
```

`start.sh` auto-detects if the plugin is already built. If not, it runs `build-plugin.sh` first.

### Stop everything

```bash
./stop.sh
```

---

## URLs

| Service | URL |
|---------|-----|
| **ElasticShop** (browse and generate sessions) | http://localhost:3000 |
| **Kibana** | http://localhost:5601 |
| **RUM Session Replay Plugin** | http://localhost:5601/app/rumSessionReplay |
| **Standalone Replay Player** | http://localhost:3003 |
| **Elasticsearch** | http://localhost:9200 |
| **Catalog API** | http://localhost:3001/api/products |
| **Orders API** | http://localhost:3002/api/orders |
| OTLP Collector (browser → collector) | localhost:4321 |

---

## Try the demo

1. Open **http://localhost:3000** in Chrome
2. Browse the ElasticShop — add items to cart, place an order, click around
3. Open **http://localhost:5601/app/rumSessionReplay** in Kibana
4. Your session appears in the list within a few seconds
5. Click a session → watch the full DOM replay with an event timeline

> Kibana takes ~60–90 seconds to fully boot after `./start.sh`. Watch progress with:
> ```bash
> docker compose logs -f kibana
> ```

---

## Architecture — Why an external plugin?

Kibana plugins cannot be plain JavaScript files. Kibana's browser bootstrap (`plugin_reader.ts`) requires every plugin bundle to call:

```js
window.__kbnBundles__.define('plugin/rumSessionReplay/public', [...], factory)
```

Only Kibana's own build toolchain (`@kbn/optimizer` / `@kbn/rspack-optimizer`) produces bundles in this format. That's why:

- We clone Kibana source once and use `yarn plugin-helpers build` to build the plugin
- The output (`build/kibana/rumSessionReplay/`) is mounted into the Kibana Docker container as a read-only volume
- No Kibana source modifications — pure external plugin via the official plugin API

---

## Project structure

```
.
├── plugin-src/                  # Kibana plugin source (TypeScript)
│   ├── common/                  # Shared types & constants
│   │   ├── constants.ts         # Index names, field mappings, API routes
│   │   └── types.ts             # Session, Event, Metadata types
│   ├── public/                  # Browser-side (React + EUI)
│   │   ├── plugin.ts            # Plugin entry — registers Kibana app
│   │   ├── application.tsx      # React root + CoreStart context
│   │   ├── routes.tsx           # Client-side routing
│   │   └── pages/
│   │       ├── SessionList/     # Session table with filters
│   │       └── SessionPlayer/   # rrweb player + metadata panel
│   ├── server/                  # Node.js server-side
│   │   ├── plugin.ts            # Registers Hapi routes on setup
│   │   └── routes/
│   │       ├── sessions.ts      # GET /api/rum-session-replay/sessions
│   │       └── events.ts        # GET /api/rum-session-replay/events/:id
│   ├── kibana.json              # Plugin manifest
│   └── package.json
│
├── frontend/                    # ElasticShop (EDOT RUM instrumented)
├── backend-catalog/             # Catalog API (EDOT Node.js)
├── backend-orders/              # Orders API (EDOT Node.js)
├── otel-collector/              # EDOT Collector config
├── player/                      # Standalone rrweb player
│
├── build-plugin.sh              # One-time plugin build script
├── start.sh                     # Start full stack (builds if needed)
├── stop.sh                      # Stop all services
└── docker-compose.yml           # All 6 services + Kibana
```

---

## Data flowing through the stack

| Index | Contents |
|-------|----------|
| `logs-rum.replay-default` | rrweb session recording events (packed JSON) |
| `traces-generic.otel-default` | Page views, XHR spans, user interactions |
| `logs-generic.otel-default` | Console logs, errors captured by RUM SDK |
| `metrics-generic.otel-default` | Performance metrics (LCP, FID, CLS) |

---

## Troubleshooting

**Kibana shows "Elastic did not load properly"**
> The plugin bundle is missing or corrupt. Re-run `./build-plugin.sh` to rebuild.

**`yarn install` fails with engine mismatch**
> Make sure you have Node v24 installed. The script uses `--ignore-engines` to accept patch version differences (e.g. 24.15 vs 24.18).

**Plugin does not appear in Kibana sidebar**
> Wait 60–90 seconds for Kibana to fully boot. Check `docker compose logs -f kibana` for `Server running at http://0.0.0.0:5601`.

**Sessions not appearing after browsing**
> The EDOT RUM SDK flushes events every few seconds. Wait 5–10 seconds, then refresh the session list. Check the browser DevTools Network tab for requests to `localhost:4321`.

**Ports already in use**
> Run `./stop.sh` first, or check for conflicting services: `lsof -i :9200 -i :5601 -i :3000`.

---

## Related

- [EDOT Browser RUM SDK](https://www.elastic.co/docs/reference/opentelemetry/edot-sdks/edot-web)
- [Kibana External Plugin Development](https://www.elastic.co/docs/extend/kibana/tutorials/external-plugin-development)
- [Kibana Plugin Tooling](https://www.elastic.co/docs/extend/kibana/tutorials/plugin-tooling)
- [rrweb](https://github.com/rrweb-io/rrweb)

---

## Option 2 — Kibana from source (dev server)

Prefer running Kibana from source with hot-reload during development? See the companion repo:

**`session-replay-local-demo/`** — same ElasticShop stack + Kibana dev server (no Docker for Kibana, full source access, live TypeScript compilation).

---

*Built by [Elastic Field Engineering](https://www.elastic.co) as a local demo. Not a supported Elastic product.*
