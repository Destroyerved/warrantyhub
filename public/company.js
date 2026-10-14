// Company dashboard

// Next steps a company can take from each claim status (mirrors CLAIM_FLOW on the server).
const NEXT_STEPS = {
  open: [['in_review', 'Start review', ''], ['rejected', 'Reject', 'danger']],
  in_review: [['approved', 'Approve', ''], ['rejected', 'Reject', 'danger']],
  approved: [['resolved', 'Mark resolved', '']],
  rejected: [],
  resolved: [],
};

let products = [];

// ---------- overview ----------

async function loadOverview() {
  const s = await api('/api/company/stats');
  const tiles = [
    ['Products', s.products],
    ['Serials registered', s.units],
    ['Active warranties', s.active],
    ['Open claims', s.openClaims],
  ];
  document.getElementById('stats').innerHTML = tiles
    .map(([label, num]) => `<div class="card stat"><div class="num">${num}</div><div class="label">${label}</div></div>`)
    .join('');

  const { claims } = await api('/api/company/claims');
  const pending = claims.filter((c) => c.status === 'open' || c.status === 'in_review').slice(0, 5);
  document.getElementById('recentClaims').innerHTML = pending.length
    ? `<div class="table-wrap"><table>
        <tr><th>Ref</th><th>Product</th><th>Customer</th><th>Raised</th><th>Status</th></tr>
        ${pending.map((c) => `<tr>
          <td class="mono">${esc(c.ref)}</td>
          <td>${esc(c.unit.productName)} <span class="muted mono">${esc(c.unit.serial)}</span></td>
          <td>${esc(c.consumerName)}</td>
          <td>${fmtDate(c.createdAt)}</td>
          <td>${badge(c.status)}</td>
        </tr>`).join('')}
      </table></div>`
    : '<div class="empty">No open claims. 🎉</div>';
}

// ---------- products ----------

async function loadProducts() {
  ({ products } = await api('/api/company/products'));

  document.getElementById('productTable').innerHTML = products.length
    ? `<table>
        <tr><th>Product</th><th>Model</th><th>Warranty</th><th>Serials</th><th></th></tr>
        ${products.map((p) => `<tr>
          <td><strong>${esc(p.name)}</strong></td>
          <td>${esc(p.model) || '<span class="muted">—</span>'}</td>
          <td>${p.warrantyMonths} months</td>
          <td>${p.units}</td>
          <td style="text-align:right">
            ${p.units ? '' : `<button class="btn danger small" data-delete="${esc(p.id)}">Delete</button>`}
          </td>
        </tr>`).join('')}
      </table>`
    : '<div class="empty">No products yet. Add your first one above.</div>';

  const options = products.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}${p.model ? ' · ' + esc(p.model) : ''}</option>`).join('');
  document.getElementById('sProduct').innerHTML = '<option value="">Select product…</option>' + options;
  document.getElementById('unitProductFilter').innerHTML = '<option value="">All products</option>' + options;
}

onSubmit(document.getElementById('productForm'), async (data, form) => {
  await api('/api/company/products', { method: 'POST', body: data });
  form.reset();
  toast('Product added');
  loadProducts();
});

document.getElementById('productTable').addEventListener('click', async (e) => {
  const pid = e.target.dataset.delete;
  if (!pid || !confirm('Delete this product?')) return;
  try {
    await api('/api/company/products/' + pid, { method: 'DELETE' });
    toast('Product deleted');
    loadProducts();
  } catch (err) {
    toast(err.message, 'error');
  }
});

// ---------- serial numbers ----------

async function loadUnits() {
  const params = new URLSearchParams({
    productId: document.getElementById('unitProductFilter').value,
    q: document.getElementById('unitSearch').value,
  });
  const { units } = await api('/api/company/units?' + params);
  document.getElementById('unitTable').innerHTML = units.length
    ? `<table>
        <tr><th>Serial</th><th>Product</th><th>Status</th><th>Owner</th><th>Purchased</th><th>Expires</th></tr>
        ${units.map((u) => `<tr>
          <td class="mono">${esc(u.serial)}</td>
          <td>${esc(u.productName)}</td>
          <td>${badge(u.status)}</td>
          <td>${u.ownerName ? esc(u.ownerName) + '<div class="small muted">' + esc(u.ownerEmail) + '</div>' : '<span class="muted">—</span>'}</td>
          <td>${fmtDate(u.purchaseDate)}</td>
          <td>${fmtDate(u.expiresAt)}</td>
        </tr>`).join('')}
      </table>`
    : '<div class="empty">No serial numbers match.</div>';
}

onSubmit(document.getElementById('serialForm'), async (data, form) => {
  const result = await api('/api/company/units', { method: 'POST', body: data });
  form.querySelector('textarea').value = '';
  const skipped = result.skipped.length ? ` · ${result.skipped.length} already existed` : '';
  toast(`${result.added} serial(s) registered${skipped}`);
  loadUnits();
});

let searchTimer;
document.getElementById('unitSearch').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadUnits, 250);
});
document.getElementById('unitProductFilter').addEventListener('change', loadUnits);

// ---------- claims ----------

function claimCard(c) {
  const actions = NEXT_STEPS[c.status];
  return `<div class="card claim">
    <div class="row between">
      <div>
        <span class="mono">${esc(c.ref)}</span> · <strong>${esc(c.unit.productName)}</strong>
        <span class="muted mono">${esc(c.unit.serial)}</span>
      </div>
      ${badge(c.status)}
    </div>
    <div class="small muted" style="margin-top:4px">
      ${esc(c.consumerName)} (${esc(c.consumerEmail)}) · raised ${fmtDate(c.createdAt)}
      · warranty until ${fmtDate(c.unit.expiresAt)}
    </div>
    <div class="claim-issue">${esc(c.issue)}</div>
    <ul class="timeline">
      ${c.history.map((h) => `<li>
        <strong>${esc(STATUS_LABELS[h.status])}</strong>
        <span class="muted">· ${h.by === 'company' ? 'You' : 'Customer'} · ${fmtDateTime(h.at)}</span>
        ${h.note && h.by === 'company' ? `<div>${esc(h.note)}</div>` : ''}
      </li>`).join('')}
    </ul>
    ${actions.length ? `<form class="claim-actions" data-claim="${esc(c.id)}">
      <div class="field">
        <label>Note to customer <span class="hint">(optional)</span></label>
        <input name="note" placeholder="e.g. Technician will visit on Monday">
      </div>
      <div class="row">
        ${actions.map(([status, label, cls]) => `<button type="button" class="btn small ${cls}" data-status="${status}">${label}</button>`).join('')}
      </div>
    </form>` : ''}
  </div>`;
}

async function loadClaims() {
  const status = document.getElementById('claimFilter').value;
  const { claims } = await api('/api/company/claims' + (status ? '?status=' + status : ''));
  document.getElementById('claimList').innerHTML = claims.length
    ? claims.map(claimCard).join('')
    : '<div class="card empty">No claims here.</div>';
}

document.getElementById('claimFilter').addEventListener('change', loadClaims);

document.getElementById('claimList').addEventListener('click', async (e) => {
  const status = e.target.dataset.status;
  if (!status) return;
  const form = e.target.closest('form');
  if (status === 'rejected' && !confirm('Reject this claim?')) return;
  e.target.disabled = true;
  try {
    await api('/api/company/claims/' + form.dataset.claim, {
      method: 'POST',
      body: { status, note: form.note.value },
    });
    toast('Claim updated');
    loadClaims();
  } catch (err) {
    toast(err.message, 'error');
    e.target.disabled = false;
  }
});

// ---------- start ----------

requireLogin('company').then(async () => {
  await loadProducts();
  setupTabs((tab) => {
    if (tab === 'overview') loadOverview();
    if (tab === 'products') loadProducts();
    if (tab === 'serials') loadUnits();
    if (tab === 'claims') loadClaims();
  });
});
