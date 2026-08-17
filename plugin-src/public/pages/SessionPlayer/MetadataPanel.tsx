import React, {useState} from 'react';
import {
    EuiPanel,
    EuiTitle,
    EuiSpacer,
    EuiDescriptionList,
    EuiAccordion,
    EuiBadge,
    EuiFlexGroup,
    EuiFlexItem,
    EuiText,
    EuiTimeline,
    EuiTimelineItem,
    EuiIcon,
    EuiButtonEmpty,
} from '@elastic/eui';
import type {SessionMetadata, SessionError, PageNavigation} from '../../../common/types';

interface Props {
    metadata: SessionMetadata;
    onSeek: (offsetMs: number) => void;
}

function formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString();
}

function formatDuration(ms: number): string {
    if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
    const m = Math.floor(ms / 60_000);
    const s = Math.round((ms % 60_000) / 1000);
    return `${m}m ${s}s`;
}

export function MetadataPanel({metadata, onSeek}: Props) {
    const [activeTab, setActiveTab] = useState<'pages' | 'errors' | 'network'>('pages');

    const sessionInfo = [
        {title: 'Session ID', description: <code style={{fontSize: 11}}>{metadata.sessionId}</code>},
        {
            title: 'User',
            description:
                metadata.userName ||
                metadata.userEmail ||
                metadata.userId || (
                    <EuiText color="subdued" size="s">
                        anonymous
                    </EuiText>
                ),
        },
        {title: 'Start', description: formatTime(metadata.startTime)},
        {title: 'End', description: formatTime(metadata.endTime)},
        {title: 'Duration', description: formatDuration(metadata.durationMs)},
        {title: 'Pages', description: metadata.pages.length},
        {
            title: 'Errors',
            description: (
                <EuiBadge color={metadata.errors.length > 0 ? 'danger' : 'success'}>
                    {metadata.errors.length}
                </EuiBadge>
            ),
        },
    ];

    return (
        <EuiPanel hasShadow paddingSize="m" style={{height: '100%', overflowY: 'auto'}}>
            <EuiTitle size="s">
                <h2>Session Info</h2>
            </EuiTitle>
            <EuiSpacer size="s" />
            <EuiDescriptionList
                type="column"
                listItems={sessionInfo}
                compressed
            />

            <EuiSpacer size="m" />

            {/* Tab bar */}
            <EuiFlexGroup gutterSize="none">
                {(['pages', 'errors', 'network'] as const).map((tab) => (
                    <EuiFlexItem key={tab}>
                        <EuiButtonEmpty
                            size="s"
                            color={activeTab === tab ? 'primary' : 'text'}
                            onClick={() => setActiveTab(tab)}
                            style={{
                                borderBottom:
                                    activeTab === tab
                                        ? '2px solid #0077CC'
                                        : '2px solid transparent',
                                borderRadius: 0,
                                textTransform: 'capitalize',
                            }}
                        >
                            {tab}
                            {tab === 'errors' && metadata.errors.length > 0 && (
                                <EuiBadge color="danger" style={{marginLeft: 4}}>
                                    {metadata.errors.length}
                                </EuiBadge>
                            )}
                        </EuiButtonEmpty>
                    </EuiFlexItem>
                ))}
            </EuiFlexGroup>

            <EuiSpacer size="s" />

            {activeTab === 'pages' && (
                <PagesList pages={metadata.pages} onSeek={onSeek} />
            )}
            {activeTab === 'errors' && (
                <ErrorsList errors={metadata.errors} onSeek={onSeek} />
            )}
            {activeTab === 'network' && (
                <NetworkList events={metadata.networkEvents} onSeek={onSeek} />
            )}
        </EuiPanel>
    );
}

function PagesList({
    pages,
    onSeek,
}: {
    pages: PageNavigation[];
    onSeek: (ms: number) => void;
}) {
    if (pages.length === 0) {
        return <EuiText color="subdued" size="s">No page navigations recorded.</EuiText>;
    }
    return (
        <EuiTimeline>
            {pages.map((p, i) => (
                <EuiTimelineItem
                    key={i}
                    icon={<EuiIcon type="link" />}
                    verticalAlign="top"
                >
                    <EuiFlexGroup alignItems="center" gutterSize="s">
                        <EuiFlexItem>
                            <EuiText size="s">
                                <strong>{p.path}</strong>
                            </EuiText>
                            <EuiText color="subdued" size="xs">
                                {formatTime(p.timestamp)}
                            </EuiText>
                        </EuiFlexItem>
                        <EuiFlexItem grow={false}>
                            <EuiButtonEmpty
                                size="xs"
                                iconType="playFilled"
                                onClick={() => onSeek(p.offsetMs)}
                            >
                                Jump
                            </EuiButtonEmpty>
                        </EuiFlexItem>
                    </EuiFlexGroup>
                </EuiTimelineItem>
            ))}
        </EuiTimeline>
    );
}

function ErrorsList({
    errors,
    onSeek,
}: {
    errors: SessionError[];
    onSeek: (ms: number) => void;
}) {
    if (errors.length === 0) {
        return <EuiText color="success" size="s">No errors in this session.</EuiText>;
    }
    return (
        <>
            {errors.map((err, i) => (
                <EuiPanel
                    key={i}
                    hasShadow={false}
                    hasBorder
                    paddingSize="s"
                    style={{marginBottom: 8, borderLeft: '3px solid #BD271E'}}
                >
                    <EuiFlexGroup alignItems="flexStart" gutterSize="s">
                        <EuiFlexItem>
                            <EuiText size="s" color="danger">
                                <strong>{err.type || 'Error'}</strong>
                            </EuiText>
                            <EuiText size="xs">{err.message}</EuiText>
                            <EuiText color="subdued" size="xs">
                                {formatTime(err.timestamp)}
                            </EuiText>
                        </EuiFlexItem>
                        <EuiFlexItem grow={false}>
                            <EuiButtonEmpty
                                size="xs"
                                iconType="playFilled"
                                color="danger"
                                onClick={() => onSeek(err.offsetMs)}
                            >
                                Jump
                            </EuiButtonEmpty>
                        </EuiFlexItem>
                    </EuiFlexGroup>
                    {err.stack && (
                        <EuiAccordion id={`stack-${i}`} buttonContent="Stack trace">
                            <pre
                                style={{
                                    fontSize: 10,
                                    overflow: 'auto',
                                    maxHeight: 200,
                                    background: '#f5f7fa',
                                    padding: 8,
                                }}
                            >
                                {err.stack}
                            </pre>
                        </EuiAccordion>
                    )}
                </EuiPanel>
            ))}
        </>
    );
}

function NetworkList({
    events,
    onSeek,
}: {
    events: SessionMetadata['networkEvents'];
    onSeek: (ms: number) => void;
}) {
    if (events.length === 0) {
        return <EuiText color="subdued" size="s">No network events recorded.</EuiText>;
    }
    return (
        <>
            {events.map((ev, i) => (
                <EuiPanel
                    key={i}
                    hasShadow={false}
                    hasBorder
                    paddingSize="s"
                    style={{marginBottom: 4}}
                >
                    <EuiFlexGroup gutterSize="s" alignItems="center">
                        <EuiFlexItem grow={false}>
                            <EuiBadge
                                color={
                                    !ev.statusCode
                                        ? 'default'
                                        : ev.statusCode >= 400
                                        ? 'danger'
                                        : 'success'
                                }
                            >
                                {ev.method}
                            </EuiBadge>
                        </EuiFlexItem>
                        <EuiFlexItem>
                            <EuiText size="xs" style={{wordBreak: 'break-all'}}>
                                {ev.url}
                            </EuiText>
                        </EuiFlexItem>
                        <EuiFlexItem grow={false}>
                            {ev.statusCode && (
                                <EuiBadge
                                    color={ev.statusCode >= 400 ? 'danger' : 'hollow'}
                                >
                                    {ev.statusCode}
                                </EuiBadge>
                            )}
                        </EuiFlexItem>
                        <EuiFlexItem grow={false}>
                            {ev.durationMs != null && (
                                <EuiText size="xs" color="subdued">
                                    {Math.round(ev.durationMs)}ms
                                </EuiText>
                            )}
                        </EuiFlexItem>
                    </EuiFlexGroup>
                </EuiPanel>
            ))}
        </>
    );
}
