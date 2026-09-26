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
