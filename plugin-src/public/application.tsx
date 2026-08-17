import React from 'react';
import {createRoot} from 'react-dom/client';
import {Router} from 'react-router-dom';
import {EuiProvider} from '@elastic/eui';
import '@elastic/eui/dist/eui_theme_light.css';
import {AppRoutes} from './routes';

interface MountParams {
    element: HTMLElement;
    history: unknown;
}

export function renderApp(
    params: MountParams,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _core: any
): () => void {
    const root = createRoot(params.element);

    // NOTE: React Router v6 uses createBrowserRouter or useNavigate.
    // For Kibana compatibility we use the history object Kibana passes in.
    root.render(
        <EuiProvider colorMode="light">
            <App history={params.history} />
        </EuiProvider>
    );

    return () => root.unmount();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function App({history}: {history: any}) {
    return (
        <Router navigator={history} location={history.location}>
            <AppRoutes />
        </Router>
    );
}
