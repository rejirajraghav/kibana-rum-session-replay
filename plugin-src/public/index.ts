import {RumSessionReplayPlugin} from './plugin';

// Kibana calls this function to instantiate the plugin
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function plugin(initializerContext: any) {
    return new RumSessionReplayPlugin(initializerContext);
}
