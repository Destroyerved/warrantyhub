// Fills data/db.json with demo accounts and products. Run: npm run seed
// WARNING: this replaces any existing data.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_FILE = path.join(__dirname, 'data', 'db.json');

const id = () => crypto.randomBytes(8).toString('hex');
const now = new Date().toISOString();

function user(role, name, email, password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { id: id(), role, name, email, salt, hash, createdAt: now };
}

function daysAgo(n) {
  return new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
}

function addMonths(dateStr, months) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  if (d.getUTCDate() !== day) d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

const acme = user('company', 'Acme Electronics', 'company@demo.test', 'demo123');
const kool = user('company', 'KoolAir Appliances', 'koolair@demo.test', 'demo123');
const ravi = user('consumer', 'Ravi Kumar', 'consumer@demo.test', 'demo123');

const tv = { id: id(), companyId: acme.id, name: 'Smart TV 55"', model: 'AX-55U', warrantyMonths: 24, createdAt: now };
const phone = { id: id(), companyId: acme.id, name: 'Phone Pro', model: 'AP-12', warrantyMonths: 12, createdAt: now };
const ac = { id: id(), companyId: kool.id, name: 'Split AC 1.5 Ton', model: 'KA-15S', warrantyMonths: 60, createdAt: now };

const units = [];
const addUnits = (product, prefix, count) => {
  for (let i = 1; i <= count; i++) {
    units.push({
      id: id(),
      companyId: product.companyId,
      productId: product.id,
      serial: prefix + String(i).padStart(4, '0'),
      createdAt: now,
    });
  }
};
addUnits(tv, 'TV55-', 10);
addUnits(phone, 'PH12-', 10);
addUnits(ac, 'AC15-', 5);

// Ravi owns one TV (active) and one phone (expired)
const activate = (unit, product, purchaseDate, invoiceNo) => {
  Object.assign(unit, {
    consumerId: ravi.id,
    purchaseDate,
    expiresAt: addMonths(purchaseDate, product.warrantyMonths),
    invoiceNo,
    activatedAt: now,
  });
};
const ravisTv = units.find((u) => u.serial === 'TV55-0001');
activate(ravisTv, tv, daysAgo(120), 'INV-88231');
activate(units.find((u) => u.serial === 'PH12-0003'), phone, daysAgo(500), 'INV-71002');

const claims = [
  {
    id: id(),
    ref: 'CLM-1001',
    unitId: ravisTv.id,
    companyId: acme.id,
    consumerId: ravi.id,
    issue: 'Screen shows a vertical green line on the left side after 10 minutes of use.',
    status: 'in_review',
    createdAt: now,
    updatedAt: now,
    history: [
      { at: now, by: 'consumer', status: 'open', note: 'Screen shows a vertical green line on the left side after 10 minutes of use.' },
      { at: now, by: 'company', status: 'in_review', note: 'Technician visit scheduled. Please keep the invoice ready.' },
    ],
  },
];

const db = { users: [acme, kool, ravi], products: [tv, phone, ac], units, claims, sessions: [] };
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
console.log('Demo data written to data/db.json (see README for demo logins)');
