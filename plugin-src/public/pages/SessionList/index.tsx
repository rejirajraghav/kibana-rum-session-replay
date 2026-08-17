import React, {useState} from 'react';
import {
    EuiPage,
    EuiPageBody,
    EuiPageHeader,
    EuiPageSection,
    EuiFieldSearch,
    EuiFlexGroup,
    EuiFlexItem,
    EuiCallOut,
    EuiSuperDatePicker,
    EuiButton,
} from '@elastic/eui';
import {SessionTable} from './SessionTable';
import {useSessionList} from './useSessionList';

export function SessionListPage() {
    const [page, setPage] = useState(0);
    const [pageSize, setPageSize] = useState(25);
    const [query, setQuery] = useState('');
    const [from, setFrom] = useState('now-24h');
    const [to, setTo] = useState('now');

    const {sessions, total, loading, error, reload} = useSessionList({
        page,
        pageSize,
        query,
        from,
        to,
    });

    return (
        <EuiPage paddingSize="l">
            <EuiPageBody>
                <EuiPageHeader
                    pageTitle="Session Replay"
                    description="Browse and replay recorded user sessions captured by EDOT Browser RUM."
                    rightSideItems={[
                        <EuiButton
                            key="refresh"
                            iconType="refresh"
                            onClick={reload}
                        >
                            Refresh
                        </EuiButton>,
                    ]}
                />

                <EuiPageSection>
                    <EuiFlexGroup>
                        <EuiFlexItem>
                            <EuiFieldSearch
                                placeholder="Search by session ID or user…"
                                value={query}
                                onChange={(e) => {
                                    setQuery(e.target.value);
                                    setPage(0);
                                }}
                                isClearable
                            />
                        </EuiFlexItem>
                        <EuiFlexItem grow={false}>
                            <EuiSuperDatePicker
                                start={from}
                                end={to}
                                onTimeChange={({start, end}) => {
                                    setFrom(start);
                                    setTo(end);
                                    setPage(0);
                                }}
                            />
                        </EuiFlexItem>
                    </EuiFlexGroup>
                </EuiPageSection>

                {error && (
                    <EuiPageSection>
                        <EuiCallOut
                            title="Failed to load sessions"
                            color="danger"
                            iconType="error"
                        >
                            {error}
                        </EuiCallOut>
                    </EuiPageSection>
                )}

                <EuiPageSection>
                    <SessionTable
                        sessions={sessions}
                        total={total}
                        page={page}
                        pageSize={pageSize}
                        loading={loading}
                        onPageChange={(p, size) => {
                            setPage(p);
                            setPageSize(size);
                        }}
                    />
                </EuiPageSection>
            </EuiPageBody>
        </EuiPage>
    );
}
