/* Potafo Accounts - Module 3: Bank Statement
   Two sections:
   1. Bank Statement  - pick a bank account (a ledger under Bank Accounts in Tally Ledgers) and upload the statement
                        you get from the bank (Excel .xlsx or .csv). The lines are kept per bank account.
   2. Reconciliation  - shows the statement lines that are not reconciled yet. Tick lines (or Select all), choose the
                        ledger they belong to, and Reconcile: each line is posted to the Cash Book of that bank
                        account with the ledger as Particulars, and drops off this list.

   The sheet is read from row 18 down:
     column A  Sl no.       (a number; the first row without one ends the statement)
     column D  Date
     column G  Remark
     column H  Withdrawal
     column I  Deposit
     column J  Balance
   Amounts may be real numbers or text such as "1,234.50". */
(function () {
  'use strict';

  var P = window.Potafo;
  var esc = P.esc, money = P.money;
  var KEY = 'bankstatement';
  var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  // where things are in the bank's sheet (0 = column A, first row is row 1)
  var FIRST_ROW = 18;
  var COL = { sl: 0, date: 3, remark: 6, withdrawal: 7, deposit: 8, balance: 9 };

  var root, data, accounts = [], active = '';
  var filters = { from: '', to: '', q: '', sort: 'date-asc' };      // Bank Statement section
  var section = 'statement';                                         // 'statement' | 'recon'
  var rf = { from: '', to: '', q: '' };                              // Reconciliation section
  var picked = {};                                                   // statement lines ticked for reconciling: id -> true
  var shownIds = [];                                                 // the lines currently listed in Reconciliation
  var ledgerOf = {};                                                 // ledger chosen for each statement line: id -> ledger name

  // ---- data -------------------------------------------------------------
  function load() {
    var d = P.store.get(KEY, null) || {};
    return {
      account: d.account || '',
      section: d.section || 'statement',
      statements: d.statements || {},     // statements[account] = { lines: [...] }
      recon: d.recon || {}                // recon[account] = [{ bank: lineId, book: cashBookVoucherId }]
    };
  }
  function save() { return P.store.set(KEY, data); }
  function linesOf(name) { return data.statements[name] ? data.statements[name].lines : []; }

  // ---- reading the bank's file -------------------------------------------
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(y, m, d) {
    var dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? y + '-' + pad(m) + '-' + pad(d) : '';
  }

  // Excel date numbers, 12/09/2026, 12-09-26, 12-Sep-2026, 2026-09-12  ->  yyyy-mm-dd ('' if not a date)
  function parseDate(v) {
    v = String(v == null ? '' : v).trim();
    var m, y;
    if (!v) return '';
    if (/^\d+(\.\d+)?$/.test(v)) {
      var n = Math.floor(parseFloat(v));
      if (n < 20000 || n > 80000) return '';
      var dt = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
      return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
    }
    if ((m = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/.exec(v))) return iso(+m[1], +m[2], +m[3]);
    if ((m = /^(\d{1,2})[-\/. ](\d{1,2})[-\/. ](\d{2,4})/.exec(v))) { y = +m[3]; return iso(y < 100 ? y + 2000 : y, +m[2], +m[1]); }
    if ((m = /^(\d{1,2})[-\/. ]([A-Za-z]{3})[A-Za-z]*[-\/. ,]*(\d{2,4})/.exec(v))) {
      var mon = MONTHS[m[2].toLowerCase()];
      y = +m[3];
      return mon ? iso(y < 100 ? y + 2000 : y, mon, +m[1]) : '';
    }
    return '';
  }

  // Real numbers or text: "1234.5", "1,234.50", "Rs 1,234.50", "(500)", "1,234.50 Dr"  ->  number (blank = 0, junk = NaN)
  function parseAmount(v) {
    var s = String(v == null ? '' : v).replace(/[₹,\s]|rs\.?/gi, '');
    var dr = /dr\.?$/i.test(s);
    s = s.replace(/(dr|cr)\.?$/i, '');
    if (!s || s === '-') return 0;
    var neg = /^\(.*\)$/.test(s);
    var n = parseFloat(s.replace(/[()]/g, ''));
    if (isNaN(n)) return NaN;
    return (neg || dr) ? -Math.abs(n) : n;
  }

  function text(v) { return String(v == null ? '' : v).trim(); }
  function isSlNo(v) { return /^\d+(\.0+)?$/.test(text(v)); }

  function lineKey(l) { return [l.date, l.desc, l.debit, l.credit, l.balance].join('|'); }

  // ---- markup -----------------------------------------------------------
  var TEMPLATE =
    '<section class="bs">' +
    '<div class="bs-head">' +
      '<div class="field acc-select" id="bsField"><label for="bsAccount">Bank account</label><select id="bsAccount"></select></div>' +
      '<div class="bs-actions" id="bsActions">' +
        '<button type="button" class="btn btn-primary" id="bsUpload">Upload statement</button>' +
        '<input type="file" id="bsFile" accept=".xlsx,.csv" hidden>' +
      '</div>' +
    '</div>' +

    '<div class="panel empty-state" id="bsEmpty" hidden>' +
      '<h3>Bank Statement: no bank account yet</h3>' +
      '<p class="muted">This page lists the ledgers that are under <b>Bank Accounts</b> in Tally Ledgers. ' +
      '<a href="#/ledgers">Create one in Tally Ledgers</a> and it will appear here.</p>' +
    '</div>' +

    '<div id="bsMain">' +
      '<div class="seg-tabs" role="tablist" aria-label="Bank Statement sections">' +
        '<button type="button" class="seg-tab" role="tab" data-sec="statement" id="tabStatement">Bank Statement</button>' +
        '<button type="button" class="seg-tab" role="tab" data-sec="recon" id="tabRecon">Reconciliation</button>' +
      '</div>' +

    // ---- section 1: the uploaded bank statement
    '<div id="bsSecStatement">' +
      '<p class="muted hint">The statement is read from row ' + FIRST_ROW + ': Sl no. in A, Date in D, Remark in G, ' +
        'Withdrawal in H, Deposit in I and Balance in J. It ends at the first row with no Sl no.</p>' +
      '<div id="bsReport"></div>' +
      '<div class="cards" id="bsCards"></div>' +

      '<div class="panel filters">' +
        '<div class="field"><label>From</label><input type="date" id="bsFrom"></div>' +
        '<div class="field"><label>To</label><input type="date" id="bsTo"></div>' +
        '<div class="field"><label>Sort by</label><select id="bsSort">' +
          '<option value="date-asc">Date: oldest first</option>' +
          '<option value="date-desc">Date: newest first</option>' +
          '<option value="wd-desc">Withdrawal: high to low</option>' +
          '<option value="dep-desc">Deposit: high to low</option>' +
          '<option value="remark-asc">Remark: A to Z</option>' +
        '</select></div>' +
        '<div class="field grow"><label>Search</label><input type="search" id="bsQ" placeholder="Remark, amount, date..."></div>' +
      '</div>' +
      '<div class="quick">' +
        '<button class="chip" data-act="range-today">Today</button>' +
        '<button class="chip" data-act="range-month">This month</button>' +
        '<button class="chip" data-act="range-last">Last month</button>' +
        '<button class="chip" data-act="range-all">All time</button>' +
      '</div>' +

      '<div class="panel table-wrap" id="bsTable"></div>' +
      '<div class="bs-foot"><button type="button" class="chip chip-danger" id="bsClear">Clear this statement</button></div>' +
    '</div>' +

    // ---- section 2: reconcile the statement lines against a ledger
    '<div id="bsSecRecon" hidden>' +
      '<p class="muted hint">These statement lines are not reconciled yet. Choose a ledger for each line (choosing one ticks the line), ' +
        'or tick lines / Select all and set one ledger for all of them. <b>Reconcile</b> posts them to the Cash Book of this bank account ' +
        '(one voucher per ledger per date), and they leave this list.</p>' +
      '<p class="muted hint kbd-hint"><b>Keyboard:</b> &uarr; &darr; move between lines &middot; Enter, Space or just start typing to pick a ledger &middot; ' +
        'Delete clears it &middot; Ctrl+C copies a line\'s ledger, Ctrl+V pastes it on another line &middot; Ctrl+Enter reconciles the ticked lines.</p>' +
      '<div class="cards" id="rcCards"></div>' +
      '<div class="panel filters">' +
        '<div class="field"><label>From</label><input type="date" id="rcFrom"></div>' +
        '<div class="field"><label>To</label><input type="date" id="rcTo"></div>' +
        '<div class="field grow"><label>Search lines</label><input type="search" id="rcQ" placeholder="Remark, amount, date..."></div>' +
      '</div>' +
      '<div class="panel filters rc-apply">' +
        '<div class="field grow"><label for="rcLedger">Set one ledger for all ticked lines <span class="muted">(optional)</span></label><select id="rcLedger"></select></div>' +
        '<div class="btn-row rc-actions">' +
          '<button type="button" class="btn btn-primary" id="rcDo" data-act="rc-do" disabled>Reconcile</button>' +
          '<button type="button" class="btn btn-ghost" id="rcClearSel" data-act="rc-clear-sel" disabled>Clear selected</button>' +
        '</div>' +
      '</div>' +
      '<p class="sub" id="rcMsg"></p>' +
      '<div class="panel table-wrap" id="rcTable"></div>' +
    '</div>' +
    '</div>' +
    '</section>';

  function $(sel) { return root.querySelector(sel); }

  // ---- screen: Bank Statement -------------------------------------------
  function byDate(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.ord - b.ord; }

  var SORTS = {
    'date-asc': byDate,
    'date-desc': function (a, b) { return byDate(b, a); },
    'wd-desc': function (a, b) { return b.debit - a.debit || byDate(a, b); },
    'dep-desc': function (a, b) { return b.credit - a.credit || byDate(a, b); },
    'remark-asc': function (a, b) { return a.desc.localeCompare(b.desc) || byDate(a, b); }
  };

  // does a statement line match the search text? (remark, date, amounts)
  function lineMatches(l, q) {
    if (!q) return true;
    var hay = [l.desc, P.fmtDate(l.date), l.debit || '', l.credit || '', l.debit ? money(l.debit) : '', l.credit ? money(l.credit) : '',
      l.balance === null ? '' : money(Math.abs(l.balance))].join(' ').toLowerCase();
    return hay.indexOf(q) !== -1;
  }

  // The lines of this account that match the date range and search, in the chosen order.
  // (Lines are always kept in date order first, so the closing balance is the newest line's balance.)
  function view() {
    var q = filters.q.trim().toLowerCase();
    var list = linesOf(active).filter(function (l) {
      if (filters.from && l.date < filters.from) return false;
      if (filters.to && l.date > filters.to) return false;
      return lineMatches(l, q);
    });
    return { shown: list.slice().sort(SORTS[filters.sort] || byDate), chrono: list.slice().sort(byDate) };
  }

  function card(label, value, cls) {
    return '<div class="card ' + cls + '"><span class="card-label">' + label + '</span><span class="card-value">' + value + '</span></div>';
  }

  function render() {
    if (section === 'recon') renderRecon(); else renderStatement();
  }

  function renderStatement() {
    var v = view(), lines = v.shown, dep = 0, wd = 0, last = null;
    var total = linesOf(active).length, filtered = lines.length !== total;
    lines.forEach(function (l) {
      dep += Math.round(l.credit * 100);
      wd += Math.round(l.debit * 100);
    });
    v.chrono.forEach(function (l) { if (l.balance !== null) last = l.balance; });

    $('#bsCards').innerHTML =
      card(filtered ? 'Lines shown' : 'Statement lines', String(lines.length), '') +
      card('Total deposits', '&#8377; ' + money(dep / 100), 'in') +
      card('Total withdrawals', '&#8377; ' + money(wd / 100), 'out') +
      card('Closing balance', last === null ? '&mdash;' : '&#8377; ' + (last < 0 ? '-' : '') + money(Math.abs(last)), last !== null && last < 0 ? 'neg' : 'close');

    var done = reconciledIds();
    var body = lines.map(function (l) {
      return '<tr><td class="nowrap">' + P.fmtDate(l.date) + '</td>' +
        '<td>' + esc(l.desc) + (done[l.id] ? ' <span class="tag tag-ok">Reconciled</span>' : '') + '</td>' +
        '<td class="num out">' + (l.debit ? money(l.debit) : '') + '</td>' +
        '<td class="num in">' + (l.credit ? money(l.credit) : '') + '</td>' +
        '<td class="num strong' + (l.balance !== null && l.balance < 0 ? ' neg' : '') + '">' + (l.balance === null ? '' : (l.balance < 0 ? '-' : '') + money(Math.abs(l.balance))) + '</td></tr>';
    }).join('');

    if (!lines.length) {
      body = '<tr><td colspan="5" class="empty">' + (total ? 'No lines match your dates or search.' :
        'No statement uploaded for ' + esc(active) + ' yet. Use <b>Upload statement</b>.') + '</td></tr>';
    } else {
      body += '<tr class="row-total"><td colspan="2">Total (' + lines.length + ' line' + (lines.length === 1 ? '' : 's') + ')</td>' +
        '<td class="num out">' + money(wd / 100) + '</td><td class="num in">' + money(dep / 100) + '</td><td class="num"></td></tr>';
    }

    $('#bsTable').innerHTML =
      '<table><thead><tr><th>Date</th><th>Remark</th>' +
      '<th class="num">Withdrawal (&#8377;)</th><th class="num">Deposit (&#8377;)</th><th class="num">Balance (&#8377;)</th></tr></thead>' +
      '<tbody>' + body + '</tbody></table>';

    // Clear only offers lines that are not reconciled
    $('#bsClear').hidden = !linesOf(active).some(function (l) { return !done[l.id]; });
  }

  function renderAccountSelect() {
    $('#bsAccount').innerHTML = accounts.map(function (a) {
      return '<option value="' + esc(a.name) + '"' + (a.name === active ? ' selected' : '') + '>' + esc(a.name) + '</option>';
    }).join('');
  }

  function showReport(html) { $('#bsReport').innerHTML = html; }

  // ---- date range, sort, search (Bank Statement section) -------------------
  function monthRange(offset) {
    var now = new Date();
    return {
      from: P.isoDate(new Date(now.getFullYear(), now.getMonth() + offset, 1)),
      to: P.isoDate(new Date(now.getFullYear(), now.getMonth() + offset + 1, 0))
    };
  }

  function setRange(from, to) {
    filters.from = from; filters.to = to;
    $('#bsFrom').value = from;
    $('#bsTo').value = to;
    render();
  }

  function onFilter(ev) {
    var t = ev.target, id = t.id;

    // reconciliation: a line's tick box, or Select all
    if (t.dataset && t.dataset.rc) {
      var top = $('#rcLedger').value;
      if (t.dataset.rc === 'all') {
        shownIds.forEach(function (lineId) {
          tickLine(lineId, t.checked);
          if (t.checked && top && !ledgerOf[lineId]) setRowLedger(lineId, top);      // the ledger set above fills the blanks
        });
      } else {
        tickLine(t.dataset.id, t.checked);
        if (t.checked && top && !ledgerOf[t.dataset.id]) setRowLedger(t.dataset.id, top);
      }
      syncPicked();
      return;
    }

    // the ledger set above is applied to every ticked line
    if (id === 'rcLedger') {
      if (t.value) Object.keys(picked).forEach(function (lineId) { setRowLedger(lineId, t.value); });
      syncPicked();
      return;
    }

    if (id === 'bsFrom') filters.from = t.value;
    else if (id === 'bsTo') filters.to = t.value;
    else if (id === 'bsSort') filters.sort = t.value;
    else if (id === 'bsQ') filters.q = t.value;
    else if (id === 'rcFrom') rf.from = t.value;
    else if (id === 'rcTo') rf.to = t.value;
    else if (id === 'rcQ') rf.q = t.value;
    else return;
    render();
  }

  // ---- upload -----------------------------------------------------------
  async function importFile(file) {
    var rows;
    try { rows = await P.readTable(file); }
    catch (e) {
      showReport('<div class="panel report"><p class="form-error">' + esc(e.message || 'Could not read the file.') + '</p></div>');
      return;
    }

    var st = data.statements[active] || (data.statements[active] = { lines: [] });
    var have = {}, added = 0, dupes = 0, skipped = [], count = 0;
    st.lines.forEach(function (l) { have[lineKey(l)] = true; });
    var ord = st.lines.reduce(function (m, l) { return Math.max(m, l.ord + 1); }, 0);

    // row 18 onwards, for as long as column A holds a Sl no.
    for (var i = FIRST_ROW - 1; i < rows.length; i++) {
      var r = rows[i] || [];
      if (!isSlNo(r[COL.sl])) break;                       // the number ended: the statement ends
      count++;

      var date = parseDate(r[COL.date]);
      var debit = parseAmount(r[COL.withdrawal]), credit = parseAmount(r[COL.deposit]);
      var balRaw = text(r[COL.balance]);
      var balance = balRaw ? parseAmount(balRaw) : null;
      if (!date || isNaN(debit) || isNaN(credit) || (balance !== null && isNaN(balance)) || (!debit && !credit)) {
        skipped.push(i + 1);
        continue;
      }

      var line = {
        id: P.uid(), ord: ord, date: date,
        desc: text(r[COL.remark]).replace(/\s+/g, ' '),
        debit: Math.abs(debit), credit: Math.abs(credit), balance: balance
      };
      if (have[lineKey(line)]) { dupes++; continue; }      // duplicates are ignored
      have[lineKey(line)] = true;
      st.lines.push(line);
      ord++; added++;
    }

    if (added && !save()) return;
    render();

    var html = '<div class="panel report">';
    if (!count) {
      html += '<p class="form-error">No statement lines found. The statement must start at row ' + FIRST_ROW + ' with a Sl no. in column A.</p>';
    } else {
      html += '<p><b class="ok">' + added + ' line' + (added === 1 ? '' : 's') + ' added</b> to ' + esc(active) +
        (dupes ? ' &middot; <span class="muted">' + dupes + ' duplicate' + (dupes === 1 ? '' : 's') + ' ignored</span>' : '') +
        (skipped.length ? ' &middot; <b class="warn">' + skipped.length + ' row' + (skipped.length === 1 ? '' : 's') + ' skipped</b>' : '') + '</p>' +
        '<p class="muted">Read rows ' + FIRST_ROW + ' to ' + (FIRST_ROW + count - 1) + '; the statement ended there.</p>';
      if (skipped.length) {
        html += '<p class="warn">Skipped because the date or amount could not be read: row ' + skipped.slice(0, 20).join(', row ') +
          (skipped.length > 20 ? ' and ' + (skipped.length - 20) + ' more' : '') + '.</p>';
      }
    }
    html += '<div class="dlg-actions"><button type="button" class="btn btn-ghost" data-act="close-report">Dismiss</button></div></div>';
    showReport(html);
    if (added) P.toast(added + ' line' + (added === 1 ? '' : 's') + ' uploaded');
  }

  // Reconciled lines are already in the Cash Book, so they cannot be cleared from the statement.
  // (Delete their voucher in the Cash Book first and the line becomes unreconciled again.)
  async function clearStatement() {
    var done = reconciledIds();
    var all = linesOf(active), removable = all.filter(function (l) { return !done[l.id]; });
    var kept = all.length - removable.length;
    if (!removable.length) {
      P.toast('Every line is reconciled, so nothing can be cleared.', true);
      return;
    }
    var n = removable.length;
    var ok = await P.confirm({
      title: 'Clear this statement?',
      message: n + ' line' + (n === 1 ? '' : 's') + ' for ' + active + ' will be removed.' +
        (kept ? ' The ' + kept + ' reconciled line' + (kept === 1 ? '' : 's') + ' will stay.' : '') + ' This cannot be undone.',
      confirmText: 'Clear'
    });
    if (!ok) return;

    if (kept) data.statements[active].lines = all.filter(function (l) { return done[l.id]; });
    else { delete data.statements[active]; delete data.recon[active]; }
    save();
    picked = {};
    showReport('');
    render();
    P.toast(n + ' line' + (n === 1 ? '' : 's') + ' cleared' + (kept ? ', reconciled lines kept' : ''));
  }

  // ---- screen: Reconciliation ---------------------------------------------
  // A statement line is reconciled once it has a Cash Book voucher (recon pair). If that voucher is deleted in the
  // Cash Book, the line simply shows up here again.
  function cashBookDoc() {
    var d = P.store.get('cashbook', null) || {};
    d.entries = d.entries || [];
    d.counter = d.counter || 0;
    return d;
  }

  function reconciledIds() {
    var have = {};
    cashBookDoc().entries.forEach(function (e) { have[e.id] = true; });
    var done = {};
    (data.recon[active] || []).forEach(function (p) { if (have[p.book]) done[p.bank] = true; });
    return done;
  }

  function ledgerOptions(selected) {
    var names = (P.ledgers ? P.ledgers.all() : []).map(function (l) { return l.name; })
      .filter(function (n) { return n !== active; })
      .sort(function (a, b) { return a.localeCompare(b); });
    return '<option value="">Select ledger...</option>' + names.map(function (n) {
      return '<option value="' + esc(n) + '"' + (n === selected ? ' selected' : '') + '>' + esc(n) + '</option>';
    }).join('');
  }

  function rcMessage(msg, isError) {
    var m = $('#rcMsg');
    m.textContent = msg || '';
    m.className = 'sub' + (isError ? ' warn' : '');
  }

  function renderRecon() {
    var done = reconciledIds(), q = rf.q.trim().toLowerCase();
    var all = linesOf(active), open = all.filter(function (l) { return !done[l.id]; });
    var list = open.filter(function (l) {
      if (rf.from && l.date < rf.from) return false;
      if (rf.to && l.date > rf.to) return false;
      return lineMatches(l, q);
    }).sort(byDate);
    shownIds = list.map(function (l) { return l.id; });

    // only lines still listed stay ticked
    Object.keys(picked).forEach(function (id) { if (shownIds.indexOf(id) === -1) delete picked[id]; });

    var dep = 0, wd = 0;
    open.forEach(function (l) { dep += Math.round(l.credit * 100); wd += Math.round(l.debit * 100); });
    $('#rcCards').innerHTML =
      card('Not reconciled', String(open.length), open.length ? 'out' : 'in') +
      card('Deposits not reconciled', '&#8377; ' + money(dep / 100), 'in') +
      card('Withdrawals not reconciled', '&#8377; ' + money(wd / 100), 'out') +
      card('Reconciled', String(all.length - open.length), 'close');

    // every line has its own ledger box: a button that opens one shared searchable list
    function ledgerCell(id) {
      var name = ledgerOf[id];
      return '<button type="button" class="ss-btn lp-btn" data-line="' + id + '" aria-haspopup="listbox" title="Choose the ledger for this line">' +
        (name ? '<span class="ss-text">' + esc(name) + '</span>' : '<span class="ss-text ss-placeholder">Select ledger...</span>') + '</button>';
    }
    var rows = list.map(function (l) {
      return '<tr class="' + (picked[l.id] ? 'sel' : '') + '">' +
        '<td class="chk"><input type="checkbox" data-rc="line" data-id="' + l.id + '"' + (picked[l.id] ? ' checked' : '') + ' aria-label="Select this line"></td>' +
        '<td class="nowrap">' + P.fmtDate(l.date) + '</td><td>' + esc(l.desc) + '</td>' +
        '<td class="num out">' + (l.debit ? money(l.debit) : '') + '</td><td class="num in">' + (l.credit ? money(l.credit) : '') + '</td>' +
        '<td class="lp-cell">' + ledgerCell(l.id) + '</td></tr>';
    }).join('');

    var empty = !all.length ? 'No statement uploaded for ' + esc(active) + ' yet. Upload one in the Bank Statement section.' :
      !open.length ? 'Everything in this statement is reconciled.' : 'No lines match your dates or search.';
    $('#rcTable').innerHTML =
      '<table><thead><tr><th class="chk"><input type="checkbox" data-rc="all" id="rcAll" aria-label="Select all lines"></th>' +
      '<th>Date</th><th>Remark</th><th class="num">Withdrawal (&#8377;)</th><th class="num">Deposit (&#8377;)</th><th>Ledger</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="6" class="empty">' + empty + '</td></tr>') + '</tbody></table>';

    $('#rcLedger').innerHTML = ledgerOptions($('#rcLedger').value);
    syncPicked();
  }

  // ---- per-line ledger and tick, kept in step without redrawing the table (so the keyboard focus stays put) ----
  function setRowLedger(id, name) {
    if (name) ledgerOf[id] = name; else delete ledgerOf[id];
    var b = root.querySelector('.lp-btn[data-line="' + id + '"]');
    if (b) b.innerHTML = name ? '<span class="ss-text">' + esc(name) + '</span>' : '<span class="ss-text ss-placeholder">Select ledger...</span>';
  }

  function tickLine(id, on) {
    if (on) picked[id] = true; else delete picked[id];
    var cb = root.querySelector('[data-rc="line"][data-id="' + id + '"]');
    if (cb) { cb.checked = on; cb.closest('tr').classList.toggle('sel', on); }
  }

  function ledgerItems() {
    return (P.ledgers ? P.ledgers.all() : []).map(function (l) { return l.name; })
      .filter(function (n) { return n !== active; })
      .sort(function (a, b) { return a.localeCompare(b); })
      .map(function (n) { return { value: n, label: n }; });
  }

  function lineButtons() { return Array.prototype.slice.call(root.querySelectorAll('.lp-btn')); }

  // give a line its ledger, tick it, and move on to the next line
  function applyLedger(btn, name) {
    var id = btn.dataset.line;
    setRowLedger(id, name);
    tickLine(id, !!name);
    syncPicked();
    var all = lineButtons(), next = all[all.indexOf(btn) + 1];
    (next || btn).focus();
  }

  // open the searchable ledger list for one line; choosing applies it
  async function pickForLine(btn, prefill) {
    var name = await P.pick(btn, ledgerItems(), ledgerOf[btn.dataset.line] || '', prefill);
    if (name === null) { btn.focus(); return; }               // Esc: leave it as it was
    applyLedger(btn, name);
  }

  // Ctrl+C on a line's ledger copies it (to the clipboard, and for Ctrl+V on another line)
  var copiedLedger = '';

  function copyText(s) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(s); return; }
    } catch (e) { /* fall through */ }
    var ta = document.createElement('textarea');
    ta.value = s;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    ta.remove();
  }

  function copyLedger(btn) {
    var name = ledgerOf[btn.dataset.line];
    if (!name) { P.toast('This line has no ledger to copy yet.', true); return; }
    copiedLedger = name;
    copyText(name);
    P.toast('Copied ' + name + '. Press Ctrl+V on another line to use it.');
  }

  function pasteLedger(btn) {
    var ok = copiedLedger && ledgerItems().some(function (it) { return it.value === copiedLedger; });
    if (!ok) { P.toast('Nothing copied yet. Press Ctrl+C on a line that has a ledger.', true); return; }
    applyLedger(btn, copiedLedger);
  }

  function onLineKey(e) {
    var btn = e.target.closest && e.target.closest('.lp-btn');
    if (btn) {
      var all = lineButtons(), i = all.indexOf(btn), mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      if (mod && k === 'c') { e.preventDefault(); copyLedger(btn); return; }
      if (mod && k === 'v') { e.preventDefault(); pasteLedger(btn); return; }
      if (mod && e.key === 'Enter') { e.preventDefault(); reconcile(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); (all[i + 1] || btn).focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); (all[i - 1] || btn).focus(); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickForLine(btn); }
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        setRowLedger(btn.dataset.line, '');
        tickLine(btn.dataset.line, false);
        syncPicked();
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); pickForLine(btn, e.key); }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && section === 'recon') { e.preventDefault(); reconcile(); }
  }

  // Clear selected: take the ledger off every ticked line and untick them
  function clearSelected() {
    var ids = Object.keys(picked);
    if (!ids.length) return;
    ids.forEach(function (id) { setRowLedger(id, ''); tickLine(id, false); });
    syncPicked();
    P.toast('Cleared ' + ids.length + ' line' + (ids.length === 1 ? '' : 's'));
  }

  // Select all box, the Reconcile button and the hint
  function syncPicked() {
    var ids = Object.keys(picked), n = ids.length, all = $('#rcAll');
    var missing = ids.filter(function (id) { return !ledgerOf[id]; }).length;
    if (all) {
      all.disabled = !shownIds.length;
      all.checked = shownIds.length > 0 && n === shownIds.length;
      all.indeterminate = n > 0 && n < shownIds.length;
    }
    $('#rcDo').textContent = n ? 'Reconcile ' + n + ' line' + (n === 1 ? '' : 's') : 'Reconcile';
    $('#rcDo').disabled = !(n && !missing);
    $('#rcClearSel').textContent = n ? 'Clear ' + n + ' selected' : 'Clear selected';
    $('#rcClearSel').disabled = !n;
    rcMessage(missing ? missing + ' ticked line' + (missing === 1 ? ' has' : 's have') + ' no ledger yet.' : '');
  }

  async function reconcile() {
    var ids = Object.keys(picked);
    if (!ids.length || ids.some(function (id) { return !ledgerOf[id]; })) return;

    var lines = linesOf(active).filter(function (l) { return picked[l.id]; }).sort(byDate);

    // one date, one ledger, one voucher: lines on the same date (same direction, same ledger) are added together
    var groups = [], byKey = {};
    lines.forEach(function (l) {
      var type = l.credit > 0 ? 'in' : 'out', ledger = ledgerOf[l.id], key = ledger + '|' + l.date + '|' + type;
      var g = byKey[key] || (byKey[key] = { ledger: ledger, date: l.date, type: type, cents: 0, lines: [] });
      if (!g.lines.length) groups.push(g);
      g.cents += Math.round((type === 'in' ? l.credit : l.debit) * 100);
      g.lines.push(l);
    });

    var ok = await P.confirm({
      title: 'Reconcile ' + lines.length + ' line' + (lines.length === 1 ? '' : 's') + '?',
      message: 'Posted to the Cash Book of ' + active + ' as ' + groups.length + ' voucher' + (groups.length === 1 ? '' : 's') +
        ' (one per ledger per date), each with its ledger as Particulars.',
      confirmText: 'Reconcile'
    });
    if (!ok) return;

    // post to the Cash Book (same document the Cash Book module reads)
    var doc = cashBookDoc(), pairs = (data.recon[active] || []).slice(), stamp = Date.now();
    groups.forEach(function (g, i) {
      // a voucher made earlier by reconciling the same ledger on the same date takes the new lines too
      var entry = doc.entries.filter(function (e) {
        return e.bs && e.account === active && e.date === g.date && e.type === g.type && e.particulars === g.ledger;
      })[0];
      if (entry) {
        entry.amount = (Math.round(entry.amount * 100) + g.cents) / 100;
      } else {
        doc.counter += 1;
        entry = {
          id: P.uid(), ts: stamp + i, account: active, type: g.type, date: g.date, amount: g.cents / 100,
          particulars: g.ledger, ref: '', bs: true, voucher: 'CB-' + ('0000' + doc.counter).slice(-4)
        };
        doc.entries.push(entry);
      }
      g.lines.forEach(function (l) { pairs.push({ bank: l.id, book: entry.id }); });
    });
    if (!P.store.set('cashbook', doc)) return;
    data.recon[active] = pairs;
    if (!save()) return;

    lines.forEach(function (l) { delete ledgerOf[l.id]; });
    picked = {};
    renderRecon();
    P.toast(lines.length + ' line' + (lines.length === 1 ? '' : 's') + ' reconciled into ' + groups.length +
      ' voucher' + (groups.length === 1 ? '' : 's') + ' in the Cash Book');
  }

  // ---- the two sections ---------------------------------------------------
  function showSection(name, remember) {
    section = name;
    if (remember) { data.section = name; save(); }
    $('#bsSecStatement').hidden = name !== 'statement';
    $('#bsSecRecon').hidden = name !== 'recon';
    $('#bsActions').hidden = name !== 'statement';          // Upload belongs to the statement section
    $('#tabStatement').classList.toggle('on', name === 'statement');
    $('#tabRecon').classList.toggle('on', name === 'recon');
    $('#tabStatement').setAttribute('aria-selected', String(name === 'statement'));
    $('#tabRecon').setAttribute('aria-selected', String(name === 'recon'));
    render();
  }

  // ---- module interface -------------------------------------------------
  P.register({
    id: 'bankstatement',
    title: 'Bank Statement',
    icon: '&#9635;',
    mount: function (container) {
      data = load();
      filters = { from: '', to: '', q: '', sort: 'date-asc' };      // a fresh page starts showing everything, oldest first
      rf = { from: '', to: '', q: '' };
      picked = {};
      ledgerOf = {};
      shownIds = [];
      section = data.section === 'recon' ? 'recon' : 'statement';
      accounts = (P.ledgers && P.ledgers.accounts ? P.ledgers.accounts() : []).filter(function (a) { return a.kind === 'bank'; });
      active = accounts.some(function (a) { return a.name === data.account; }) ? data.account : (accounts[0] ? accounts[0].name : '');

      container.innerHTML = TEMPLATE;
      // listeners live on the inner section, so they go away when the page is replaced
      root = container.querySelector('.bs');

      var has = accounts.length > 0;
      $('#bsEmpty').hidden = has;
      $('#bsMain').hidden = !has;
      $('#bsField').hidden = !has;
      $('#bsActions').hidden = !has;
      if (!has) return;

      renderAccountSelect();
      showSection(section, false);            // draws the section you were last in

      $('#bsAccount').addEventListener('change', function (e) {
        active = e.target.value;
        data.account = active;
        save();
        showReport('');
        filters.q = '';
        $('#bsQ').value = '';
        picked = {};
        render();
      });

      root.addEventListener('input', onFilter);
      root.addEventListener('change', onFilter);
      root.addEventListener('keydown', onLineKey);
      var file = $('#bsFile');
      $('#bsUpload').addEventListener('click', function () { file.click(); });
      file.addEventListener('change', function () {
        var f = file.files[0];
        file.value = '';
        if (f) importFile(f);
      });
      $('#bsClear').addEventListener('click', clearStatement);
      root.addEventListener('click', function (e) {
        var tab = e.target.closest('[data-sec]');
        if (tab) { showSection(tab.dataset.sec, true); return; }
        var lp = e.target.closest('.lp-btn');
        if (lp) { pickForLine(lp); return; }

        var b = e.target.closest('[data-act]');
        if (!b) return;
        var today = P.isoDate(), m;
        switch (b.dataset.act) {
          case 'rc-do': reconcile(); break;
          case 'rc-clear-sel': clearSelected(); break;
          case 'close-report': showReport(''); break;
          case 'range-today': setRange(today, today); break;
          case 'range-month': m = monthRange(0); setRange(m.from, m.to); break;
          case 'range-last': m = monthRange(-1); setRange(m.from, m.to); break;
          case 'range-all': setRange('', ''); break;
        }
      });
    }
  });
})();
