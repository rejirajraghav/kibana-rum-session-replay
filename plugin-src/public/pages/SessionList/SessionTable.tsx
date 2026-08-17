import React from 'react';
import {
    EuiBasicTable,
    EuiBadge,
    EuiButtonIcon,
    EuiToolTip,
    EuiText,
    type EuiBasicTableColumn,
} from '@elastic/eui';
import {useNavigate} from 'react-router-dom';
import type {SessionSummary} from '../../../common/types';

interface Props {
    sessions: SessionSummary[];
    total: number;
    page: number;
    pageSize: number;
    loading: boolean;
    onPageChange: (page: number, pageSize: number) => void;
}

function formatDuration(ms: number): string {
    if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
    const m = Math.floor(ms / 60_000);
    const s = Math.round((ms % 60_000) / 1000);
    return `${m}m ${s}s`;
}

function formatTime(iso: string): string {
    return new Date(iso).toLocaleString();
}

export function SessionTable({
    sessions,
    total,
    page,
    pageSize,
    loading,
    onPageChange,
}: Props) {
    const navigate = useNavigate();

    const columns: Array<EuiBasicTableColumn<SessionSummary>> = [
        {
            field: 'sessionId',
            name: 'Session ID',
            truncateText: true,
            render: (id: string) => (
                <EuiText size="s">
                    <code>{id.slice(0, 8)}…</code>
                </EuiText>
            ),
        },
        {
            field: 'userName',
            name: 'User',
            render: (_: unknown, row: SessionSummary) =>
                row.userName || row.userEmail || row.userId || (
                    <EuiText color="subdued" size="s">
                        anonymous
                    </EuiText>
                ),
        },
        {
            field: 'startTime',
            name: 'Started',
            render: (v: string) => formatTime(v),
            sortable: true,
        },
        {
            field: 'durationMs',
            name: 'Duration',
            render: (v: number) => formatDuration(v),
            sortable: true,
        },
        {
            field: 'pages',
            name: 'Pages',
            render: (pages: string[]) => pages.length,
        },
        {
            field: 'errorCount',
            name: 'Errors',
            render: (count: number) =>
                count > 0 ? (
                    <EuiBadge color="danger">{count}</EuiBadge>
                ) : (
                    <EuiBadge color="success">0</EuiBadge>
                ),
        },
        {
            field: 'eventCount',
            name: 'Events',
        },
        {
            name: 'Play',
            actions: [
                {
                    render: (row: SessionSummary) => (
                        <EuiToolTip content="Play session replay">
                            <EuiButtonIcon
                                iconType="playFilled"
                                color="primary"
                                aria-label="Play session"
                                onClick={() =>
                                    navigate(`/session/${row.sessionId}`)
                                }
                            />
                        </EuiToolTip>
                    ),
                },
            ],
        },
    ];

    return (
        <EuiBasicTable
            items={sessions}
            columns={columns}
            loading={loading}
            pagination={{
                pageIndex: page,
                pageSize,
                totalItemCount: total,
                pageSizeOptions: [10, 25, 50],
            }}
            onChange={({page: p}) => onPageChange(p.index, p.size)}
            rowProps={(row: SessionSummary) => ({
                style:
                    row.errorCount > 0
                        ? {borderLeft: '3px solid #BD271E'}
                        : undefined,
            })}
        />
    );
}
