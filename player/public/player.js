/* Session Replay Player — SPA */

// ── State ─────────────────────────────────────────────────────────────────────
let _sessions = [];
let _currentSession = null;
let _replayer = null;
let _replayEvents = [];
let _pageTimestamps = [];
let _traceTimestamps = [];  // [{ts, endTs, idx}] for waterfall sync
let _activePageIdx = -1;
let _activeTraceIdx = -1;
let _currentSpeed = 1;
let _skipIdle = false;
let _replayStart = 0;
let _replayDur = 1;
let _selectedService = '';   // '' = first available service
let _services = [];
let _journeyRoot = null;     // ReactDOM root for journey map — persists across refreshes

// Dynamic page → colour mapping.
// Built per-session from the actual page list so any app gets consistent,
// evenly-spaced hues regardless of which routes exist.
// Hues are distributed evenly around the HSL wheel: index i of N pages
// → hue = (i / N) * 360. Saturation and lightness are fixed for dark-theme
// readability.
let _pageColorMap = {};  // pathname → hsl(...) string

/**
 * Build (or rebuild) the color map from a session's pages array.
 * Called once per session load, before renderSidebar and _buildTimelineDecorations.
 * @param {Array} pages  — detail.pages from the API
 */
function _buildPageColorMap(pages) {
    // Collect unique pathnames in first-appearance order
    const seen = [];
    for (const p of (pages || [])) {
        const url = _pageUrlFrom(p);
        try {
            const path = new URL(url, 'http://x').pathname.replace(/\/$/, '') || '/';
            if (!seen.includes(path)) seen.push(path);
        } catch (_) {}
    }
    const n = Math.max(1, seen.length);
    _pageColorMap = {};
    seen.forEach((path, i) => {
        // Spread hues across the full wheel; offset by 200° so the first page
        // lands on a cool blue rather than red, which reads better on dark UI.
        const hue = (200 + Math.round((i / n) * 360)) % 360;
        _pageColorMap[path] = `hsl(${hue},65%,58%)`;
    });
}

/**
 * Return the assigned colour for a URL. Falls back to a hash-derived hue
 * for paths not in the current session (e.g. timeline before map is built).
 */
function _pageColor(url) {
    try {
        const path = new URL(url, 'http://x').pathname.replace(/\/$/, '') || '/';
        if (_pageColorMap[path]) return _pageColorMap[path];
        // Stable hash fallback: same path always maps to the same hue
        let h = 0;
        for (let i = 0; i < path.length; i++) h = ((h << 5) - h + path.charCodeAt(i)) | 0;
        return `hsl(${Math.abs(h) % 360},55%,52%)`;
    } catch (_) { return '#444c56'; }
}

// ── Router ────────────────────────────────────────────────────────────────────
function getRoute() {
    const h = window.location.hash;
    if (h.startsWith('#/session/')) return {page: 'player', sessionId: h.slice(10)};
    if (h === '#/analytics')        return {page: 'analytics'};
    return {page: 'list'};
}

function navigate(hash) { window.location.hash = hash; }

window.addEventListener('hashchange', render);
window.addEventListener('load', () => { render(); loadServices(); });

function render() {
    const r = getRoute();
    if (r.page === 'player')    renderPlayerPage(r.sessionId);
    else if (r.page === 'analytics') renderAnalyticsPage();
    else                        renderListPage();
}

async function loadServices() {
    try {
        const res = await fetch('/api/services');
        const d = await res.json();
        _services = (d.services || []).map(s => s.name);
        if (_services.length > 0 && !_selectedService) _selectedService = _services[0];
        _renderServiceSelector();
    } catch (_) {}
}

function _renderServiceSelector() {
    const sel = document.getElementById('service-selector');
    if (!sel || _services.length === 0) return;
    const current = _selectedService;
    sel.innerHTML = _services.map(s =>
        `<option value="${s}" ${s === current ? 'selected' : ''}>${s}</option>`
    ).join('');
    sel.value = current;
}

window._onServiceChange = (val) => {
    _selectedService = val;
    render();
};

// ── Header helper ─────────────────────────────────────────────────────────────
function _header(active) {
    return `<div class="header">
        <span class="header-brand">⚡ Elastic RUM — Session Replay</span>
        <nav class="header-nav">
            <a href="#/" class="${active==='list'?'active':''}">Sessions</a>
            <a href="#/analytics" class="${active==='analytics'?'active':''}">📊 Analytics</a>
            ${active==='player' ? `<a href="#/player" class="active">▶ Player</a>` : ''}
            <select id="service-selector" onchange="window._onServiceChange(this.value)"
                style="background:#1c2330;color:#e6edf3;border:1px solid rgba(255,255,255,.2);border-radius:4px;padding:.2rem .5rem;font-size:12px;cursor:pointer;margin-left:1rem">
            </select>
        </nav>
    </div>`;
}

// ── Page 1: Session List ──────────────────────────────────────────────────────
function renderListPage() {
    document.getElementById('app').innerHTML = `
        ${_header('list')}
        <div class="sessions-page">
            <h1>Session List</h1>
            <div class="sessions-toolbar">
                <select id="time-range">
                    <option value="now-1h">Last 1 hour</option>
                    <option value="now-6h">Last 6 hours</option>
                    <option value="now-24h" selected>Last 24 hours</option>
                    <option value="now-7d">Last 7 days</option>
                </select>
                <input id="session-search" type="text" placeholder="Search by session ID or user…">
                <button class="btn btn-primary" onclick="loadSessions()">Refresh</button>
            </div>
            <div id="sessions-container"><div class="loading">Loading sessions…</div></div>
        </div>`;
    document.getElementById('time-range').addEventListener('change', loadSessions);
    document.getElementById('session-search').addEventListener('input', filterSessions);
    loadSessions();
}

async function loadSessions() {
    const from = document.getElementById('time-range')?.value || 'now-24h';
    document.getElementById('sessions-container').innerHTML = '<div class="loading">⏳ Loading…</div>';
    try {
        const res  = await fetch(`/api/sessions?from=${encodeURIComponent(from)}&size=25&service=${encodeURIComponent(_selectedService)}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        _sessions = data.sessions || [];
        renderSessionTable(_sessions);
    } catch (err) {
        document.getElementById('sessions-container').innerHTML =
            `<div class="loading" style="color:#f85149">Failed: ${err.message}</div>`;
    }
}

function filterSessions() {
    const q = document.getElementById('session-search')?.value?.toLowerCase() || '';
    renderSessionTable(q ? _sessions.filter((s) =>
        s.sessionId.toLowerCase().includes(q) ||
        (s.userName  && s.userName.toLowerCase().includes(q)) ||
        (s.userEmail && s.userEmail.toLowerCase().includes(q))
    ) : _sessions);
}

function renderSessionTable(sessions) {
    const c = document.getElementById('sessions-container');
    if (!sessions.length) { c.innerHTML = `<div class="loading">No sessions found.</div>`; return; }
    const cap = sessions.length >= 25
        ? `<div class="sessions-cap-note">Showing last 25 sessions · Use the time-range filter to narrow results</div>`
        : `<div class="sessions-cap-note">${sessions.length} session${sessions.length !== 1 ? 's' : ''} found</div>`;
    c.innerHTML = `${cap}<table class="session-table">
        <thead><tr>
            <th>Session ID</th><th>User</th><th>Start Time</th>
            <th>Duration</th><th>Errors</th><th>Replay</th><th>Play</th>
        </tr></thead>
        <tbody>${sessions.map(sessionRow).join('')}</tbody>
    </table>`;
}

function sessionRow(s) {
    const start    = s.startTime ? new Date(s.startTime) : null;
    const end      = s.endTime   ? new Date(s.endTime)   : null;
    const duration = start && end && end > start ? _fmtDuration(end - start) : '—';
    const userName = s.userName || s.userEmail || s.userId;
    const userHtml = userName
        ? `<span class="user-name">${userName}</span>`
        : '<span class="anon-user">anonymous</span>';
    const errBadge = s.errorCount > 0
        ? `<span class="error-badge">⚠ ${s.errorCount}</span>`
        : '<span style="color:#484f58">—</span>';
    const replayBadge = s.hasReplay
        ? '<span class="replay-badge">🎬 yes</span>'
        : '<span class="no-replay">—</span>';
    const playBtn = s.hasReplay
        ? `<button class="btn btn-play" onclick="navigate('#/session/${s.sessionId}')">▶</button>`
        : '—';
    return `<tr>
        <td><span class="session-id" title="${s.sessionId}">${s.sessionId.slice(0,8)}…</span></td>
        <td class="session-user">${userHtml}</td>
        <td class="session-time">${start ? _fmtTime(start) : '—'}</td>
        <td class="session-time">${duration}</td>
        <td>${errBadge}</td>
        <td>${replayBadge}</td>
        <td>${playBtn}</td>
    </tr>`;
}

// ── Page 2: Session Player ────────────────────────────────────────────────────
async function renderPlayerPage(sessionId) {
    document.getElementById('app').innerHTML = `
        ${_header('player')}
        <div id="session-info-strip" class="session-info-strip">Loading…</div>
        <div class="player-layout">
            <div class="player-left-panel" id="player-left-panel"><div class="loading">Loading…</div></div>
            <div class="player-frame">
                <div class="player-controls">
                    <button class="btn btn-primary" id="btn-play-pause" onclick="togglePlay()">▶ Play</button>
                    <button class="btn btn-ghost" onclick="restartReplay()" title="Restart">⟳</button>
                    <div class="speed-controls">
                        <button class="speed-btn active" onclick="setSpeed(1)"  data-speed="1">1×</button>
                        <button class="speed-btn"        onclick="setSpeed(2)"  data-speed="2">2×</button>
                        <button class="speed-btn"        onclick="setSpeed(8)"  data-speed="8">8×</button>
                    </div>
                    <button class="skip-idle-btn" id="btn-skip-idle" onclick="toggleSkipIdle()">Skip Idle</button>
                    <div class="player-timeline" id="player-timeline">
                        <div class="tl-segments"  id="tl-segments"></div>
                        <div class="tl-played"    id="tl-played"></div>
                        <div class="tl-errors"    id="tl-errors"></div>
                        <div class="tl-cursor"    id="tl-cursor"></div>
                    </div>
                    <span class="player-status" id="player-status">Ready</span>
                </div>
                <div class="player-viewport" id="player-viewport">
                    <div class="loading">Loading replay…</div>
                </div>
            </div>
            <div class="player-right-panel" id="player-right-panel"><div class="loading">Loading…</div></div>
        </div>`;

    try {
        const [detailRes, replayRes] = await Promise.all([
            fetch(`/api/sessions/${sessionId}`),
            fetch(`/api/sessions/${sessionId}/replay`),
        ]);
        const detail     = await detailRes.json();
        const replayData = await replayRes.json();
        if (detail.error) throw new Error(detail.error);

        _currentSession = detail;
        _replayEvents   = replayData.events || [];

        // Build dynamic page→color map from this session's actual pages
        // before renderSidebar and _buildTimelineDecorations consume it.
        _buildPageColorMap(detail.pages);

        renderSessionInfoStrip(detail);
        renderSidebar(detail);
        initPlayer(detail);
    } catch (err) {
        document.getElementById('player-viewport').innerHTML =
            `<div class="no-replay-msg"><div class="icon">⚠️</div><div>Failed: ${err.message}</div></div>`;
    }
}

function renderSessionInfoStrip(detail) {
    const s        = _sessions.find((s) => s.sessionId === detail.sessionId) || {};
    const start    = s.startTime ? _fmtTime(new Date(s.startTime)) : '—';
    const duration = s.startTime && s.endTime
        ? _fmtDuration(new Date(s.endTime) - new Date(s.startTime)) : '—';
    const userName = s.userName || s.userEmail || s.userId || 'anonymous';
    document.getElementById('session-info-strip').innerHTML = `
        <div class="info-item"><span class="info-label">Session:</span><span class="info-value">${detail.sessionId.slice(0,8)}…</span></div>
        <div class="info-item"><span class="info-label">User:</span><span class="info-value">${userName}</span></div>
        <div class="info-item"><span class="info-label">Start:</span><span class="info-value">${start}</span></div>
        <div class="info-item"><span class="info-label">Duration:</span><span class="info-value">${duration}</span></div>
        <div class="info-item"><span class="info-label">Errors:</span><span class="info-value error-count">${detail.errors?.length || 0}</span></div>
        <div class="info-item"><span class="info-label">Traces:</span><span class="info-value">${detail.traces?.length || 0}</span></div>
        <div class="info-item"><span class="info-label">Pages:</span><span class="info-value">${detail.pages?.length || 0}</span></div>`;
}

// Helper: extract page URL from an ES _source document
function _pageUrlFrom(p) {
    return p?.attributes?.['page.url.path']
        || p?.resource?.attributes?.['url.full']
        || p?.['attributes.page.url.path']
        || p?.['resource.attributes.url.full']
        || '/';
}
// Helper: extract error message from an ES log _source
function _errMsgFrom(e) {
    const b = e.body;
    if (typeof b === 'string') return b;
    if (b && typeof b === 'object') return b.text || b.message || JSON.stringify(b);
    return e.attributes?.['exception.message'] || e.attributes?.['error.message'] || 'Error';
}

function renderSidebar(detail) {
    const leftPanel  = document.getElementById('player-left-panel');
    const rightPanel = document.getElementById('player-right-panel');

    // ── LEFT: page navigations ──────────────────────────────────────
    const pageNav = (p) => p.attributes?.['navigation.type'] || p?.['attributes.navigation.type'] || '';
    const pageItems = (detail.pages || []).map((p, i) => {
        const url   = _pageUrlFrom(p);
        const color = _pageColor(url);
        return `<div class="sidebar-item page" id="page-nav-${i}" data-ts="${new Date(p['@timestamp']).getTime()}">
            <span class="page-color-dot" style="background:${color}"></span>
            <span class="item-ts">${_fmtTimeShort(p['@timestamp'])}</span>
            <div class="item-label">
                <div class="name">${url}</div>
                <div class="detail">${pageNav(p)}</div>
            </div>
        </div>`;
    }).join('');

    leftPanel.innerHTML = `
        <div class="sidebar-section-header">🗺 Pages (${detail.pages?.length || 0})</div>
        ${pageItems || '<div class="sidebar-item" style="color:#484f58">No navigations recorded</div>'}`;

    // ── RIGHT: errors + waterfall ───────────────────────────────────
    const errors = detail.errors || [];
    const errorItems = errors.map((e) => {
        const msg    = _errMsgFrom(e);
        const srcUrl = e.resource?.attributes?.['url.full'] || e?.['resource.attributes.url.full'] || '';
        const sev    = e.attributes?.severity_number || e?.['attributes.severity_number'] || 0;
        const sevLabel = sev >= 17 ? 'ERR' : sev >= 13 ? 'WARN' : 'LOG';
        return `<div class="sidebar-item error">
            <span class="item-ts">${_fmtTimeShort(e['@timestamp'])}</span>
            <div class="item-label">
                <div class="name" title="${_esc(msg)}">${_truncate(msg, 45)}</div>
                ${srcUrl ? `<div class="detail">${_truncate(srcUrl, 40)}</div>` : ''}
            </div>
            <span class="item-status status-error">${sevLabel}</span>
        </div>`;
    }).join('');

    const waterfallHtml = _buildWaterfall(detail.traces || []);

    rightPanel.innerHTML = `
        <div class="sidebar-section">
            <div class="sidebar-section-header rp-error-header">
                ⚠ Errors
                <span class="rp-count ${errors.length ? 'rp-count-error' : ''}">${errors.length}</span>
            </div>
            ${errorItems || '<div class="sidebar-item" style="color:#484f58;font-size:.75rem">No errors in this session</div>'}
        </div>
        <div class="sidebar-section">
            <div class="sidebar-section-header">
                📡 Traces
                <span class="rp-count">${detail.traces?.length || 0}</span>
            </div>
            ${waterfallHtml}
        </div>`;

    // ── Timestamps for sync ─────────────────────────────────────────
    _pageTimestamps = (detail.pages || []).map((p, i) => ({
        ts: new Date(p['@timestamp']).getTime(), idx: i,
    })).sort((a, b) => a.ts - b.ts);
    _activePageIdx = -1;

    _traceTimestamps = (detail.traces || []).slice(0, 100).map((t, i) => {
        const startMs = new Date(t['@timestamp']).getTime();
        const durUs   = t.duration ?? t.attributes?.['transaction.duration.us'] ?? 0;
        return {ts: startMs, endTs: startMs + Math.round(durUs / 1000), idx: i};
    }).sort((a, b) => a.ts - b.ts);
    _activeTraceIdx = -1;
}

function _buildWaterfall(traces) {
    if (!traces.length) return '<div class="sidebar-item" style="color:#484f58">No traces</div>';

    const starts    = traces.map((t) => new Date(t['@timestamp']).getTime()).filter(Boolean);
    const sessionStart = Math.min(...starts);
    const ends      = traces.map((t) => {
        const s   = new Date(t['@timestamp']).getTime();
        const dur = t.duration ?? t.attributes?.['transaction.duration.us'] ?? 0;
        return s + Math.round(dur / 1000);
    });
    const sessionEnd = Math.max(...ends, sessionStart + 1);
    const totalMs   = sessionEnd - sessionStart || 1;

    const markers = [0, 25, 50, 75, 100].map((pct) =>
        `<span class="wf-marker" style="left:${pct}%">${_fmtDurationShort(Math.round(totalMs * pct / 100))}</span>`
    ).join('');

    const rows = traces.slice(0, 100).map((t, i) => {
        const startMs  = new Date(t['@timestamp']).getTime() - sessionStart;
        const durUs    = t.duration ?? t.attributes?.['transaction.duration.us'] ?? 0;
        const durMs    = Math.round(durUs / 1000);
        const leftPct  = (startMs / totalMs * 100).toFixed(2);
        const widthPct = Math.max(0.4, (durMs / totalMs * 100)).toFixed(2);
        const isErr    = (t.attributes?.['event.outcome'] || '') === 'failure';
        const service  = t.resource?.attributes?.['service.name'] || '';
        const name     = t.name || 'span';
        const code     = t.attributes?.['http.response.status_code'] ?? '';
        return `
        <div class="wf-row" id="wf-row-${i}" data-ts="${new Date(t['@timestamp']).getTime()}" data-end-ts="${new Date(t['@timestamp']).getTime() + durMs}" title="${service} · ${name} · ${durMs}ms">
            <div class="wf-label" title="${name}">${_truncate(name, 22)}</div>
            <div class="wf-chart">
                <div class="wf-bar ${isErr ? 'wf-bar-error' : 'wf-bar-ok'}" style="left:${leftPct}%;width:${widthPct}%"></div>
            </div>
            <div class="wf-meta">
                <span class="${isErr ? 'wf-badge-error' : 'wf-badge-ok'}">${code || (isErr ? '✗' : '✓')}</span>
                <span class="wf-dur">${durMs}ms</span>
            </div>
        </div>`;
    }).join('');

    return `<div class="waterfall">
        <div class="wf-scale">${markers}</div>
        ${rows}
    </div>`;
}

function initPlayer(detail) {
    const viewport = document.getElementById('player-viewport');
    if (!_replayEvents?.length) {
        viewport.innerHTML = `<div class="no-replay-msg">
            <div class="icon">🎬</div><div>No replay events found.</div>
            <div style="margin-top:.5rem;font-size:.8rem;color:#484f58">Check replay sampling rate &gt; 0.</div>
        </div>`;
        return;
    }

    // zoom shrinks both visual AND layout size (unlike transform:scale which only
    // shrinks visually, leaving the layout box at 1280px and causing overflow).
    // Subtract left(200) + right(300) panels + gaps/scrollbar(100) from window width.
    // Subtract header + controls + timeline(240) from window height.
    const maxW = Math.max(window.innerWidth  - 620, 320);
    const maxH = Math.max(window.innerHeight - 260, 240);
    const s    = Math.min(maxW / 1280, maxH / 720);

    viewport.innerHTML = `<div id="rrweb-player" style="zoom:${s.toFixed(4)}"></div>`;

    const errorTimestamps = (detail.errors || []).map((e) => new Date(e['@timestamp']).getTime());
    _replayStart = _replayEvents[0]?.timestamp ?? 0;
    const replayEnd = _replayEvents[_replayEvents.length - 1]?.timestamp ?? _replayStart;
    _replayDur = replayEnd - _replayStart || 1;

    // Build coloured page segments + error dots on the timeline
    _buildTimelineDecorations(detail, _replayStart, _replayDur);

    // Click-to-seek on timeline
    document.getElementById('player-timeline').addEventListener('click', (e) => {
        if (!_replayer) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const off  = Math.round(pct * _replayDur);
        _replayer.play(off);
        document.getElementById('btn-play-pause').textContent = '⏸ Pause';
        document.getElementById('player-status').textContent = 'Playing…';
    });

    try {
        _replayer = new rrweb.Replayer(_replayEvents, {
            root: document.getElementById('rrweb-player'),
            speed: _currentSpeed,
            skipInactive: _skipIdle,
            showWarning: false, showDebug: false,
            blockClass: 'rr-block', liveMode: false,
            width: 1280, height: 720,
        });

        _replayer.on('event-cast', (event) => {
            const ts  = event.timestamp;
            const pct = Math.min(100, ((ts - _replayStart) / _replayDur) * 100);

            // Move played overlay + cursor
            const played = document.getElementById('tl-played');
            const cursor = document.getElementById('tl-cursor');
            if (played) played.style.width = pct.toFixed(2) + '%';
            if (cursor) cursor.style.left  = pct.toFixed(2) + '%';

            // Show elapsed / total in status
            const elapsed = Math.round((ts - _replayStart) / 1000);
            const total   = Math.round(_replayDur / 1000);
            const status  = document.getElementById('player-status');
            if (status) status.textContent = `${_fmtDuration(elapsed * 1000)} / ${_fmtDuration(total * 1000)}`;

            if (errorTimestamps.some((ets) => Math.abs(ts - ets) < 2000)) _showErrorMarker(viewport);

            _syncPageHighlight(ts);
            _syncWaterfallHighlight(ts);
        });

        _replayer.on('finish', () => {
            document.getElementById('btn-play-pause').textContent = '▶ Play';
            document.getElementById('player-status').textContent = 'Finished';
        });

        document.getElementById('player-status').textContent = `${_replayEvents.length} events · ${_fmtDuration(_replayDur)}`;
    } catch (err) {
        viewport.innerHTML = `<div class="no-replay-msg"><div class="icon">⚠️</div><div>${err.message}</div></div>`;
    }
}

function _buildTimelineDecorations(detail, replayStart, replayDur) {
    const segEl  = document.getElementById('tl-segments');
    const errEl  = document.getElementById('tl-errors');
    if (!segEl || !errEl) return;

    // ── Page segments ────────────────────────────────────────────────
    // _pageTimestamps is [{ts, idx}] sorted asc; build [{startPct, widthPct, url}]
    const pages = (_pageTimestamps.length ? _pageTimestamps : []).map((p, i) => {
        const nextTs   = _pageTimestamps[i + 1]?.ts ?? (replayStart + replayDur);
        const startPct = Math.max(0, ((p.ts - replayStart) / replayDur) * 100);
        const endPct   = Math.min(100, ((nextTs - replayStart) / replayDur) * 100);
        // Use the shared helper that handles all ES nested-object shapes
        const url      = _pageUrlFrom(detail.pages?.[p.idx]);
        return {startPct, widthPct: Math.max(0.5, endPct - startPct), url};
    });

    // Fallback: single full-width segment when no page navigation data exists
    if (!pages.length) {
        segEl.innerHTML = `<div class="tl-seg" style="width:100%;background:${_pageColor('/')};opacity:.7"></div>`;
    } else {
        segEl.innerHTML = pages.map(({startPct, widthPct, url}) => {
            const color = _pageColor(url);
            const label = (() => { try { return new URL(url, 'http://x').pathname || '/'; } catch (_) { return url; } })();
            return `<div class="tl-seg" style="left:${startPct.toFixed(2)}%;width:${widthPct.toFixed(2)}%;background:${color}"
                         title="${label}"></div>`;
        }).join('');
    }

    // ── Error dots ───────────────────────────────────────────────────
    const errorTs = (detail.errors || []).map((e) => new Date(e['@timestamp']).getTime());
    errEl.innerHTML = errorTs.map((ts) => {
        const pct = Math.min(99.5, Math.max(0.5, ((ts - replayStart) / replayDur) * 100));
        return `<div class="tl-error-dot" style="left:${pct.toFixed(2)}%" title="Error at ${new Date(ts).toLocaleTimeString()}"></div>`;
    }).join('');
}

function _syncPageHighlight(ts) {
    if (!_pageTimestamps.length) return;
    let activeIdx = -1;
    for (const {ts: pts, idx} of _pageTimestamps) {
        if (pts <= ts) activeIdx = idx; else break;
    }
    if (activeIdx === _activePageIdx) return;
    _activePageIdx = activeIdx;
    document.querySelectorAll('.sidebar-item.page').forEach((el) => el.classList.remove('page-active'));
    if (activeIdx >= 0) {
        const el = document.getElementById(`page-nav-${activeIdx}`);
        if (el) { el.classList.add('page-active'); el.scrollIntoView({block: 'nearest', behavior: 'smooth'}); }
    }
}

function _syncWaterfallHighlight(ts) {
    if (!_traceTimestamps.length) return;

    // Find the trace whose start time is closest to the current replay timestamp.
    // Traces are millisecond-duration past events, so "overlap" matching never
    // works; closest-start within a 20-second window is the right heuristic.
    let activeIdx = -1;
    let bestDiff = 20000; // 20-second window
    for (const {ts: start, idx} of _traceTimestamps) {
        const diff = Math.abs(ts - start);
        if (diff < bestDiff) {
            bestDiff = diff;
            activeIdx = idx;
        }
    }

    if (activeIdx === _activeTraceIdx) return;
    _activeTraceIdx = activeIdx;

    document.querySelectorAll('.wf-row').forEach((el) => el.classList.remove('wf-active'));
    if (activeIdx >= 0) {
        const el = document.getElementById(`wf-row-${activeIdx}`);
        if (el) {
            el.classList.add('wf-active');
            el.scrollIntoView({block: 'nearest', behavior: 'smooth'});
        }
    }
}

window.togglePlay = function () {
    if (!_replayer) return;
    const btn = document.getElementById('btn-play-pause');
    if (btn.textContent.includes('▶')) {
        _replayer.play(); btn.textContent = '⏸ Pause';
        document.getElementById('player-status').textContent = 'Playing…';
    } else {
        _replayer.pause(); btn.textContent = '▶ Play';
        document.getElementById('player-status').textContent = 'Paused';
    }
};

window.restartReplay = function () {
    if (!_replayer) return;
    _replayer.pause(); _replayer.play(0);
    document.getElementById('btn-play-pause').textContent = '⏸ Pause';
    document.getElementById('player-status').textContent = 'Playing…';
    _activePageIdx = -1; _activeTraceIdx = -1;
    const played = document.getElementById('tl-played');
    const cursor = document.getElementById('tl-cursor');
    if (played) played.style.width = '0%';
    if (cursor) cursor.style.left  = '0%';
};

window.setSpeed = function (n) {
    _currentSpeed = n;
    if (_replayer) {
        try { _replayer.setConfig({speed: n}); } catch (_) {
            // rrweb alpha fallback — recreate with new speed
            const wasPlaying = !document.getElementById('btn-play-pause').textContent.includes('▶');
            const offset = Math.round(((parseFloat(document.getElementById('tl-cursor')?.style.left) || 0) / 100) * _replayDur);
            _replayer.pause();
            _replayer.setConfig({speed: n});
            if (wasPlaying) _replayer.play(offset);
        }
    }
    document.querySelectorAll('.speed-btn').forEach((b) => {
        b.classList.toggle('active', parseFloat(b.dataset.speed) === n);
    });
};

window.toggleSkipIdle = function () {
    _skipIdle = !_skipIdle;
    if (_replayer) {
        try { _replayer.setConfig({skipInactive: _skipIdle}); } catch (_) {}
    }
    const btn = document.getElementById('btn-skip-idle');
    if (btn) btn.classList.toggle('active', _skipIdle);
};

// Scale the rrweb player to fill the viewport without overflow.
// #rrweb-player is position:absolute 1280×720, transform-origin:top left.
// We compute scale so it fits, then translate to center it in the viewport.
function _fitPlayer(vp) {
    if (!vp) vp = document.getElementById('player-viewport');
    const player = document.getElementById('rrweb-player');
    if (!vp || !player) return;
    const availW = vp.clientWidth;
    if (!availW) return;
    // Scale to fill the width, anchor at top-left — no empty space
    const s = Math.min(availW / 1280, 1);
    player.style.transform = `scale(${s.toFixed(4)})`;
}

let _errorMarkerTimer;
function _showErrorMarker(viewport) {
    let m = viewport.querySelector('.error-marker');
    if (!m) {
        m = document.createElement('div');
        m.className = 'error-marker'; m.textContent = '⚠ Error occurred';
        viewport.style.position = 'relative'; viewport.appendChild(m);
    }
    m.style.display = 'block';
    clearTimeout(_errorMarkerTimer);
    _errorMarkerTimer = setTimeout(() => { if (m) m.style.display = 'none'; }, 3000);
}

// ── Page 3: Analytics ─────────────────────────────────────────────────────────
async function renderAnalyticsPage() {
    document.getElementById('app').innerHTML = `
        ${_header('analytics')}
        <div class="analytics-page">
            <div class="analytics-toolbar">
                <h2>📊 Analytics</h2>
                <select id="analytics-range">
                    <option value="now-1h">Last 1 hour</option>
                    <option value="now-6h">Last 6 hours</option>
                    <option value="now-24h" selected>Last 24 hours</option>
                    <option value="now-7d">Last 7 days</option>
                </select>
                <button class="btn btn-primary" onclick="loadAnalytics()">Refresh</button>
            </div>
            <div id="analytics-container"><div class="loading">Loading analytics…</div></div>
        </div>`;
    document.getElementById('analytics-range').addEventListener('change', loadAnalytics);
    loadAnalytics();
}

async function loadAnalytics() {
    const from = document.getElementById('analytics-range')?.value || 'now-24h';
    document.getElementById('analytics-container').innerHTML = '<div class="loading">⏳ Loading…</div>';
    try {
        const res  = await fetch(`/api/analytics?from=${encodeURIComponent(from)}&service=${encodeURIComponent(_selectedService)}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        renderAnalytics(data);
    } catch (err) {
        document.getElementById('analytics-container').innerHTML =
            `<div class="loading" style="color:#f85149">Failed: ${err.message}</div>`;
    }
}

function renderAnalytics(data) {
    const rrwebTypes = {0:'DomContentLoaded',1:'Load',2:'FullSnapshot',3:'IncrementalSnapshot',4:'Meta',99:'Marker'};
    const wv = data.webVitals || {};
    const cm = data.customMetrics || {};
    const pv = data.pageViews || {};

    // ── KPI row ──────────────────────────────────────────────────────
    const kpiCards = `
    <div class="kpi-grid">
        ${kpi('📡', 'Total Traces',    data.traces.total.toLocaleString(),          '')}
        ${kpi('🎬', 'Replay Sessions', data.replay.sessions.toLocaleString(),        '')}
        ${kpi('🚨', 'Errors',          data.traces.errors.total.toLocaleString(),    'kpi-error')}
        ${kpi('📋', 'Log Records',     data.logs.total.toLocaleString(),             '')}
        ${kpi('👥', 'Unique Sessions', data.traces.sessions.toLocaleString(),        '')}
        ${kpi('🛒', 'Orders Placed',   cm.ordersPlaced != null ? cm.ordersPlaced.toLocaleString() : '—', '')}
    </div>`;

    // ── Web Vitals section ───────────────────────────────────────────
    // Thresholds from https://web.dev/vitals/ (good / needs-improvement / poor)
    const vitalThresholds = {
        lcp:  {good: 2500,  poor: 4000,  unit: 'ms',  label: 'LCP',  name: 'Largest Contentful Paint',   tip: '< 2.5 s good'},
        fcp:  {good: 1800,  poor: 3000,  unit: 'ms',  label: 'FCP',  name: 'First Contentful Paint',      tip: '< 1.8 s good'},
        cls:  {good: 0.1,   poor: 0.25,  unit: '',    label: 'CLS',  name: 'Cumulative Layout Shift',     tip: '< 0.1 good'},
        inp:  {good: 200,   poor: 500,   unit: 'ms',  label: 'INP',  name: 'Interaction to Next Paint',   tip: '< 200 ms good'},
        ttfb: {good: 800,   poor: 1800,  unit: 'ms',  label: 'TTFB', name: 'Time to First Byte',          tip: '< 800 ms good'},
    };

    function vitalStatus(key, val) {
        if (val == null) return 'vital-no-data';
        const t = vitalThresholds[key];
        if (!t) return '';
        return val <= t.good ? 'vital-good' : val <= t.poor ? 'vital-needs-improvement' : 'vital-poor';
    }

    function vitalCard(key) {
        const t  = vitalThresholds[key];
        const v  = wv[key];
        const p50 = v?.p50;
        const p75 = v?.p75;
        const p95 = v?.p95;
        const status = vitalStatus(key, p75 ?? p50);
        const fmt = (n) => n != null ? (t.unit ? `${n}${t.unit}` : String(n)) : '—';
        const noData = !v || v.count === 0;
        return `<div class="vital-card ${status}">
            <div class="vital-header">
                <span class="vital-label">${t.label}</span>
                <span class="vital-status-dot"></span>
            </div>
            <div class="vital-name">${t.name}</div>
            ${noData
                ? `<div class="vital-no-data-msg">No data yet</div>`
                : `<div class="vital-p50">${fmt(p50)}<span class="vital-pctile">p50</span></div>
                   <div class="vital-sub-row">
                       <span>p75 <b>${fmt(p75)}</b></span>
                       <span>p95 <b>${fmt(p95)}</b></span>
                       <span class="vital-count">${v.count} samples</span>
                   </div>`}
            <div class="vital-tip">${t.tip}</div>
        </div>`;
    }

    const webVitalsSection = `
    <div class="analytics-section-header">🌐 Core Web Vitals</div>
    <div class="vitals-grid">
        ${['lcp','fcp','cls','inp','ttfb'].map(vitalCard).join('')}
    </div>`;

    // ── Custom metrics row ───────────────────────────────────────────
    const customMetricsSection = `
    <div class="analytics-section-header">📈 Custom Metrics</div>
    <div class="kpi-grid kpi-grid-sm">
        ${kpi('🛒', 'Orders Placed',       cm.ordersPlaced     != null ? cm.ordersPlaced.toLocaleString() : '—', '')}
        ${kpi('🖱️', 'Demo Clicks',         cm.demoClicks       != null ? cm.demoClicks.toLocaleString()   : '—', '')}
        ${kpi('⏱️', 'Resp Time avg (ms)',  cm.demoRespTimeAvg  != null ? cm.demoRespTimeAvg              : '—', '')}
        ${kpi('⚡', 'Resp Time p95 (ms)',  cm.demoRespTimeP95  != null ? cm.demoRespTimeP95              : '—', '')}
    </div>`;

    // ── Page views by route ──────────────────────────────────────────
    const maxPv = Math.max(...(pv.byPage || []).map((p) => p.count), 1);
    const pageViewsChart = `
    <div class="chart-card">
        <div class="chart-title">Page Views by Route <span class="chart-sub">(${(pv.total || 0).toLocaleString()} total)</span></div>
        <div class="bar-chart">
            ${(pv.byPage || []).map((p) => `
            <div class="bar-row">
                <div class="bar-label" title="${p.page}">${p.page || '/'}</div>
                <div class="bar-track">
                    <div class="bar-fill bar-fill-teal" style="width:${(p.count/maxPv*100).toFixed(1)}%"></div>
                </div>
                <div class="bar-val">${p.count.toLocaleString()}</div>
            </div>`).join('') || '<div style="color:#484f58;padding:.5rem">No page view data</div>'}
        </div>
    </div>`;

    // ── Traces by service ────────────────────────────────────────────
    const maxSvc = Math.max(...data.traces.byService.map((s) => s.count), 1);
    const serviceChart = `
    <div class="chart-card">
        <div class="chart-title">Traces by Service</div>
        <div class="bar-chart">
            ${data.traces.byService.map((s) => `
            <div class="bar-row">
                <div class="bar-label" title="${s.name}">${_truncate(s.name, 24)}</div>
                <div class="bar-track">
                    <div class="bar-fill bar-fill-blue" style="width:${(s.count/maxSvc*100).toFixed(1)}%"></div>
                </div>
                <div class="bar-val">${s.count.toLocaleString()}</div>
            </div>`).join('') || '<div style="color:#484f58;padding:.5rem">No data</div>'}
        </div>
    </div>`;

    // ── Replay event types ───────────────────────────────────────────
    const maxReplay = Math.max(...data.replay.byType.map((t) => t.count), 1);
    const replayChart = `
    <div class="chart-card">
        <div class="chart-title">Replay Events by Type</div>
        <div class="bar-chart">
            ${data.replay.byType.map((t) => `
            <div class="bar-row">
                <div class="bar-label">${rrwebTypes[t.type] || 'type ' + t.type}</div>
                <div class="bar-track">
                    <div class="bar-fill bar-fill-purple" style="width:${(t.count/maxReplay*100).toFixed(1)}%"></div>
                </div>
                <div class="bar-val">${t.count.toLocaleString()}</div>
            </div>`).join('') || '<div style="color:#484f58;padding:.5rem">No replay data</div>'}
        </div>
    </div>`;

    // ── Trace volume sparkline ───────────────────────────────────────
    const timelineChart = `
    <div class="chart-card chart-card-wide">
        <div class="chart-title">Trace Volume & Errors Over Time</div>
        ${_sparkline(data.traces.byHour, data.traces.errors.byHour)}
    </div>`;

    // ── Log severity ─────────────────────────────────────────────────
    const sevNames  = {5:'DEBUG',9:'INFO',13:'WARN',17:'ERROR',21:'FATAL'};
    const sevColors = {5:'#58a6ff',9:'#3fb950',13:'#d29922',17:'#f85149',21:'#bc8cff'};
    const maxLog = Math.max(...data.logs.bySeverity.map((s) => s.count), 1);
    const logChart = `
    <div class="chart-card">
        <div class="chart-title">Log Records by Severity</div>
        <div class="bar-chart">
            ${data.logs.bySeverity.map((s) => `
            <div class="bar-row">
                <div class="bar-label">${sevNames[s.severity] || 'SEV ' + s.severity}</div>
                <div class="bar-track">
                    <div class="bar-fill" style="width:${(s.count/maxLog*100).toFixed(1)}%;background:${sevColors[s.severity]||'#58a6ff'}"></div>
                </div>
                <div class="bar-val">${s.count.toLocaleString()}</div>
            </div>`).join('') || '<div style="color:#484f58;padding:.5rem">No log data</div>'}
        </div>
    </div>`;

    document.getElementById('analytics-container').innerHTML = `
        ${kpiCards}
        ${webVitalsSection}
        ${customMetricsSection}
        <div class="analytics-section-header">📊 Signal Breakdown</div>
        <div class="charts-grid">
            ${timelineChart}
            ${pageViewsChart}
            ${serviceChart}
            ${replayChart}
            ${logChart}
        </div>
        <div class="analytics-section-header">🗺️ User Journey Flow</div>
        <div id="journey-section"><div class="loading">Loading journey…</div></div>
        <div class="analytics-section-header">🔽 Conversion Funnel</div>
        <div id="funnel-section"><div class="loading">Loading funnel…</div></div>`;

    const _from = document.getElementById('analytics-range')?.value || 'now-24h';
    _loadJourney(_from, _selectedService);
    _loadFunnel(_from, _selectedService);
}

// ── User Journey (Sankey) ─────────────────────────────────────────────────────
async function _loadJourney(from, service) {
    try {
        let url = `/api/analytics/journey?from=${encodeURIComponent(from)}`;
        if (service) url += `&service=${encodeURIComponent(service)}`;
        const res = await fetch(url);
        const d = await res.json();
        if (d.error) throw new Error(d.error);
        _renderJourney(d);
    } catch (err) {
        const el = document.getElementById('journey-section');
        if (el) el.innerHTML = `<div style="color:#f85149;padding:1rem">Failed: ${err.message}</div>`;
    }
}

function _renderJourney(d) {
    const el = document.getElementById('journey-section');
    if (!el) return;
    if (!d.nodes || d.nodes.length === 0) {
        el.innerHTML = '<div style="color:#484f58;padding:1rem">No navigation data — browse the app to generate sessions.</div>';
        return;
    }

    // Inject subtitle + container
    el.innerHTML = `<div style="color:#8b949e;font-size:13px;margin-bottom:.75rem">
        ${d.totalNavigations.toLocaleString()} navigations across ${d.nodes.length} unique pages
    </div><div id="journey-rf-wrap"></div>`;

    // Fallback if ReactFlow CDN didn't load
    const _RF = window.ReactFlow || {};
    const RF = _RF.ReactFlow;
    if (!RF) {
        el.innerHTML += _journeyTableFallback(d);
        return;
    }
    const {Background, Controls, applyNodeChanges} = _RF;

    const allIds = new Set(d.nodes.map(n => n.id));
    const allLinks = (d.links || []).filter(l => l.from !== l.to && allIds.has(l.from) && allIds.has(l.to));

    // BFS depth from single root (most common session-start page)
    const serverEntries = (d.entryPages || []).filter(id => allIds.has(id));
    const incomingCount = new Map([...allIds].map(id => [id, 0]));
    allLinks.forEach(l => incomingCount.set(l.to, (incomingCount.get(l.to) || 0) + 1));
    const root = serverEntries[0]
        || [...allIds].sort((a, b) => (incomingCount.get(a) || 0) - (incomingCount.get(b) || 0))[0];

    const depthOf = new Map([[root, 0]]);
    const bfsQ = [root];
    while (bfsQ.length) {
        const cur = bfsQ.shift();
        const cd = depthOf.get(cur);
        allLinks.filter(l => l.from === cur && !depthOf.has(l.to))
            .forEach(l => { depthOf.set(l.to, cd + 1); bfsQ.push(l.to); });
    }
    const maxDepth = Math.max(0, ...[...depthOf.values()]);
    [...allIds].forEach(id => { if (!depthOf.has(id)) depthOf.set(id, maxDepth + 1); });

    // Group nodes by depth column; sort each column by visits desc
    const columns = new Map();
    d.nodes.forEach(n => {
        const dep = depthOf.get(n.id) ?? 0;
        if (!columns.has(dep)) columns.set(dep, []);
        columns.get(dep).push(n);
    });
    columns.forEach(col => col.sort((a, b) => b.visits - a.visits));

    // Compute outgoing counts for drop-off %
    const outgoing = new Map();
    allLinks.forEach(l => outgoing.set(l.from, (outgoing.get(l.from) || 0) + l.count));

    // Build ReactFlow nodes — sanitize IDs
    const nid = path => 'n_' + path.replace(/[^a-zA-Z0-9]/g, '_');

    const ENTRY_ID = '__entry__';
    const COL_W = 250;
    const ROW_H = 120;

    const rfNodes = [];

    // "Entry Points" anchor node
    const entryColNodes = columns.get(0) || [];
    const entryMidY = entryColNodes.length > 0
        ? ((entryColNodes.length - 1) * ROW_H) / 2
        : 0;
    rfNodes.push({
        id: ENTRY_ID,
        position: {x: 0, y: entryMidY},
        sourcePosition: 'right',
        targetPosition: 'left',
        data: {label: 'Entry Points'},
        style: {
            background: '#1c2128', border: '1px solid #444c56',
            borderRadius: '6px', padding: '10px 18px',
            color: '#8b949e', fontSize: '13px', fontWeight: 600,
            minWidth: '120px', textAlign: 'center',
        },
    });

    // Page nodes — sourcePosition/targetPosition force horizontal bezier edges
    columns.forEach((col, dep) => {
        col.forEach((n, i) => {
            const outCount = outgoing.get(n.id) || 0;
            const dropOff = n.visits > 0
                ? Math.min(100, Math.round((1 - outCount / n.visits) * 100))
                : 100;
            const shortPath = n.id.length > 20 ? '…' + n.id.slice(-18) : n.id;
            const colour = _pageColor('http://x' + n.id);

            rfNodes.push({
                id: nid(n.id),
                position: {x: (dep + 1) * COL_W, y: i * ROW_H},
                sourcePosition: 'right',
                targetPosition: 'left',
                data: {label: React.createElement('div', {
                    title: `Exit rate: ${dropOff}% of visits did not navigate forward`,
                    style: {textAlign: 'center', lineHeight: 1.4},
                },
                    React.createElement('div', {
                        style: {fontSize: '11px', color: '#8b949e', marginBottom: '4px',
                            borderBottom: `2px solid ${colour}`, paddingBottom: '4px'},
                    }, shortPath),
                    React.createElement('div', {style: {fontSize: '18px', fontWeight: 700, color: '#c9d1d9'}},
                        n.visits.toLocaleString())
                )},
                style: {
                    background: '#161b22', border: `1px solid #30363d`,
                    borderRadius: '6px', padding: '8px 12px',
                    minWidth: '140px', textAlign: 'center',
                    boxShadow: `0 0 0 1px ${colour}22`,
                },
            });
        });
    });

    // Forward-only edges (depthOf(to) > depthOf(from)) — eliminates back-nav mess.
    // Positions are explicit so forward-filter won't collapse layout.
    const fwdLinks = allLinks.filter(l =>
        (depthOf.get(l.to) ?? 0) > (depthOf.get(l.from) ?? 0)
    );

    const rfEdges = [];

    // Entry → depth-0 page nodes
    (columns.get(0) || []).forEach(n => {
        rfEdges.push({
            id: `e_entry_${nid(n.id)}`,
            source: ENTRY_ID, target: nid(n.id),
            type: 'default',
            style: {stroke: '#444c56', strokeWidth: 2},
            animated: false,
            markerEnd: {type: 'arrowclosed', color: '#444c56'},
        });
    });

    // Forward page-to-page transitions only
    fwdLinks.forEach(l => {
        const colour = _pageColor('http://x' + l.from);
        rfEdges.push({
            id: `e_${nid(l.from)}_${nid(l.to)}`,
            source: nid(l.from), target: nid(l.to),
            type: 'default',
            label: String(l.count),
            style: {stroke: colour, strokeWidth: 2},
            animated: false,
            markerEnd: {type: 'arrowclosed', color: colour},
        });
    });

    // JourneyApp component (no JSX)
    function JourneyApp({initialNodes, edges}) {
        const [nodes, setNodes] = React.useState(initialNodes);
        const onChange = React.useCallback(
            changes => setNodes(nds => applyNodeChanges(changes, nds)),
            []
        );
        return React.createElement(RF, {
            nodes, edges,
            onNodesChange: onChange,
            fitView: true,
            fitViewOptions: {padding: 0.15},
            nodesDraggable: true,
            nodesConnectable: false,
            elementsSelectable: true,
            proOptions: {hideAttribution: true},
        },
            React.createElement(Background, {color: '#21262d', gap: 20, variant: 'dots'}),
            React.createElement(Controls, {showInteractive: false})
        );
    }

    if (_journeyRoot) { _journeyRoot.unmount(); _journeyRoot = null; }
    const wrap = document.getElementById('journey-rf-wrap');
    _journeyRoot = ReactDOM.createRoot(wrap);
    _journeyRoot.render(React.createElement(JourneyApp, {initialNodes: rfNodes, edges: rfEdges}));
}

function _journeyTableFallback(d) {
    const maxV = Math.max(...d.nodes.map(n => n.visits), 1);
    return `<div class="chart-card"><div class="chart-title">Page Visits</div><div class="bar-chart">
    ${d.nodes.slice(0, 10).map(n => `<div class="bar-row">
        <div class="bar-label">${_truncate(n.id, 28)}</div>
        <div class="bar-track"><div class="bar-fill bar-fill-teal" style="width:${(n.visits/maxV*100).toFixed(1)}%"></div></div>
        <div class="bar-val">${n.visits}</div>
    </div>`).join('')}
    </div></div>`;
}

// ── Conversion Funnel ─────────────────────────────────────────────────────────
async function _loadFunnel(from, service) {
    try {
        let url = `/api/analytics/funnel?from=${encodeURIComponent(from)}`;
        if (service) url += `&service=${encodeURIComponent(service)}`;
        const res = await fetch(url);
        const d = await res.json();
        if (d.error) throw new Error(d.error);
        _renderFunnel(d);
    } catch (err) {
        const el = document.getElementById('funnel-section');
        if (el) el.innerHTML = `<div style="color:#f85149;padding:1rem">Failed: ${err.message}</div>`;
    }
}

function _renderFunnel(d) {
    const el = document.getElementById('funnel-section');
    if (!el) return;
    const funnel = d.funnel || [];
    if (!funnel.length || d.totalEntries === 0) {
        el.innerHTML = '<div style="color:#484f58;padding:1rem">No funnel data yet.</div>';
        return;
    }
    const W = 800, maxW = W - 140;
    const stepColors = ['#00bcd4','#29b6f6','#7c4dff','#f06292','#ff7043'];
    const top = funnel[0].sessions || 1;
    const lastStep = funnel[funnel.length - 1];
    const overallConv = Math.round((lastStep.sessions / top) * 100);

    const bars = funnel.map((s, i) => {
        const bw = Math.max(4, Math.round((s.pctOfTop / 100) * maxW));
        const y = i * 92;
        const color = stepColors[i % stepColors.length];
        const isLast = i === funnel.length - 1;
        const dropLabel = !isLast && s.dropOff > 0
            ? `<text x="${Math.max(bw + 8, 60)}" y="74" font-size="11" fill="#f85149">↓ ${s.dropOff.toLocaleString()} dropped (${100 - (funnel[i+1]?.pctOfPrev||0)}%)</text>`
            : '';
        return `<g transform="translate(0,${y})">
            <rect x="0" y="0" width="${bw}" height="60" fill="${color}" rx="4" opacity=".88"/>
            <text x="10" y="26" fill="rgba(255,255,255,.95)" font-size="13" font-weight="600">${_esc(s.step)}</text>
            <text x="10" y="44" fill="rgba(255,255,255,.7)" font-size="11">${s.sessions.toLocaleString()} sessions</text>
            <text x="${bw + 8}" y="35" fill="${color}" font-size="14" font-weight="700" dominant-baseline="middle">${s.pctOfTop}%</text>
            ${dropLabel}
        </g>`;
    }).join('');

    el.innerHTML = `
    <div class="kpi-grid kpi-grid-sm" style="margin-bottom:1.25rem">
        ${kpi('🚪','Funnel Entries',top.toLocaleString(),'')}
        ${kpi('✅','Completed',lastStep.sessions.toLocaleString(),'')}
        ${kpi('📈','Overall Conversion',overallConv+'%',overallConv>=20?'':'kpi-error')}
        ${kpi('↩️','Total Drop-off',(top-lastStep.sessions).toLocaleString(),'')}
    </div>
    <div style="overflow-x:auto">
        <svg width="${W}" height="${funnel.length*92}" viewBox="0 0 ${W} ${funnel.length*92}" style="display:block;min-width:400px;max-width:100%">
            ${bars}
        </svg>
    </div>`;
}

function kpi(icon, label, value, cls) {
    return `<div class="kpi-card ${cls}">
        <div class="kpi-icon">${icon}</div>
        <div class="kpi-value">${value}</div>
        <div class="kpi-label">${label}</div>
    </div>`;
}

function _sparkline(tracesByHour, errorsByHour) {
    if (!tracesByHour.length) return '<div style="color:#484f58;padding:.5rem">No timeline data</div>';

    const errMap = new Map(errorsByHour.map((b) => [b.ts, b.count]));
    const maxCount = Math.max(...tracesByHour.map((b) => b.count), 1);
    const W = 600, H = 80, pad = 4;
    const step = (W - pad * 2) / Math.max(tracesByHour.length - 1, 1);

    const tracePoints = tracesByHour.map((b, i) => {
        const x = pad + i * step;
        const y = H - pad - ((b.count / maxCount) * (H - pad * 2));
        return `${x},${y}`;
    }).join(' ');

    const errBars = tracesByHour.map((b, i) => {
        const x   = pad + i * step;
        const ec  = errMap.get(b.ts) || 0;
        const h   = ec > 0 ? Math.max(4, (ec / maxCount) * (H - pad * 2)) : 0;
        const y   = H - pad - h;
        return ec > 0 ? `<rect x="${(x-2).toFixed(1)}" y="${y.toFixed(1)}" width="4" height="${h.toFixed(1)}" fill="#f85149" opacity=".7"/>` : '';
    }).join('');

    const labels = tracesByHour.filter((_, i) => i % Math.ceil(tracesByHour.length / 6) === 0)
        .map((b, i) => {
            const idx = tracesByHour.indexOf(b);
            const x   = pad + idx * step;
            const label = new Date(b.ts).toLocaleTimeString('en-GB', {hour: '2-digit', minute: '2-digit'});
            return `<text x="${x}" y="${H + 12}" text-anchor="middle" font-size="8" fill="#484f58">${label}</text>`;
        }).join('');

    return `<svg viewBox="0 0 ${W} ${H + 16}" style="width:100%;max-height:100px">
        <polyline points="${tracePoints}" fill="none" stroke="#58a6ff" stroke-width="1.5"/>
        ${errBars}
        ${labels}
        <text x="${W - pad}" y="12" text-anchor="end" font-size="8" fill="#58a6ff">● traces</text>
        <text x="${W - pad}" y="22" text-anchor="end" font-size="8" fill="#f85149">■ errors</text>
    </svg>`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function _fmtTime(d) {
    return d.toLocaleString('en-GB', {month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
}
function _fmtTimeShort(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit',second:'2-digit'});
}
function _fmtDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms/1000).toFixed(1)}s`;
    return `${Math.floor(ms/60000)}m ${Math.floor((ms%60000)/1000)}s`;
}
function _fmtDurationShort(ms) {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms/1000).toFixed(1)}s`;
}
function _truncate(str, len) {
    return str && str.length > len ? str.slice(0, len) + '…' : (str || '');
}
function _esc(str) {
    return (str || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
