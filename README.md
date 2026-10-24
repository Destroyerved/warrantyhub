# WarrantyHub

A simple, central warranty registry for **companies** and **consumers**.
Plain HTML, CSS and JavaScript on the front, a small Node.js server on the back.
No frameworks, no build step, no npm dependencies.

## What it does

**Companies**
- Add products with a warranty period (in months)
- Register serial numbers in bulk for every unit sold
- See which units have been activated, by whom, and when cover ends
- Review warranty claims: start review → approve / reject → resolve, with notes to the customer

**Consumers**
- Activate a warranty using brand + serial number + purchase date
- See all products in one list with a countdown to expiry
- File a claim and follow its status timeline

**Anyone**
- Check the warranty status of any product by brand + serial number (no login needed, no personal data shown)

## Run it

Requires Node.js 18 or newer.

```bash
npm run seed   # optional: load demo data (replaces data/db.json)
npm start      # http://localhost:3000
```

Set `PORT` to use a different port.

### Demo logins (after `npm run seed`)

| Role     | Email                | Password |
|----------|----------------------|----------|
| Company  | company@demo.test    | demo123  |
| Company  | koolair@demo.test    | demo123  |
| Consumer | consumer@demo.test   | demo123  |

Demo serials you can activate as the consumer: `TV55-0002` … `TV55-0010`, `PH12-0001` … `PH12-0010` (Acme Electronics), `AC15-0001` … `AC15-0005` (KoolAir Appliances).

## How it works

```
server.js        HTTP server, JSON API and static file serving
seed.js          demo data
data/db.json     the database (created on first write, git-ignored)
public/
  index.html     landing page, public warranty check, log in / sign up
  company.html   company dashboard   (company.js)
  consumer.html  consumer dashboard  (consumer.js)
  common.js      shared helpers (API calls, formatting, tabs, toasts)
  style.css      all styles
```

- Passwords are hashed with scrypt and a per-user salt.
- Sessions are random tokens in an HttpOnly cookie, valid for 7 days.
- Warranty expiry = purchase date + the product's warranty months.
- A serial number belongs to one brand and can be activated by one consumer only.
- Only one open claim per product at a time, and only while the warranty is active.

### Claim flow

```
open → in_review → approved → resolved
  └──────┴──────→ rejected
```

## API

| Method | Path                          | Who      |
|--------|-------------------------------|----------|
| POST   | `/api/register`               | anyone   |
| POST   | `/api/login`                  | anyone   |
| POST   | `/api/logout`                 | anyone   |
| GET    | `/api/me`                     | anyone   |
| GET    | `/api/companies`              | anyone   |
| GET    | `/api/check?companyId=&serial=` | anyone |
| GET    | `/api/company/stats`          | company  |
| GET    | `/api/company/products`       | company  |
| POST   | `/api/company/products`       | company  |
| DELETE | `/api/company/products/:id`   | company  |
| GET    | `/api/company/units?productId=&q=` | company |
| POST   | `/api/company/units`          | company  |
| GET    | `/api/company/claims?status=` | company  |
| POST   | `/api/company/claims/:id`     | company  |
| GET    | `/api/consumer/warranties`    | consumer |
| POST   | `/api/consumer/warranties`    | consumer |
| GET    | `/api/consumer/claims`        | consumer |
| POST   | `/api/consumer/claims`        | consumer |
