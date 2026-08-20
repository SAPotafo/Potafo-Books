/* ===================== Shared engine for Cash Book / Bank Book ===================== */
const BOOKS = {
  cash: {
    key: 'potafo_cashbook',
    ledgerKey: 'potafo_cash_ledgers',
    counterKey: 'potafo_cash_vouchercounters',
    openingBalKey: 'potafo_cash_openingbalances',
    voucherPrefix: 'CV',
    title: 'Cash Book',
    sub: 'Track cash receipts and payments across cash locations.',
    ledgerLabel: 'Cash Location',
    defaultLedgers: ['Main Cash']
  },
  bank: {
    key: 'potafo_bankbook',
    ledgerKey: 'potafo_bank_ledgers',
    counterKey: 'potafo_bank_vouchercounters',
    openingBalKey: 'potafo_bank_openingbalances',
    voucherPrefix: 'BV',
    title: 'Bank Book',
    sub: 'Track bank receipts and payments across bank accounts.',
    ledgerLabel: 'Bank Account',
    defaultLedgers: ['Primary Bank A/c']
  }
};

function loadJSON(key, fallback){
  try{
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  }catch(e){ return fallback; }
}
function saveJSON(key, val){
  localStorage.setItem(key, JSON.stringify(val));
}
function fmt(n){
  const v = Number(n)||0;
  return v.toLocaleString('en-IN', {minimumFractionDigits:2, maximumFractionDigits:2});
}
function todayStr(){
  return new Date().toISOString().slice(0,10);
}
function uid(){
  return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2,7);
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

function initBook(type){
  const cfg = BOOKS[type];
  let ledgers = loadJSON(cfg.ledgerKey, null);
  if(!ledgers || !ledgers.length){
    ledgers = cfg.defaultLedgers.slice();
    saveJSON(cfg.ledgerKey, ledgers);
  }
  let entries = loadJSON(cfg.key, null);
  if(!entries){
    entries = [];
    saveJSON(cfg.key, entries);
  }
  let counters = loadJSON(cfg.counterKey, null);
  if(!counters){
    counters = {};
    saveJSON(cfg.counterKey, counters);
  }
  let openingBalances = loadJSON(cfg.openingBalKey, null);
  if(!openingBalances){
    openingBalances = {};
    saveJSON(cfg.openingBalKey, openingBalances);
  }
  const state = {
    type, cfg, ledgers, entries, counters, openingBalances,
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

  // wire auto voucher toggle (kebab menu item)
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

function addEntry(state){
  const dateEl = document.getElementById(state.type + '-date');
  const particularsEl = document.getElementById(state.type + '-particulars');
  const refEl = document.getElementById(state.type + '-ref');
  const amountEl = document.getElementById(state.type + '-amount');

  const date = dateEl.value || todayStr();
  const particulars = particularsEl.value.trim();
  let ref = refEl.value.trim();
  const amount = parseFloat(amountEl.value);

  if(!particulars){ alert('Enter particulars.'); particularsEl.focus(); return; }
  if(!amount || amount <= 0){ alert('Enter a valid amount.'); amountEl.focus(); return; }

  if(state.autoVoucher){
    ref = nextVoucherNo(state);
    state.counters[state.activeLedger] = (state.counters[state.activeLedger] || 0) + 1;
    saveJSON(state.cfg.counterKey, state.counters);
  } else {
    if(!ref){ alert('Enter a voucher no., or switch Auto back on.'); refEl.focus(); return; }
    const dup = state.entries.some(e => e.ledger === state.activeLedger && e.ref === ref);
    if(dup && !confirm(`Voucher no. "${ref}" already exists in this ledger. Use it anyway?`)) return;
  }

  const entry = {
    id: uid(),
    ledger: state.activeLedger,
    date,
    txType: state.txType, // 'Income' = money in, 'Expense' = money out
    particulars,
    ref,
    amount
  };
  state.entries.push(entry);
  saveJSON(state.cfg.key, state.entries);

  particularsEl.value = '';
  amountEl.value = '';
  particularsEl.focus();
  updateVoucherField(state);

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
  document.getElementById('dv-confirm').addEventListener('click', ()=>{
    state.entries = state.entries.filter(e => e.id !== id);
    saveJSON(state.cfg.key, state.entries);
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
  function submit(){
    const trimmed = nameEl.value.trim();
    if(!trimmed){ nameEl.focus(); return; }
    if(state.ledgers.includes(trimmed)){ alert('That ledger already exists.'); return; }
    state.ledgers.push(trimmed);
    saveJSON(cfg.ledgerKey, state.ledgers);
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
  function submit(){
    const trimmed = nameEl.value.trim();
    if(!trimmed || trimmed === oldName){ closeModal(); return; }
    if(state.ledgers.includes(trimmed)){ alert('A ledger with that name already exists.'); return; }
    state.ledgers = state.ledgers.map(l => l === oldName ? trimmed : l);
    saveJSON(cfg.ledgerKey, state.ledgers);
    state.entries.forEach(e => { if(e.ledger === oldName) e.ledger = trimmed; });
    saveJSON(cfg.key, state.entries);
    if(state.counters[oldName] !== undefined){
      state.counters[trimmed] = state.counters[oldName];
      delete state.counters[oldName];
      saveJSON(cfg.counterKey, state.counters);
    }
    if(state.openingBalances[oldName] !== undefined){
      state.openingBalances[trimmed] = state.openingBalances[oldName];
      delete state.openingBalances[oldName];
      saveJSON(cfg.openingBalKey, state.openingBalances);
    }
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
  function submit(){
    const val = parseFloat(amountEl.value);
    state.openingBalances[state.activeLedger] = isNaN(val) ? 0 : val;
    saveJSON(cfg.openingBalKey, state.openingBalances);
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
  document.getElementById('dl-confirm').addEventListener('click', ()=>{
    state.entries = state.entries.filter(e => e.ledger !== state.activeLedger);
    saveJSON(cfg.key, state.entries);
    delete state.counters[state.activeLedger];
    saveJSON(cfg.counterKey, state.counters);
    delete state.openingBalances[state.activeLedger];
    saveJSON(cfg.openingBalKey, state.openingBalances);
    state.ledgers = state.ledgers.filter(l => l !== state.activeLedger);
    saveJSON(cfg.ledgerKey, state.ledgers);
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
  document.getElementById('em-save').addEventListener('click', ()=>{
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

    entry.date = date;
    entry.txType = txType;
    entry.particulars = particulars;
    entry.ref = ref;
    entry.amount = amount;
    saveJSON(state.cfg.key, state.entries);
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
