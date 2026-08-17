import {RumSessionReplayServerPlugin} from './plugin';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function plugin(initializerContext: any) {
    return new RumSessionReplayServerPlugin(initializerContext);
}
