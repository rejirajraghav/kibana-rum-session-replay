import {
    INDEX_REPLAY,
    INDEX_TRACES,
    INDEX_LOGS,
    API_BASE,
} from '../../common/constants';
import type {
    SessionEventsResponse,
    ReplayEvent,
    SessionMetadata,
    PageNavigation,
    SessionError,
    NetworkEvent,
} from '../../common/types';

const SESSION_ID_RE = /^[0-9a-f-]{8,64}$/i;
const MAX_EVENTS = 50_000; // cap — rrweb Replayer can handle this comfortably

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerEventsRoute(router: any) {
    router.get(
        {
            path: `${API_BASE}/sessions/{sessionId}/events`,
            validate: false,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async (ctx: any, req: any, res: any) => {
            const {sessionId} = req.params as {sessionId: string};

            // Validate session ID — must be a UUID-like string
            if (!SESSION_ID_RE.test(sessionId)) {
                return res.badRequest({body: {message: 'Invalid session ID'}});
            }

            try {
                const esClient = (await ctx.core).elasticsearch.client.asCurrentUser;

                // Fetch all three data sources in parallel
                const [replayResult, tracesResult, logsResult] =
                    await Promise.all([
                        fetchReplayEvents(esClient, sessionId),
                        fetchTraces(esClient, sessionId),
                        fetchLogs(esClient, sessionId),
                    ]);

                const {events, startMs, endMs} = replayResult;

                const pages = buildPageNavigations(events, startMs);
                const errors = buildErrors(logsResult, startMs);
                const networkEvents = buildNetworkEvents(tracesResult, startMs);

                const metadata: SessionMetadata = {
                    sessionId,
                    userId: extractUserField(events, 'userId'),
                    userEmail: extractUserField(events, 'userEmail'),
                    userName: extractUserField(events, 'userName'),
                    startTime: new Date(startMs).toISOString(),
                    endTime: new Date(endMs).toISOString(),
                    durationMs: endMs - startMs,
                    pages,
                    errors,
                    networkEvents,
                };

                const body: SessionEventsResponse = {events, metadata};
                return res.ok({body});
            } catch (err) {
                return res.internalError({body: {message: String(err)}});
            }
        }
    );
}

// -- ES queries

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchReplayEvents(esClient: any, sessionId: string) {
    const result = await esClient.search({
        index: INDEX_REPLAY,
        size: MAX_EVENTS,
        sort: [{'attributes.rr-web\\.event': 'asc'}],
        query: {
            term: {'attributes.session\\.id': sessionId},
        },
        _source: ['@timestamp', 'body', 'attributes'],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hits: any[] = result.hits?.hits ?? [];
    let startMs = Infinity;
    let endMs = -Infinity;

    const events: ReplayEvent[] = hits
        .map(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (hit: any): ReplayEvent | null => {
                let parsed: ReplayEvent['data'];
                try {
                    parsed = JSON.parse(hit._source?.body ?? 'null');
                } catch (_) {
                    return null;
                }
                if (!parsed) return null;

                const ts: number = parsed.timestamp ?? new Date(hit._source['@timestamp']).getTime();
                if (ts < startMs) startMs = ts;
                if (ts > endMs) endMs = ts;

                return {
                    timestamp: ts,
                    type: parsed.type ?? hit._source?.attributes?.['rrweb.type'] ?? 0,
                    data: parsed,
                    pageUrl: hit._source?.attributes?.['page.url'],
                    pageUrlPath: hit._source?.attributes?.['page.url.path'],
                };
            }
        )
        .filter((e): e is ReplayEvent => e !== null);

    if (startMs === Infinity) startMs = Date.now();
    if (endMs === -Infinity) endMs = startMs;

    return {events, startMs, endMs};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchTraces(esClient: any, sessionId: string) {
    const result = await esClient.search({
        index: INDEX_TRACES,
        size: 500,
        sort: [{'@timestamp': 'asc'}],
        query: {
            bool: {
                should: [
                    {term: {'resource.attributes.session\\.id': sessionId}},
                    {term: {'attributes.session\\.id': sessionId}},
                ],
                minimum_should_match: 1,
            },
        },
        _source: [
            '@timestamp',
            'attributes',
            'duration',
            'name',
            'status',
        ],
    });
    return result.hits?.hits ?? [];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchLogs(esClient: any, sessionId: string) {
    const result = await esClient.search({
        index: INDEX_LOGS,
        size: 200,
        sort: [{'@timestamp': 'asc'}],
        query: {
            bool: {
                must: [
                    {term: {'attributes.session\\.id': sessionId}},
                ],
                should: [
                    {term: {'severity_number': 17}}, // ERROR
                    {term: {'severity_number': 21}}, // FATAL
                    // console.error via console-capture.js
                    {term: {'attributes.elastic\\.rum\\.log\\.type': 'console'}},
                ],
                minimum_should_match: 1,
            },
        },
        _source: ['@timestamp', 'body', 'attributes', 'severity_number'],
    });
    return result.hits?.hits ?? [];
}

// -- Data shape builders

function buildPageNavigations(events: ReplayEvent[], startMs: number): PageNavigation[] {
    const pages: PageNavigation[] = [];
    let lastPath = '';
    for (const ev of events) {
        const path = ev.pageUrlPath ?? '';
        if (path && path !== lastPath) {
            lastPath = path;
            pages.push({
                timestamp: new Date(ev.timestamp).toISOString(),
                path,
                url: ev.pageUrl ?? path,
                offsetMs: ev.timestamp - startMs,
            });
        }
    }
    return pages;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildErrors(hits: any[], startMs: number): SessionError[] {
    return hits.map((hit) => {
        const src = hit._source ?? {};
        const ts = new Date(src['@timestamp']).getTime();
        let body = src.body ?? '';
        if (typeof body === 'object') body = JSON.stringify(body);

        return {
            timestamp: src['@timestamp'],
            message: body.slice(0, 300),
            type: src.attributes?.['error.type'] ?? 'error',
            stack: src.attributes?.['exception.stacktrace'] ?? src.attributes?.['error.stack'],
            offsetMs: ts - startMs,
        };
    });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildNetworkEvents(hits: any[], startMs: number): NetworkEvent[] {
    return hits.map((hit) => {
        const src = hit._source ?? {};
        const ts = new Date(src['@timestamp']).getTime();
        const attrs = src.attributes ?? {};
        return {
            timestamp: src['@timestamp'],
            method: attrs['http.request.method'] ?? attrs['http.method'] ?? 'GET',
            url: attrs['url.full'] ?? attrs['http.url'] ?? '',
            statusCode: attrs['http.response.status_code'] ?? attrs['http.status_code'],
            durationMs: src.duration ? src.duration / 1_000_000 : undefined, // ns → ms
            traceId: src.trace_id,
        };
    });
}

function extractUserField(events: ReplayEvent[], field: string): string | undefined {
    // User fields are on event attributes, not on the event body
    // We stored them when building ReplayEvent — use a side-channel approach
    // by looking at the first event that has the field set
    // NOTE: user fields come from ES attributes, not the parsed rrweb body.
    // For this reason, we return undefined here and rely on the metadata
    // that Kibana built from the per-event attributes.source during the
    // replay fetch (which currently doesn't return user fields directly).
    // TODO: thread user fields from the ES hit attributes into ReplayEvent.
    void events;
    void field;
    return undefined;
}
