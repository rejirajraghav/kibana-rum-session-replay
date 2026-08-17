import {INDEX_REPLAY, INDEX_LOGS, API_BASE} from '../../common/constants';
import type {SessionSummary, SessionListResponse} from '../../common/types';

const SESSION_ID_RE = /^[0-9a-f-]{8,64}$/i;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerSessionsRoute(router: any) {
    router.get(
        {
            path: `${API_BASE}/sessions`,
            validate: false,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async (ctx: any, req: any, res: any) => {
            try {
                const {
                    page = '0',
                    size = '25',
                    from = 'now-24h',
                    to = 'now',
                    query = '',
                } = req.query as Record<string, string>;

                const pageNum = Math.max(0, parseInt(page, 10));
                const pageSize = Math.min(100, Math.max(1, parseInt(size, 10)));

                const esClient = (await ctx.core).elasticsearch.client.asCurrentUser;

                // Step 1: aggregation — one bucket per session
                const aggResult = await esClient.search({
                    index: INDEX_REPLAY,
                    size: 0,
                    query: buildTimeRangeQuery(from, to, query),
                    aggs: {
                        sessions: {
                            terms: {
                                field: 'attributes.session\\.id',
                                size: 10_000, // upper bound; filtered by page below
                                order: {min_ts: 'desc'},
                            },
                            aggs: {
                                min_ts: {min: {field: '@timestamp'}},
                                max_ts: {max: {field: '@timestamp'}},
                                error_count: {
                                    filter: {term: {'attributes.rrweb\\.type': 5}},
                                },
                                user_name: {
                                    terms: {
                                        field: 'attributes.user\\.name',
                                        size: 1,
                                    },
                                },
                                user_email: {
                                    terms: {
                                        field: 'attributes.user\\.email',
                                        size: 1,
                                    },
                                },
                                user_id: {
                                    terms: {
                                        field: 'attributes.user\\.id',
                                        size: 1,
                                    },
                                },
                                pages: {
                                    terms: {
                                        field: 'attributes.page\\.url\\.path',
                                        size: 50,
                                    },
                                },
                            },
                        },
                    },
                });

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const buckets: any[] =
                    aggResult.aggregations?.sessions?.buckets ?? [];
                const total = buckets.length;
                const pageBuckets = buckets.slice(
                    pageNum * pageSize,
                    (pageNum + 1) * pageSize
                );

                const sessions: SessionSummary[] = pageBuckets.map(
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (b: any) => {
                        const startMs = b.min_ts.value ?? 0;
                        const endMs = b.max_ts.value ?? startMs;
                        return {
                            sessionId: b.key,
                            userName:
                                b.user_name.buckets[0]?.key ?? undefined,
                            userEmail:
                                b.user_email.buckets[0]?.key ?? undefined,
                            userId: b.user_id.buckets[0]?.key ?? undefined,
                            startTime: new Date(startMs).toISOString(),
                            endTime: new Date(endMs).toISOString(),
                            durationMs: endMs - startMs,
                            errorCount: b.error_count.doc_count,
                            eventCount: b.doc_count,
                            pages: b.pages.buckets.map(
                                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                (p: any) => p.key
                            ),
                        };
                    }
                );

                const body: SessionListResponse = {sessions, total};
                return res.ok({body});
            } catch (err) {
                return res.internalError({
                    body: {message: String(err)},
                });
            }
        }
    );
}

function buildTimeRangeQuery(from: string, to: string, query: string) {
    const must: object[] = [
        {
            range: {
                '@timestamp': {
                    gte: from,
                    lte: to,
                },
            },
        },
        // Only replay events (scope: elastic-rrweb)
        {
            exists: {field: 'attributes.session\\.id'},
        },
    ];

    if (query) {
        // Simple prefix / wildcard search on session ID and user fields
        must.push({
            bool: {
                should: [
                    {
                        prefix: {
                            'attributes.session\\.id': {value: query.toLowerCase()},
                        },
                    },
                    {
                        match: {'attributes.user\\.name': query},
                    },
                    {
                        match: {'attributes.user\\.email': query},
                    },
                ],
                minimum_should_match: 1,
            },
        });
    }

    return {bool: {must}};
}
