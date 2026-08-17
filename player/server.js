// Session Replay Player — API server (local Elasticsearch, no auth)
import express from 'express';
import {Client} from '@elastic/elasticsearch';
import {fileURLToPath} from 'url';
import {dirname, join} from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3003;

const SESSION_FIELD  = 'resource.attributes.rum.sessionId';
const SERVICE_FIELD  = 'resource.attributes.service.name';
const SERVICE_FILTER = 'elasticshop-frontend';

const TRACES_INDEX = 'traces-generic.otel-default';
const LOGS_INDEX   = 'logs-generic.otel-default';
const REPLAY_INDEX = 'logs-rum.replay-default';

const ES_URL = process.env.ES_URL || 'http://elasticsearch:9200';

const esClient = new Client({ node: ES_URL });

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// ── API: list sessions ──────────────────────────────────────────────────────
app.get('/api/sessions', async (req, res) => {
    try {
        const {from = 'now-24h', size = 25, service} = req.query;
        const svcFilter = service || SERVICE_FILTER;

        const result = await esClient.search({
            index: `${TRACES_INDEX},${LOGS_INDEX}`,
            ignore_unavailable: true,
            body: {
                size: 0,
                query: {
                    bool: {
                        must: [
                            {term: {[SERVICE_FIELD]: svcFilter}},
                            {exists: {field: SESSION_FIELD}},
                            {range: {'@timestamp': {gte: from}}},
                        ],
                    },
                },
                aggs: {
                    sessions: {
                        terms: {field: SESSION_FIELD, size: Math.min(Number(size), 25), order: {'start_time': 'desc'}},
                        aggs: {
                            start_time: {min: {field: '@timestamp'}},
                            end_time:   {max: {field: '@timestamp'}},
                            user_id:    {terms: {field: 'attributes.user.id',    size: 1}},
                            user_email: {terms: {field: 'attributes.user.email', size: 1}},
                            user_name:  {terms: {field: 'attributes.user.name',  size: 1}},
                            pages: {
                                terms: {
                                    field: 'resource.attributes.url.full',
                                    size: 30,
                                },
                            },
                            error_count: {
                                filter: {
                                    bool: {
                                        should: [
                                            {term:  {'attributes.event.outcome': 'failure'}},
                                            {term:  {'attributes.log.level': 'ERROR'}},
                                            {range: {'attributes.event.severity': {gte: 17}}},
                                        ],
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });

        const buckets = result.aggregations?.sessions?.buckets ?? [];

        const sessionIds = buckets.map((b) => b.key);
        let replaySet = new Set();
        if (sessionIds.length > 0) {
            try {
                const replayCheck = await esClient.search({
                    index: REPLAY_INDEX,
                    ignore_unavailable: true,
                    body: {
                        size: 0,
                        query: {
                            bool: {
                                should: sessionIds.map((id) => ({
                                    bool: {
                                        should: [
                                            {term: {'attributes.rum.sessionId': id}},
                                            {term: {'attributes.session.id': id}},
                                        ],
                                    },
                                })),
                                minimum_should_match: 1,
                            },
                        },
                        aggs: {
                            by_session: {
                                terms: {
                                    script: {
                                        source: "def v = doc['attributes.rum.sessionId']; if (v != null && v.size() > 0) return v.value; def v2 = doc['attributes.session.id']; if (v2 != null && v2.size() > 0) return v2.value; return ''",
                                    },
                                    size: 200,
                                },
                            },
                        },
                    },
                });
                (replayCheck.aggregations?.by_session?.buckets ?? []).forEach((b) => {
                    if (b.key) replaySet.add(b.key);
                });
            } catch (_) {/* replay index may not exist yet */}
        }

        const sessions = buckets.map((b) => ({
            sessionId:  b.key,
            startTime:  b.start_time.value_as_string || new Date(b.start_time.value).toISOString(),
            endTime:    b.end_time.value_as_string   || new Date(b.end_time.value).toISOString(),
            userId:     b.user_id.buckets[0]?.key    || null,
            userEmail:  b.user_email.buckets[0]?.key || null,
            userName:   b.user_name.buckets[0]?.key  || null,
            pages:      b.pages.buckets.map((p) => p.key),
            errorCount: b.error_count.doc_count,
            hasReplay:  replaySet.has(b.key),
            eventCount: b.doc_count,
        })).sort((a, b) => new Date(b.startTime) - new Date(a.startTime));

        res.json({sessions, total: sessions.length});
    } catch (err) {
        console.error('GET /api/sessions error:', err.message);
        res.status(500).json({error: err.message});
    }
});

// ── API: session detail ──────────────────────────────────────────────────────
app.get('/api/sessions/:sessionId', async (req, res) => {
    const {sessionId} = req.params;
    try {
        const sessionFilter = {term: {[SESSION_FIELD]: sessionId}};

        const [tracesRes, errorsRes, pagesRes, backendRes] = await Promise.all([
            esClient.search({
                index: TRACES_INDEX,
                ignore_unavailable: true,
                body: {
                    size: 500,
                    query: {bool: {must: [sessionFilter, {term: {[SERVICE_FIELD]: SERVICE_FILTER}}]}},
                    sort: [{'@timestamp': 'asc'}],
                    _source: ['@timestamp', 'name', 'kind', 'duration',
                              'attributes.event.outcome', 'attributes.transaction.duration.us',
                              'resource.attributes.url.full', 'attributes.http.response.status_code',
                              'trace.id', 'span.id', 'parent.span.id'],
                },
            }),
            esClient.search({
                index: `${TRACES_INDEX},${LOGS_INDEX}`,
                ignore_unavailable: true,
                body: {
                    size: 200,
                    query: {
                        bool: {
                            must: [sessionFilter],
                            should: [
                                {term:  {'scope.name': 'elastic.rum.console'}},
                                {term:  {'attributes.event.outcome': 'failure'}},
                                {term:  {'attributes.log.level': 'ERROR'}},
                                {range: {'attributes.severity_number': {gte: 17}}},
                                {range: {'attributes.event.severity':  {gte: 17}}},
                            ],
                            minimum_should_match: 1,
                        },
                    },
                    sort: [{'@timestamp': 'asc'}],
                    _source: ['@timestamp', 'body', 'name', 'scope.name',
                              'attributes.severity_number', 'attributes.event.outcome',
                              'attributes.exception.message', 'attributes.error.message',
                              'resource.attributes.url.full', 'attributes.http.url'],
                },
            }),
            esClient.search({
                index: TRACES_INDEX,
                ignore_unavailable: true,
                body: {
                    size: 200,
                    query: {
                        bool: {
                            must: [
                                sessionFilter,
                                {term: {'name': 'navigation.route_change'}},
                            ],
                        },
                    },
                    sort: [{'@timestamp': 'asc'}],
                    _source: ['@timestamp', 'resource.attributes.url.full',
                              'attributes.page.url.path', 'attributes.navigation.type',
                              'attributes.navigation.previous_url'],
                },
            }),
            esClient.search({
                index: TRACES_INDEX,
                ignore_unavailable: true,
                body: {
                    size: 200,
                    query: {
                        bool: {
                            must: [sessionFilter],
                            must_not: [{term: {[SERVICE_FIELD]: SERVICE_FILTER}}],
                        },
                    },
                    sort: [{'@timestamp': 'asc'}],
                    _source: ['@timestamp', 'name', 'resource.attributes.service.name',
                              'attributes.event.outcome', 'duration', 'trace.id'],
                },
            }),
        ]);

        res.json({
            sessionId,
            traces:   tracesRes.hits.hits.map((h) => h._source),
            errors:   errorsRes.hits.hits.map((h) => h._source),
            pages:    pagesRes.hits.hits.map((h) => h._source),
            backend:  backendRes.hits.hits.map((h) => h._source),
        });
    } catch (err) {
        console.error('GET /api/sessions/:id error:', err.message);
        res.status(500).json({error: err.message});
    }
});

// ── API: replay events ───────────────────────────────────────────────────────
app.get('/api/sessions/:sessionId/replay', async (req, res) => {
    const {sessionId} = req.params;
    try {
        const result = await esClient.search({
            index: REPLAY_INDEX,
            ignore_unavailable: true,
            body: {
                size: 10000,
                query: {
                    bool: {
                        should: [
                            {term: {'attributes.rum.sessionId': sessionId}},
                            {term: {'attributes.session.id': sessionId}},
                            {term: {'attributes.rum.session.id': sessionId}},
                        ],
                        minimum_should_match: 1,
                    },
                },
                sort: [
                    {'attributes.rr-web.event': 'asc'},
                    {'attributes.rr-web.chunk': 'asc'},
                ],
                _source: ['body', 'attributes', '@timestamp'],
            },
        });

        const chunks = new Map();
        for (const hit of result.hits.hits) {
            const src = hit._source;
            const attrs = src.attributes || {};

            const rrweb = attrs['rr-web'] || {};
            const key   = rrweb.event   ?? attrs['rr-web.event'];
            const chunk = rrweb.chunk   ?? attrs['rr-web.chunk']        ?? 1;
            const total = rrweb['total-chunks'] ?? attrs['rr-web.total-chunks'] ?? 1;
            const rrwebMeta = attrs.rrweb || {};
            const type  = rrwebMeta.type ?? attrs['rrweb.type'];

            if (key == null) continue;
            if (!chunks.has(key)) {
                chunks.set(key, {total, parts: [], type, ts: src['@timestamp']});
            }
            const entry = chunks.get(key);
            const bodyText = typeof src.body === 'object' ? src.body.text : src.body;
            entry.parts[(chunk - 1)] = bodyText;
        }

        const events = [];
        for (const [, entry] of [...chunks.entries()].sort((a, b) => a[0] - b[0])) {
            const filled = entry.parts.filter(Boolean);
            if (filled.length === entry.total) {
                try { events.push(JSON.parse(filled.join(''))); } catch (_) {}
            }
        }

        res.json({events, total: events.length});
    } catch (err) {
        console.error('GET /api/sessions/:id/replay error:', err.message);
        res.status(500).json({error: err.message});
    }
});

// ── API: analytics ────────────────────────────────────────────────────────────
app.get('/api/analytics', async (req, res) => {
    const {from = 'now-24h', service} = req.query;
    const svcFilter = service || SERVICE_FILTER;
    const METRICS_INDEX = 'metrics-generic.otel-default';
    const frontendFilter = {bool: {must: [{term: {[SERVICE_FIELD]: svcFilter}}, {range: {'@timestamp': {gte: from}}}]}};
    const vitalsFilter   = {bool: {must: [{term: {[SERVICE_FIELD]: svcFilter}}, {term: {'scope.name': '@opentelemetry/instrumentation-web-vitals'}}, {range: {'@timestamp': {gte: from}}}]}};

    try {
        const [tracesRes, errorsRes, replayRes, metricsRes, vitalsRes, pageViewRes] = await Promise.all([
            esClient.search({
                index: TRACES_INDEX, ignore_unavailable: true,
                body: {
                    size: 0,
                    query: frontendFilter,
                    aggs: {
                        total_sessions: {cardinality: {field: SESSION_FIELD}},
                        by_hour: {
                            date_histogram: {field: '@timestamp', calendar_interval: 'hour'},
                            aggs: {sessions: {cardinality: {field: SESSION_FIELD}}},
                        },
                        by_service: {terms: {field: 'resource.attributes.service.name', size: 10}},
                        errors: {
                            filter: {term: {'attributes.event.outcome': 'failure'}},
                            aggs: {by_hour: {date_histogram: {field: '@timestamp', calendar_interval: 'hour'}}},
                        },
                    },
                },
            }),
            esClient.search({
                index: LOGS_INDEX, ignore_unavailable: true,
                body: {
                    size: 0,
                    query: {bool: {must: [{range: {'@timestamp': {gte: from}}}], should: [{term: {'scope.name': 'elastic.rum.console'}}, {range: {'attributes.severity_number': {gte: 13}}}], minimum_should_match: 1}},
                    aggs: {
                        by_severity: {terms: {field: 'attributes.severity_number', size: 5}},
                        by_hour: {date_histogram: {field: '@timestamp', calendar_interval: 'hour'}},
                    },
                },
            }),
            esClient.search({
                index: REPLAY_INDEX, ignore_unavailable: true,
                body: {
                    size: 0,
                    query: {range: {'@timestamp': {gte: from}}},
                    aggs: {
                        by_type: {terms: {field: 'attributes.rrweb.type', size: 10}},
                        total_sessions: {cardinality: {script: {source: "def v = doc['attributes.rum.sessionId']; if(v!=null&&v.size()>0) return v.value; return ''"}}},
                    },
                },
            }),
            esClient.search({
                index: METRICS_INDEX, ignore_unavailable: true,
                body: {
                    size: 0,
                    query: {bool: {must: [{term: {[SERVICE_FIELD]: SERVICE_FILTER}}, {range: {'@timestamp': {gte: from}}}]}},
                    aggs: {
                        orders_placed:  {filter: {exists: {field: 'metrics.orders\\.placed'}},  aggs: {total: {sum: {field: 'metrics.orders\\.placed'}}}},
                        demo_clicks:    {filter: {exists: {field: 'metrics.demo\\.clicks'}},    aggs: {total: {sum: {field: 'metrics.demo\\.clicks'}}}},
                        demo_resp_time: {filter: {exists: {field: 'metrics.demo\\.response_time'}}, aggs: {avg: {avg: {field: 'metrics.demo\\.response_time'}}, p95: {percentiles: {field: 'metrics.demo\\.response_time', percents: [95]}}}},
                    },
                },
            }).catch(() => null),
            esClient.search({
                index: LOGS_INDEX, ignore_unavailable: true,
                body: {
                    size: 0,
                    query: vitalsFilter,
                    aggs: {
                        lcp:  {filter: {term: {'attributes.browser.web_vital.name': 'lcp'}},  aggs: {p: {percentiles: {field: 'attributes.browser.web_vital.value', percents: [50,75,95]}}, count: {value_count: {field: 'attributes.browser.web_vital.value'}}}},
                        fcp:  {filter: {term: {'attributes.browser.web_vital.name': 'fcp'}},  aggs: {p: {percentiles: {field: 'attributes.browser.web_vital.value', percents: [50,75,95]}}, count: {value_count: {field: 'attributes.browser.web_vital.value'}}}},
                        cls:  {filter: {term: {'attributes.browser.web_vital.name': 'cls'}},  aggs: {p: {percentiles: {field: 'attributes.browser.web_vital.value', percents: [50,75,95]}}, count: {value_count: {field: 'attributes.browser.web_vital.value'}}}},
                        inp:  {filter: {term: {'attributes.browser.web_vital.name': 'inp'}},  aggs: {p: {percentiles: {field: 'attributes.browser.web_vital.value', percents: [50,75,95]}}, count: {value_count: {field: 'attributes.browser.web_vital.value'}}}},
                        ttfb: {filter: {term: {'attributes.browser.web_vital.name': 'ttfb'}}, aggs: {p: {percentiles: {field: 'attributes.browser.web_vital.value', percents: [50,75,95]}}, count: {value_count: {field: 'attributes.browser.web_vital.value'}}}},
                    },
                },
            }).catch(() => null),
            esClient.search({
                index: TRACES_INDEX, ignore_unavailable: true,
                body: {
                    size: 0,
                    query: {bool: {must: [frontendFilter, {term: {name: 'page.view'}}]}},
                    aggs: {
                        by_page: {terms: {field: 'attributes.page\\.name', size: 20}},
                        by_hour: {date_histogram: {field: '@timestamp', calendar_interval: 'hour'}},
                    },
                },
            }).catch(() => null),
        ]);

        function _vitals(agg) {
            if (!agg || !agg.count || agg.count.value === 0) return null;
            const p = agg.p?.values || {};
            const round = (v, decimals = 1) => v != null && isFinite(v) ? Math.round(v * Math.pow(10, decimals)) / Math.pow(10, decimals) : null;
            return {count: agg.count.value, p50: round(p['50.0']), p75: round(p['75.0']), p95: round(p['95.0'])};
        }

        const maggs  = metricsRes?.aggregations  || {};
        const vaggs  = vitalsRes?.aggregations   || {};
        const paggs  = pageViewRes?.aggregations || {};

        res.json({
            traces: {
                total:    tracesRes.hits.total?.value || 0,
                sessions: tracesRes.aggregations?.total_sessions?.value || 0,
                byHour:   (tracesRes.aggregations?.by_hour?.buckets || []).map((b) => ({ts: b.key_as_string, count: b.doc_count, sessions: b.sessions?.value || 0})),
                byService:(tracesRes.aggregations?.by_service?.buckets || []).map((b) => ({name: b.key, count: b.doc_count})),
                errors: {
                    total:  tracesRes.aggregations?.errors?.doc_count || 0,
                    byHour: (tracesRes.aggregations?.errors?.by_hour?.buckets || []).map((b) => ({ts: b.key_as_string, count: b.doc_count})),
                },
            },
            logs: {
                total:      errorsRes.hits.total?.value || 0,
                bySeverity: (errorsRes.aggregations?.by_severity?.buckets || []).map((b) => ({severity: b.key, count: b.doc_count})),
                byHour:     (errorsRes.aggregations?.by_hour?.buckets || []).map((b) => ({ts: b.key_as_string, count: b.doc_count})),
            },
            replay: {
                total:    replayRes.hits.total?.value || 0,
                sessions: replayRes.aggregations?.total_sessions?.value || 0,
                byType:   (replayRes.aggregations?.by_type?.buckets || []).map((b) => ({type: b.key, count: b.doc_count})),
            },
            webVitals: {lcp: _vitals(vaggs.lcp), fcp: _vitals(vaggs.fcp), cls: _vitals(vaggs.cls), inp: _vitals(vaggs.inp), ttfb: _vitals(vaggs.ttfb)},
            customMetrics: {
                ordersPlaced:  maggs.orders_placed?.total?.value  ?? null,
                demoClicks:    maggs.demo_clicks?.total?.value    ?? null,
                demoRespTimeAvg: maggs.demo_resp_time?.avg?.value != null ? Math.round(maggs.demo_resp_time.avg.value) : null,
                demoRespTimeP95: maggs.demo_resp_time?.p95?.values?.['95.0'] != null ? Math.round(maggs.demo_resp_time.p95.values['95.0']) : null,
            },
            pageViews: {
                total:  pageViewRes?.hits?.total?.value || 0,
                byPage: (paggs.by_page?.buckets || []).map((b) => ({page: b.key, count: b.doc_count})),
                byHour: (paggs.by_hour?.buckets  || []).map((b) => ({ts: b.key_as_string, count: b.doc_count})),
            },
        });
    } catch (err) {
        console.error('GET /api/analytics error:', err.message);
        res.status(500).json({error: err.message});
    }
});

// ── API: list available services ─────────────────────────────────────────────
app.get('/api/services', async (req, res) => {
    try {
        const r = await esClient.search({
            index: `${TRACES_INDEX},${LOGS_INDEX}`, ignore_unavailable: true,
            body: {
                size: 0,
                query: {bool: {must: [{exists: {field: SESSION_FIELD}}, {range: {'@timestamp': {gte: 'now-7d'}}}]}},
                aggs: {services: {terms: {field: SERVICE_FIELD, size: 50}}},
            },
        });
        const services = (r.aggregations?.services?.buckets || []).map((b) => ({name: b.key, count: b.doc_count}));
        res.json({services});
    } catch (err) { res.status(500).json({error: err.message}); }
});

function _attr(attrs, key) {
    if (!attrs) return null;
    if (attrs[key] != null) return attrs[key];
    const parts = key.split('.');
    let v = attrs;
    for (const p of parts) {
        if (v == null || typeof v !== 'object') return null;
        v = v[p];
    }
    return v ?? null;
}

function _toPath(url) {
    if (!url) return null;
    try { return new URL(url, 'http://x').pathname.replace(/\/$/, '') || '/'; }
    catch (_) { return url.startsWith('/') ? url.replace(/\/$/, '') || '/' : null; }
}

// ── API: user journey ─────────────────────────────────────────────────────────
app.get('/api/analytics/journey', async (req, res) => {
    const {from = 'now-24h', service} = req.query;
    const svcFilter = service || SERVICE_FILTER;
    try {
        const result = await esClient.search({
            index: TRACES_INDEX, ignore_unavailable: true,
            body: {
                size: 1000,
                query: {bool: {must: [{term: {[SERVICE_FIELD]: svcFilter}}, {term: {name: 'navigation.route_change'}}, {range: {'@timestamp': {gte: from}}}]}},
                sort: [{'@timestamp': 'asc'}],
                _source: true,
            },
        });

        const visitCounts = new Map();
        const transitionCounts = new Map();
        const entryPageCounts = new Map();

        for (const hit of result.hits.hits) {
            const a = hit._source?.attributes || {};
            const toPage   = _attr(a, 'page.url.path') || _toPath(_attr(a, 'page.url')) || null;
            const fromPage = _toPath(_attr(a, 'navigation.previous_url'));
            if (toPage)   visitCounts.set(toPage, (visitCounts.get(toPage) || 0) + 1);
            if (fromPage) visitCounts.set(fromPage, visitCounts.get(fromPage) ?? 0);
            if (fromPage && toPage && fromPage !== toPage) {
                const key = `${fromPage}|||${toPage}`;
                transitionCounts.set(key, (transitionCounts.get(key) || 0) + 1);
            }
            if (!fromPage && toPage) {
                entryPageCounts.set(toPage, (entryPageCounts.get(toPage) || 0) + 1);
            }
        }

        const nodes = [...visitCounts.entries()].map(([id, visits]) => ({id, visits}));
        const links = [...transitionCounts.entries()].map(([key, count]) => {
            const [from, to] = key.split('|||');
            return {from, to, count};
        }).sort((a, b) => b.count - a.count);

        const entryPages = [...entryPageCounts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
        res.json({nodes, links, entryPages, totalNavigations: result.hits.total?.value || 0});
    } catch (err) { res.status(500).json({error: err.message}); }
});

// ── API: conversion funnel ────────────────────────────────────────────────────
app.get('/api/analytics/funnel', async (req, res) => {
    const {from = 'now-24h', service} = req.query;
    const svcFilter = service || SERVICE_FILTER;
    const steps = req.query.steps
        ? req.query.steps.split(',').map((s) => s.trim()).filter(Boolean)
        : ['/home', '/products', '/cart', '/checkout', '/orders'];
    try {
        const counts = await Promise.all(steps.map((step) =>
            esClient.search({
                index: TRACES_INDEX, ignore_unavailable: true,
                body: {
                    size: 0,
                    query: {bool: {must: [{term: {[SERVICE_FIELD]: svcFilter}}, {term: {'attributes.page.url.path': step}}, {range: {'@timestamp': {gte: from}}}]}},
                    aggs: {sessions: {cardinality: {field: SESSION_FIELD}}},
                },
            }).then((r) => r.aggregations?.sessions?.value || 0)
        ));

        const firstNonZero = counts.findIndex((c) => c > 0);
        if (firstNonZero === -1) return res.json({funnel: [], totalEntries: 0});

        const top = counts[firstNonZero];
        res.json({
            funnel: steps.map((step, i) => ({
                step,
                sessions:  counts[i],
                pctOfTop:  Math.round((counts[i] / top) * 100),
                pctOfPrev: i === 0 ? 100 : counts[i - 1] > 0 ? Math.round((counts[i] / counts[i - 1]) * 100) : 0,
                dropOff:   i === 0 ? 0 : Math.max(0, counts[i - 1] - counts[i]),
            })),
            totalEntries: top,
        });
    } catch (err) { res.status(500).json({error: err.message}); }
});

app.get('*', (_, res) => res.sendFile(join(__dirname, 'public/index.html')));

app.listen(PORT, () => console.log(`Player on :${PORT} → ES: ${ES_URL}`));
