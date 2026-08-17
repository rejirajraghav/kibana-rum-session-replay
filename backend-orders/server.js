// Orders Service — cart, checkout, order history
import express from 'express';
import cors from 'cors';
import {trace, SpanStatusCode, context, propagation} from '@opentelemetry/api';

const app = express();
// Allow browser to send W3C trace propagation headers directly to this service
app.use(cors({
    origin: true,
    allowedHeaders: ['Content-Type', 'traceparent', 'tracestate', 'baggage'],
    exposedHeaders: ['traceparent'],
}));
app.use(express.json());

const PORT = process.env.PORT || 3002;
const CATALOG_URL = process.env.CATALOG_URL || 'http://catalog-service:3001';

// In-memory order store (demo only)
const orders = new Map();

app.get('/health', (_, res) => res.json({status: 'ok', service: 'orders'}));

// Create order / checkout
app.post('/api/orders', async (req, res) => {
    const tracer = trace.getTracer('orders-service');
    const span = tracer.startSpan('orders.create');
    try {
        const {items, userId, email} = req.body;
        if (!items || items.length === 0) {
            throw new Error('Order must contain at least one item');
        }

        // Normalise item shape — frontend sends {id, name, price, qty}
        const normItems = items.map((i) => ({
            ...i,
            productId: i.productId ?? i.id,
        }));
        span.setAttribute('order.item_count', normItems.length);
        span.setAttribute('order.user_id', userId ?? 'guest');

        // Real HTTP call to catalog-service — OTel HTTP instrumentation propagates traceparent
        const catalogRes = await fetch(`${CATALOG_URL}/api/products`);
        if (!catalogRes.ok) throw new Error('Catalog service unavailable');
        const {products: catalog} = await catalogRes.json();
        const catalogMap = Object.fromEntries(catalog.map((p) => [p.id, p]));
        for (const item of normItems) {
            if (!catalogMap[item.productId]) {
                throw new Error(`Product ${item.productId} not found`);
            }
            span.setAttribute(`order.product.${item.productId}`, item.qty);
        }

        // Simulate payment processing delay
        await new Promise((r) => setTimeout(r, 200));

        const orderId = `ord-${Date.now()}`;
        const total = normItems.reduce((s, i) => s + i.price * i.qty, 0);
        const order = {
            id: orderId,
            userId: userId ?? 'guest',
            email,
            items: normItems,
            total: parseFloat(total.toFixed(2)),
            status: 'confirmed',
            createdAt: new Date().toISOString(),
        };
        orders.set(orderId, order);

        span.setAttribute('order.id', orderId);
        span.setAttribute('order.total', order.total);
        res.status(201).json(order);
    } catch (err) {
        span.recordException(err);
        span.setStatus({code: SpanStatusCode.ERROR});
        res.status(400).json({error: err.message});
    } finally {
        span.end();
    }
});

// List orders for a user
app.get('/api/orders', (req, res) => {
    const {userId} = req.query;
    const result = [...orders.values()].filter(
        (o) => !userId || o.userId === userId
    );
    res.json({orders: result, total: result.length});
});

// Single order
app.get('/api/orders/:id', (req, res) => {
    const order = orders.get(req.params.id);
    if (!order) return res.status(404).json({error: 'Order not found'});
    res.json(order);
});

// Simulate order failure for RUM testing
app.post('/api/orders/error/simulate', (_, res) => {
    const tracer = trace.getTracer('orders-service');
    const span = tracer.startSpan('orders.simulate_error');
    const err = new Error('Payment gateway timeout');
    span.recordException(err);
    span.setStatus({code: SpanStatusCode.ERROR});
    span.end();
    res.status(503).json({error: err.message});
});

app.listen(PORT, () => {
    console.log(`Orders service listening on :${PORT}`);
});
