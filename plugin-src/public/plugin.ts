import {PLUGIN_ID, PLUGIN_NAME} from '../common/constants';

// Kibana core types — use any for standalone plugin compatibility
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CoreSetup = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CoreStart = any;

export class RumSessionReplayPlugin {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(private readonly initializerContext: any) {}

    setup(core: CoreSetup) {
        core.application.register({
            id: PLUGIN_ID,
            title: PLUGIN_NAME,
            euiIconType: 'videoPlayer',
            category: {
                id: 'observability',
                label: 'Observability',
                order: 1000,
            },
            async mount(params: {element: HTMLElement; history: unknown}) {
                // Lazy-load the React app only when the user navigates to it
                const {renderApp} = await import('./application');
                return renderApp(params, core);
            },
        });

        // Register nav menu entry under Observability
        // NOTE: navigation plugin API differs across Kibana versions;
        // the app is always accessible via /app/rumSessionReplay regardless.
        try {
            // Kibana 8.8+ deep links pattern
            core.getStartServices().then(([coreStart]: [CoreStart]) => {
                // nav link is auto-registered via application.register above
                void coreStart;
            });
        } catch (_) {}
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    start(_core: CoreStart) {}

    stop() {}
}
