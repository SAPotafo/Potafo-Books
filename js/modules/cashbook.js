/* Potafo Accounts - Module 1: Cash Book
   One book per cash or bank ledger from Tally Ledgers (anything under Cash-in-Hand or Bank Accounts).
   The slider beside the title switches between them. */
(function () {
  'use strict';

  var P = window.Potafo;
  var esc = P.esc, money = P.money;
  var KEY = 'cashbook';

  var root, data, filters, editingId = null, lastDate = '';
  var accounts = [];     // [{ name, kind: 'cash' | 'bank' }] from Tally Ledgers
  var active = '';       // name of the account being shown

  // ---- data -------------------------------------------------------------
  function load() {
    var d = P.store.get(KEY, null) || {};
    return {
      opening: d.opening || 0,          // older single opening balance (belongs to the default account)
      openings: d.openings || {},       // opening balance per account
      account: d.account || '',
      counter: d.counter || 0,
      entries: d.entries || []
    };
  }
  function save() { return P.store.set(KEY, data); }

  // work in paise to avoid floating point drift
  function paise(n) { return Math.round(Number(n) * 100); }
  function rupees(p) { return p / 100; }

  // ---- accounts ---------------------------------------------------------
  function hasAccount(name) { return accounts.some(function (a) { return a.name === name; }); }

  // Entries made before accounts existed belong to "Cash" (or the first account)
  function defaultAccount() {
    return hasAccount('Cash') ? 'Cash' : (accounts[0] ? accounts[0].name : '');
  }
  function accountOf(e) { return e.account || defaultAccount(); }

  function openingOf(name) {
    if (Object.prototype.hasOwnProperty.call(data.openings, name)) return data.openings[name];
    return name === defaultAccount() ? data.opening : 0;
  }

  function monthRange(offset) {
    var now = new Date();
    var first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    var last = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
    return { from: P.isoDate(first), to: P.isoDate(last) };
  }

  function sortedEntries() {
    return data.entries.filter(function (e) { return accountOf(e) === active; }).sort(function (a, b) {
      return a.date < b.date ? -1 : a.date > b.date ? 1 : a.ts - b.ts;
    });
  }

  // Everything the screen needs, computed from the current account, data and filters.
  function compute() {
    var all = sortedEntries();
    var open = paise(openingOf(active));
    var inRange = [];
    all.forEach(function (e) {
      var p = paise(e.amount) * (e.type === 'in' ? 1 : -1);
      if (filters.from && e.date < filters.from) open += p;
      else if (!filters.to || e.date <= filters.to) inRange.push(e);
    });

    var bal = open, totalIn = 0, totalOut = 0;
    var rows = inRange.map(function (e) {
      var p = paise(e.amount);
      if (e.type === 'in') { bal += p; totalIn += p; } else { bal -= p; totalOut += p; }
      return { e: e, balance: bal };
    });

    var q = filters.q.trim().toLowerCase();
    var visible = rows.filter(function (r) {
      var e = r.e;
      if (filters.type !== 'all' && e.type !== filters.type) return false;
      if (!q) return true;
      return (e.particulars + ' ' + e.ref + ' ' + e.voucher).toLowerCase().indexOf(q) !== -1;
    });

    return { opening: open, totalIn: totalIn, totalOut: totalOut, closing: bal, rows: visible, count: rows.length };
  }

  // <option>s for the Particulars dropdown: the Tally ledgers grouped by the group they are Under.
  // The account being shown is left out (Cash book never lists Cash). Other cash/bank ledgers stay,
  // for transfers. A name saved earlier that is no longer listed is kept so old entries can be edited.
  function ledgerOptions(selected) {
    var ledgers = (P.ledgers ? P.ledgers.all() : []).filter(function (l) { return l.name !== active; });
    var byGroup = {}, known = {};
    ledgers.forEach(function (l) {
      (byGroup[l.under] = byGroup[l.under] || []).push(l.name);
      known[l.name] = true;
    });
    var html = '<option value="">Select ledger...</option>';
    if (selected && !known[selected]) {
      html += '<optgroup label="Not in Tally Ledgers"><option value="' + esc(selected) + '" selected>' + esc(selected) + '</option></optgroup>';
    }
    Object.keys(byGroup).sort().forEach(function (g) {
      html += '<optgroup label="' + esc(g) + '">' + byGroup[g].sort(function (a, b) { return a.localeCompare(b); }).map(function (n) {
        return '<option value="' + esc(n) + '"' + (n === selected ? ' selected' : '') + '>' + esc(n) + '</option>';
      }).join('') + '</optgroup>';
    });
    return html;
  }

  // ---- markup -----------------------------------------------------------
  var TEMPLATE =
    '<section class="cb">' +
    // The dropdown takes the place of the page title: pick the cash or bank ledger to work in
    '<div class="cb-head">' +
      '<div class="field acc-select" id="accField"><label for="accSelect">Cash / Bank account</label><select id="accSelect"></select></div>' +
      '<h2 class="print-only" id="cbPrintTitle"></h2>' +
    '</div>' +

    '<div class="panel empty-state" id="cbEmpty" hidden>' +
      '<h3>Cash Book: no cash or bank ledger yet</h3>' +
      '<p class="muted">The Cash Book lists the ledgers that are under <b>Cash-in-Hand</b> or <b>Bank Accounts</b> in Tally Ledgers. ' +
      '<a href="#/ledgers">Create one in Tally Ledgers</a> and it will appear here.</p>' +
    '</div>' +

    '<div id="cbMain">' +
    '<div class="cards" id="cbCards"></div>' +

    // New entry: Date, Particulars, Amount, then the Receipt/Payment slider
    '<form class="panel entry" id="cbForm" novalidate>' +
      '<div class="entry-head"><h3 id="eTitle">New entry</h3><span class="muted">F2 Receipt &middot; F3 Payment</span></div>' +
      '<div class="entry-grid">' +
        '<div class="field e-date"><label for="eDate">Date</label><input type="date" id="eDate" required></div>' +
        '<div class="field e-part"><label for="eParticulars">Particulars <span class="muted">(ledger)</span></label><select id="eParticulars"></select></div>' +
        '<div class="field e-amt"><label for="eAmount">Amount (&#8377;)</label><input type="number" id="eAmount" step="0.01" min="0.01" inputmode="decimal" required></div>' +
        '<div class="field e-type"><label for="eType">Type</label>' +
          '<span class="tswitch">' +
            '<input type="checkbox" id="eType" role="switch" aria-label="Payment (switch off means Receipt)">' +
            '<span class="tsw-track"><span class="tsw-thumb"></span>' +
              '<span class="tsw-lab lab-in">Receipt</span><span class="tsw-lab lab-out">Payment</span></span>' +
          '</span></div>' +
        '<div class="field e-ref"><label for="eRef">Reference / Bill no. <span class="muted">(optional)</span></label><input type="text" id="eRef" maxlength="40"></div>' +
        '<div class="btn-row e-actions">' +
          '<button type="submit" class="btn btn-primary" id="eSave">Add entry</button>' +
          '<button type="button" class="btn btn-ghost" id="eCancel" data-act="cancel-edit" hidden>Cancel</button>' +
        '</div>' +
      '</div>' +
      '<p class="sub" id="eHint"></p>' +
      '<p class="form-error" id="cbError"></p>' +
    '</form>' +

    '<div class="panel filters">' +
      '<div class="field"><label>From</label><input type="date" id="fFrom"></div>' +
      '<div class="field"><label>To</label><input type="date" id="fTo"></div>' +
      '<div class="field"><label>Show</label><select id="fType">' +
        '<option value="all">All entries</option><option value="in">Receipts only</option><option value="out">Payments only</option></select></div>' +
      '<div class="field grow"><label>Search</label><input type="search" id="fQ" placeholder="Particulars, voucher, reference..."></div>' +
    '</div>' +
    '<div class="quick">' +
      '<button class="chip" data-act="range-today">Today</button>' +
      '<button class="chip" data-act="range-month">This month</button>' +
      '<button class="chip" data-act="range-last">Last month</button>' +
      '<button class="chip" data-act="range-all">All time</button>' +
      '<span class="spacer"></span>' +
      '<button class="chip" data-act="opening">Opening balance</button>' +
      '<button class="chip" data-act="csv">Export CSV</button>' +
      '<button class="chip" data-act="print">Print</button>' +
    '</div>' +

    '<div class="panel table-wrap" id="cbTable"></div>' +

    // Opening balance
    '<dialog id="cbOpenDialog"><form method="dialog" novalidate>' +
      '<h3 id="oTitle">Opening balance</h3>' +
      '<p class="muted">Cash or bank balance before your first entry.</p>' +
      '<div class="field"><label for="oAmount">Amount (&#8377;)</label><input type="number" id="oAmount" step="0.01" inputmode="decimal"></div>' +
      '<div class="dlg-actions">' +
        '<button type="button" class="btn btn-ghost" data-act="open-cancel">Cancel</button>' +
        '<button type="button" class="btn btn-primary" data-act="open-save">Save</button>' +
      '</div>' +
    '</form></dialog>' +
    '</div>' +
    '</section>';

  function $(sel) { return root.querySelector(sel); }

  // ---- account dropdown -------------------------------------------------
  function renderAccountSelect() {
    var cash = accounts.filter(function (a) { return a.kind === 'cash'; });
    var bank = accounts.filter(function (a) { return a.kind === 'bank'; });
    function group(label, list) {
      return list.length ? '<optgroup label="' + label + '">' + list.map(function (a) {
        return '<option value="' + esc(a.name) + '"' + (a.name === active ? ' selected' : '') + '>' + esc(a.name) + '</option>';
      }).join('') + '</optgroup>' : '';
    }
    $('#accSelect').innerHTML = group('Cash in hand', cash) + group('Bank accounts', bank);
  }

  function selectAccount(name) {
    if (!hasAccount(name) || name === active) return;
    active = name;
    data.account = name;
    save();
    lastDate = '';
    filters.q = '';
    $('#fQ').value = '';
    resetForm();        // Particulars no longer lists this account, and any edit in progress is dropped
    render();
  }

  // ---- table ------------------------------------------------------------
  function render() {
    var c = compute();

    $('#cbPrintTitle').textContent = 'Cash Book – ' + active;

    $('#cbCards').innerHTML =
      card('Opening balance', c.opening, '') +
      card('Total receipts', c.totalIn, 'in') +
      card('Total payments', c.totalOut, 'out') +
      card('Closing balance', c.closing, c.closing < 0 ? 'neg' : 'close');

    var body = '<tr class="row-open"><td colspan="3">Opening balance' + (filters.from ? ' as on ' + P.fmtDate(filters.from) : '') +
      '</td><td class="num"></td><td class="num"></td><td class="num strong">' + bal(c.opening) + '</td><td class="no-print"></td></tr>';

    if (!c.rows.length) {
      body += '<tr><td colspan="7" class="empty">' + (c.count ? 'No entries match your filters.' :
        'No entries in this period yet. Add one in New entry above.') + '</td></tr>';
    }

    var visIn = 0, visOut = 0;
    c.rows.forEach(function (r) {
      var e = r.e, isIn = e.type === 'in';
      if (isIn) visIn += paise(e.amount); else visOut += paise(e.amount);
      body += '<tr' + (e.id === editingId ? ' class="sel"' : '') + '>' +
        '<td class="nowrap">' + P.fmtDate(e.date) + '</td>' +
        '<td class="nowrap muted">' + esc(e.voucher) + '</td>' +
        '<td>' + esc(e.particulars) + (e.ref ? '<div class="sub">Ref: ' + esc(e.ref) + '</div>' : '') + '</td>' +
        '<td class="num in">' + (isIn ? money(e.amount) : '') + '</td>' +
        '<td class="num out">' + (isIn ? '' : money(e.amount)) + '</td>' +
        '<td class="num strong' + (r.balance < 0 ? ' neg' : '') + '">' + bal(r.balance) + '</td>' +
        '<td class="actions no-print">' +
          '<button class="icon-btn" data-act="edit" data-id="' + e.id + '" title="Edit" aria-label="Edit">&#9998;</button>' +
          '<button class="icon-btn danger" data-act="delete" data-id="' + e.id + '" title="Delete" aria-label="Delete">&#10005;</button>' +
        '</td></tr>';
    });

    if (c.rows.length) {
      body += '<tr class="row-total"><td colspan="3">Total (' + c.rows.length + ' entr' + (c.rows.length === 1 ? 'y' : 'ies') + ')</td>' +
        '<td class="num in">' + money(rupees(visIn)) + '</td><td class="num out">' + money(rupees(visOut)) + '</td>' +
        '<td class="num"></td><td class="no-print"></td></tr>';
    }

    $('#cbTable').innerHTML =
      '<table><thead><tr><th>Date</th><th>Voucher</th><th>Particulars</th>' +
      '<th class="num">Receipt (&#8377;)</th><th class="num">Payment (&#8377;)</th><th class="num">Balance (&#8377;)</th><th class="no-print"></th></tr></thead>' +
      '<tbody>' + body + '</tbody></table>';
  }

  function card(label, paiseVal, cls) {
    return '<div class="card ' + cls + '"><span class="card-label">' + label + '</span>' +
      '<span class="card-value">&#8377; ' + money(rupees(paiseVal)) + '</span></div>';
  }
  function bal(p) { return money(rupees(Math.abs(p))) + (p < 0 ? ' Cr' : p > 0 ? ' Dr' : ''); }

  // ---- new entry form ---------------------------------------------------
  function typeName(t) { return t === 'in' ? 'Receipt' : 'Payment'; }
  function getType() { return $('#eType').checked ? 'out' : 'in'; }
  function setType(t) { $('#eType').checked = t === 'out'; }
  function hint(text) { $('#eHint').textContent = text || ''; }

  function resetForm() {
    editingId = null;
    $('#eTitle').textContent = 'New entry';
    $('#eDate').value = lastDate || P.isoDate();
    $('#eParticulars').innerHTML = ledgerOptions('');
    $('#eAmount').value = '';
    $('#eRef').value = '';
    $('#eSave').textContent = 'Add entry';
    $('#eCancel').hidden = true;
    $('#cbError').textContent = '';
    hint('Pick the ledger and Receipt or Payment is chosen for you.');
  }

  // Receipt/Payment follows the chosen ledger (Income, Debtors... = Receipt; Expenses, Creditors... = Payment)
  function autoType() {
    var name = $('#eParticulars').value;
    if (!name) { hint(''); return; }
    var flow = P.ledgers && P.ledgers.flow ? P.ledgers.flow(name) : null;
    if (flow) {
      setType(flow);
      var led = P.ledgers.all().filter(function (l) { return l.name === name; })[0];
      hint('Set to ' + typeName(flow) + ' because ' + name + (led ? ' is under ' + led.under : ' is a ' + typeName(flow) + ' ledger') +
        '. Slide to change it.');
    } else {
      hint('Cannot tell from this ledger. Slide to choose Receipt or Payment.');
    }
  }

  function focusEntry(type) {
    if (type) { setType(type); hint('Set to ' + typeName(type) + '.'); }
    $('#cbForm').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    $('#eParticulars').focus();
  }

  function loadEntry(id) {
    var e = data.entries.filter(function (x) { return x.id === id; })[0];
    if (!e) return;
    editingId = id;
    $('#eTitle').textContent = 'Edit entry ' + e.voucher;
    $('#eDate').value = e.date;
    $('#eParticulars').innerHTML = ledgerOptions(e.particulars);
    $('#eAmount').value = e.amount;
    $('#eRef').value = e.ref || '';
    setType(e.type);
    $('#eSave').textContent = 'Update entry';
    $('#eCancel').hidden = false;
    $('#cbError').textContent = '';
    hint('');
    render();
    $('#cbForm').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    $('#eAmount').focus();
  }

  function saveEntry(ev) {
    ev.preventDefault();
    var date = $('#eDate').value;
    var particulars = $('#eParticulars').value.trim();
    var amount = parseFloat($('#eAmount').value);
    var type = getType();
    var err = !date ? 'Please choose a date.' :
      !particulars ? 'Select the ledger for Particulars.' :
      !(amount > 0) ? 'Enter an amount greater than zero.' : '';
    if (err) { $('#cbError').textContent = err; return; }

    var fields = {
      type: type, date: date, amount: rupees(paise(amount)), particulars: particulars, ref: $('#eRef').value.trim()
    };
    var wasEditing = !!editingId;

    if (editingId) {
      var e = data.entries.filter(function (x) { return x.id === editingId; })[0];
      Object.keys(fields).forEach(function (k) { e[k] = fields[k]; });
      if (!e.account) e.account = active;      // pin older entries to the account they were shown under
    } else {
      data.counter += 1;
      fields.id = P.uid();
      fields.ts = Date.now();
      fields.account = active;
      fields.voucher = 'CB-' + ('0000' + data.counter).slice(-4);
      data.entries.push(fields);
    }
    if (!save()) return;

    // make sure the saved entry is visible in the current period
    if (filters.from && date < filters.from) filters.from = date;
    if (filters.to && date > filters.to) filters.to = date;
    syncFilterInputs();
    lastDate = date;          // the next entry starts on the same date
    resetForm();
    render();
    $('#eParticulars').focus();
    P.toast(wasEditing ? 'Entry updated' : typeName(type) + ' added');
  }

  async function deleteEntry(id) {
    var e = data.entries.filter(function (x) { return x.id === id; })[0];
    if (!e) return;
    var ok = await P.confirm({
      title: 'Delete this entry?',
      message: e.voucher + ' · ' + e.particulars + ' · ₹ ' + money(e.amount) + '. This cannot be undone.',
      confirmText: 'Delete'
    });
    if (!ok) return;
    data.entries = data.entries.filter(function (x) { return x.id !== id; });
    if (editingId === id) resetForm();
    save();
    render();
    P.toast('Entry deleted');
  }

  // ---- filters / export -------------------------------------------------
  function syncFilterInputs() {
    $('#fFrom').value = filters.from;
    $('#fTo').value = filters.to;
  }

  function setRange(from, to) {
    filters.from = from; filters.to = to;
    syncFilterInputs();
    render();
  }

  function exportCsv() {
    var c = compute();
    var cell = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
    var lines = [['Date', 'Voucher', 'Particulars', 'Reference', 'Receipt', 'Payment', 'Balance'].map(cell).join(',')];
    lines.push(['', '', 'Opening balance', '', '', '', rupees(c.opening).toFixed(2)].map(cell).join(','));
    c.rows.forEach(function (r) {
      var e = r.e;
      lines.push([e.date, e.voucher, e.particulars, e.ref,
        e.type === 'in' ? e.amount.toFixed(2) : '', e.type === 'out' ? e.amount.toFixed(2) : '',
        rupees(r.balance).toFixed(2)].map(cell).join(','));
    });
    var file = 'cash-book-' + active.replace(/[^\w-]+/g, '-').toLowerCase() + '-' + P.isoDate() + '.csv';
    P.download(file, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
  }

  // ---- events -----------------------------------------------------------
  function onClick(ev) {
    var b = ev.target.closest('[data-act]');
    if (!b) return;
    var act = b.dataset.act, today = P.isoDate();
    switch (act) {
      case 'edit': loadEntry(b.dataset.id); break;
      case 'delete': deleteEntry(b.dataset.id); break;
      case 'cancel-edit': resetForm(); render(); break;
      case 'range-today': setRange(today, today); break;
      case 'range-month': var m = monthRange(0); setRange(m.from, m.to); break;
      case 'range-last': var l = monthRange(-1); setRange(l.from, l.to); break;
      case 'range-all': setRange('', ''); break;
      case 'opening':
        $('#oTitle').textContent = 'Opening balance · ' + active;
        $('#oAmount').value = openingOf(active) || '';
        $('#cbOpenDialog').showModal();
        $('#oAmount').focus();
        break;
      case 'open-cancel': $('#cbOpenDialog').close(); break;
      case 'open-save':
        var v = parseFloat($('#oAmount').value);
        data.openings[active] = isNaN(v) ? 0 : rupees(paise(v));
        if (save()) { $('#cbOpenDialog').close(); render(); P.toast('Opening balance updated'); }
        break;
      case 'csv': exportCsv(); break;
      case 'print': window.print(); break;
    }
  }

  function onInput(ev) {
    var id = ev.target.id;
    if (id === 'accSelect') { selectAccount(ev.target.value); return; }
    if (id === 'eParticulars') { autoType(); return; }
    if (id === 'eType') { hint('Set to ' + typeName(getType()) + '.'); return; }
    if (id === 'fFrom') filters.from = ev.target.value;
    else if (id === 'fTo') filters.to = ev.target.value;
    else if (id === 'fType') filters.type = ev.target.value;
    else if (id === 'fQ') filters.q = ev.target.value;
    else return;
    render();
  }

  function onKey(ev) {
    if (!accounts.length) return;
    var dlg = root && root.querySelector('dialog[open]');
    if (dlg) {
      if (ev.key === 'Enter' && ev.target.tagName === 'INPUT') {
        ev.preventDefault();
        root.querySelector('[data-act="open-save"]').click();
      }
      return;
    }
    if (ev.key === 'F2') { ev.preventDefault(); focusEntry('in'); }
    else if (ev.key === 'F3') { ev.preventDefault(); focusEntry('out'); }
  }

  // ---- module interface -------------------------------------------------
  P.register({
    id: 'cashbook',
    title: 'Cash Book',
    icon: '&#8377;',
    mount: function (container) {
      root = container;
      data = load();
      editingId = null;
      lastDate = '';
      accounts = P.ledgers && P.ledgers.accounts ? P.ledgers.accounts() : [];
      active = hasAccount(data.account) ? data.account : defaultAccount();

      var m = monthRange(0);
      filters = { from: m.from, to: m.to, type: 'all', q: '' };
      container.innerHTML = TEMPLATE;

      container.addEventListener('click', onClick);
      container.addEventListener('input', onInput);
      container.addEventListener('change', onInput);
      document.addEventListener('keydown', onKey);

      var has = accounts.length > 0;
      $('#cbEmpty').hidden = has;
      $('#cbMain').hidden = !has;
      $('#accField').hidden = !has;
      if (!has) return;

      $('#cbForm').addEventListener('submit', saveEntry);
      renderAccountSelect();
      syncFilterInputs();
      resetForm();
      render();
    },
    unmount: function () {
      document.removeEventListener('keydown', onKey);
      if (root) {
        root.removeEventListener('click', onClick);
        root.removeEventListener('input', onInput);
        root.removeEventListener('change', onInput);
      }
    }
  });
})();
