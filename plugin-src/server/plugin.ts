import {registerRoutes} from './routes';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CoreSetup = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CoreStart = any;

export class RumSessionReplayServerPlugin {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(private readonly initializerContext: any) {}

    setup(core: CoreSetup) {
        const router = core.http.createRouter();
        registerRoutes(router);
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    start(_core: CoreStart) {}

    stop() {}
}
