// WarrantyHub - central warranty registry for companies and consumers.
// Zero dependencies: Node's built-in http + crypto + fs. Data lives in data/db.json.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SESSION_DAYS = 7;

// ---------- storage ----------

function emptyDb() {
  return { users: [], products: [], units: [], claims: [], sessions: [] };
}

function loadDb() {
  if (!fs.existsSync(DB_FILE)) return emptyDb();
  return Object.assign(emptyDb(), JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
}

let db = loadDb();

function saveDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

// ---------- helpers ----------

const id = () => crypto.randomBytes(8).toString('hex');
const now = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);

function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function checkPassword(password, user) {
  const { hash } = hashPassword(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.hash, 'hex'));
}

function addMonths(dateStr, months) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

function isValidDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T00:00:00Z'));
}

const normSerial = (s) => String(s || '').trim().toUpperCase();

function publicUser(u) {
  return { id: u.id, role: u.role, name: u.name, email: u.email };
}

function warrantyStatus(unit) {
  if (!unit.activatedAt) return 'not_registered';
  return unit.expiresAt >= today() ? 'active' : 'expired';
}

// Joined view of a unit with its product/company names, safe to send to clients.
function unitView(unit, opts = {}) {
  const product = db.products.find((p) => p.id === unit.productId) || {};
  const company = db.users.find((u) => u.id === unit.companyId) || {};
  const view = {
    id: unit.id,
    serial: unit.serial,
    productName: product.name,
    productModel: product.model,
    warrantyMonths: product.warrantyMonths,
    companyName: company.name,
    purchaseDate: unit.purchaseDate || null,
    expiresAt: unit.expiresAt || null,
    status: warrantyStatus(unit),
  };
  if (opts.withOwner) {
    const owner = db.users.find((u) => u.id === unit.consumerId);
    view.ownerName = owner ? owner.name : null;
    view.ownerEmail = owner ? owner.email : null;
    view.invoiceNo = unit.invoiceNo || null;
    view.createdAt = unit.createdAt;
  }
  return view;
}

function claimView(claim) {
  const unit = db.units.find((u) => u.id === claim.unitId);
  const consumer = db.users.find((u) => u.id === claim.consumerId);
  return Object.assign({}, claim, {
    unit: unit ? unitView(unit) : null,
    consumerName: consumer ? consumer.name : null,
    consumerEmail: consumer ? consumer.email : null,
  });
}

// ---------- http plumbing ----------

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json' }, headers));
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) reject(new HttpError(413, 'Request too large'));
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new HttpError(400, 'Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function currentUser(req) {
  const token = parseCookies(req).session;
  if (!token) return null;
  const session = db.sessions.find((s) => s.token === token && s.expiresAt > now());
  if (!session) return null;
  return db.users.find((u) => u.id === session.userId) || null;
}

function requireRole(user, role) {
  if (!user) throw new HttpError(401, 'Please log in');
  if (user.role !== role) throw new HttpError(403, 'Not allowed for your account type');
}

function required(body, fields) {
  for (const f of fields) {
    if (body[f] === undefined || body[f] === null || String(body[f]).trim() === '') {
      throw new HttpError(400, `Missing field: ${f}`);
    }
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'Forbidden' });
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------- routes ----------

const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const regex = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
  routes.push({ method, regex, keys, handler });
};

// --- auth ---

route('POST', '/api/register', async (req, res, { body }) => {
  required(body, ['role', 'name', 'email', 'password']);
  if (!['company', 'consumer'].includes(body.role)) throw new HttpError(400, 'Invalid account type');
  const email = String(body.email).trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Invalid email');
  if (String(body.password).length < 6) throw new HttpError(400, 'Password must be at least 6 characters');
  if (db.users.some((u) => u.email === email)) throw new HttpError(409, 'Email already registered');

  const { salt, hash } = hashPassword(String(body.password));
  const user = { id: id(), role: body.role, name: String(body.name).trim(), email, salt, hash, createdAt: now() };
  db.users.push(user);
  return startSession(res, user);
});

route('POST', '/api/login', async (req, res, { body }) => {
  required(body, ['email', 'password']);
  const user = db.users.find((u) => u.email === String(body.email).trim().toLowerCase());
  if (!user || !checkPassword(String(body.password), user)) throw new HttpError(401, 'Wrong email or password');
  return startSession(res, user);
});

function startSession(res, user) {
  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  db.sessions = db.sessions.filter((s) => s.expiresAt > now()); // drop stale ones
  db.sessions.push({ token, userId: user.id, expiresAt });
  saveDb();
  send(res, 200, { user: publicUser(user) }, {
    'Set-Cookie': `session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`,
  });
}

route('POST', '/api/logout', async (req, res) => {
  const token = parseCookies(req).session;
  db.sessions = db.sessions.filter((s) => s.token !== token);
  saveDb();
  send(res, 200, { ok: true }, { 'Set-Cookie': 'session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
});

route('GET', '/api/me', async (req, res, { user }) => {
  send(res, 200, { user: user ? publicUser(user) : null });
});

// --- public ---

route('GET', '/api/companies', async (req, res) => {
  const companies = db.users
    .filter((u) => u.role === 'company')
    .map((u) => ({ id: u.id, name: u.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  send(res, 200, { companies });
});

route('GET', '/api/check', async (req, res, { query }) => {
  const serial = normSerial(query.get('serial'));
  const companyId = query.get('companyId');
  if (!serial || !companyId) throw new HttpError(400, 'Choose a brand and enter a serial number');
  const unit = db.units.find((u) => u.companyId === companyId && u.serial === serial);
  if (!unit) throw new HttpError(404, 'No product with that serial number was found for this brand');
  send(res, 200, { unit: unitView(unit) });
});

// --- company ---

route('GET', '/api/company/products', async (req, res, { user }) => {
  requireRole(user, 'company');
  const products = db.products
    .filter((p) => p.companyId === user.id)
    .map((p) => Object.assign({}, p, { units: db.units.filter((u) => u.productId === p.id).length }));
  send(res, 200, { products });
});

route('POST', '/api/company/products', async (req, res, { user, body }) => {
  requireRole(user, 'company');
  required(body, ['name', 'warrantyMonths']);
  const months = parseInt(body.warrantyMonths, 10);
  if (!(months >= 1 && months <= 240)) throw new HttpError(400, 'Warranty must be 1 to 240 months');
  const product = {
    id: id(),
    companyId: user.id,
    name: String(body.name).trim(),
    model: String(body.model || '').trim(),
    warrantyMonths: months,
    createdAt: now(),
  };
  db.products.push(product);
  saveDb();
  send(res, 201, { product });
});

route('DELETE', '/api/company/products/:id', async (req, res, { user, params }) => {
  requireRole(user, 'company');
  const product = db.products.find((p) => p.id === params.id && p.companyId === user.id);
  if (!product) throw new HttpError(404, 'Product not found');
  if (db.units.some((u) => u.productId === product.id)) {
    throw new HttpError(409, 'This product has serial numbers registered and cannot be deleted');
  }
  db.products = db.products.filter((p) => p !== product);
  saveDb();
  send(res, 200, { ok: true });
});

route('GET', '/api/company/units', async (req, res, { user, query }) => {
  requireRole(user, 'company');
  const q = normSerial(query.get('q'));
  const productId = query.get('productId');
  const units = db.units
    .filter((u) => u.companyId === user.id)
    .filter((u) => !productId || u.productId === productId)
    .filter((u) => !q || u.serial.includes(q))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 500)
    .map((u) => unitView(u, { withOwner: true }));
  send(res, 200, { units });
});

// Bulk add serial numbers. Accepts { productId, serials: "A1\nA2,A3" } or an array.
route('POST', '/api/company/units', async (req, res, { user, body }) => {
  requireRole(user, 'company');
  required(body, ['productId', 'serials']);
  const product = db.products.find((p) => p.id === body.productId && p.companyId === user.id);
  if (!product) throw new HttpError(404, 'Product not found');

  const list = (Array.isArray(body.serials) ? body.serials : String(body.serials).split(/[\s,;]+/))
    .map(normSerial)
    .filter(Boolean);
  if (!list.length) throw new HttpError(400, 'Enter at least one serial number');

  const existing = new Set(db.units.filter((u) => u.companyId === user.id).map((u) => u.serial));
  const added = [];
  const skipped = [];
  for (const serial of list) {
    if (existing.has(serial)) {
      skipped.push(serial);
      continue;
    }
    existing.add(serial);
    db.units.push({ id: id(), companyId: user.id, productId: product.id, serial, createdAt: now() });
    added.push(serial);
  }
  saveDb();
  send(res, 201, { added: added.length, skipped });
});

// --- consumer ---

route('GET', '/api/consumer/warranties', async (req, res, { user }) => {
  requireRole(user, 'consumer');
  const units = db.units
    .filter((u) => u.consumerId === user.id)
    .sort((a, b) => b.activatedAt.localeCompare(a.activatedAt))
    .map((u) => {
      const view = unitView(u);
      view.invoiceNo = u.invoiceNo || null;
      view.openClaim = db.claims.some((c) => c.unitId === u.id && ['open', 'in_review', 'approved'].includes(c.status));
      return view;
    });
  send(res, 200, { warranties: units });
});

route('POST', '/api/consumer/warranties', async (req, res, { user, body }) => {
  requireRole(user, 'consumer');
  required(body, ['companyId', 'serial', 'purchaseDate']);
  if (!isValidDate(body.purchaseDate)) throw new HttpError(400, 'Invalid purchase date');

  const serial = normSerial(body.serial);
  const unit = db.units.find((u) => u.companyId === body.companyId && u.serial === serial);
  if (!unit) throw new HttpError(404, 'This serial number is not registered by the selected brand');
  if (unit.consumerId === user.id) throw new HttpError(409, 'You have already registered this product');
  if (unit.consumerId) throw new HttpError(409, 'This product is already registered to another owner. Contact the brand.');

  const product = db.products.find((p) => p.id === unit.productId);
  unit.consumerId = user.id;
  unit.purchaseDate = body.purchaseDate;
  unit.expiresAt = addMonths(body.purchaseDate, product.warrantyMonths);
  unit.invoiceNo = String(body.invoiceNo || '').trim();
  unit.activatedAt = now();
  saveDb();
  send(res, 201, { warranty: unitView(unit) });
});

// ---------- server ----------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);

  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);

  const match = routes
    .map((r) => ({ r, m: r.method === req.method && pathname.match(r.regex) }))
    .find((x) => x.m);
  if (!match) return send(res, 404, { error: 'Not found' });

  try {
    const params = {};
    match.r.keys.forEach((k, i) => (params[k] = match.m[i + 1]));
    const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
    await match.r.handler(req, res, { user: currentUser(req), body, params, query: url.searchParams });
  } catch (err) {
    if (err instanceof HttpError) return send(res, err.status, { error: err.message });
    console.error(err);
    send(res, 500, { error: 'Something went wrong' });
  }
});

server.listen(PORT, () => {
  console.log(`WarrantyHub running at http://localhost:${PORT}`);
});
