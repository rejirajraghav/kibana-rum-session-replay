/* ElasticShop — RUM Demo App */

const CATALOG_URL = 'http://localhost:3001/api';
const ORDERS_URL  = 'http://localhost:3002/api';

// ── 1. Init RUM SDK ───────────────────────────────────────────────────────────
let sdk = null;
try {
    sdk = startBrowserSdkWithReplay({
        serviceName:   'elasticshop-frontend',
        serviceVersion: '2.0.0',
        otlpEndpoint:  'http://localhost:4321',
        logLevel:      'warn',
        kibanaUrl:     window.__KIBANA_URL__ || null,
        replay: {
            samplingRate:      100,
            errorSamplingRate: 100,
            privacy: {
                maskAllInputs: true,
                maskAllText:   false,
                blockClass:    'rum-block',
                ignoreClass:   'rum-ignore',
            },
            quality: {inlineStylesheet: true, collectFonts: false},
        },
        ignoreUrls: [/\/(health|metrics)$/],
        tracePropagationTargets: [/localhost:3001/, /localhost:3002/],
    });
} catch (err) {
    console.error('[RUM] init failed:', err);
    window.__rumInitError = err;
}
window.__rum = sdk;

// ── 2. Module tracking — records which features fired this session ─────────────
const _moduleFired = {};
function _markModule(key) {
    if (!_moduleFired[key]) {
        _moduleFired[key] = {first: Date.now(), count: 0};
    }
    _moduleFired[key].count++;
    _refreshLabStatus();
}

// ── 3. State ──────────────────────────────────────────────────────────────────
let cart = JSON.parse(sessionStorage.getItem('elasticshop.cart') || '[]');
let currentUser = null;

// ── 4. Router ─────────────────────────────────────────────────────────────────
const ROUTES = {
    '/':         renderHome,
    '/home':     renderHome,
    '/products': renderProducts,
    '/cart':     renderCart,
    '/orders':   renderOrders,
    '/checkout': renderCheckout,
    '/lab':      renderLab,
};

function navigate(path) {
    history.pushState({}, '', path);
    render();
}
window.navigate = navigate;

function render() {
    let path = window.location.pathname;
    // Redirect bare '/' to '/home' so the initial load emits a route_change span
    // with a real path, making the user journey diagram correctly show home on the left.
    if (path === '/') {
        history.replaceState({}, '', '/home');
        path = '/home';
    }
    (ROUTES[path] || renderHome)();
    updateCartBadge();
    updateNavUser();
    updateRumSessionInfo();
    highlightNavLink(path);
}

window.addEventListener('popstate', render);
document.querySelector('.nav-links').addEventListener('click', (e) => {
    const link = e.target.closest('a[data-route]');
    if (link) { e.preventDefault(); navigate(link.getAttribute('href')); }
});

function highlightNavLink(path) {
    document.querySelectorAll('.nav-links a').forEach((a) => {
        a.classList.toggle('active', a.getAttribute('href') === path);
    });
}

// ── 5. Pages ──────────────────────────────────────────────────────────────────
function renderHome() {
    sdk?.addAction('page.view', {'page.name': 'home'});
    _markModule('actions');
    document.getElementById('app').innerHTML = `
    <div class="hero">
        <div class="hero-eyebrow">Elastic EDOT RUM · Full Observability Demo</div>
        <h1 class="hero-title">ElasticShop</h1>
        <p class="hero-sub">Every click, page view, error, and network call is captured and sent to your Elastic cluster. Open the <strong>Test Lab</strong> to exercise each SDK module.</p>
        <div class="hero-actions">
            <button class="btn btn-primary btn-lg" onclick="navigate('/products')">Browse Products</button>
            <button class="btn btn-outline btn-lg" onclick="navigate('/lab')">Open Test Lab 🔬</button>
        </div>
    </div>
    <div class="features-grid">
        ${featureCard('🎬', 'Session Replay', 'Full rrweb recording. Open the player at localhost:3003 to watch any session.', 'replay')}
        ${featureCard('📡', 'Distributed Traces', 'W3C traceparent injected into all fetch/XHR calls. Trace flows from browser to catalog-service and orders-service.', 'traces')}
        ${featureCard('🚨', 'Error Tracking', 'JS exceptions, console.error, and unhandled rejections with breadcrumb trail attached.', 'errors')}
        ${featureCard('📈', 'Web Vitals & Metrics', 'LCP, CLS, INP, TTFB plus custom counters and histograms emitted as OTel metrics.', 'metrics')}
        ${featureCard('👤', 'User Identity', 'setUser() tags all subsequent traces with user.id, user.email, user.name.', 'identity')}
        ${featureCard('🔒', 'Privacy Controls', 'maskAllInputs, blockClass, ignoreClass — PII stays out of replay snapshots.', 'privacy')}
    </div>`;
}

function featureCard(icon, title, desc, module) {
    const fired = _moduleFired[module];
    const badge = fired
        ? `<span class="feature-badge feature-badge-ok">✓ tested</span>`
        : `<span class="feature-badge feature-badge-idle">idle</span>`;
    return `<div class="feature-card">
        <div class="feature-icon">${icon}</div>
        <div class="feature-title">${title} ${badge}</div>
        <div class="feature-desc">${desc}</div>
    </div>`;
}

async function renderProducts() {
    sdk?.addAction('page.view', {'page.name': 'products'});
    _markModule('actions');
    const app = document.getElementById('app');
    app.innerHTML = `
    <div class="page-header">
        <h2>Products</h2>
        <div class="filter-bar">
            <input id="search-input" type="text" placeholder="Search…">
            <select id="cat-filter"><option value="">All Categories</option></select>
        </div>
    </div>
    <div id="products-grid" class="card-grid"><div class="loading-state">⏳ Loading products…</div></div>`;

    try {
        const [prodRes, catRes] = await Promise.all([
            fetch(`${CATALOG_URL}/products`),
            fetch(`${CATALOG_URL}/categories`),
        ]);
        const {products} = await prodRes.json();
        const {categories} = await catRes.json();
        _markModule('traces');

        const catFilter = document.getElementById('cat-filter');
        categories.forEach((c) => {
            const o = document.createElement('option');
            o.value = c; o.textContent = c[0].toUpperCase() + c.slice(1);
            catFilter.appendChild(o);
        });

        function display(list) {
            document.getElementById('products-grid').innerHTML = list.length
                ? list.map(productCard).join('')
                : '<div class="empty-state">No products found</div>';
        }

        let _searchTimer = null;
        function filter() {
            const q = document.getElementById('search-input').value.toLowerCase();
            const cat = document.getElementById('cat-filter').value;
            const results = products.filter((p) =>
                (!q || p.name.toLowerCase().includes(q)) && (!cat || p.category === cat));
            display(results);
            return {q, cat, count: results.length};
        }

        document.getElementById('search-input').addEventListener('input', () => {
            const {q, cat, count} = filter();
            // Debounce: emit action 600ms after user stops typing
            clearTimeout(_searchTimer);
            if (q) {
                _searchTimer = setTimeout(() => {
                    sdk?.addAction('product.search', {
                        'search.query': q,
                        'search.results': count,
                        'search.category_filter': cat || 'all',
                    });
                    _markModule('actions');
                }, 600);
            }
        });

        document.getElementById('cat-filter').addEventListener('change', () => {
            const {q, cat, count} = filter();
            sdk?.addAction('product.filter', {
                'filter.category': cat || 'all',
                'filter.results': count,
                'search.query': q || '',
            });
            _markModule('actions');
        });
        display(products);
    } catch (err) {
        sdk?.recordException(err, {'page.name': 'products'});
        _markModule('errors');
        app.querySelector('#products-grid').innerHTML =
            `<div class="alert alert-error">Failed to load products: ${err.message}</div>`;
    }
}

function productCard(p) {
    const emojis = {electronics:'🎧', sports:'👟', home:'☕', health:'💪', books:'📚'};
    const stockClass = p.stock === 0 ? 'stock-out' : p.stock < 10 ? 'stock-low' : 'stock-ok';
    const stockText  = p.stock === 0 ? 'Out of stock' : p.stock < 10 ? `Only ${p.stock} left` : `In stock`;
    return `<div class="product-card">
        <div class="product-img">${emojis[p.category] || '📦'}</div>
        <div class="product-body">
            <div class="product-name">${p.name}</div>
            <div class="product-category">${p.category}</div>
            <div class="product-price">$${p.price.toFixed(2)}</div>
            <div class="product-stock ${stockClass}">${stockText}</div>
            <div class="product-actions">
                <button class="btn btn-primary btn-sm" onclick="addToCart('${p.id}','${escHtml(p.name)}',${p.price})" ${p.stock===0?'disabled':''}>Add to Cart</button>
                <button class="btn btn-outline btn-sm" onclick="viewProduct('${p.id}')">Details</button>
            </div>
        </div>
    </div>`;
}

function renderCart() {
    sdk?.addAction('page.view', {'page.name': 'cart'});
    const app = document.getElementById('app');
    if (!cart.length) {
        app.innerHTML = `<div class="empty-page">
            <div class="empty-icon">🛒</div>
            <h3>Your cart is empty</h3>
            <button class="btn btn-primary" onclick="navigate('/products')">Browse Products</button>
        </div>`;
        return;
    }
    const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
    app.innerHTML = `
    <div class="page-header"><h2>Shopping Cart</h2></div>
    <div class="cart-layout">
        <div class="cart-items-list">
            ${cart.map((i) => `
            <div class="cart-row">
                <div class="cart-row-name">${i.name}</div>
                <div class="cart-row-controls">
                    <button class="qty-btn" onclick="changeQty('${i.id}',-1)">−</button>
                    <span class="qty-val">${i.qty}</span>
                    <button class="qty-btn" onclick="changeQty('${i.id}',1)">+</button>
                </div>
                <div class="cart-row-price">$${(i.price * i.qty).toFixed(2)}</div>
                <button class="btn btn-sm btn-danger" onclick="removeFromCart('${i.id}')">✕</button>
            </div>`).join('')}
        </div>
        <div class="cart-summary-card">
            <h3>Order Summary</h3>
            <div class="summary-row"><span>Subtotal</span><span>$${total.toFixed(2)}</span></div>
            <div class="summary-row"><span>Shipping</span><span class="text-success">Free</span></div>
            <div class="summary-total"><span>Total</span><span>$${total.toFixed(2)}</span></div>
            <button class="btn btn-primary btn-block" onclick="navigate('/checkout')">Checkout →</button>
            <button class="btn btn-outline btn-block" style="margin-top:.5rem" onclick="clearCart()">Clear Cart</button>
        </div>
    </div>`;
}

function renderCheckout() {
    sdk?.addAction('page.view', {'page.name': 'checkout'});
    const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
    document.getElementById('app').innerHTML = `
    <div class="page-header"><h2>Checkout</h2></div>
    <div class="checkout-layout">
        <div class="checkout-form-card">
            <h3>Payment Details</h3>
            <div class="form-group">
                <label>Email</label>
                <input type="email" id="co-email" placeholder="you@example.com" value="${currentUser?.email || ''}">
            </div>
            <div class="form-group">
                <label>Card Number <span class="label-hint">(masked in replay)</span></label>
                <input type="text" id="co-card" placeholder="4111 1111 1111 1111" maxlength="19">
            </div>
            <div class="form-group">
                <label>CVV <span class="label-hint">(masked in replay)</span></label>
                <input type="password" id="co-cvv" placeholder="•••" maxlength="4">
            </div>
            <div id="co-msg"></div>
            <div class="checkout-actions">
                <button class="btn btn-primary btn-block" onclick="placeOrder(false)">Place Order ($${total.toFixed(2)})</button>
                <button class="btn btn-danger btn-block" onclick="placeOrder(true)" style="margin-top:.5rem">💥 Simulate Failed Payment</button>
            </div>
        </div>
        <div class="checkout-summary-card">
            <h3>Order Summary</h3>
            ${cart.map((i) => `<div class="summary-row"><span>${i.name} ×${i.qty}</span><span>$${(i.price*i.qty).toFixed(2)}</span></div>`).join('')}
            <div class="summary-total"><span>Total</span><span>$${total.toFixed(2)}</span></div>
        </div>
    </div>`;
}

async function renderOrders() {
    sdk?.addAction('page.view', {'page.name': 'orders'});
    const app = document.getElementById('app');
    app.innerHTML = `<div class="loading-state">⏳ Loading orders…</div>`;
    try {
        const userId = currentUser?.id || 'guest';
        const res    = await fetch(`${ORDERS_URL}/orders?userId=${userId}`);
        const {orders} = await res.json();
        _markModule('traces');
        if (!orders.length) {
            app.innerHTML = `<div class="empty-page">
                <div class="empty-icon">📋</div>
                <h3>No orders yet</h3>
                <button class="btn btn-primary" onclick="navigate('/products')">Start Shopping</button>
            </div>`;
            return;
        }
        app.innerHTML = `<div class="page-header"><h2>My Orders</h2></div>` +
            orders.map((o) => `
            <div class="order-card">
                <div class="order-header">
                    <div>
                        <div class="order-id">#${o.id}</div>
                        <div class="order-date">${new Date(o.createdAt).toLocaleDateString()}</div>
                    </div>
                    <div class="order-right">
                        <span class="status-badge status-${o.status}">${o.status}</span>
                        <div class="order-total">$${o.total}</div>
                    </div>
                </div>
                <div class="order-items">${o.items.map((i) => `${i.name} ×${i.qty}`).join(' · ')}</div>
            </div>`).join('');
    } catch (err) {
        sdk?.recordException(err, {'page.name': 'orders'});
        _markModule('errors');
        app.innerHTML = `<div class="alert alert-error">Failed to load orders: ${err.message}</div>`;
    }
}

// ── Test Lab Page ─────────────────────────────────────────────────────────────
function renderLab() {
    sdk?.addAction('page.view', {'page.name': 'lab'});
    document.getElementById('app').innerHTML = `
    <div class="page-header">
        <h2>🔬 RUM Test Lab</h2>
        <p class="page-sub">Each card exercises a specific SDK module. Results are visible in the Elastic player and your cluster.</p>
    </div>
    <div class="lab-grid" id="lab-grid">${buildLabCards()}</div>
    <div class="lab-log-section">
        <div class="lab-log-header">
            <span>📋 Session Event Log</span>
            <button class="btn btn-sm btn-outline" onclick="clearLabLog()">Clear</button>
        </div>
        <div id="lab-log" class="lab-log"></div>
    </div>`;
}

function buildLabCards() {
    const modules = [
        {
            id: 'errors', icon: '💥', title: 'Error Tracking',
            desc: 'JS exceptions + breadcrumb trail → OTel LogRecord with exception event. Tests error-utils.js + actions.js.',
            actions: [
                {label: 'JS Error (try/catch)', fn: 'triggerJsError()', cls: 'danger'},
                {label: 'Unhandled Rejection', fn: 'triggerUnhandledRejection()', cls: 'danger'},
                {label: 'Failed Checkout', fn: 'triggerFailedCheckout()', cls: 'danger'},
            ],
        },
        {
            id: 'console', icon: '🔴', title: 'Console Capture',
            desc: 'Wraps console.error/warn/info/debug → OTel LogRecords via elastic.rum.console scope.',
            actions: [
                {label: 'console.error', fn: 'triggerConsoleError()', cls: 'danger'},
                {label: 'console.warn', fn: 'triggerConsoleWarn()', cls: 'warning'},
                {label: 'console.info', fn: 'triggerConsoleInfo()', cls: 'primary'},
            ],
        },
        {
            id: 'network', icon: '📡', title: 'Network Traces',
            desc: 'Fetch/XHR → OTel spans with W3C traceparent injected. Traces flow from browser → catalog-service/orders-service.',
            actions: [
                {label: 'Fetch Products', fn: 'triggerFetch()', cls: 'primary'},
                {label: 'Slow API (3s)', fn: 'triggerSlowRequest()', cls: 'warning'},
                {label: 'Network Error 500', fn: 'triggerNetworkError()', cls: 'danger'},
                {label: 'XHR Request', fn: 'triggerXHR()', cls: 'primary'},
                {label: 'Parallel Fetch ×3', fn: 'triggerParallelRequests()', cls: 'primary'},
            ],
        },
        {
            id: 'replay', icon: '🎬', title: 'Session Replay',
            desc: 'rrweb records DOM mutations → OTel LogRecords (scope: elastic-rrweb) → logs-rum.replay-default.',
            actions: [
                {label: 'Pause Recording', fn: 'sdk?.pauseReplay(); logLab("replay", "Replay paused")', cls: 'warning'},
                {label: 'Resume Recording', fn: 'sdk?.resumeReplay(); logLab("replay", "Replay resumed + full snapshot")', cls: 'success'},
            ],
        },
        {
            id: 'identity', icon: '👤', title: 'User Identity',
            desc: 'setUser() merges user.id/email/name into global span attrs via PageContextSpanProcessor.',
            actions: [
                {label: 'Set Demo User', fn: 'triggerSetUser()', cls: 'success'},
                {label: 'Set PII User', fn: 'triggerSetPiiUser()', cls: 'warning'},
                {label: 'Clear User', fn: 'triggerClearUser()', cls: 'outline'},
            ],
        },
        {
            id: 'actions', icon: '🎯', title: 'Custom Actions',
            desc: 'addAction() emits zero-duration INTERNAL spans. incrementCounter() updates OTel metrics.',
            actions: [
                {label: 'Add Action', fn: 'triggerCustomAction()', cls: 'primary'},
                {label: 'Increment Counter', fn: 'triggerCounter()', cls: 'primary'},
                {label: 'Record Metric', fn: 'triggerMetric()', cls: 'primary'},
            ],
        },
        {
            id: 'navigation', icon: '🗺️', title: 'Route Tracking',
            desc: 'pushState/replaceState/popstate → navigation.route_change spans with page.url + navigation.type.',
            actions: [
                {label: '→ Products', fn: "navigate('/products')", cls: 'primary'},
                {label: '→ Cart', fn: "navigate('/cart')", cls: 'primary'},
                {label: 'Hash Change', fn: 'triggerHashChange()', cls: 'primary'},
            ],
        },
        {
            id: 'breadcrumbs', icon: '🍞', title: 'Breadcrumbs',
            desc: '50-entry circular buffer. Attached as JSON string on every recordException call.',
            actions: [
                {label: 'Add Breadcrumb', fn: 'triggerAddBreadcrumb()', cls: 'primary'},
                {label: 'Show Breadcrumbs', fn: 'triggerShowBreadcrumbs()', cls: 'outline'},
                {label: 'Error with Trail', fn: 'triggerErrorWithBreadcrumbs()', cls: 'danger'},
            ],
        },
        {
            id: 'privacy', icon: '🔒', title: 'Privacy & Masking',
            desc: 'maskAllInputs=true, blockClass, ignoreClass. These fields are masked in the replay recording.',
            actions: [],
            extra: `
            <div class="privacy-demo">
                <input type="password" placeholder="🔒 Password — masked in replay" class="privacy-input">
                <input type="email" placeholder="📧 Email — masked in replay" class="privacy-input">
                <div class="rum-block privacy-blocked">🚫 This block is excluded from replay (rum-block)</div>
                <div class="rum-ignore privacy-ignored">👁 This element is ignored (rum-ignore)</div>
            </div>`,
        },
        {
            id: 'lifecycle', icon: '♻️', title: 'Lifecycle Handlers',
            desc: 'visibilitychange + pagehide → forceFlush(). Ensures no telemetry is lost on tab close.',
            actions: [
                {label: 'Force Flush Now', fn: 'triggerForceFlush()', cls: 'primary'},
            ],
        },
    ];

    return modules.map((m) => {
        const fired = _moduleFired[m.id];
        const statusClass = fired ? 'module-status-ok' : 'module-status-idle';
        const statusText  = fired ? `✓ ${fired.count}×` : '○ idle';
        const btns = m.actions.map((a) =>
            `<button class="btn btn-sm btn-${a.cls}" onclick="${a.fn}; _markModule('${m.id}'); logLab('${m.id}', '${a.label}')">${a.label}</button>`
        ).join('');
        return `<div class="module-card" id="module-${m.id}">
            <div class="module-card-header">
                <span class="module-icon">${m.icon}</span>
                <span class="module-title">${m.title}</span>
                <span class="module-status ${statusClass}" id="status-${m.id}">${statusText}</span>
            </div>
            <div class="module-desc">${m.desc}</div>
            <div class="module-actions">${btns}</div>
            ${m.extra || ''}
        </div>`;
    }).join('');
}

function _refreshLabStatus() {
    Object.keys(_moduleFired).forEach((id) => {
        const el = document.getElementById(`status-${id}`);
        if (!el) return;
        const f = _moduleFired[id];
        el.textContent = `✓ ${f.count}×`;
        el.className = 'module-status module-status-ok';
    });
}

const _labLog = [];
window.logLab = (module, action) => {
    _labLog.unshift({ts: Date.now(), module, action});
    if (_labLog.length > 50) _labLog.pop();
    const el = document.getElementById('lab-log');
    if (!el) return;
    el.innerHTML = _labLog.slice(0, 20).map((e) => `
        <div class="lab-log-row">
            <span class="lab-log-ts">${new Date(e.ts).toLocaleTimeString()}</span>
            <span class="lab-log-module">${e.module}</span>
            <span class="lab-log-action">${e.action}</span>
        </div>`).join('');
};

window.clearLabLog = () => {
    _labLog.length = 0;
    const el = document.getElementById('lab-log');
    if (el) el.innerHTML = '';
};

// ── 6. Cart operations ────────────────────────────────────────────────────────
window.addToCart = (id, name, price) => {
    const ex = cart.find((i) => i.id === id);
    if (ex) ex.qty++; else cart.push({id, name, price, qty: 1});
    saveCart();
    sdk?.addAction('cart.add_item', {'product.id': id, 'product.name': name, 'product.price': price});
    _markModule('actions');
    updateCartBadge();
    showToast(`${name} added to cart`, 'success');
};

window.removeFromCart = (id) => {
    cart = cart.filter((i) => i.id !== id);
    saveCart(); renderCart();
};

window.changeQty = (id, delta) => {
    const item = cart.find((i) => i.id === id);
    if (!item) return;
    item.qty = Math.max(1, item.qty + delta);
    saveCart(); renderCart();
};

window.clearCart = () => { cart = []; saveCart(); renderCart(); };

window.viewProduct = async (id) => {
    sdk?.addAction('product.view', {'product.id': id});
    _markModule('actions');
    try {
        const res = await fetch(`${CATALOG_URL}/products/${id}`);
        const p   = await res.json();
        _markModule('traces');
        showToast(`${p.name} — $${p.price}`, 'info');
    } catch (err) { sdk?.recordException(err); }
};

window.placeOrder = async (simulateFail = false) => {
    const email = document.getElementById('co-email')?.value;
    const msg   = document.getElementById('co-msg');
    if (!cart.length) return;

    if (simulateFail) {
        // Deliberate JS error — triggers error sampling
        sdk?.addBreadcrumb('checkout', 'Payment initiated (will fail)');
        try {
            const badRef = null;
            badRef.processPayment(); // TypeError
        } catch (err) {
            sdk?.recordException(err, {'test.scenario': 'failed_payment', 'page.name': 'checkout'});
            _markModule('errors');
            if (msg) msg.innerHTML = `<div class="alert alert-error">💥 Payment failed: ${err.message} <small>(captured by RUM)</small></div>`;
        }
        return;
    }

    if (msg) msg.innerHTML = '<div class="alert alert-info">Processing…</div>';
    try {
        const res = await fetch(`${ORDERS_URL}/orders`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({items: cart, userId: currentUser?.id || 'guest', email}),
        });
        if (!res.ok) throw new Error(await res.text());
        const order = await res.json();
        sdk?.addAction('order.placed', {'order.id': order.id, 'order.total': order.total});
        sdk?.incrementCounter('orders.placed');
        _markModule('actions');
        cart = []; saveCart();
        if (msg) msg.innerHTML = `<div class="alert alert-success">✓ Order confirmed — #${order.id}</div>`;
        setTimeout(() => navigate('/orders'), 1500);
    } catch (err) {
        sdk?.recordException(err, {'page.name': 'checkout'});
        _markModule('errors');
        if (msg) msg.innerHTML = `<div class="alert alert-error">Order failed: ${err.message}</div>`;
    }
};

function saveCart() {
    sessionStorage.setItem('elasticshop.cart', JSON.stringify(cart));
}

// ── 7. Auth ───────────────────────────────────────────────────────────────────
document.getElementById('btn-login').addEventListener('click', showLoginModal);

function showLoginModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal">
        <div class="modal-header">
            <h3>Login</h3>
            <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
        </div>
        <div class="form-group"><label>User ID</label><input id="li-id" value="user-123"></div>
        <div class="form-group"><label>Email</label><input type="email" id="li-email" value="demo@example.com"></div>
        <div class="form-group"><label>Name</label><input id="li-name" value="Demo User"></div>
        <div class="form-group"><label>Password <span class="label-hint">(masked in replay)</span></label>
            <input type="password" id="li-pass" placeholder="••••••••"></div>
        <div class="modal-footer">
            <button class="btn btn-primary" onclick="doLogin()">Login</button>
            <button class="btn btn-outline" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
        </div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

window.doLogin = () => {
    const id    = document.getElementById('li-id').value;
    const email = document.getElementById('li-email').value;
    const name  = document.getElementById('li-name').value;
    currentUser = {id, email, name};
    sdk?.setUser({id, email, name});
    sdk?.addAction('user.login', {'user.id': id});
    _markModule('identity');
    document.querySelector('.modal-overlay')?.remove();
    updateNavUser();
    showToast(`Logged in as ${name}`, 'success');
};

function updateNavUser() {
    const el = document.getElementById('nav-user');
    if (currentUser) {
        el.innerHTML = `<span class="nav-username">👤 ${currentUser.name}</span>
            <button class="btn btn-sm btn-outline" onclick="doLogout()">Logout</button>`;
    } else {
        el.innerHTML = `<button id="btn-login" class="btn btn-sm btn-outline">Login</button>`;
        document.getElementById('btn-login').addEventListener('click', showLoginModal);
    }
}

window.doLogout = () => {
    sdk?.addAction('user.logout', {'user.id': currentUser?.id});
    sdk?.clearUser?.();
    currentUser = null;
    updateNavUser();
    showToast('Logged out');
};

// ── 8. Test Triggers ──────────────────────────────────────────────────────────
window.triggerJsError = () => {
    sdk?.addBreadcrumb('test', 'About to throw JS error');
    try { null.cannotCallOnNull(); } catch (err) {
        sdk?.recordException(err, {'test.scenario': 'js_error'});
        _markModule('errors');
        showToast('JS Error captured → check Elastic', 'error');
    }
};

window.triggerUnhandledRejection = () => {
    Promise.reject(new Error('Unhandled rejection — captured by RUM error sampling'));
    _markModule('errors');
    showToast('Promise rejection fired', 'error');
};

window.triggerFailedCheckout = () => {
    sdk?.addBreadcrumb('checkout', 'Payment initiated (simulated failure)');
    try { null.processPayment(); } catch (err) {
        sdk?.recordException(err, {'test.scenario': 'failed_payment'});
        _markModule('errors');
        showToast('💥 Failed payment captured by RUM', 'error');
    }
};

window.triggerConsoleError = () => {
    console.error('RUM Test: console.error captured', {userId: currentUser?.id, page: location.pathname});
    _markModule('console');
    showToast('console.error sent to Elastic', 'error');
};

window.triggerConsoleWarn = () => {
    console.warn('RUM Test: console.warn — degraded performance detected');
    _markModule('console');
    showToast('console.warn sent to Elastic', 'warning');
};

window.triggerConsoleInfo = () => {
    console.info('RUM Test: console.info — feature flag enabled');
    _markModule('console');
    showToast('console.info sent to Elastic', 'info');
};

window.triggerFetch = async () => {
    const res = await fetch(`${CATALOG_URL}/products`);
    const d   = await res.json();
    _markModule('traces');
    showToast(`Fetch OK — ${d.products?.length || 0} products`, 'success');
};

window.triggerSlowRequest = async () => {
    showToast('Slow request sent (3s)…', 'info');
    try {
        await fetch(`${CATALOG_URL}/products/slow/simulate`);
        _markModule('traces');
        showToast('Slow request complete — check traces', 'success');
    } catch (err) {
        sdk?.recordException(err, {'test.scenario': 'slow_request'});
    }
};

window.triggerNetworkError = async () => {
    try {
        const res = await fetch(`${CATALOG_URL}/products/error/simulate`);
        _markModule('traces');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
        sdk?.recordException(err, {'test.scenario': 'network_error'});
        _markModule('errors');
    }
    showToast('Network error fired — check traces', 'error');
};

window.triggerXHR = () => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', `${CATALOG_URL}/products`);
    xhr.onload = () => { _markModule('traces'); showToast(`XHR done — status ${xhr.status}`, 'success'); };
    xhr.onerror = () => showToast('XHR error', 'error');
    xhr.send();
};

window.triggerParallelRequests = async () => {
    showToast('Sending 3 parallel requests…', 'info');
    await Promise.all([
        fetch(`${CATALOG_URL}/products`),
        fetch(`${CATALOG_URL}/categories`),
        fetch(`${ORDERS_URL}/orders?userId=guest`),
    ]);
    _markModule('traces');
    showToast('3 parallel requests done — check trace waterfall', 'success');
};

window.triggerHashChange = () => {
    window.location.hash = '#section-' + Math.random().toString(36).slice(2, 6);
    _markModule('navigation');
    showToast('Hash changed → route_change span emitted', 'info');
};

window.triggerSetUser = () => {
    const user = {id: 'user-123', email: 'demo@example.com', name: 'Demo User'};
    currentUser = user; sdk?.setUser(user); updateNavUser();
    _markModule('identity');
    showToast('User identity set — check spans for user.id', 'success');
};

window.triggerSetPiiUser = () => {
    const user = {id: 'pii-001', email: 'pii@example.com', name: 'PII Test User'};
    currentUser = user; sdk?.setUser(user); updateNavUser();
    _markModule('identity');
    showToast('PII User set — password field is masked in replay', 'warning');
};

window.triggerClearUser = () => {
    sdk?.clearUser?.(); currentUser = null; updateNavUser();
    showToast('User cleared — spans will have no user.* attrs', 'info');
};

window.triggerCustomAction = () => {
    sdk?.addAction('custom.demo_action', {'test.value': Math.random().toFixed(4), 'test.ts': Date.now()});
    _markModule('actions');
    showToast('Custom action span emitted', 'success');
};

window.triggerCounter = () => {
    sdk?.incrementCounter('demo.clicks');
    _markModule('actions');
    showToast('Counter incremented → check metrics', 'success');
};

window.triggerMetric = () => {
    sdk?.recordMetric('demo.response_time', Math.round(Math.random() * 500 + 50));
    _markModule('actions');
    showToast('Metric recorded → check metrics index', 'success');
};

window.triggerAddBreadcrumb = () => {
    sdk?.addBreadcrumb('test', 'Manual breadcrumb', {value: Math.random().toFixed(3)});
    _markModule('breadcrumbs');
    showToast('Breadcrumb added to ring buffer', 'info');
};

window.triggerShowBreadcrumbs = () => {
    const crumbs = sdk?.getBreadcrumbs?.() || [];
    console.info('[RUM] Breadcrumbs:', crumbs);
    showToast(`${crumbs.length} breadcrumbs in buffer — see console`, 'info');
};

window.triggerErrorWithBreadcrumbs = () => {
    sdk?.addBreadcrumb('test', 'Step 1 — page visited');
    sdk?.addBreadcrumb('test', 'Step 2 — button clicked');
    sdk?.addBreadcrumb('test', 'Step 3 — about to error');
    try { undefined.badAccess(); } catch (err) {
        sdk?.recordException(err, {'test.scenario': 'error_with_breadcrumbs'});
        _markModule('errors'); _markModule('breadcrumbs');
        showToast('Error + breadcrumb trail captured', 'error');
    }
};

window.triggerForceFlush = async () => {
    showToast('Flushing all pending telemetry…', 'info');
    await sdk?.forceFlush?.();
    _markModule('lifecycle');
    showToast('forceFlush complete', 'success');
};

// ── RUM Panel ─────────────────────────────────────────────────────────────────
window.switchRumTab = (name, btn) => {
    document.querySelectorAll('.rum-tab-content').forEach((el) => el.classList.remove('active'));
    document.querySelectorAll('.rum-tab').forEach((el) => el.classList.remove('active'));
    document.getElementById(`rum-tab-${name}`)?.classList.add('active');
    btn.classList.add('active');
    if (name === 'session') updateRumSessionInfo();
};

document.getElementById('rum-panel-toggle').addEventListener('click', () => {
    const panel = document.getElementById('rum-panel');
    const arrow = document.getElementById('rum-panel-arrow');
    panel.classList.toggle('collapsed');
    if (arrow) arrow.textContent = panel.classList.contains('collapsed') ? '◀' : '▶';
});

function updateRumSessionInfo() {
    const el = document.getElementById('rum-session-info');
    if (!el) return;
    if (!sdk) {
        el.innerHTML = `<div class="alert alert-error">SDK init failed</div>`;
        return;
    }
    const user = sdk.getUser?.() || {};
    const sid  = sdk.sessionId || '—';
    el.innerHTML = `
    <table class="session-table">
        <tr><td>session.id</td><td><code>${sid.slice(0,8)}…</code>
            <button class="copy-btn" onclick="copyId('${sid}')">⧉</button></td></tr>
        ${user.id    ? `<tr><td>user.id</td><td><code>${user.id}</code></td></tr>` : ''}
        ${user.email ? `<tr><td>user.email</td><td><code>${user.email}</code></td></tr>` : ''}
        ${user.name  ? `<tr><td>user.name</td><td>${user.name}</td></tr>` : ''}
        <tr><td>page.url</td><td><code>${location.pathname}</code></td></tr>
    </table>`;
    _updateSessionBadge(sid);
}

function _updateSessionBadge(sid) {
    const el = document.getElementById('nav-session-badge');
    if (el) { el.textContent = sid.slice(0, 8) + '…'; el.title = sid; }
}

// ── UI Helpers ────────────────────────────────────────────────────────────────
function updateCartBadge() {
    const total = cart.reduce((s, i) => s + i.qty, 0);
    const el = document.getElementById('cart-count');
    if (el) { el.textContent = total; el.classList.toggle('badge-hidden', total === 0); }
}

function showToast(msg, type = 'info') {
    const toast = document.getElementById('rum-toast');
    if (!toast) return;
    const icons = {info: 'ℹ', error: '✕', warning: '⚠', success: '✓'};
    toast.className = `rum-toast rum-toast-${type}`;
    toast.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ'}</span>${msg}`;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toast.classList.add('hidden'), 3500);
}

function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

window.copyId = (val) => {
    navigator.clipboard.writeText(val).then(() => showToast('Copied', 'success'));
};

// ── Boot ──────────────────────────────────────────────────────────────────────
render();
setTimeout(updateRumSessionInfo, 300);
