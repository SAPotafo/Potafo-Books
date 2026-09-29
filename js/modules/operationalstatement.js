/* Potafo Accounts - Module 4: Operational Statement
   The page has one button, "Create Table". It opens a pop-up where you create the Income and Expense sides:
   as many Main Heads as you like, and under each head as many ledger names (from Tally Ledgers) as you like.
   Income heads take ledgers that sit under Income, Expense heads take ledgers that sit under Expenses;
   a ledger can be under one head only.

   Once a table exists, the statement is shown across the page: Income on the left, Expense on the right, each side with
   Particulars, Amount and Per Order. It has From / To dates and a search box.

   "Add Data" (next to Create Table) opens a pop-up with two lists:
     - No. of Orders: a date and how many orders there were that day.
     - Amounts: a date, a ledger (from the table) and an amount.
   Amounts in the statement = the amounts added there + the Cash Book vouchers (all cash and bank accounts) whose
   Particulars is that ledger (an Income ledger = receipts minus payments, an Expense ledger = payments minus receipts).
   Per Order = the amount divided by the total No. of Orders for the dates in the From - To period. */
(function () {
  'use strict';

  var P = window.Potafo;
  var esc = P.esc, money = P.money;
  var KEY = 'operationalstatement';
  var TYPES = {
    income: { label: 'Income', nature: 'Income' },
    expense: { label: 'Expense', nature: 'Expenses' }
  };

  var root, data;
  var filters = { from: '', to: '', q: '' };
  var draft = [];                       // the heads being edited in the pop-up (saved only when you press Save)
  var dd = { date: '', edits: {} };     // Add Data: the date shown, and what has been typed for each date (saved on Save data)

  // ---- data -------------------------------------------------------------
  function load() {
    var d = P.store.get(KEY, null) || {};
    return {
      heads: d.heads || [],                                   // [{ id, type, name, ledgers: [ledger names] }]
      entries: d.entries || [],                               // Add Data amounts: [{ id, date, ledger, amount }]
      orders: Array.isArray(d.orders) ? d.orders : []         // Add Data orders:  [{ id, date, orders }]
    };
  }

  // every ledger that is under a head of the table, A-Z (the ledger list in Add Data)
  function tableLedgers() {
    var seen = {}, out = [];
    data.heads.forEach(function (h) { h.ledgers.forEach(function (n) { if (!seen[n]) { seen[n] = true; out.push(n); } }); });
    return out.sort(function (a, b) { return a.localeCompare(b); });
  }
  function save() { return P.store.set(KEY, data); }

  function of(list, type) { return list.filter(function (h) { return h.type === type; }); }
  function draftHead(id) { return draft.filter(function (h) { return h.id === id; })[0]; }

  // ledgers that can still go under a head of this type: right nature, and not under any head of this type yet
  function availableLedgers(type) {
    var used = {};
    of(draft, type).forEach(function (h) { h.ledgers.forEach(function (n) { used[n] = true; }); });
    return (P.ledgers ? P.ledgers.all() : []).map(function (l) { return l.name; }).filter(function (n) {
      return !used[n] && P.ledgers.nature && P.ledgers.nature(n) === TYPES[type].nature;
    }).sort(function (a, b) { return a.localeCompare(b); });
  }

  // ---- markup -----------------------------------------------------------
  function side(type) {
    return '<div class="op-side"><div class="op-top"><h4>' + TYPES[type].label + '</h4></div>' +
      '<div class="op-list" id="op-' + type + '"></div>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-act="add-head" data-type="' + type + '">+ Add head</button></div>';
  }

  var TEMPLATE =
    '<section class="op">' +
    '<div class="op-bar">' +
      '<button type="button" class="btn btn-ghost" data-act="create-table">Create Table</button>' +
      '<button type="button" class="btn btn-ghost" data-act="add-data">Add Data</button>' +
      '<button type="button" class="btn btn-ghost" data-act="saved-data">Saved Data</button>' +
    '</div>' +

    '<div id="opStatement" hidden>' +
      '<div class="panel filters">' +
        '<div class="field"><label>From</label><input type="date" id="opFrom"></div>' +
        '<div class="field"><label>To</label><input type="date" id="opTo"></div>' +
        '<div class="field grow"><label>Search</label><input type="search" id="opQ" placeholder="Main head or ledger..."></div>' +
      '</div>' +
      '<p class="sub op-orders-info" id="opOrdersInfo"></p>' +
      '<div class="panel table-wrap" id="opTable"></div>' +
    '</div>' +

    // Add Data: one date, the No. of Orders for it, and an amount for every ledger of the table
    '<dialog id="opDataDialog" class="op-wide"><form id="opDataForm" novalidate>' +
      '<h3>Add Data</h3>' +
      '<div class="op-data-top">' +
        '<div class="field"><label for="odDate">Date</label><input type="date" id="odDate"></div>' +
        '<div class="field"><label for="odOrders">No. of Orders</label><input type="number" id="odOrders" min="0" step="1" inputmode="numeric" placeholder="0"></div>' +
      '</div>' +
      '<div class="op-dlg-body"><div class="table-wrap"><table class="op-dt">' +
        '<thead><tr><th>Ledger</th><th class="num">Amount (&#8377;)</th></tr></thead><tbody id="odList"></tbody></table></div></div>' +
      '<p class="form-error" id="odError"></p>' +
      '<div class="dlg-actions">' +
        '<button type="button" class="btn btn-ghost" data-act="cancel-data">Cancel</button>' +
        '<button type="submit" class="btn btn-primary">Save data</button>' +
      '</div>' +
    '</form></dialog>' +

    // Saved Data: every saved date on its own, with its amounts
    '<dialog id="opSavedDialog" class="op-wide"><form method="dialog" novalidate>' +
      '<h3>Saved Data</h3>' +
      '<div class="panel filters">' +
        '<div class="field"><label>From</label><input type="date" id="svFrom"></div>' +
        '<div class="field"><label>To</label><input type="date" id="svTo"></div>' +
        '<div class="field grow"><label>Search</label><input type="search" id="svQ" placeholder="Date, ledger or amount..."></div>' +
      '</div>' +
      '<div class="sv-bar">' +
        '<label class="pick-all"><input type="checkbox" id="svAll" data-sv="all"><span>Select all</span><span class="muted" id="svCount"></span></label>' +
        '<button type="button" class="btn btn-danger btn-sm" id="svDel" data-act="sv-del-sel" hidden>Delete selected</button>' +
      '</div>' +
      '<div class="op-dlg-body" id="svList"></div>' +
      '<div class="dlg-actions"><button type="button" class="btn btn-ghost" data-act="close-saved">Close</button></div>' +
    '</form></dialog>' +

    '<dialog id="opDialog" class="op-wide"><form id="opForm" novalidate>' +
      '<h3>Create Table</h3>' +
      '<div class="op-dlg-body"><div class="op-grid">' + side('income') + side('expense') + '</div></div>' +
      '<p class="form-error" id="opError"></p>' +
      '<div class="dlg-actions">' +
        '<button type="button" class="btn btn-ghost" data-act="cancel">Cancel</button>' +
        '<button type="submit" class="btn btn-primary">Save table</button>' +
      '</div>' +
    '</form></dialog>' +
    '</section>';

  function $(sel) { return root.querySelector(sel); }

  // ---- the pop-up: heads and their ledgers ----------------------------------
  function renderDraft() {
    var known = {};
    (P.ledgers ? P.ledgers.all() : []).forEach(function (l) { known[l.name] = true; });

    Object.keys(TYPES).forEach(function (type) {
      var heads = of(draft, type);
      $('#op-' + type).innerHTML = heads.length ? heads.map(function (h) {
        return '<div class="op-head">' +
          '<div class="op-head-top">' +
            '<input type="text" class="op-name-input" data-op="name" data-id="' + h.id + '" value="' + esc(h.name) + '" maxlength="60" ' +
              'placeholder="Main Head" aria-label="Main head name" autocomplete="off">' +
            '<button type="button" class="icon-btn danger" data-act="del-head" data-id="' + h.id + '" title="Remove this head" aria-label="Remove this head">&#10005;</button>' +
          '</div>' +
          '<div class="op-chips">' + h.ledgers.map(function (n) {
            return '<span class="op-chip' + (known[n] ? '' : ' gone') + '" title="' + (known[n] ? '' : 'Not in Tally Ledgers') + '">' + esc(n) +
              '<button type="button" data-act="rm-ledger" data-id="' + h.id + '" data-name="' + esc(n) + '" aria-label="Remove ' + esc(n) + '">&times;</button></span>';
          }).join('') +
            '<button type="button" class="op-add" data-act="add-ledger" data-id="' + h.id + '">+ Ledger</button>' +
          '</div></div>';
      }).join('') : '<p class="muted">No ' + TYPES[type].label + ' heads yet.</p>';
    });
  }

  function openTable() {
    draft = JSON.parse(JSON.stringify(data.heads));
    ['income', 'expense'].forEach(function (type) {         // a first empty row on each side to start typing in
      if (!of(draft, type).length) draft.push({ id: P.uid(), type: type, name: '', ledgers: [] });
    });
    $('#opError').textContent = '';
    renderDraft();
    $('#opDialog').showModal();
    var first = root.querySelector('.op-name-input');
    if (first) first.focus();
  }

  function addHead(type) {
    var h = { id: P.uid(), type: type, name: '', ledgers: [] };
    draft.push(h);
    renderDraft();
    var input = root.querySelector('.op-name-input[data-id="' + h.id + '"]');
    if (input) input.focus();
  }

  async function addLedger(btn) {
    var h = draftHead(btn.dataset.id);
    if (!h) return;
    var names = availableLedgers(h.type);
    if (!names.length) {
      P.toast('No more ' + TYPES[h.type].label + ' ledgers available. Create them under ' + TYPES[h.type].nature + ' in Tally Ledgers.', true);
      return;
    }
    var name = await P.pick(btn, names.map(function (n) { return { value: n, label: n }; }), '', '');
    if (name === null || name === '') { btn.focus(); return; }
    h.ledgers.push(name);
    renderDraft();
    var again = root.querySelector('.op-add[data-id="' + h.id + '"]');       // ready to add the next ledger
    if (again) again.focus();
  }

  function saveTable(ev) {
    ev.preventDefault();
    var problem = '', clean = [], seen = {};
    draft.forEach(function (h) {
      var name = h.name.trim().replace(/\s+/g, ' ');
      if (!name && !h.ledgers.length) return;                                  // an empty row is just dropped
      if (!name) { problem = problem || 'A ' + TYPES[h.type].label + ' head has ledgers but no name.'; return; }
      if (!h.ledgers.length) { problem = problem || '"' + name + '" needs at least one ledger.'; return; }
      var key = h.type + '|' + name.toLowerCase();
      if (seen[key]) { problem = problem || 'There are two ' + TYPES[h.type].label + ' heads named "' + name + '".'; return; }
      seen[key] = true;
      clean.push({ id: h.id, type: h.type, name: name, ledgers: h.ledgers.slice() });
    });
    if (problem) { $('#opError').textContent = problem; return; }

    data.heads = clean;
    if (!save()) return;
    $('#opDialog').close();
    if (!filters.from && !filters.to) {                                         // first table: start on this month
      var m = monthRange(0);
      filters.from = m.from; filters.to = m.to;
      $('#opFrom').value = m.from;
      $('#opTo').value = m.to;
    }
    renderStatement();
    P.toast('Table saved');
  }

  // ---- the statement: Income on the left, Expense on the right ---------------
  function monthRange(offset) {
    var now = new Date();
    return {
      from: P.isoDate(new Date(now.getFullYear(), now.getMonth() + offset, 1)),
      to: P.isoDate(new Date(now.getFullYear(), now.getMonth() + offset + 1, 0))
    };
  }

  function cents(n) { return Math.round(n * 100); }
  function fmt(c) { return money(c / 100); }

  function inPeriod(date) { return !(filters.from && date < filters.from) && !(filters.to && date > filters.to); }

  // Cash Book vouchers and Add Data amounts in the period, added up per ledger name
  function ledgerTotals() {
    var doc = P.store.get('cashbook', null) || {}, sums = {};
    function of1(name) { return sums[name] || (sums[name] = { inn: 0, out: 0, added: 0 }); }
    (doc.entries || []).forEach(function (e) {
      if (!inPeriod(e.date)) return;
      var s = of1(e.particulars);
      if (e.type === 'in') s.inn += cents(e.amount); else s.out += cents(e.amount);
    });
    data.entries.forEach(function (e) { if (inPeriod(e.date)) of1(e.ledger).added += cents(e.amount); });
    return sums;
  }

  // total No. of Orders for the dates in the period
  function ordersInPeriod() {
    return data.orders.reduce(function (n, o) { return inPeriod(o.date) ? n + (parseFloat(o.orders) || 0) : n; }, 0);
  }

  function renderStatement() {
    var has = data.heads.length > 0;
    $('#opStatement').hidden = !has;
    if (!has) return;

    var sums = ledgerTotals(), q = filters.q.trim().toLowerCase();
    var orders = ordersInPeriod();
    // Per Order = the amount divided by the No. of Orders in the period (a dash while there are none)
    function perOrder(c) { return orders > 0 ? fmt(c / orders) : '&mdash;'; }
    $('#opOrdersInfo').textContent = orders > 0 ? 'No. of Orders in this period: ' + orders :
      'No. of Orders for this period: none yet. Use Add Data to enter them for Per Order.';

    // one list of lines per side: a shaded line for each main head, its ledgers indented under it
    var lines = { income: [], expense: [] }, total = { income: 0, expense: 0 };
    Object.keys(TYPES).forEach(function (type) {
      of(data.heads, type).forEach(function (h) {
        var headHit = !q || h.name.toLowerCase().indexOf(q) !== -1;
        var shown = h.ledgers.slice().sort(function (a, b) { return a.localeCompare(b); })
          .filter(function (n) { return headHit || n.toLowerCase().indexOf(q) !== -1; });
        if (!shown.length) return;

        var headAmt = 0, rows = [];
        shown.forEach(function (n) {
          var s = sums[n] || { inn: 0, out: 0, added: 0 };
          var amt = (type === 'income' ? s.inn - s.out : s.out - s.inn) + s.added;
          headAmt += amt;
          rows.push({ label: n, amt: amt, head: false });
        });
        total[type] += headAmt;
        lines[type].push({ label: h.name, head: true });                                // the head: just its name
        rows.forEach(function (r) { lines[type].push(r); });
        lines[type].push({ label: 'Total ' + h.name, amt: headAmt, subtotal: true });   // the head's total, after its ledgers
      });
    });

    // Net profit balances the Expense side, Net loss balances the Income side (as in an income and expenditure account)
    var net = total.income - total.expense;
    var count = Math.max(lines.income.length, lines.expense.length, 1);

    // one side of a row: a head name (no amounts), a ledger, or the total of a head
    function half(line, type, cls) {
      if (!line) return '<td class="' + cls + '"></td><td class="num"></td><td class="num"></td>';
      var tone = type === 'income' ? 'in' : 'out';
      if (line.head) {
        return '<td class="' + cls + ' op-head-cell"><b>' + esc(line.label) + '</b></td><td class="num op-head-cell"></td><td class="num op-head-cell"></td>';
      }
      if (line.subtotal) {
        return '<td class="' + cls + ' op-sub"><b>' + esc(line.label) + '</b></td>' +
          '<td class="num op-sub ' + tone + '"><b>' + fmt(line.amt) + '</b></td><td class="num op-sub ' + tone + '"><b>' + perOrder(line.amt) + '</b></td>';
      }
      return '<td class="' + cls + ' op-indent">' + esc(line.label) + '</td>' +
        '<td class="num ' + tone + '">' + fmt(line.amt) + '</td><td class="num ' + tone + '">' + perOrder(line.amt) + '</td>';
    }
    // a total row: a label and an amount on each side (or nothing on a side)
    // (each side is coloured: green for Income, orange for Expense)
    function foot(labelL, amtL, labelR, amtR) {
      function cellsFor(label, amt, type, cls) {
        var tint = type === 'in' ? 'op-tot-in' : 'op-tot-out';
        return label
          ? '<td class="' + cls + ' ' + tint + '"><b>' + label + '</b></td><td class="num ' + tint + '"><b>' + fmt(amt) + '</b></td><td class="num ' + tint + '"><b>' + perOrder(amt) + '</b></td>'
          : '<td class="' + cls + ' ' + tint + '"></td><td class="num ' + tint + '"></td><td class="num ' + tint + '"></td>';
      }
      return '<tr class="row-total">' + cellsFor(labelL, amtL, 'in', '') + cellsFor(labelR, amtR, 'out', 'op-split') + '</tr>';
    }

    var body = '';
    for (var i = 0; i < count; i++) {
      body += '<tr>' + half(lines.income[i], 'income', '') + half(lines.expense[i], 'expense', 'op-split') + '</tr>';
    }
    if (!lines.income.length && !lines.expense.length) {
      body = '<tr><td colspan="6" class="empty">Nothing matches your search.</td></tr>';
    }
    var shownTag = q ? ' (shown)' : '';
    body += foot('Total Income' + shownTag, total.income, 'Total Expense' + shownTag, total.expense);
    body += net >= 0 ? foot('', 0, 'Net profit', net) : foot('Net loss', -net, '', 0);

    $('#opTable').innerHTML =
      '<table class="op-h"><thead>' +
        '<tr><th colspan="3" class="op-group op-g-in">Income</th><th colspan="3" class="op-group op-g-out op-split">Expense</th></tr>' +
        '<tr><th>Particulars</th><th class="num">Amount (&#8377;)</th><th class="num">Per Order (&#8377;)</th>' +
        '<th class="op-split">Particulars</th><th class="num">Amount (&#8377;)</th><th class="num">Per Order (&#8377;)</th></tr>' +
      '</thead><tbody>' + body + '</tbody></table>';
  }

  // ---- Add Data pop-up: one date, then an amount for every ledger of the table ------------
  function byDateAsc(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; }

  // what is already saved for a date
  function savedFor(date) {
    var amounts = {};
    data.entries.forEach(function (e) { if (e.date === date) amounts[e.ledger] = (amounts[e.ledger] || 0) + e.amount; });
    Object.keys(amounts).forEach(function (n) { amounts[n] = String(Math.round(amounts[n] * 100) / 100); });
    var o = data.orders.filter(function (x) { return x.date === date; })[0];
    return { orders: o ? String(o.orders) : '', amounts: amounts };
  }
  function editsFor(date) { return dd.edits[date] || (dd.edits[date] = savedFor(date)); }

  // the list of every ledger in the table: Income heads and their ledgers, then Expense heads and theirs
  function renderList() {
    var e = editsFor(dd.date), html = '';
    Object.keys(TYPES).forEach(function (type) {
      var heads = of(data.heads, type).filter(function (h) { return h.ledgers.length; });
      html += '<tr class="op-sec op-sec-' + type + '"><td colspan="2">' + TYPES[type].label + '</td></tr>';
      if (!heads.length) html += '<tr><td colspan="2" class="empty">No ' + TYPES[type].label + ' heads in the table.</td></tr>';
      heads.forEach(function (h) {
        html += '<tr class="op-head-cell"><td colspan="2"><b>' + esc(h.name) + '</b></td></tr>';
        h.ledgers.slice().sort(function (a, b) { return a.localeCompare(b); }).forEach(function (n) {
          html += '<tr><td class="op-indent">' + esc(n) + '</td><td class="num"><input type="number" step="0.01" inputmode="decimal" data-la="' + esc(n) +
            '" value="' + esc(e.amounts[n] || '') + '" placeholder="0.00" aria-label="Amount for ' + esc(n) + '"></td></tr>';
        });
      });
    });
    $('#odList').innerHTML = html;
  }

  function showDate() {
    var e = editsFor(dd.date);
    $('#odDate').value = dd.date;
    $('#odOrders').value = e.orders;
    renderList();
  }

  function openData(date) {
    if (!tableLedgers().length) { P.toast('Create the table first, so there are ledgers to add data for.', true); return; }
    dd = { date: date || P.isoDate(), edits: {} };
    $('#odError').textContent = '';
    showDate();
    $('#opDataDialog').showModal();
    $('#odOrders').focus();
  }

  // keep what is typed; returns true when the box belongs to this pop-up
  function onDataInput(t) {
    if (t.id === 'odDate') { if (t.value) { dd.date = t.value; showDate(); } return true; }     // another date: show that day
    if (t.id === 'odOrders') { editsFor(dd.date).orders = t.value; return true; }
    if (t.dataset && t.dataset.la !== undefined) { editsFor(dd.date).amounts[t.dataset.la] = t.value; return true; }
    return false;
  }

  function saveData(ev) {
    ev.preventDefault();
    var problem = '';
    Object.keys(dd.edits).forEach(function (date) {
      var e = dd.edits[date], o = e.orders === '' ? 0 : parseFloat(e.orders);
      if (isNaN(o) || o < 0) problem = problem || 'Enter a valid No. of Orders for ' + P.fmtDate(date) + '.';
      Object.keys(e.amounts).forEach(function (n) {
        if (e.amounts[n] !== '' && isNaN(parseFloat(e.amounts[n]))) problem = problem || 'Enter a valid amount for ' + n + ' on ' + P.fmtDate(date) + '.';
      });
    });
    if (problem) { $('#odError').textContent = problem; return; }

    // each date you visited replaces what was saved for that date
    Object.keys(dd.edits).forEach(function (date) {
      var e = dd.edits[date];
      data.entries = data.entries.filter(function (x) { return x.date !== date; });
      data.orders = data.orders.filter(function (x) { return x.date !== date; });
      Object.keys(e.amounts).forEach(function (n) {
        var a = Math.round(parseFloat(e.amounts[n]) * 100) / 100;
        if (e.amounts[n] !== '' && a !== 0) data.entries.push({ id: P.uid(), date: date, ledger: n, amount: a });
      });
      var o = e.orders === '' ? 0 : parseFloat(e.orders);
      if (o > 0) data.orders.push({ id: P.uid(), date: date, orders: o });
    });
    data.entries.sort(byDateAsc);
    data.orders.sort(byDateAsc);
    if (!save()) return;
    $('#opDataDialog').close();
    renderStatement();
    P.toast('Data saved');
  }

  // ---- Saved Data pop-up: every saved ledger amount on its own, grouped by date ------------
  //   From / To dates, search, tick lines (or a whole date, or Select all), delete, or change an amount right in the list
  var sv = { from: '', to: '', q: '', picked: {}, shown: [], groups: [] };     // picked / shown hold saved-amount ids

  function typeOfLedger(name) {
    var h = data.heads.filter(function (x) { return x.ledgers.indexOf(name) !== -1; })[0];
    return h ? h.type : '';
  }
  function typeRank(name) { var t = typeOfLedger(name); return t === 'income' ? 0 : t === 'expense' ? 1 : 2; }

  // the saved dates that pass the From / To dates and the search, each with its ledger lines
  function savedGroups() {
    var dates = {}, q = sv.q.trim().toLowerCase(), out = [];
    data.entries.forEach(function (e) { dates[e.date] = true; });
    data.orders.forEach(function (o) { dates[o.date] = true; });

    Object.keys(dates).sort().reverse().forEach(function (date) {          // newest date first
      if (sv.from && date < sv.from) return;
      if (sv.to && date > sv.to) return;
      var o = data.orders.filter(function (x) { return x.date === date; })[0];
      var lines = data.entries.filter(function (e) { return e.date === date; });
      if (q) {
        var dateHit = (P.fmtDate(date) + ' orders ' + (o ? o.orders : '')).toLowerCase().indexOf(q) !== -1;
        if (!dateHit) {
          lines = lines.filter(function (e) { return (e.ledger + ' ' + e.amount + ' ' + fmt(cents(e.amount))).toLowerCase().indexOf(q) !== -1; });
          if (!lines.length) return;
        }
      }
      lines.sort(function (a, b) { return typeRank(a.ledger) - typeRank(b.ledger) || a.ledger.localeCompare(b.ledger); });
      out.push({ date: date, orders: o, lines: lines });
    });
    return out;
  }

  function dateTotals(date) {
    var inc = 0, exp = 0;
    data.entries.forEach(function (e) {
      if (e.date !== date) return;
      var t = typeOfLedger(e.ledger);
      if (t === 'income') inc += cents(e.amount); else if (t === 'expense') exp += cents(e.amount);
    });
    return { inc: inc, exp: exp };
  }

  function renderSaved() {
    var groups = savedGroups();
    sv.groups = groups.map(function (g) { return { date: g.date, ids: g.lines.map(function (e) { return e.id; }) }; });
    sv.shown = [];
    sv.groups.forEach(function (g) { sv.shown = sv.shown.concat(g.ids); });
    Object.keys(sv.picked).forEach(function (id) { if (sv.shown.indexOf(id) === -1) delete sv.picked[id]; });   // only what is listed stays ticked

    var body = groups.map(function (g) {
      var t = dateTotals(g.date), ids = g.lines.map(function (e) { return e.id; });
      var head = '<tr class="sv-group"><td class="chk"><input type="checkbox" data-sv="date" data-date="' + g.date + '"' +
          (ids.length && ids.every(function (id) { return sv.picked[id]; }) ? ' checked' : '') + (ids.length ? '' : ' disabled') + ' aria-label="Select every line of ' + P.fmtDate(g.date) + '"></td>' +
        '<td colspan="3"><b class="sv-date">' + P.fmtDate(g.date) + '</b>' +
          '<span class="sv-meta">Orders: <b>' + (g.orders ? g.orders.orders : 0) + '</b></span>' +
          '<span class="sv-meta in">Income &#8377; <span data-tot="inc" data-date="' + g.date + '">' + fmt(t.inc) + '</span></span>' +
          '<span class="sv-meta out">Expense &#8377; <span data-tot="exp" data-date="' + g.date + '">' + fmt(t.exp) + '</span></span></td>' +
        '<td class="actions"><button type="button" class="btn btn-ghost btn-sm" data-act="sv-edit" data-date="' + g.date + '">Edit</button>' +
          '<button type="button" class="icon-btn danger" data-act="sv-del" data-date="' + g.date + '" title="Delete this whole date" aria-label="Delete all data for ' + P.fmtDate(g.date) + '">&#10005;</button></td></tr>';
      var rows = g.lines.map(function (e) {
        var type = typeOfLedger(e.ledger);
        return '<tr' + (sv.picked[e.id] ? ' class="tick"' : '') + '><td class="chk"><input type="checkbox" data-sv="row" data-id="' + e.id + '"' + (sv.picked[e.id] ? ' checked' : '') +
            ' aria-label="Select ' + esc(e.ledger) + '"></td>' +
          '<td class="op-indent">' + esc(e.ledger) + '</td>' +
          '<td>' + (type ? '<span class="tag tag-' + (type === 'income' ? 'ok' : 'warn') + '">' + TYPES[type].label + '</span>' : '<span class="muted">not in table</span>') + '</td>' +
          '<td class="num"><input type="number" step="0.01" inputmode="decimal" class="sv-amt" data-svamt="' + e.id + '" value="' + e.amount + '" aria-label="Amount for ' + esc(e.ledger) + '"></td>' +
          '<td class="actions"><button type="button" class="icon-btn danger" data-act="sv-line-del" data-id="' + e.id + '" title="Delete this ledger amount" aria-label="Delete ' + esc(e.ledger) + '">&#10005;</button></td></tr>';
      }).join('');
      return head + (rows || '<tr><td></td><td colspan="4" class="muted">Only the No. of Orders is saved for this date.</td></tr>');
    }).join('');

    $('#svList').innerHTML = groups.length
      ? '<div class="table-wrap"><table class="op-dt sv-table"><thead><tr><th class="chk"></th><th>Date / Ledger</th><th>Type</th><th class="num">Amount (&#8377;)</th><th></th></tr></thead><tbody>' + body + '</tbody></table></div>'
      : '<p class="muted">' + (data.entries.length || data.orders.length ? 'No saved data matches your dates or search.' : 'Nothing saved yet. Use <b>Add Data</b>.') + '</p>';
    syncSaved();
  }

  // Select all box, the count and the Delete selected button (and each date's own tick box)
  function syncSaved() {
    var n = Object.keys(sv.picked).length, all = $('#svAll');
    all.disabled = !sv.shown.length;
    all.checked = sv.shown.length > 0 && sv.shown.every(function (id) { return sv.picked[id]; });
    all.indeterminate = !all.checked && n > 0;
    $('#svCount').textContent = n ? n + ' selected' : (sv.shown.length + ' ledger amount' + (sv.shown.length === 1 ? '' : 's'));
    $('#svDel').hidden = !n;
    $('#svDel').textContent = 'Delete ' + n + ' selected';
    sv.groups.forEach(function (g) {
      var cb = root.querySelector('[data-sv="date"][data-date="' + g.date + '"]');
      if (cb) cb.checked = g.ids.length > 0 && g.ids.every(function (id) { return sv.picked[id]; });
    });
  }

  function tickLine(id, on) {
    if (on) sv.picked[id] = true; else delete sv.picked[id];
    var cb = root.querySelector('[data-sv="row"][data-id="' + id + '"]');
    if (cb) { cb.checked = on; cb.closest('tr').classList.toggle('tick', on); }
  }

  function openSaved() {
    sv = { from: '', to: '', q: '', picked: {}, shown: [], groups: [] };
    $('#svFrom').value = '';
    $('#svTo').value = '';
    $('#svQ').value = '';
    renderSaved();
    $('#opSavedDialog').showModal();
  }

  // change one ledger amount right in the list (the totals for its date are updated in place)
  function changeAmount(input) {
    var e = data.entries.filter(function (x) { return x.id === input.dataset.svamt; })[0];
    if (!e) return;
    var a = parseFloat(input.value);
    if (isNaN(a) || a === 0) {
      input.value = e.amount;
      P.toast('Enter an amount. To remove this line use the \u2715 on its row.', true);
      return;
    }
    e.amount = Math.round(a * 100) / 100;
    input.value = e.amount;
    if (!save()) return;
    var t = dateTotals(e.date);
    [['inc', t.inc], ['exp', t.exp]].forEach(function (p) {
      var span = root.querySelector('[data-tot="' + p[0] + '"][data-date="' + e.date + '"]');
      if (span) span.textContent = fmt(p[1]);
    });
    renderStatement();
  }

  async function deleteLine(id) {
    var e = data.entries.filter(function (x) { return x.id === id; })[0];
    if (!e) return;
    var ok = await P.confirm({
      title: 'Delete this ledger amount?',
      message: e.ledger + ' \u00B7 \u20B9 ' + money(e.amount) + ' on ' + P.fmtDate(e.date) + '. This cannot be undone.',
      confirmText: 'Delete'
    });
    if (!ok) return;
    data.entries = data.entries.filter(function (x) { return x.id !== id; });
    delete sv.picked[id];
    save();
    renderSaved();
    renderStatement();
    P.toast('Deleted');
  }

  // delete every ticked ledger amount
  async function deleteSelectedLines() {
    var ids = Object.keys(sv.picked);
    if (!ids.length) return;
    var ok = await P.confirm({
      title: 'Delete ' + ids.length + ' ledger amount' + (ids.length === 1 ? '' : 's') + '?',
      message: 'The ' + ids.length + ' ticked ledger amount' + (ids.length === 1 ? '' : 's') + ' will be removed. The No. of Orders for their dates stays. This cannot be undone.',
      confirmText: 'Delete ' + ids.length
    });
    if (!ok) return;
    data.entries = data.entries.filter(function (x) { return !sv.picked[x.id]; });
    sv.picked = {};
    save();
    renderSaved();
    renderStatement();
    P.toast(ids.length + ' deleted');
  }

  // delete a whole date: all its ledger amounts and its No. of Orders
  async function deleteDate(date) {
    var n = data.entries.filter(function (e) { return e.date === date; }).length;
    var ok = await P.confirm({
      title: 'Delete all the data for ' + P.fmtDate(date) + '?',
      message: n + ' ledger amount' + (n === 1 ? '' : 's') + ' and the No. of Orders saved for that date will be removed. This cannot be undone.',
      confirmText: 'Delete'
    });
    if (!ok) return;
    data.entries = data.entries.filter(function (e) { return e.date !== date; });
    data.orders = data.orders.filter(function (o) { return o.date !== date; });
    sv.picked = {};
    save();
    renderSaved();
    renderStatement();
    P.toast('Deleted');
  }

  // ---- module interface -------------------------------------------------
  P.register({
    id: 'operationalstatement',
    title: 'Operational Statement',
    icon: '&#9639;',
    mount: function (container) {
      data = load();
      var m = monthRange(0);
      filters = { from: m.from, to: m.to, q: '' };
      container.innerHTML = TEMPLATE;
      // listeners live on the inner section, so they go away when the page is replaced
      root = container.querySelector('.op');
      $('#opFrom').value = filters.from;
      $('#opTo').value = filters.to;
      renderStatement();

      root.addEventListener('click', function (e) {
        var b = e.target.closest('[data-act]');
        if (!b) return;
        switch (b.dataset.act) {
          case 'create-table': openTable(); break;
          case 'add-data': openData(); break;
          case 'saved-data': openSaved(); break;
          case 'close-saved': $('#opSavedDialog').close(); break;
          case 'sv-edit': e.preventDefault(); $('#opSavedDialog').close(); openData(b.dataset.date); break;
          case 'sv-del': e.preventDefault(); deleteDate(b.dataset.date); break;
          case 'sv-del-sel': deleteSelectedLines(); break;
          case 'sv-line-del': deleteLine(b.dataset.id); break;
          case 'cancel-data': $('#opDataDialog').close(); break;
          case 'cancel': $('#opDialog').close(); break;
          case 'add-head': addHead(b.dataset.type); break;
          case 'add-ledger': addLedger(b); break;
          case 'rm-ledger':
            var h = draftHead(b.dataset.id);
            if (h) { h.ledgers = h.ledgers.filter(function (n) { return n !== b.dataset.name; }); renderDraft(); }
            break;
          case 'del-head': draft = draft.filter(function (x) { return x.id !== b.dataset.id; }); renderDraft(); break;
        }
      });

      root.addEventListener('change', function (e) {
        var t = e.target;
        if (t.dataset && t.dataset.op === 'name') {                // a head's name in the pop-up
          var h = draftHead(t.dataset.id);
          if (h) h.name = t.value;
        }
        if (t.dataset && t.dataset.sv) {                           // Saved Data: a line's tick box, a date's tick box, or Select all
          if (t.dataset.sv === 'all') sv.shown.forEach(function (id) { tickLine(id, t.checked); });
          else if (t.dataset.sv === 'date') {
            var grp = sv.groups.filter(function (g) { return g.date === t.dataset.date; })[0];
            if (grp) grp.ids.forEach(function (id) { tickLine(id, t.checked); });
          } else tickLine(t.dataset.id, t.checked);
          syncSaved();
          return;
        }
        if (t.dataset && t.dataset.svamt !== undefined) { changeAmount(t); return; }   // an amount changed in the Saved Data list
        if (t.dataset) onDataInput(t);                             // Add Data boxes
      });
      $('#opDataForm').addEventListener('submit', saveData);
      root.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && e.target.dataset && e.target.dataset.op === 'name') { e.preventDefault(); e.target.blur(); }

        // Add Data: Enter moves down to the next amount box, so the list can be filled from the keyboard
        var inData = e.target.id === 'odOrders' || (e.target.dataset && e.target.dataset.la !== undefined);
        if (e.key === 'Enter' && inData) {
          e.preventDefault();
          var boxes = Array.prototype.slice.call(root.querySelectorAll('#opDataDialog #odOrders, #opDataDialog [data-la]'));
          var next = boxes[boxes.indexOf(e.target) + 1];
          if (next) next.focus();
        }
      });
      $('#opForm').addEventListener('submit', function (ev) {
        // the name box being typed in when Save is pressed counts, so read the boxes first
        Array.prototype.forEach.call(root.querySelectorAll('.op-name-input'), function (i) {
          var h = draftHead(i.dataset.id);
          if (h) h.name = i.value;
        });
        saveTable(ev);
      });

      // statement filters
      root.addEventListener('input', function (e) {
        var id = e.target.id;
        if (onDataInput(e.target)) return;                          // Add Data boxes
        if (id === 'svFrom' || id === 'svTo' || id === 'svQ') {     // Saved Data: dates and search
          if (id === 'svFrom') sv.from = e.target.value; else if (id === 'svTo') sv.to = e.target.value; else sv.q = e.target.value;
          renderSaved();
          return;
        }
        if (id === 'opFrom') filters.from = e.target.value;
        else if (id === 'opTo') filters.to = e.target.value;
        else if (id === 'opQ') filters.q = e.target.value;
        else return;
        renderStatement();
      });
    }
  });
})();
