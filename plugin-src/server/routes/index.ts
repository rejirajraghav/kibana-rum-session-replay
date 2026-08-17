import {registerSessionsRoute} from './sessions';
import {registerEventsRoute} from './events';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerRoutes(router: any) {
    registerSessionsRoute(router);
    registerEventsRoute(router);
}
