'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const client = require('prom-client');

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const ALLOW_TEST_RESET = process.env.ALLOW_TEST_RESET === '1';

const CATEGORIES = [
  { id: 'coffee', name: 'Кофе' },
  { id: 'tea', name: 'Чай' },
  { id: 'gear', name: 'Аксессуары' },
  { id: 'sweets', name: 'Сладости' },
  { id: 'gifts', name: 'Подарки' },
];

const DELIVERY_PRICE = 300;
const FREE_DELIVERY_FROM = 3000;
const PROMO = {
  SALE10: { type: 'percent', value: 10, min: 0, title: 'Скидка 10 %' },
  WELCOME500: { type: 'fixed', value: 500, min: 2000, title: 'Скидка 500 ₽ на заказ от 2000 ₽' },
};

// ---------- хранилище ----------

function seedProducts() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'products.json'), 'utf8'));
}

function freshDb() {
  return { products: seedProducts(), users: [], orders: [], nextUserId: 1, nextOrderId: 1001 };
}

function loadDb() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    return freshDb();
  }
}

let db = loadDb();
const sessions = new Map(); // sid -> { userId, cart: {productId: qty}, promo }

function saveDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

// ---------- метрики ----------

const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

const httpRequests = new client.Counter({
  name: 'http_requests_total',
  help: 'Количество HTTP-запросов',
  labelNames: ['method', 'route', 'status'],
  registers: [registry],
});
const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Длительность HTTP-запросов',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [registry],
});
const ordersTotal = new client.Counter({
  name: 'shop_orders_total',
  help: 'Количество оформленных заказов',
  labelNames: ['delivery', 'payment'],
  registers: [registry],
});
const revenueTotal = new client.Counter({
  name: 'shop_revenue_rub_total',
  help: 'Сумма оформленных заказов, руб.',
  registers: [registry],
});
const cartAdds = new client.Counter({
  name: 'shop_cart_items_added_total',
  help: 'Количество добавлений товаров в корзину',
  registers: [registry],
});
const usersRegistered = new client.Counter({
  name: 'shop_users_registered_total',
  help: 'Количество регистраций',
  registers: [registry],
});
const loginFailures = new client.Counter({
  name: 'shop_login_failures_total',
  help: 'Количество неудачных попыток входа',
  registers: [registry],
});
new client.Gauge({
  name: 'shop_active_sessions',
  help: 'Количество активных сессий',
  registers: [registry],
  collect() {
    this.set(sessions.size);
  },
});
new client.Gauge({
  name: 'shop_products_out_of_stock',
  help: 'Количество товаров, которых нет в наличии',
  registers: [registry],
  collect() {
    this.set(db.products.filter((p) => p.stock <= 0).length);
  },
});

// ---------- приложение ----------

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '100kb' }));

app.use((req, res, next) => {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const route = req.route ? req.baseUrl + req.route.path : req.path.startsWith('/api') ? 'unknown' : 'static';
    const labels = { method: req.method, route, status: res.statusCode };
    httpRequests.inc(labels);
    httpDuration.observe(labels, Number(process.hrtime.bigint() - started) / 1e9);
  });
  next();
});

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

app.use('/api', (req, res, next) => {
  let sid = parseCookies(req).sid;
  if (!sid || !sessions.has(sid)) {
    sid = crypto.randomBytes(18).toString('hex');
    sessions.set(sid, { userId: null, cart: {}, promo: null });
    res.setHeader('Set-Cookie', `sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
  }
  req.sid = sid;
  req.session = sessions.get(sid);
  req.user = req.session.userId ? db.users.find((u) => u.id === req.session.userId) || null : null;
  next();
});

const fail = (res, status, message, fields) => res.status(status).json({ error: message, fields });
const publicUser = (u) => (u ? { id: u.id, email: u.email, name: u.name } : null);

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 32).toString('hex');
}

function cartView(session) {
  const items = [];
  let subtotal = 0;
  for (const [pid, qty] of Object.entries(session.cart)) {
    const p = db.products.find((x) => x.id === Number(pid));
    if (!p) continue;
    const sum = p.price * qty;
    subtotal += sum;
    items.push({ productId: p.id, name: p.name, icon: p.icon, price: p.price, qty, sum, stock: p.stock });
  }
  let discount = 0;
  let promo = null;
  if (session.promo && PROMO[session.promo]) {
    const rule = PROMO[session.promo];
    if (subtotal >= rule.min) {
      discount = rule.type === 'percent' ? Math.round((subtotal * rule.value) / 100) : Math.min(rule.value, subtotal);
      promo = { code: session.promo, title: rule.title };
    }
  }
  const count = items.reduce((n, i) => n + i.qty, 0);
  return { items, count, subtotal, discount, promo, total: subtotal - discount };
}

function deliveryCost(method, totalAfterDiscount) {
  if (method !== 'courier') return 0;
  return totalAfterDiscount >= FREE_DELIVERY_FROM ? 0 : DELIVERY_PRICE;
}

// --- служебное ---

app.get('/api/health', (req, res) => {
  res.json({ app: 'qa-shop', status: 'ok', version: require('./package.json').version, uptime: Math.round(process.uptime()) });
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', registry.contentType);
  res.end(await registry.metrics());
});

if (ALLOW_TEST_RESET) {
  app.post('/api/test/reset', (req, res) => {
    db = freshDb();
    sessions.clear();
    saveDb();
    res.json({ ok: true });
  });
}

// --- каталог ---

app.get('/api/categories', (req, res) => res.json(CATEGORIES));

app.get('/api/products', (req, res) => {
  const { search = '', category = '', sort = '' } = req.query;
  let list = db.products.slice();
  if (category) list = list.filter((p) => p.category === category);
  const q = String(search).trim().toLowerCase();
  if (q) list = list.filter((p) => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q));
  if (sort === 'price_asc') list.sort((a, b) => a.price - b.price);
  else if (sort === 'price_desc') list.sort((a, b) => b.price - a.price);
  else if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  res.json(list);
});

app.get('/api/products/:id', (req, res) => {
  const p = db.products.find((x) => x.id === Number(req.params.id));
  if (!p) return fail(res, 404, 'Товар не найден');
  res.json(p);
});

// --- авторизация ---

app.post('/api/auth/register', (req, res) => {
  const { email, password, name } = req.body || {};
  const fields = {};
  const mail = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail)) fields.email = 'Укажите корректный e-mail';
  if (String(password || '').length < 6) fields.password = 'Пароль должен быть не короче 6 символов';
  if (String(name || '').trim().length < 2) fields.name = 'Укажите имя';
  if (Object.keys(fields).length) return fail(res, 400, 'Проверьте поля формы', fields);
  if (db.users.some((u) => u.email === mail)) {
    return fail(res, 409, 'Пользователь с таким e-mail уже зарегистрирован', { email: 'E-mail уже занят' });
  }
  const salt = crypto.randomBytes(12).toString('hex');
  const user = { id: db.nextUserId++, email: mail, name: String(name).trim(), salt, passHash: hashPassword(String(password), salt) };
  db.users.push(user);
  saveDb();
  usersRegistered.inc();
  req.session.userId = user.id;
  res.status(201).json(publicUser(user));
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const mail = String(email || '').trim().toLowerCase();
  const user = db.users.find((u) => u.email === mail);
  if (!user || hashPassword(String(password || ''), user.salt) !== user.passHash) {
    loginFailures.inc();
    return fail(res, 401, 'Неверный e-mail или пароль');
  }
  req.session.userId = user.id;
  res.json(publicUser(user));
});

app.post('/api/auth/logout', (req, res) => {
  req.session.userId = null;
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => res.json({ user: publicUser(req.user) }));

// --- корзина ---

app.get('/api/cart', (req, res) => res.json(cartView(req.session)));

app.post('/api/cart/items', (req, res) => {
  const productId = Number((req.body || {}).productId);
  const qty = Number((req.body || {}).qty || 1);
  const p = db.products.find((x) => x.id === productId);
  if (!p) return fail(res, 404, 'Товар не найден');
  if (!Number.isInteger(qty) || qty < 1) return fail(res, 400, 'Некорректное количество');
  const next = (req.session.cart[productId] || 0) + qty;
  if (next > p.stock) return fail(res, 409, p.stock > 0 ? `В наличии только ${p.stock} шт.` : 'Товара нет в наличии');
  req.session.cart[productId] = next;
  cartAdds.inc(qty);
  res.status(201).json(cartView(req.session));
});

app.patch('/api/cart/items/:productId', (req, res) => {
  const productId = Number(req.params.productId);
  const qty = Number((req.body || {}).qty);
  if (!(productId in req.session.cart)) return fail(res, 404, 'Товара нет в корзине');
  if (!Number.isInteger(qty) || qty < 0) return fail(res, 400, 'Некорректное количество');
  const p = db.products.find((x) => x.id === productId);
  if (qty === 0) delete req.session.cart[productId];
  else if (qty > p.stock) return fail(res, 409, `В наличии только ${p.stock} шт.`);
  else req.session.cart[productId] = qty;
  res.json(cartView(req.session));
});

app.delete('/api/cart/items/:productId', (req, res) => {
  delete req.session.cart[Number(req.params.productId)];
  res.json(cartView(req.session));
});

app.delete('/api/cart', (req, res) => {
  req.session.cart = {};
  req.session.promo = null;
  res.json(cartView(req.session));
});

app.post('/api/cart/promo', (req, res) => {
  const code = String((req.body || {}).code || '').trim().toUpperCase();
  if (!code) {
    req.session.promo = null;
    return res.json(cartView(req.session));
  }
  const rule = PROMO[code];
  if (!rule) return fail(res, 404, 'Промокод не найден');
  const { subtotal } = cartView(req.session);
  if (subtotal < rule.min) return fail(res, 409, `Промокод действует при заказе от ${rule.min} ₽`);
  req.session.promo = code;
  res.json(cartView(req.session));
});

// --- заказы ---

app.get('/api/delivery', (req, res) => {
  const method = req.query.method === 'pickup' ? 'pickup' : 'courier';
  const cart = cartView(req.session);
  res.json({ method, cost: deliveryCost(method, cart.total), freeFrom: FREE_DELIVERY_FROM });
});

app.post('/api/orders', (req, res) => {
  const body = req.body || {};
  const cart = cartView(req.session);
  if (!cart.items.length) return fail(res, 400, 'Корзина пуста');

  const fields = {};
  const name = String(body.name || '').trim();
  const phone = String(body.phone || '').trim();
  const address = String(body.address || '').trim();
  const delivery = body.delivery;
  const payment = body.payment;
  if (name.length < 2) fields.name = 'Укажите имя получателя';
  if (!/^\+?\d[\d\s()-]{9,15}$/.test(phone)) fields.phone = 'Укажите телефон в формате +7 900 000-00-00';
  if (!['courier', 'pickup'].includes(delivery)) fields.delivery = 'Выберите способ доставки';
  if (delivery === 'courier' && address.length < 5) fields.address = 'Укажите адрес доставки';
  if (!['card', 'cash'].includes(payment)) fields.payment = 'Выберите способ оплаты';
  if (Object.keys(fields).length) return fail(res, 400, 'Проверьте поля формы', fields);

  for (const item of cart.items) {
    if (item.qty > item.stock) return fail(res, 409, `Товара «${item.name}» осталось ${item.stock} шт.`);
  }
  for (const item of cart.items) {
    db.products.find((p) => p.id === item.productId).stock -= item.qty;
  }

  const shipping = deliveryCost(delivery, cart.total);
  const order = {
    id: db.nextOrderId++,
    userId: req.user ? req.user.id : null,
    sid: req.sid,
    createdAt: new Date().toISOString(),
    status: 'new',
    items: cart.items.map(({ productId, name: n, price, qty, sum }) => ({ productId, name: n, price, qty, sum })),
    subtotal: cart.subtotal,
    discount: cart.discount,
    promo: cart.promo ? cart.promo.code : null,
    shipping,
    total: cart.total + shipping,
    customer: { name, phone, address: delivery === 'courier' ? address : '', comment: String(body.comment || '').slice(0, 500) },
    delivery,
    payment,
  };
  db.orders.push(order);
  saveDb();
  ordersTotal.inc({ delivery, payment });
  revenueTotal.inc(order.total);
  req.session.cart = {};
  req.session.promo = null;
  const { sid, ...view } = order;
  res.status(201).json(view);
});

app.get('/api/orders', (req, res) => {
  if (!req.user) return fail(res, 401, 'Войдите, чтобы посмотреть заказы');
  const list = db.orders.filter((o) => o.userId === req.user.id).map(({ sid, ...o }) => o);
  res.json(list.reverse());
});

app.get('/api/orders/:id', (req, res) => {
  const order = db.orders.find((o) => o.id === Number(req.params.id));
  const own = order && ((req.user && order.userId === req.user.id) || order.sid === req.sid);
  if (!own) return fail(res, 404, 'Заказ не найден');
  const { sid, ...view } = order;
  res.json(view);
});

app.use('/api', (req, res) => fail(res, 404, 'Метод не найден'));

app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') return fail(res, 400, 'Некорректный JSON');
  console.error(err);
  fail(res, 500, 'Внутренняя ошибка сервера');
});

app.listen(PORT, () => {
  console.log(`qa-shop запущен на порту ${PORT}`);
});
