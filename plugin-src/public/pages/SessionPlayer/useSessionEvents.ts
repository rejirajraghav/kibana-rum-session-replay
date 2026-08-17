import {useState, useEffect} from 'react';
import type {SessionEventsResponse, ReplayEvent, SessionMetadata} from '../../../common/types';
import {API_BASE} from '../../../common/constants';

interface UseSessionEventsResult {
    events: ReplayEvent[];
    metadata: SessionMetadata | null;
    loading: boolean;
    error: string | null;
}

export function useSessionEvents(sessionId: string): UseSessionEventsResult {
    const [events, setEvents] = useState<ReplayEvent[]>([]);
    const [metadata, setMetadata] = useState<SessionMetadata | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!sessionId) return;
        let cancelled = false;
        setLoading(true);
        setError(null);
        setEvents([]);
        setMetadata(null);

        fetch(`${API_BASE}/sessions/${encodeURIComponent(sessionId)}/events`, {
            headers: {'kbn-xsrf': 'true'},
        })
            .then((r) => {
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return r.json() as Promise<SessionEventsResponse>;
            })
            .then((data) => {
                if (cancelled) return;
                setEvents(data.events);
                setMetadata(data.metadata);
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
    }, [sessionId]);

    return {events, metadata, loading, error};
}
