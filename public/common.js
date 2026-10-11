// Shared helpers for every page.

async function api(path, options = {}) {
  const opts = { method: options.method || 'GET', headers: {} };
  if (options.body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(options.body);
  }
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !options.allow401) location.href = '/';
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value.length === 10 ? value + 'T00:00:00' : value);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDateTime(value) {
  return new Date(value).toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function daysBetween(from, to) {
  return Math.round((new Date(to + 'T00:00:00') - new Date(from + 'T00:00:00')) / 864e5);
}

function todayStr() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

const STATUS_LABELS = {
  active: 'Active',
  expired: 'Expired',
  not_registered: 'Not registered',
  open: 'Open',
  in_review: 'In review',
  approved: 'Approved',
  rejected: 'Rejected',
  resolved: 'Resolved',
};

function badge(status) {
  return `<span class="badge ${esc(status)}">${esc(STATUS_LABELS[status] || status)}</span>`;
}

// Warranty time left as a progress bar + label.
function coverageBar(w) {
  if (!w.purchaseDate) return '';
  const total = daysBetween(w.purchaseDate, w.expiresAt);
  const left = daysBetween(todayStr(), w.expiresAt);
  const pct = Math.max(0, Math.min(100, (left / total) * 100));
  const cls = left < 0 ? 'done' : left <= 30 ? 'low' : '';
  const label = left < 0 ? `Expired ${-left} days ago` : left === 0 ? 'Expires today' : `${left} days left`;
  return `<div class="progress ${cls}"><div style="width:${pct}%"></div></div><div class="small muted">${label}</div>`;
}

let toastTimer;
function toast(message, type) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.className = 'show' + (type === 'error' ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), 3000);
}

function formToObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}

// Runs an async submit handler with the button disabled and errors shown as a toast.
function onSubmit(form, handler) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    if (btn) btn.disabled = true;
    try {
      await handler(formToObject(form), form);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

// Makes sure someone of the right role is logged in, otherwise sends them home.
async function requireLogin(role) {
  const { user } = await api('/api/me');
  if (!user || user.role !== role) {
    location.href = '/';
    return new Promise(() => {}); // stop the caller while the page navigates
  }
  document.querySelectorAll('[data-user-name]').forEach((el) => (el.textContent = user.name));
  return user;
}

async function logout() {
  await api('/api/logout', { method: 'POST' });
  location.href = '/';
}

// Simple hash-based tabs: <nav class="tabs"><a href="#x">  +  <section data-tab="x">
function setupTabs(onChange) {
  const show = () => {
    const links = [...document.querySelectorAll('.tabs a')];
    const name = location.hash.slice(1) || links[0].getAttribute('href').slice(1);
    links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + name));
    document.querySelectorAll('[data-tab]').forEach((s) => s.classList.toggle('hidden', s.dataset.tab !== name));
    if (onChange) onChange(name);
  };
  window.addEventListener('hashchange', show);
  show();
}

async function loadCompanyOptions(select) {
  const { companies } = await api('/api/companies');
  select.innerHTML =
    '<option value="">Select brand…</option>' +
    companies.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
}
