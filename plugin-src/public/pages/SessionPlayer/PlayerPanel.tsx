import React, {useEffect, useRef, useState} from 'react';
import {
    EuiPanel,
    EuiFlexGroup,
    EuiFlexItem,
    EuiButtonIcon,
    EuiRange,
    EuiSelect,
    EuiText,
    EuiLoadingSpinner,
    EuiCallOut,
} from '@elastic/eui';
import type {ReplayEvent} from '../../../common/types';

// NOTE: rrweb 1.1.3 — must match the SDK version exactly.
// Replayer is the core class; we do NOT use rrweb-player package to avoid
// version mismatch. We build our own controls instead.
import {Replayer} from 'rrweb';

interface Props {
    events: ReplayEvent[];
    // Duration in ms — used for timeline scrubber
    durationMs: number;
    // Error timestamps as offsets from session start (ms)
    errorOffsets: number[];
    // External seek — when user clicks an error in the sidebar
    seekTo?: number;
}

const SPEED_OPTIONS = [
    {value: '0.5', text: '0.5×'},
    {value: '1', text: '1×'},
    {value: '2', text: '2×'},
    {value: '4', text: '4×'},
];

function formatMs(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

export function PlayerPanel({events, durationMs, errorOffsets, seekTo}: Props) {
    const containerRef = useRef<HTMLDivElement>(null);
    const replayerRef = useRef<Replayer | null>(null);
    const [playing, setPlaying] = useState(false);
    const [currentMs, setCurrentMs] = useState(0);
    const [speed, setSpeed] = useState('1');
    const [ready, setReady] = useState(false);
    const [initError, setInitError] = useState<string | null>(null);

    // Initialise Replayer once events are loaded
    useEffect(() => {
        if (!containerRef.current || events.length === 0) return;

        // Destroy previous instance if re-mounting
        if (replayerRef.current) {
            try {
                replayerRef.current.destroy();
            } catch (_) {}
            replayerRef.current = null;
        }
        setReady(false);
        setInitError(null);
        setCurrentMs(0);
        setPlaying(false);

        try {
            // rrweb Replayer expects raw event objects (already parsed from JSON)
            const replayer = new Replayer(
                events.map((e) => e.data),
                {
                    root: containerRef.current,
                    speed: Number(speed),
                    skipInactive: true,
                    showWarning: false,
                    showDebug: false,
                }
            );

            // Track position for scrubber
            replayer.on('event-cast', (e: {timestamp: number}) => {
                const sessionStart = events[0]?.timestamp ?? 0;
                setCurrentMs(e.timestamp - sessionStart);
            });

            replayer.on('finish', () => {
                setPlaying(false);
            });

            replayerRef.current = replayer;
            setReady(true);
        } catch (err) {
            setInitError(String(err));
        }

        return () => {
            if (replayerRef.current) {
                try {
                    replayerRef.current.destroy();
                } catch (_) {}
                replayerRef.current = null;
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [events]);

    // Respond to external seek (error click in sidebar)
    useEffect(() => {
        if (!ready || seekTo == null || !replayerRef.current) return;
        try {
            replayerRef.current.pause(seekTo);
            setCurrentMs(seekTo);
            setPlaying(false);
        } catch (_) {}
    }, [seekTo, ready]);

    const handlePlayPause = () => {
        if (!replayerRef.current) return;
        if (playing) {
            replayerRef.current.pause();
        } else {
            replayerRef.current.play(currentMs);
        }
        setPlaying((p) => !p);
    };

    const handleSpeedChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const v = e.target.value;
        setSpeed(v);
        if (replayerRef.current) {
            replayerRef.current.setConfig({speed: Number(v)});
        }
    };

    const handleScrubberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const ms = Number(e.target.value);
        setCurrentMs(ms);
        if (replayerRef.current) {
            replayerRef.current.pause(ms);
            setPlaying(false);
        }
    };

    if (initError) {
        return (
            <EuiCallOut title="Player failed to initialise" color="danger" iconType="error">
                {initError}
            </EuiCallOut>
        );
    }

    return (
        <EuiPanel hasShadow paddingSize="s">
            {/* rrweb mounts its iframe here */}
            <div
                ref={containerRef}
                style={{
                    width: '100%',
                    minHeight: 480,
                    background: '#f5f7fa',
                    borderRadius: 4,
                    overflow: 'hidden',
                    position: 'relative',
                }}
            >
                {!ready && events.length > 0 && (
                    <div style={{display: 'flex', justifyContent: 'center', paddingTop: 200}}>
                        <EuiLoadingSpinner size="xl" />
                    </div>
                )}
            </div>

            {/* Controls */}
            <div style={{marginTop: 12}}>
                {/* Scrubber with error markers */}
                <div style={{position: 'relative'}}>
                    <EuiRange
                        min={0}
                        max={durationMs || 1}
                        value={currentMs}
                        onChange={handleScrubberChange}
                        disabled={!ready}
                        fullWidth
                        showInput={false}
                        compressed
                    />
                    {/* Red error markers on the timeline */}
                    {errorOffsets.map((offset, i) => (
                        <div
                            key={i}
                            title={`Error at ${formatMs(offset)}`}
                            style={{
                                position: 'absolute',
                                left: `${(offset / (durationMs || 1)) * 100}%`,
                                top: 0,
                                width: 4,
                                height: '100%',
                                background: '#BD271E',
                                borderRadius: 2,
                                cursor: 'pointer',
                                pointerEvents: 'all',
                            }}
                            onClick={() => {
                                if (replayerRef.current) {
                                    replayerRef.current.pause(offset);
                                    setCurrentMs(offset);
                                    setPlaying(false);
                                }
                            }}
                        />
                    ))}
                </div>

                <EuiFlexGroup alignItems="center" gutterSize="s">
                    <EuiFlexItem grow={false}>
                        <EuiButtonIcon
                            iconType={playing ? 'pause' : 'playFilled'}
                            aria-label={playing ? 'Pause' : 'Play'}
                            onClick={handlePlayPause}
                            disabled={!ready}
                            size="m"
                        />
                    </EuiFlexItem>
                    <EuiFlexItem grow={false}>
                        <EuiText size="s">
                            {formatMs(currentMs)} / {formatMs(durationMs)}
                        </EuiText>
                    </EuiFlexItem>
                    <EuiFlexItem grow={false}>
                        <EuiSelect
                            options={SPEED_OPTIONS}
                            value={speed}
                            onChange={handleSpeedChange}
                            disabled={!ready}
                            compressed
                        />
                    </EuiFlexItem>
                </EuiFlexGroup>
            </div>
        </EuiPanel>
    );
}
