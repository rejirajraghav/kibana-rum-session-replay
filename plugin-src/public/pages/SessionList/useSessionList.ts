import {useState, useEffect, useCallback} from 'react';
import type {SessionSummary, SessionListResponse} from '../../../common/types';
import {API_BASE} from '../../../common/constants';

interface UseSessionListOptions {
    page: number;
    pageSize: number;
    query: string;
    from: string;
    to: string;
}

interface UseSessionListResult {
    sessions: SessionSummary[];
    total: number;
    loading: boolean;
    error: string | null;
    reload: () => void;
}

export function useSessionList({
    page,
    pageSize,
    query,
    from,
    to,
}: UseSessionListOptions): UseSessionListResult {
    const [sessions, setSessions] = useState<SessionSummary[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [tick, setTick] = useState(0);

    const reload = useCallback(() => setTick((t) => t + 1), []);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);

        const params = new URLSearchParams({
            page: String(page),
            size: String(pageSize),
            from,
            to,
            ...(query ? {query} : {}),
        });

        fetch(`${API_BASE}/sessions?${params}`, {
            headers: {'kbn-xsrf': 'true'},
        })
            .then((r) => {
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return r.json() as Promise<SessionListResponse>;
            })
            .then((data) => {
                if (cancelled) return;
                setSessions(data.sessions);
                setTotal(data.total);
            })
            .catch((err: Error) => {
                if (cancelled) return;
                setError(err.message);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [page, pageSize, query, from, to, tick]);

    return {sessions, total, loading, error, reload};
}
