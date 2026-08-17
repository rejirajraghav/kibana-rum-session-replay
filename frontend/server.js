// Frontend server — serves static files + reverse proxies backend services
import express from 'express';
import {createProxyMiddleware} from 'http-proxy-middleware';
import {fileURLToPath} from 'url';
import {dirname, join} from 'path';
import {readFileSync} from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const CATALOG_URL = process.env.CATALOG_URL || 'http://catalog-service:3001';
const ORDERS_URL = process.env.ORDERS_URL || 'http://orders-service:3002';
const COLLECTOR_URL = process.env.COLLECTOR_URL || 'http://otel-collector:4318';
const KIBANA_URL = process.env.KIBANA_URL || '';

// Inject Kibana URL into index.html
app.get('/', (req, res) => {
    res.send(
        readFileSync(join(__dirname, 'public/index.html'), 'utf8')
            .replace(
                '</head>',
                `<script>window.__KIBANA_URL__ = "${KIBANA_URL}";</script></head>`
            )
    );
});

// Proxy: OTLP collector (browser → collector — avoids CORS + auth header issue)
// NOTE: Express strips the mount prefix before the proxy sees the path,
//       so pathRewrite operates on the path AFTER the mount prefix is removed.
app.use(
    '/otlp',
    createProxyMiddleware({
        target: COLLECTOR_URL,
        changeOrigin: true,
        // After Express strips '/otlp', proxy sees '/*' — send as-is
    })
);

// Proxy: Catalog service
// Express strips '/api/catalog', proxy sees e.g. '/products'
// Include /api in the target base so no pathRewrite needed
app.use(
    '/api/catalog',
    createProxyMiddleware({
        target: `${CATALOG_URL}/api`,
        changeOrigin: true,
    })
);

// Proxy: Orders service
app.use(
    '/api/orders',
    createProxyMiddleware({
        target: `${ORDERS_URL}/api`,
        changeOrigin: true,
    })
);

// Static assets (RUM bundle, CSS, JS)
app.use(express.static(join(__dirname, 'public')));

// SPA fallback — all unknown paths → index.html
app.get('*', (req, res) => {
    res.sendFile(join(__dirname, 'public/index.html'));
});

app.listen(PORT, () => console.log(`Frontend on :${PORT}`));
