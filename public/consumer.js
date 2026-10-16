// Consumer dashboard

let warranties = [];

// ---------- warranties ----------

function warrantyCard(w) {
  const canClaim = w.status === 'active' && !w.openClaim;
  return `<div class="card w-card" style="margin:0">
    <div class="w-head">
      <div>
        <div class="w-title">${esc(w.productName)}</div>
        <div class="small muted">${esc(w.companyName)}${w.productModel ? ' · ' + esc(w.productModel) : ''}</div>
      </div>
      ${badge(w.status)}
    </div>
    <dl class="w-meta">
      <dt>Serial</dt><dd class="mono">${esc(w.serial)}</dd>
      <dt>Purchased</dt><dd>${fmtDate(w.purchaseDate)}</dd>
      <dt>Valid until</dt><dd>${fmtDate(w.expiresAt)}</dd>
      <dt>Invoice</dt><dd>${esc(w.invoiceNo) || '—'}</dd>
    </dl>
    ${coverageBar(w)}
    <div style="margin-top:14px">
      ${canClaim ? `<button class="btn secondary small" data-claim="${esc(w.id)}">File a claim</button>` : ''}
      ${w.openClaim ? '<a class="small" href="#claims">Claim in progress →</a>' : ''}
    </div>
  </div>`;
}

async function loadWarranties() {
  ({ warranties } = await api('/api/consumer/warranties'));
  document.getElementById('warrantyList').innerHTML = warranties.length
    ? warranties.map(warrantyCard).join('')
    : '<div class="card empty" style="grid-column:1/-1">No products yet. Register your first one above.</div>';

  const claimable = warranties.filter((w) => w.status === 'active' && !w.openClaim);
  document.getElementById('cUnit').innerHTML = claimable.length
    ? '<option value="">Select product…</option>' +
      claimable.map((w) => `<option value="${esc(w.id)}">${esc(w.productName)} — ${esc(w.serial)}</option>`).join('')
    : '<option value="">No products with active cover</option>';
}

onSubmit(document.getElementById('registerForm'), async (data, form) => {
  await api('/api/consumer/warranties', { method: 'POST', body: data });
  form.reset();
  toast('Warranty activated');
  loadWarranties();
});

document.getElementById('warrantyList').addEventListener('click', (e) => {
  const unitId = e.target.dataset.claim;
  if (!unitId) return;
  location.hash = 'claims';
  document.getElementById('cUnit').value = unitId;
  document.getElementById('cIssue').focus();
});

// ---------- claims ----------

function claimCard(c) {
  return `<div class="card claim">
    <div class="row between">
      <div>
        <span class="mono">${esc(c.ref)}</span> · <strong>${esc(c.unit.productName)}</strong>
        <span class="muted">· ${esc(c.unit.companyName)}</span>
      </div>
      ${badge(c.status)}
    </div>
    <div class="claim-issue">${esc(c.issue)}</div>
    <ul class="timeline">
      ${c.history.map((h) => `<li>
        <strong>${esc(STATUS_LABELS[h.status])}</strong>
        <span class="muted">· ${h.by === 'company' ? esc(c.unit.companyName) : 'You'} · ${fmtDateTime(h.at)}</span>
        ${h.note && h.by === 'company' ? `<div>${esc(h.note)}</div>` : ''}
      </li>`).join('')}
    </ul>
  </div>`;
}

async function loadClaims() {
  const { claims } = await api('/api/consumer/claims');
  document.getElementById('claimList').innerHTML = claims.length
    ? claims.map(claimCard).join('')
    : '<div class="card empty">You haven\'t filed any claims.</div>';
}

onSubmit(document.getElementById('claimForm'), async (data, form) => {
  await api('/api/consumer/claims', { method: 'POST', body: data });
  form.reset();
  toast('Claim submitted');
  await loadWarranties();
  loadClaims();
});

// ---------- start ----------

requireLogin('consumer').then(async () => {
  await Promise.all([loadCompanyOptions(document.getElementById('rCompany')), loadWarranties()]);
  setupTabs((tab) => {
    if (tab === 'warranties') loadWarranties();
    if (tab === 'claims') loadClaims();
  });
});
