// Catalog Service — products, categories, search
import express from 'express';
import cors from 'cors';
import {trace, SpanStatusCode} from '@opentelemetry/api';

const app = express();
// Allow browser to send W3C trace propagation headers directly to this service
app.use(cors({
    origin: true,
    allowedHeaders: ['Content-Type', 'traceparent', 'tracestate', 'baggage'],
    exposedHeaders: ['traceparent'],
}));
app.use(express.json());

const PORT = process.env.PORT || 3001;

const PRODUCTS = [
    {id: 'p1', name: 'Wireless Headphones', price: 79.99, category: 'electronics', stock: 42, description: 'Premium noise-cancelling headphones with 30hr battery.'},
    {id: 'p2', name: 'Running Shoes', price: 129.99, category: 'sports', stock: 15, description: 'Lightweight trail running shoes with cushioned sole.'},
    {id: 'p3', name: 'Coffee Maker', price: 54.99, category: 'home', stock: 8, description: '12-cup programmable drip coffee maker with thermal carafe.'},
    {id: 'p4', name: 'Yoga Mat', price: 34.99, category: 'sports', stock: 30, description: 'Non-slip 6mm thick eco-friendly yoga mat.'},
    {id: 'p5', name: 'Smart Watch', price: 199.99, category: 'electronics', stock: 0, description: 'GPS smartwatch with heart rate monitor and 7-day battery.'},
    {id: 'p6', name: 'Laptop Stand', price: 44.99, category: 'electronics', stock: 22, description: 'Adjustable aluminium laptop stand, 10–17 inch compatible.'},
    {id: 'p7', name: 'Protein Powder', price: 39.99, category: 'health', stock: 60, description: 'Whey protein isolate, 25g protein per serving.'},
    {id: 'p8', name: 'Mechanical Keyboard', price: 149.99, category: 'electronics', stock: 5, description: 'Tenkeyless mechanical keyboard with Cherry MX switches.'},
];

// Health check
app.get('/health', (_, res) => res.json({status: 'ok', service: 'catalog'}));

// List all products (with optional category filter)
app.get('/api/products', (req, res) => {
    const tracer = trace.getTracer('catalog-service');
    const span = tracer.startSpan('catalog.list_products');
    try {
        const {category, q} = req.query;
        let results = PRODUCTS;
        if (category) results = results.filter((p) => p.category === category);
        if (q) results = results.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));
        span.setAttribute('catalog.result_count', results.length);
        res.json({products: results, total: results.length});
    } catch (err) {
        span.recordException(err);
        span.setStatus({code: SpanStatusCode.ERROR});
        res.status(500).json({error: err.message});
    } finally {
        span.end();
    }
});

// Single product
app.get('/api/products/:id', (req, res) => {
    const product = PRODUCTS.find((p) => p.id === req.params.id);
    if (!product) return res.status(404).json({error: 'Product not found'});
    res.json(product);
});

// Simulate slow/error endpoints for RUM testing
app.get('/api/products/error/simulate', (_, res) => {
    const err = new Error('Simulated catalog server error');
    const tracer = trace.getTracer('catalog-service');
    const span = tracer.startSpan('catalog.simulate_error');
    span.recordException(err);
    span.setStatus({code: SpanStatusCode.ERROR});
    span.end();
    res.status(500).json({error: err.message});
});

app.get('/api/products/slow/simulate', async (_, res) => {
    await new Promise((r) => setTimeout(r, 3000));
    res.json({message: 'Slow response after 3s', products: PRODUCTS.slice(0, 2)});
});

app.get('/api/categories', (_, res) => {
    const cats = [...new Set(PRODUCTS.map((p) => p.category))];
    res.json({categories: cats});
});

app.listen(PORT, () => {
    console.log(`Catalog service listening on :${PORT}`);
});
