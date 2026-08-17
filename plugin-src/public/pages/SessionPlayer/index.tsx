import React, {useState} from 'react';
import {useParams, useNavigate} from 'react-router-dom';
import {
    EuiPage,
    EuiPageBody,
    EuiPageHeader,
    EuiPageSection,
    EuiFlexGroup,
    EuiFlexItem,
    EuiButtonEmpty,
    EuiLoadingSpinner,
    EuiCallOut,
    EuiSplitPanel,
} from '@elastic/eui';
import {PlayerPanel} from './PlayerPanel';
import {MetadataPanel} from './MetadataPanel';
import {useSessionEvents} from './useSessionEvents';

export function SessionPlayerPage() {
    const {sessionId} = useParams<{sessionId: string}>();
    const navigate = useNavigate();
    const {events, metadata, loading, error} = useSessionEvents(sessionId ?? '');
    const [seekTo, setSeekTo] = useState<number | undefined>(undefined);

    const durationMs = metadata
        ? new Date(metadata.endTime).getTime() - new Date(metadata.startTime).getTime()
        : 0;

    const errorOffsets = metadata?.errors.map((e) => e.offsetMs) ?? [];

    if (loading) {
        return (
            <EuiPage paddingSize="l">
                <EuiPageBody>
                    <div style={{display: 'flex', justifyContent: 'center', paddingTop: 120}}>
                        <EuiLoadingSpinner size="xl" />
                    </div>
                </EuiPageBody>
            </EuiPage>
        );
    }

    if (error) {
        return (
            <EuiPage paddingSize="l">
                <EuiPageBody>
                    <EuiCallOut title="Failed to load session" color="danger" iconType="error">
                        {error}
                    </EuiCallOut>
                </EuiPageBody>
            </EuiPage>
        );
    }

    return (
        <EuiPage paddingSize="l">
            <EuiPageBody>
                <EuiPageHeader
                    pageTitle={
                        sessionId
                            ? `Session: ${sessionId.slice(0, 8)}…`
                            : 'Session Player'
                    }
                    leftSideItems={[
                        <EuiButtonEmpty
                            key="back"
                            iconType="arrowLeft"
                            onClick={() => navigate('/')}
                        >
                            All Sessions
                        </EuiButtonEmpty>,
                    ]}
                    rightSideItems={
                        metadata?.errors && metadata.errors.length > 0
                            ? [
                                  <EuiCallOut
                                      key="err"
                                      color="danger"
                                      size="s"
                                      iconType="error"
                                      title={`${metadata.errors.length} error${metadata.errors.length > 1 ? 's' : ''} in this session`}
                                  />,
                              ]
                            : []
                    }
                />

                <EuiPageSection>
                    <EuiSplitPanel.Outer direction="row" style={{minHeight: 640}}>
                        {/* Left: metadata, pages, errors */}
                        <EuiSplitPanel.Inner
                            style={{width: 320, minWidth: 280, maxWidth: 400, overflowY: 'auto'}}
                        >
                            {metadata && (
                                <MetadataPanel
                                    metadata={metadata}
                                    onSeek={(ms) => setSeekTo(ms)}
                                />
                            )}
                        </EuiSplitPanel.Inner>

                        {/* Right: rrweb player */}
                        <EuiSplitPanel.Inner grow>
                            {events.length > 0 ? (
                                <PlayerPanel
                                    events={events}
                                    durationMs={durationMs}
                                    errorOffsets={errorOffsets}
                                    seekTo={seekTo}
                                />
                            ) : (
                                <EuiCallOut
                                    title="No replay events found"
                                    color="warning"
                                    iconType="warning"
                                >
                                    This session has no rrweb recording data. The session may have
                                    been outside the replay sampling rate.
                                </EuiCallOut>
                            )}
                        </EuiSplitPanel.Inner>
                    </EuiSplitPanel.Outer>
                </EuiPageSection>
            </EuiPageBody>
        </EuiPage>
    );
}
