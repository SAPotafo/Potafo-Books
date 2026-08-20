/* ===================== Shared engine for Cash Book / Bank Book ===================== */

/* ============================================================================
   SUPABASE CONFIG — paste your two values from Supabase (Project Settings → API)
   ============================================================================ */
const SUPABASE_URL = 'https://xfvltefvqznwvnudsfcn.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_8gUNWnuSSKkwpcedqxmwhA_7zuug-9p';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const BOOKS = {
  cash: {
    voucherPrefix: 'CV',
    title: 'Cash Book',
    sub: 'Track cash receipts and payments across cash locations.',
    ledgerLabel: 'Cash Location',
    defaultLedgers: ['Main Cash']
  },
  bank: {
    voucherPrefix: 'BV',
    title: 'Bank Book',
    sub: 'Track bank receipts and payments across bank accounts.',
    ledgerLabel: 'Bank Account',
    defaultLedgers: ['Primary Bank A/c']
  }
};

/* ===================== Supabase helpers ===================== */
/* Every one of these talks to the database. If something goes wrong (no internet,
   wrong keys, etc.) it shows a simple alert instead of silently failing. */
async function fetchLedgers(book){
  const { data, error } = await sb.from('ledgers').select('*').eq('book', book).order('created_at', { ascending: true });
  if(error){ alert('Could not load ' + book + ' ledgers: ' + error.message); return []; }
  return data || [];
}
async function insertLedgerRow(book, name){
  const { data, error } = await sb.from('ledgers').insert({ book, name }).select().single();
  if(error){ alert('Could not create ledger: ' + error.message); return null; }
  return data;
}
async function updateLedgerRow(id, fields){
  const { error } = await sb.from('ledgers').update(fields).eq('id', id);
  if(error){ alert('Could not update ledger: ' + error.message); return false; }
  return true;
}
async function deleteLedgerRow(id){
  const { error } = await sb.from('ledgers').delete().eq('id', id);
  if(error){ alert('Could not delete ledger: ' + error.message); return false; }
  return true;
}
async function fetchEntries(book){
  const { data, error } = await sb.from('entries').select('*').eq('book', book);
  if(error){ alert('Could not load ' + book + ' entries: ' + error.message); return []; }
  return data || [];
}
async function insertEntryRow(row){
  const { data, error } = await sb.from('entries').insert(row).select().single();
  if(error){ alert('Could not save entry: ' + error.message); return null; }
  return data;
}
async function updateEntryRow(id, fields){
  const { error } = await sb.from('entries').update(fields).eq('id', id);
  if(error){ alert('Could not update entry: ' + error.message); return false; }
  return true;
}
async function deleteEntryRow(id){
  const { error } = await sb.from('entries').delete().eq('id', id);
  if(error){ alert('Could not delete entry: ' + error.message); return false; }
  return true;
}

function fmt(n){
  const v = Number(n)||0;
  return v.toLocaleString('en-IN', {minimumFractionDigits:2, maximumFractionDigits:2});
}
function todayStr(){
  return new Date().toISOString().slice(0,10);
}
function pad4(n){
  return String(n).padStart(4,'0');
}
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ===================== Particulars Autocomplete ===================== */
// Wires a "search as you type" suggestion dropdown onto a Particulars input,
// backed by the unique set of particulars already used in this book (cash/bank).
function setupParticularsAutocomplete(state, inputEl, listEl){
  let activeIndex = -1;

  function getSuggestions(query){
    const q = query.trim().toLowerCase();
    const seen = new Set();
    const list = [];
    state.entries.forEach(e => {
      const p = (e.particulars || '').trim();
      if(p && !seen.has(p.toLowerCase())){ seen.add(p.toLowerCase()); list.push(p); }
    });
    const filtered = q ? list.filter(p => p.toLowerCase().includes(q)) : list;
    filtered.sort((a,b)=>{
      const aStarts = a.toLowerCase().startsWith(q) ? 0 : 1;
      const bStarts = b.toLowerCase().startsWith(q) ? 0 : 1;
      if(aStarts !== bStarts) return aStarts - bStarts;
      return a.localeCompare(b);
    });
    return filtered.slice(0, 8);
  }

  function updateActive(items){
    items.forEach((it,i)=> it.classList.toggle('active', i === activeIndex));
    if(activeIndex >= 0) items[activeIndex].scrollIntoView({block:'nearest'});
  }

  function render(){
    const items = getSuggestions(inputEl.value);
    activeIndex = -1;
    if(!items.length){ listEl.classList.remove('open'); listEl.innerHTML = ''; return; }
    listEl.innerHTML = items.map(p => `<div class="ac-item">${escapeHtml(p)}</div>`).join('');
    listEl.classList.add('open');
  }

  inputEl.addEventListener('input', render);
  inputEl.addEventListener('focus', render);
  inputEl.addEventListener('keydown', (ev)=>{
    const items = Array.from(listEl.querySelectorAll('.ac-item'));
    if(!items.length || !listEl.classList.contains('open')) return;
    if(ev.key === 'ArrowDown'){ ev.preventDefault(); activeIndex = Math.min(activeIndex+1, items.length-1); updateActive(items); }
    else if(ev.key === 'ArrowUp'){ ev.preventDefault(); activeIndex = Math.max(activeIndex-1, 0); updateActive(items); }
    else if(ev.key === 'Enter'){ if(activeIndex >= 0){ ev.preventDefault(); inputEl.value = items[activeIndex].textContent; listEl.classList.remove('open'); } }
    else if(ev.key === 'Escape'){ listEl.classList.remove('open'); }
  });
  // mousedown (not click) so the suggestion registers before the input's blur fires
  listEl.addEventListener('mousedown', (ev)=>{
    const item = ev.target.closest('.ac-item');
    if(!item) return;
    ev.preventDefault();
    inputEl.value = item.textContent;
    listEl.classList.remove('open');
    inputEl.focus();
  });
  document.addEventListener('click', (ev)=>{
    if(!inputEl.contains(ev.target) && !listEl.contains(ev.target)){
      listEl.classList.remove('open');
    }
  });
}

/* ===================== Init (now loads from Supabase) ===================== */
async function initBook(type){
  const cfg = BOOKS[type];

  let ledgerRows = await fetchLedgers(type);
  if(!ledgerRows.length){
    const created = await insertLedgerRow(type, cfg.defaultLedgers[0]);
    if(created) ledgerRows = [created];
  }

  const ledgers = [];        // array of ledger names, same shape as before
  const ledgerIds = {};      // name -> database id (new: needed to talk to Supabase)
  const counters = {};       // name -> voucher counter
  const openingBalances = {};// name -> opening balance
  const idToName = {};
  ledgerRows.forEach(r => {
    ledgers.push(r.name);
    ledgerIds[r.name] = r.id;
    counters[r.name] = r.voucher_counter || 0;
    openingBalances[r.name] = Number(r.opening_balance) || 0;
    idToName[r.id] = r.name;
  });

  const entryRows = await fetchEntries(type);
  const entries = entryRows.map(r => ({
    id: r.id,
    ledger: idToName[r.ledger_id] || '(deleted ledger)',
    date: r.entry_date,
    txType: r.tx_type,
    particulars: r.particulars,
    ref: r.ref,
    amount: Number(r.amount)
  }));

  const state = {
    type, cfg, ledgers, ledgerIds, entries, counters, openingBalances,
    activeLedger: ledgers[0],
    txType: 'Income', // Income = money in, Expense = money out
    autoVoucher: true,
    filters: { from: '', to: '', search: '' },
  };
  renderModule(state);
  return state;
}

function nextVoucherNo(state){
  const n = (state.counters[state.activeLedger] || 0) + 1;
  return state.cfg.voucherPrefix + '-' + pad4(n);
}

function closeAllKebabs(){
  document.querySelectorAll('.kebab-menu.open').forEach(m => m.classList.remove('open'));
  document.querySelectorAll('.kebab-submenu.open').forEach(m => m.classList.remove('open'));
  document.querySelectorAll('.kebab-submenu-wrap.open').forEach(m => m.classList.remove('open'));
}
document.addEventListener('click', (ev)=>{
  if(!ev.target.closest('.kebab-wrap')) closeAllKebabs();
});

function renderModule(state){
  const mount = document.getElementById('mod-' + state.type);
  const cfg = state.cfg;
  mount.innerHTML = `
    <div class="module-title">${cfg.title}</div>
    <div class="module-sub">${cfg.sub}</div>

    <div class="ledger-manage">
      <div class="field">
        <label>${cfg.ledgerLabel}</label>
        <select id="${state.type}-ledgerSelect"></select>
      </div>
      <div class="kebab-wrap">
        <button class="kebab-btn" id="${state.type}-optionsKebabBtn" title="Options">⋮</button>
        <div class="kebab-menu" id="${state.type}-optionsKebabMenu">
          <button id="${state.type}-addLedgerBtn">New ${cfg.ledgerLabel}</button>
          <div class="divider"></div>
          <div class="kebab-submenu-wrap" id="${state.type}-ledgerSubmenuWrap">
            <button class="submenu-trigger" id="${state.type}-ledgerSubmenuTrigger">Ledger <span class="submenu-arrow">›</span></button>
            <div class="kebab-submenu" id="${state.type}-ledgerSubmenu">
              <button id="${state.type}-editLedgerBtn">Edit Ledger</button>
              <button id="${state.type}-openingBalBtn">Opening Balance</button>
              <button class="danger-item" id="${state.type}-delLedgerBtn">Delete Ledger</button>
            </div>
          </div>
          <div class="kebab-submenu-wrap" id="${state.type}-voucherSubmenuWrap">
            <button class="submenu-trigger" id="${state.type}-voucherSubmenuTrigger">Voucher <span class="submenu-arrow">›</span></button>
            <div class="kebab-submenu" id="${state.type}-voucherSubmenu">
              <button id="${state.type}-editVoucherBtn">Edit Voucher</button>
              <button class="danger-item" id="${state.type}-delVoucherBtn">Delete Voucher</button>
              <div class="divider"></div>
              <button id="${state.type}-autoVoucherToggleBtn">Auto Voucher No. <span id="${state.type}-autoVoucherStatus" class="menu-status">On</span></button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="filter-bar">
      <div class="field">
        <label>From Date</label>
        <input type="date" id="${state.type}-fromDate">
      </div>
      <div class="field">
        <label>To Date</label>
        <input type="date" id="${state.type}-toDate">
      </div>
      <div class="field grow">
        <label>Search (particulars, voucher no., amount)</label>
        <input type="text" id="${state.type}-search" placeholder="e.g. Rent, CV-0004, 1500...">
      </div>
      <button class="btn secondary" id="${state.type}-clearFilters">Clear Filters</button>
    </div>
    <div class="filter-summary" id="${state.type}-filterSummary"></div>

    <div class="stats">
      <div class="stat">
        <div class="stat-label">Opening Balance</div>
        <div class="stat-value" id="${state.type}-openBal">0.00</div>
      </div>
      <div class="stat">
        <div class="stat-label">Total Income</div>
        <div class="stat-value pos" id="${state.type}-totIncome">0.00</div>
      </div>
      <div class="stat">
        <div class="stat-label">Total Expense</div>
        <div class="stat-value neg" id="${state.type}-totExpense">0.00</div>
      </div>
      <div class="stat">
        <div class="stat-label">Closing Balance</div>
        <div class="stat-value amber" id="${state.type}-closeBal">0.00</div>
      </div>
    </div>

    <div class="toolbar">
      <div class="field">
        <label>Date</label>
        <input type="date" id="${state.type}-date" value="${todayStr()}">
      </div>
      <div class="field">
        <label>Type</label>
        <div class="btype">
          <button type="button" class="on-income" id="${state.type}-btnIncome">Income</button>
          <button type="button" id="${state.type}-btnExpense">Expense</button>
        </div>
      </div>
      <div class="field grow">
        <label>Particulars</label>
        <div class="autocomplete-wrap">
          <input type="text" id="${state.type}-particulars" placeholder="e.g. Sales, Rent, Vendor Payment..." autocomplete="off">
          <div class="autocomplete-list" id="${state.type}-particularsAC"></div>
        </div>
      </div>
      <div class="field voucher-field">
        <label>Voucher No.</label>
        <div class="voucher-wrap">
          <input type="text" id="${state.type}-ref" style="min-width:100px;">
        </div>
      </div>
      <div class="field">
        <label>Amount</label>
        <input type="number" id="${state.type}-amount" placeholder="0.00" step="0.01" min="0" style="min-width:110px;">
      </div>
      <button class="btn" id="${state.type}-addBtn">Add Entry</button>
    </div>

    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Type</th>
          <th>Particulars</th>
          <th>Voucher No.</th>
          <th class="num">Income</th>
          <th class="num">Expense</th>
          <th class="num">Balance</th>
        </tr>
      </thead>
      <tbody id="${state.type}-tbody"></tbody>
    </table>
  `;

  // wire ledger select
  const ledgerSelect = document.getElementById(state.type + '-ledgerSelect');
  refreshLedgerOptions(state, ledgerSelect);
  ledgerSelect.addEventListener('change', ()=>{
    state.activeLedger = ledgerSelect.value;
    updateVoucherField(state);
    renderTable(state);
  });

  document.getElementById(state.type + '-addLedgerBtn').addEventListener('click', ()=>{
    openAddLedgerModal(state, ledgerSelect);
  });

  // options kebab (ledger + voucher controls, single menu, with nested submenus)
  const optionsKebabBtn = document.getElementById(state.type + '-optionsKebabBtn');
  const optionsKebabMenu = document.getElementById(state.type + '-optionsKebabMenu');
  optionsKebabBtn.addEventListener('click', (ev)=>{
    ev.stopPropagation();
    const wasOpen = optionsKebabMenu.classList.contains('open');
    closeAllKebabs();
    if(!wasOpen) optionsKebabMenu.classList.add('open');
  });

  // submenu triggers: "Ledger" -> Edit/Delete Ledger, "Voucher" -> Edit/Delete Voucher + Auto Voucher
  optionsKebabMenu.querySelectorAll('.kebab-submenu-wrap').forEach(wrap=>{
    const trigger = wrap.querySelector('.submenu-trigger');
    const submenu = wrap.querySelector('.kebab-submenu');
    trigger.addEventListener('click', (ev)=>{
      ev.stopPropagation();
      const wasOpen = submenu.classList.contains('open');
      optionsKebabMenu.querySelectorAll('.kebab-submenu.open').forEach(m=>m.classList.remove('open'));
      optionsKebabMenu.querySelectorAll('.kebab-submenu-wrap.open').forEach(w=>w.classList.remove('open'));
      if(!wasOpen){ submenu.classList.add('open'); wrap.classList.add('open'); }
    });
  });

  document.getElementById(state.type + '-editLedgerBtn').addEventListener('click', ()=>{
    openEditLedgerModal(state, ledgerSelect);
  });

  document.getElementById(state.type + '-openingBalBtn').addEventListener('click', ()=>{
    openOpeningBalanceModal(state, ledgerSelect);
  });

  document.getElementById(state.type + '-delLedgerBtn').addEventListener('click', ()=>{
    openDeleteLedgerModal(state, ledgerSelect);
  });

  document.getElementById(state.type + '-editVoucherBtn').addEventListener('click', ()=>{
    closeAllKebabs();
    openSelectVoucherModal(state, 'edit');
  });
  document.getElementById(state.type + '-delVoucherBtn').addEventListener('click', ()=>{
    closeAllKebabs();
    openSelectVoucherModal(state, 'delete');
  });

  // wire type toggle
  const btnIncome = document.getElementById(state.type + '-btnIncome');
  const btnExpense = document.getElementById(state.type + '-btnExpense');
  btnIncome.addEventListener('click', ()=>{
    state.txType = 'Income';
    btnIncome.classList.add('on-income'); btnExpense.classList.remove('on-expense');
  });
  btnExpense.addEventListener('click', ()=>{
    state.txType = 'Expense';
    btnExpense.classList.add('on-expense'); btnIncome.classList.remove('on-income');
  });

  // wire auto voucher toggle (kebab menu item) — this stays a local/browser setting, not stored in the database
  const refEl = document.getElementById(state.type + '-ref');
  const autoToggleBtn = document.getElementById(state.type + '-autoVoucherToggleBtn');
  const autoStatusEl = document.getElementById(state.type + '-autoVoucherStatus');
  function refreshAutoStatus(){
    autoStatusEl.textContent = state.autoVoucher ? 'On' : 'Off';
    autoStatusEl.className = 'menu-status ' + (state.autoVoucher ? 'on' : 'off');
  }
  refreshAutoStatus();
  autoToggleBtn.addEventListener('click', ()=>{
    state.autoVoucher = !state.autoVoucher;
    refreshAutoStatus();
    updateVoucherField(state);
    closeAllKebabs();
  });

  updateVoucherField(state);

  // wire particulars autocomplete (search-as-you-type from previously used particulars)
  setupParticularsAutocomplete(
    state,
    document.getElementById(state.type + '-particulars'),
    document.getElementById(state.type + '-particularsAC')
  );

  // wire add entry
  document.getElementById(state.type + '-addBtn').addEventListener('click', ()=> addEntry(state));

  // wire filters
  const fromEl = document.getElementById(state.type + '-fromDate');
  const toEl = document.getElementById(state.type + '-toDate');
  const searchEl = document.getElementById(state.type + '-search');
  fromEl.value = state.filters.from;
  toEl.value = state.filters.to;
  searchEl.value = state.filters.search;

  fromEl.addEventListener('change', ()=>{ state.filters.from = fromEl.value; renderTable(state); });
  toEl.addEventListener('change', ()=>{ state.filters.to = toEl.value; renderTable(state); });
  searchEl.addEventListener('input', ()=>{ state.filters.search = searchEl.value; renderTable(state); });
  document.getElementById(state.type + '-clearFilters').addEventListener('click', ()=>{
    state.filters = { from: '', to: '', search: '' };
    fromEl.value = ''; toEl.value = ''; searchEl.value = '';
    renderTable(state);
  });

  renderTable(state);
}

function updateVoucherField(state){
  const refEl = document.getElementById(state.type + '-ref');
  if(!refEl) return;
  if(state.autoVoucher){
    refEl.value = nextVoucherNo(state);
    refEl.disabled = true;
  } else {
    refEl.disabled = false;
    if(refEl.value.startsWith(state.cfg.voucherPrefix + '-')){
      refEl.value = '';
    }
  }
}

function refreshLedgerOptions(state, selectEl){
  selectEl.innerHTML = state.ledgers.map(l =>
    `<option value="${escapeHtml(l)}" ${l===state.activeLedger?'selected':''}>${escapeHtml(l)}</option>`
  ).join('');
}

/* Adding an entry now writes to Supabase first (await), then updates the
   screen once the database confirms it saved. A brief "Saving..." label
   shows on the button so it's clear something is happening. */
async function addEntry(state){
  const dateEl = document.getElementById(state.type + '-date');
  const particularsEl = document.getElementById(state.type + '-particulars');
  const refEl = document.getElementById(state.type + '-ref');
  const amountEl = document.getElementById(state.type + '-amount');
  const addBtn = document.getElementById(state.type + '-addBtn');

  const date = dateEl.value || todayStr();
  const particulars = particularsEl.value.trim();
  let ref = refEl.value.trim();
  const amount = parseFloat(amountEl.value);

  if(!particulars){ alert('Enter particulars.'); particularsEl.focus(); return; }
  if(!amount || amount <= 0){ alert('Enter a valid amount.'); amountEl.focus(); return; }

  let newCounterVal = null;
  if(state.autoVoucher){
    ref = nextVoucherNo(state);
    newCounterVal = (state.counters[state.activeLedger] || 0) + 1;
  } else {
    if(!ref){ alert('Enter a voucher no., or switch Auto back on.'); refEl.focus(); return; }
    const dup = state.entries.some(e => e.ledger === state.activeLedger && e.ref === ref);
    if(dup && !confirm(`Voucher no. "${ref}" already exists in this ledger. Use it anyway?`)) return;
  }

  addBtn.disabled = true;
  addBtn.textContent = 'Saving...';

  const ledgerId = state.ledgerIds[state.activeLedger];
  const inserted = await insertEntryRow({
    book: state.type,
    ledger_id: ledgerId,
    entry_date: date,
    particulars,
    ref,
    tx_type: state.txType,
    amount
  });

  if(!inserted){
    addBtn.disabled = false;
    addBtn.textContent = 'Add Entry';
    return; // insertEntryRow already alerted the error
  }

  if(state.autoVoucher){
    state.counters[state.activeLedger] = newCounterVal;
    await updateLedgerRow(ledgerId, { voucher_counter: newCounterVal });
  }

  state.entries.push({
    id: inserted.id,
    ledger: state.activeLedger,
    date,
    txType: state.txType, // 'Income' = money in, 'Expense' = money out
    particulars,
    ref,
    amount
  });

  particularsEl.value = '';
  amountEl.value = '';
  particularsEl.focus();
  updateVoucherField(state);
  addBtn.disabled = false;
  addBtn.textContent = 'Add Entry';

  renderTable(state);
}

function deleteEntry(state, id){
  const entry = state.entries.find(e => e.id === id);
  if(!entry) return;
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-overlay" id="dvModalOverlay">
      <div class="modal">
        <h3>Delete Voucher</h3>
        <div class="modal-sub">Delete voucher "${escapeHtml(entry.ref)}" (${escapeHtml(entry.particulars)})? This cannot be undone.</div>
        <div class="modal-actions">
          <button class="btn secondary" id="dv-cancel">Cancel</button>
          <button class="btn danger-solid" id="dv-confirm">Delete</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById('dv-cancel').addEventListener('click', closeModal);
  document.getElementById('dvModalOverlay').addEventListener('click', (ev)=>{
    if(ev.target.id === 'dvModalOverlay') closeModal();
  });
  document.getElementById('dv-confirm').addEventListener('click', async ()=>{
    const ok = await deleteEntryRow(id);
    if(!ok) return;
    state.entries = state.entries.filter(e => e.id !== id);
    closeModal();
    renderTable(state);
  });
}

/* ===================== Message Modal (info-only) ===================== */
function openMessageModal(title, message){
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-overlay" id="msgModalOverlay">
      <div class="modal">
        <h3>${escapeHtml(title)}</h3>
        <div class="modal-sub">${escapeHtml(message)}</div>
        <div class="modal-actions">
          <button class="btn" id="msg-ok">OK</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById('msg-ok').addEventListener('click', closeModal);
  document.getElementById('msgModalOverlay').addEventListener('click', (ev)=>{
    if(ev.target.id === 'msgModalOverlay') closeModal();
  });
}

/* ===================== Ledger Modals (New / Edit / Delete) ===================== */
function openAddLedgerModal(state, ledgerSelect){
  closeAllKebabs();
  const cfg = state.cfg;
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-overlay" id="alModalOverlay">
      <div class="modal">
        <h3>New ${escapeHtml(cfg.ledgerLabel)}</h3>
        <div class="modal-sub">Create a new ${cfg.ledgerLabel.toLowerCase()} to track separately.</div>
        <div class="field">
          <label>${escapeHtml(cfg.ledgerLabel)} Name</label>
          <input type="text" id="al-name" placeholder="e.g. ${escapeHtml(cfg.defaultLedgers[0])}">
        </div>
        <div class="modal-actions">
          <button class="btn secondary" id="al-cancel">Cancel</button>
          <button class="btn" id="al-save">Add ${escapeHtml(cfg.ledgerLabel)}</button>
        </div>
      </div>
    </div>
  `;
  const nameEl = document.getElementById('al-name');
  nameEl.focus();
  document.getElementById('al-cancel').addEventListener('click', closeModal);
  document.getElementById('alModalOverlay').addEventListener('click', (ev)=>{
    if(ev.target.id === 'alModalOverlay') closeModal();
  });
  async function submit(){
    const trimmed = nameEl.value.trim();
    if(!trimmed){ nameEl.focus(); return; }
    if(state.ledgers.includes(trimmed)){ alert('That ledger already exists.'); return; }
    const created = await insertLedgerRow(state.type, trimmed);
    if(!created) return;
    state.ledgers.push(trimmed);
    state.ledgerIds[trimmed] = created.id;
    state.counters[trimmed] = 0;
    state.openingBalances[trimmed] = 0;
    state.activeLedger = trimmed;
    refreshLedgerOptions(state, ledgerSelect);
    updateVoucherField(state);
    renderTable(state);
    closeModal();
  }
  document.getElementById('al-save').addEventListener('click', submit);
  nameEl.addEventListener('keydown', (ev)=>{ if(ev.key === 'Enter'){ ev.preventDefault(); submit(); } });
}

function openEditLedgerModal(state, ledgerSelect){
  closeAllKebabs();
  const cfg = state.cfg;
  const oldName = state.activeLedger;
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-overlay" id="elModalOverlay">
      <div class="modal">
        <h3>Edit ${escapeHtml(cfg.ledgerLabel)}</h3>
        <div class="modal-sub">Rename "${escapeHtml(oldName)}". Existing entries and voucher numbering carry over.</div>
        <div class="field">
          <label>${escapeHtml(cfg.ledgerLabel)} Name</label>
          <input type="text" id="el-name" value="${escapeHtml(oldName)}">
        </div>
        <div class="modal-actions">
          <button class="btn secondary" id="el-cancel">Cancel</button>
          <button class="btn" id="el-save">Save Changes</button>
        </div>
      </div>
    </div>
  `;
  const nameEl = document.getElementById('el-name');
  nameEl.focus();
  nameEl.select();
  document.getElementById('el-cancel').addEventListener('click', closeModal);
  document.getElementById('elModalOverlay').addEventListener('click', (ev)=>{
    if(ev.target.id === 'elModalOverlay') closeModal();
  });
  async function submit(){
    const trimmed = nameEl.value.trim();
    if(!trimmed || trimmed === oldName){ closeModal(); return; }
    if(state.ledgers.includes(trimmed)){ alert('A ledger with that name already exists.'); return; }
    const id = state.ledgerIds[oldName];
    const ok = await updateLedgerRow(id, { name: trimmed });
    if(!ok) return;
    state.ledgers = state.ledgers.map(l => l === oldName ? trimmed : l);
    state.entries.forEach(e => { if(e.ledger === oldName) e.ledger = trimmed; });
    state.ledgerIds[trimmed] = id; delete state.ledgerIds[oldName];
    state.counters[trimmed] = state.counters[oldName]; delete state.counters[oldName];
    state.openingBalances[trimmed] = state.openingBalances[oldName]; delete state.openingBalances[oldName];
    state.activeLedger = trimmed;
    refreshLedgerOptions(state, ledgerSelect);
    updateVoucherField(state);
    renderTable(state);
    closeModal();
  }
  document.getElementById('el-save').addEventListener('click', submit);
  nameEl.addEventListener('keydown', (ev)=>{ if(ev.key === 'Enter'){ ev.preventDefault(); submit(); } });
}

function openOpeningBalanceModal(state, ledgerSelect){
  closeAllKebabs();
  const cfg = state.cfg;
  const current = state.openingBalances[state.activeLedger] || 0;
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-overlay" id="obModalOverlay">
      <div class="modal">
        <h3>Opening Balance</h3>
        <div class="modal-sub">Set the opening balance for "${escapeHtml(state.activeLedger)}". This is used as the starting point before any entries.</div>
        <div class="field">
          <label>Opening Balance</label>
          <input type="number" id="ob-amount" value="${current}" step="0.01">
        </div>
        <div class="modal-actions">
          <button class="btn secondary" id="ob-cancel">Cancel</button>
          <button class="btn" id="ob-save">Save</button>
        </div>
      </div>
    </div>
  `;
  const amountEl = document.getElementById('ob-amount');
  amountEl.focus();
  amountEl.select();
  document.getElementById('ob-cancel').addEventListener('click', closeModal);
  document.getElementById('obModalOverlay').addEventListener('click', (ev)=>{
    if(ev.target.id === 'obModalOverlay') closeModal();
  });
  async function submit(){
    const val = parseFloat(amountEl.value);
    const final = isNaN(val) ? 0 : val;
    const id = state.ledgerIds[state.activeLedger];
    const ok = await updateLedgerRow(id, { opening_balance: final });
    if(!ok) return;
    state.openingBalances[state.activeLedger] = final;
    renderTable(state);
    closeModal();
  }
  document.getElementById('ob-save').addEventListener('click', submit);
  amountEl.addEventListener('keydown', (ev)=>{ if(ev.key === 'Enter'){ ev.preventDefault(); submit(); } });
}

function openDeleteLedgerModal(state, ledgerSelect){
  closeAllKebabs();
  const cfg = state.cfg;
  if(state.ledgers.length <= 1){
    openMessageModal('Cannot Delete', 'At least one ledger must remain.');
    return;
  }
  const hasEntries = state.entries.some(e => e.ledger === state.activeLedger);
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-overlay" id="dlModalOverlay">
      <div class="modal">
        <h3>Delete ${escapeHtml(cfg.ledgerLabel)}</h3>
        <div class="modal-sub">${hasEntries
          ? `"${escapeHtml(state.activeLedger)}" has existing entries. Deleting it will remove this ledger AND all its entries. This cannot be undone.`
          : `Delete ledger "${escapeHtml(state.activeLedger)}"? This cannot be undone.`}</div>
        <div class="modal-actions">
          <button class="btn secondary" id="dl-cancel">Cancel</button>
          <button class="btn danger-solid" id="dl-confirm">Delete</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById('dl-cancel').addEventListener('click', closeModal);
  document.getElementById('dlModalOverlay').addEventListener('click', (ev)=>{
    if(ev.target.id === 'dlModalOverlay') closeModal();
  });
  document.getElementById('dl-confirm').addEventListener('click', async ()=>{
    const id = state.ledgerIds[state.activeLedger];
    // Deleting the ledger row also deletes all its entries automatically
    // (the database was set up with "on delete cascade" for this).
    const ok = await deleteLedgerRow(id);
    if(!ok) return;
    state.entries = state.entries.filter(e => e.ledger !== state.activeLedger);
    delete state.counters[state.activeLedger];
    delete state.openingBalances[state.activeLedger];
    delete state.ledgerIds[state.activeLedger];
    state.ledgers = state.ledgers.filter(l => l !== state.activeLedger);
    state.activeLedger = state.ledgers[0];
    refreshLedgerOptions(state, ledgerSelect);
    updateVoucherField(state);
    renderTable(state);
    closeModal();
  });
}

/* ===================== Edit Voucher Modal ===================== */
function closeModal(){
  document.getElementById('modal-root').innerHTML = '';
}

function openEditEntryModal(state, id){
  closeAllKebabs();
  const entry = state.entries.find(e => e.id === id);
  if(!entry) return;
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-overlay" id="editModalOverlay">
      <div class="modal">
        <h3>Edit Voucher</h3>
        <div class="modal-sub">Editing voucher no. ${escapeHtml(entry.ref)} · ${escapeHtml(entry.ledger)}</div>
        <div class="modal-row">
          <div class="field">
            <label>Date</label>
            <input type="date" id="em-date" value="${entry.date}">
          </div>
          <div class="field">
            <label>Type</label>
            <select id="em-type">
              <option value="Income" ${entry.txType==='Income'?'selected':''}>Income</option>
              <option value="Expense" ${entry.txType==='Expense'?'selected':''}>Expense</option>
            </select>
          </div>
        </div>
        <div class="field">
          <label>Particulars</label>
          <div class="autocomplete-wrap">
            <input type="text" id="em-particulars" value="${escapeHtml(entry.particulars)}" autocomplete="off">
            <div class="autocomplete-list" id="em-particularsAC"></div>
          </div>
        </div>
        <div class="modal-row">
          <div class="field">
            <label>Voucher No.</label>
            <input type="text" id="em-ref" value="${escapeHtml(entry.ref)}">
          </div>
          <div class="field">
            <label>Amount</label>
            <input type="number" id="em-amount" value="${entry.amount}" step="0.01" min="0">
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn secondary" id="em-cancel">Cancel</button>
          <button class="btn" id="em-save">Save Changes</button>
        </div>
      </div>
    </div>
  `;
  setupParticularsAutocomplete(
    state,
    document.getElementById('em-particulars'),
    document.getElementById('em-particularsAC')
  );
  document.getElementById('em-cancel').addEventListener('click', closeModal);
  document.getElementById('editModalOverlay').addEventListener('click', (ev)=>{
    if(ev.target.id === 'editModalOverlay') closeModal();
  });
  document.getElementById('em-save').addEventListener('click', async ()=>{
    const date = document.getElementById('em-date').value || entry.date;
    const txType = document.getElementById('em-type').value;
    const particulars = document.getElementById('em-particulars').value.trim();
    const ref = document.getElementById('em-ref').value.trim();
    const amount = parseFloat(document.getElementById('em-amount').value);

    if(!particulars){ alert('Enter particulars.'); return; }
    if(!ref){ alert('Enter a voucher no.'); return; }
    if(!amount || amount <= 0){ alert('Enter a valid amount.'); return; }

    const dup = state.entries.some(e => e.id !== id && e.ledger === entry.ledger && e.ref === ref);
    if(dup && !confirm(`Voucher no. "${ref}" is already used in this ledger. Save anyway?`)) return;

    const ok = await updateEntryRow(id, {
      entry_date: date,
      tx_type: txType,
      particulars,
      ref,
      amount
    });
    if(!ok) return;

    entry.date = date;
    entry.txType = txType;
    entry.particulars = particulars;
    entry.ref = ref;
    entry.amount = amount;
    closeModal();
    renderTable(state);
  });
}

function openSelectVoucherModal(state, mode){
  const root = document.getElementById('modal-root');
  const isDelete = mode === 'delete';

  function rowsForQuery(q){
    const query = (q||'').trim().toLowerCase();
    return state.entries
      .filter(e => e.ledger === state.activeLedger)
      .filter(e => !query || e.particulars.toLowerCase().includes(query) || (e.ref||'').toLowerCase().includes(query) || String(e.amount).includes(query))
      .sort((a,b)=> a.date === b.date ? 0 : (a.date < b.date ? 1 : -1));
  }

  function renderList(q){
    const list = rowsForQuery(q);
    const listEl = document.getElementById('pv-list');
    if(!list.length){
      listEl.innerHTML = `<div class="picker-empty">No vouchers found${q ? ' for that search' : ''} in "${escapeHtml(state.activeLedger)}".</div>`;
      return;
    }
    listEl.innerHTML = list.map(e => `
      <div class="picker-row ${isDelete?'picker-danger':''}" data-pick="${e.id}">
        <div class="p-left">
          <div class="p-particulars">${escapeHtml(e.particulars)}</div>
          <div class="p-meta">${e.date} · ${escapeHtml(e.ref)} · <span class="${e.txType==='Income'?'income-amt':'expense-amt'}">${e.txType}</span></div>
        </div>
        <div class="p-amount ${e.txType==='Income'?'income-amt':'expense-amt'}">${fmt(e.amount)}</div>
      </div>
    `).join('');
    listEl.querySelectorAll('[data-pick]').forEach(row=>{
      row.addEventListener('click', ()=>{
        const id = row.getAttribute('data-pick');
        closeModal();
        if(isDelete){
          deleteEntry(state, id);
        } else {
          openEditEntryModal(state, id);
        }
      });
    });
  }

  root.innerHTML = `
    <div class="modal-overlay" id="pvModalOverlay">
      <div class="modal">
        <h3>${isDelete ? 'Delete Voucher' : 'Edit Voucher'}</h3>
        <div class="modal-sub">Select a voucher from "${escapeHtml(state.activeLedger)}" to ${isDelete ? 'delete' : 'edit'}.</div>
        <div class="field">
          <label>Search</label>
          <input type="text" id="pv-search" placeholder="Particulars, voucher no., amount...">
        </div>
        <div class="picker-list" id="pv-list"></div>
        <div class="modal-actions">
          <button class="btn secondary" id="pv-cancel">Cancel</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById('pv-cancel').addEventListener('click', closeModal);
  document.getElementById('pvModalOverlay').addEventListener('click', (ev)=>{
    if(ev.target.id === 'pvModalOverlay') closeModal();
  });
  document.getElementById('pv-search').addEventListener('input', (ev)=> renderList(ev.target.value));
  renderList('');
}

function entryMatchesSearch(e, query){
  if(!query) return true;
  const q = query.trim().toLowerCase();
  if(!q) return true;
  if(e.particulars.toLowerCase().includes(q)) return true;
  if((e.ref || '').toLowerCase().includes(q)) return true;
  if(String(e.amount).includes(q)) return true;
  if(fmt(e.amount).toLowerCase().includes(q)) return true;
  return false;
}

function renderTable(state){
  const tbody = document.getElementById(state.type + '-tbody');
  const summaryEl = document.getElementById(state.type + '-filterSummary');

  // Full chronological sequence for this ledger — running balance is computed
  // over the FULL sequence (starting from the ledger's opening balance) so it
  // always reflects the true ledger balance, independent of which rows are
  // currently filtered into view.
  const openingBal = state.openingBalances[state.activeLedger] || 0;
  const allRows = state.entries
    .filter(e => e.ledger === state.activeLedger)
    .sort((a,b)=> a.date === b.date ? 0 : (a.date < b.date ? -1 : 1));

  let running = openingBal;
  const withBalance = allRows.map(e => {
    const income = e.txType === 'Income' ? e.amount : 0;
    const expense = e.txType === 'Expense' ? e.amount : 0;
    running += income - expense;
    return { ...e, income, expense, balance: running };
  });

  const { from, to, search } = state.filters;
  const visible = withBalance.filter(e => {
    if(from && e.date < from) return false;
    if(to && e.date > to) return false;
    if(!entryMatchesSearch(e, search)) return false;
    return true;
  });

  // filter summary chips
  const chips = [];
  if(from) chips.push({label:`From ${from}`, clear:()=>{ state.filters.from=''; }});
  if(to) chips.push({label:`To ${to}`, clear:()=>{ state.filters.to=''; }});
  if(search) chips.push({label:`Search "${search}"`, clear:()=>{ state.filters.search=''; }});
  if(chips.length){
    summaryEl.innerHTML = `Showing ${visible.length} of ${allRows.length} entries &nbsp; ` +
      chips.map((c,i)=>`<span class="chip">${escapeHtml(c.label)}<button data-chip="${i}">✕</button></span>`).join('');
    summaryEl.querySelectorAll('[data-chip]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        chips[Number(btn.getAttribute('data-chip'))].clear();
        const fromEl = document.getElementById(state.type + '-fromDate');
        const toEl = document.getElementById(state.type + '-toDate');
        const searchEl = document.getElementById(state.type + '-search');
        fromEl.value = state.filters.from; toEl.value = state.filters.to; searchEl.value = state.filters.search;
        renderTable(state);
      });
    });
  } else {
    summaryEl.innerHTML = '';
  }

  if(!visible.length){
    const msg = allRows.length
      ? `No entries match the current filters for "${escapeHtml(state.activeLedger)}".`
      : `No entries yet for "${escapeHtml(state.activeLedger)}". Add one above.`;
    tbody.innerHTML = `<tr><td colspan="7" class="empty">${msg}</td></tr>`;
  } else {
    tbody.innerHTML = visible.map(e => `
        <tr>
          <td>${e.date}</td>
          <td><span class="tag ${e.txType==='Income'?'income':'expense'}">${e.txType}</span></td>
          <td>${escapeHtml(e.particulars)}</td>
          <td class="voucher-cell">${escapeHtml(e.ref || '—')}</td>
          <td class="num income-amt">${e.income ? fmt(e.income) : ''}</td>
          <td class="num expense-amt">${e.expense ? fmt(e.expense) : ''}</td>
          <td class="bal">${fmt(e.balance)}</td>
        </tr>
      `).join('');
  }

  // Stat cards reflect the FILTERED view: opening balance is the true running
  // balance just before the first visible entry (or the ledger's stored
  // opening balance if there is no prior entry); totals are summed over
  // visible entries only; closing balance is the true balance as of the last
  // visible entry (falls back to opening balance if nothing is visible).
  const firstIdx = visible.length ? withBalance.indexOf(visible[0]) : -1;
  const opening = firstIdx > 0 ? withBalance[firstIdx - 1].balance : openingBal;
  const totalIncome = visible.reduce((s,e)=> s + e.income, 0);
  const totalExpense = visible.reduce((s,e)=> s + e.expense, 0);
  const closing = visible.length ? visible[visible.length - 1].balance : opening;

  document.getElementById(state.type + '-openBal').textContent = fmt(opening);
  document.getElementById(state.type + '-totIncome').textContent = fmt(totalIncome);
  document.getElementById(state.type + '-totExpense').textContent = fmt(totalExpense);
  const closeEl = document.getElementById(state.type + '-closeBal');
  closeEl.textContent = fmt(closing);
  closeEl.className = 'stat-value ' + (closing >= 0 ? 'pos' : 'neg');
}

/* ===================== Sidebar navigation ===================== */
document.querySelectorAll('.nav-item').forEach(item=>{
  item.addEventListener('click', ()=>{
    document.querySelectorAll('.nav-item').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.module').forEach(m=>m.classList.remove('active'));
    item.classList.add('active');
    document.getElementById('mod-' + item.dataset.module).classList.add('active');
  });
});

/* ===================== Init ===================== */
initBook('cash');
initBook('bank');
