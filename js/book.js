/* Potafo Accounts - book engine
   Cash Book and Bank Statement are the same kind of screen: pick an account (a ledger from Tally Ledgers),
   enter dated vouchers with a running balance, filter, export. Each module calls Potafo.createBook(config)
   with its own name, data key and wording, so each keeps its own separate data.

   config = {
     id, title, icon,                      // sidebar module
     key,                                  // where its data is saved (Potafo.store key)
     prefix,                               // voucher prefix, e.g. 'CB-'
     kinds,                                // which Tally ledgers can be an account: ['cash', 'bank'] or ['bank']
     defaultAccount,                       // account that older entries (saved before accounts existed) belong to
     accountLabel,                         // label above the account dropdown
     inWord, outWord,                      // 'Receipt' / 'Payment'   (or 'Deposit' / 'Withdrawal')
     inWords, outWords,                    // plural of the above
     refLabel,                             // label for the optional reference box
     balance,                              // 'drcr' shows Dr / Cr,  'plain' shows a signed amount
     emptyNoun, emptyText,                 // text when no matching ledger exists yet
     openingNote                           // sentence in the opening balance box
   }
*/
(function () {
  'use strict';

  var P = window.Potafo;

  P.createBook = function (cfg) {
    var esc = P.esc, money = P.money;
    var KEY = cfg.key;
    var IN = cfg.inWord, OUT = cfg.outWord, INS = cfg.inWords, OUTS = cfg.outWords;
    var drcr = cfg.balance !== 'plain';

    var root, data, filters, editingId = null, lastDate = '';
    var picked = {};       // vouchers ticked for deleting: id -> true
    var shownIds = [];     // the vouchers currently listed
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

    // Entries made before accounts existed belong to the default account (or the first one)
    function defaultAccount() {
      return cfg.defaultAccount && hasAccount(cfg.defaultAccount) ? cfg.defaultAccount : (accounts[0] ? accounts[0].name : '');
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

    // <option>s for the Particulars dropdown: a plain A-Z list of ledger names (no group headings).
    // The account being shown is left out. Other cash/bank ledgers stay, for transfers.
    // A name saved earlier that is no longer a ledger is kept so old entries can be edited.
    function ledgerOptions(selected) {
      var names = (P.ledgers ? P.ledgers.all() : []).map(function (l) { return l.name; })
        .filter(function (n) { return n !== active; });
      if (selected && names.indexOf(selected) === -1) names.push(selected);
      names.sort(function (a, b) { return a.localeCompare(b); });
      return '<option value="">Select ledger...</option>' + names.map(function (n) {
        return '<option value="' + esc(n) + '"' + (n === selected ? ' selected' : '') + '>' + esc(n) + '</option>';
      }).join('');
    }

    // ---- markup -----------------------------------------------------------
    // the menu button icon: three lines
    var MENU_ICON = '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">' +
      '<path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>';

    var TEMPLATE =
      '<section class="cb">' +
      // The dropdown takes the place of the page title: pick the ledger to work in
      '<div class="cb-head">' +
        '<div class="field acc-select" id="accField"><label for="accSelect">' + esc(cfg.accountLabel) + '</label><select id="accSelect"></select></div>' +
      '</div>' +

      '<div class="panel empty-state" id="cbEmpty" hidden>' +
        '<h3>' + esc(cfg.title) + ': no ' + esc(cfg.emptyNoun) + ' yet</h3>' +
        '<p class="muted">' + cfg.emptyText + ' <a href="#/ledgers">Create one in Tally Ledgers</a> and it will appear here.</p>' +
      '</div>' +

      '<div id="cbMain">' +
      '<div class="cards" id="cbCards"></div>' +

      // New entry: Date, Particulars, Amount, then the in/out slider
      '<form class="panel entry" id="cbForm" novalidate>' +
        '<div class="entry-head"><h3 id="eTitle">New entry</h3><span class="muted">F2 ' + IN + ' &middot; F3 ' + OUT + '</span></div>' +
        '<div class="entry-grid">' +
          '<div class="field e-date"><label for="eDate">Date</label><input type="date" id="eDate" required></div>' +
          '<div class="field e-part"><label for="eParticulars">Particulars <span class="muted">(ledger)</span></label><select id="eParticulars"></select></div>' +
          '<div class="field e-amt"><label for="eAmount">Amount (&#8377;)</label><input type="number" id="eAmount" step="0.01" min="0.01" inputmode="decimal" required></div>' +
          '<div class="field e-type"><label for="eType">Type</label>' +
            '<span class="tswitch">' +
              '<input type="checkbox" id="eType" role="switch" aria-label="' + OUT + ' (switch off means ' + IN + ')">' +
              '<span class="tsw-track"><span class="tsw-thumb"></span>' +
                '<span class="tsw-lab lab-in">' + IN + '</span><span class="tsw-lab lab-out">' + OUT + '</span></span>' +
            '</span></div>' +
          '<div class="field e-ref"><label for="eRef">' + esc(cfg.refLabel) + ' <span class="muted">(optional)</span></label><input type="text" id="eRef" maxlength="40"></div>' +
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
          '<option value="all">All entries</option><option value="in">' + INS + ' only</option><option value="out">' + OUTS + ' only</option></select></div>' +
        '<div class="field grow"><label>Search</label><input type="search" id="fQ" placeholder="Particulars, voucher, reference..."></div>' +
        '<button type="button" class="kebab kebab-field" aria-haspopup="menu" aria-expanded="false"' +
          ' title="Menu" aria-label="' + esc(cfg.title) + ' menu">' + MENU_ICON + '</button>' +
      '</div>' +
      '<div class="quick">' +
        '<button class="chip" data-act="range-today">Today</button>' +
        '<button class="chip" data-act="range-month">This month</button>' +
        '<button class="chip" data-act="range-last">Last month</button>' +
        '<button class="chip" data-act="range-all">All time</button>' +
        '<span class="spacer"></span>' +
        '<button class="chip chip-export" data-act="xlsx">Export Excel</button>' +
        '<button class="chip chip-export" data-act="pdf">Export PDF</button>' +
      '</div>' +

      '<div class="panel table-wrap" id="cbTable"></div>' +

      // Opening balance
      '<dialog id="cbOpenDialog"><form method="dialog" novalidate>' +
        '<h3 id="oTitle">Opening balance</h3>' +
        '<p class="muted">' + esc(cfg.openingNote) + '</p>' +
        '<div class="field"><label for="oAmount">Amount (&#8377;)</label><input type="number" id="oAmount" step="0.01" inputmode="decimal"></div>' +
        '<div class="dlg-actions">' +
          '<button type="button" class="btn btn-ghost" data-act="open-cancel">Cancel</button>' +
          '<button type="button" class="btn btn-primary" data-act="open-save">Save</button>' +
        '</div>' +
      '</form></dialog>' +

      // Pick a voucher to edit or delete (opened from the menu)
      '<dialog id="cbPickDialog" class="pick-wide"><form method="dialog" novalidate>' +
        '<h3 id="pTitle">Edit a voucher</h3>' +
        '<div class="field" id="pOne"><label for="pVoucher">Voucher</label><select id="pVoucher"></select></div>' +
        // Delete a voucher: tick several, or Select all
        '<div id="pMany" hidden>' +
          '<div class="field"><label for="pSearch">Search vouchers</label><input type="search" id="pSearch" placeholder="Voucher, ledger, date, amount..."></div>' +
          '<label class="pick-all"><input type="checkbox" data-bk="all" id="pAll"><span>Select all</span><span class="muted" id="pCount"></span></label>' +
          '<div class="pick-list" id="pList"></div>' +
        '</div>' +
        '<p class="muted" id="pNone" hidden>There are no vouchers in this book yet.</p>' +
        '<p class="form-error" id="pError"></p>' +
        '<div class="dlg-actions">' +
          '<button type="button" class="btn btn-ghost" data-act="pick-cancel">Cancel</button>' +
          '<button type="button" class="btn btn-primary" id="pGo" data-act="pick-go">Edit voucher</button>' +
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
      picked = {};
      lastDate = '';
      filters.q = '';
      $('#fQ').value = '';
      resetForm();        // Particulars no longer lists this account, and any edit in progress is dropped
      render();
    }

    // ---- menu (three lines, right of Search) ------------------------------
    var menuEl = null, menuBtn = null;

    function closeMenu(refocus) {
      if (!menuEl) return;
      menuEl.remove();
      menuEl = null;
      document.removeEventListener('mousedown', onMenuOutside, true);
      document.removeEventListener('keydown', onMenuKey, true);
      window.removeEventListener('resize', dropMenu);
      window.removeEventListener('scroll', onMenuScroll, true);
      if (menuBtn) {
        menuBtn.setAttribute('aria-expanded', 'false');
        if (refocus) menuBtn.focus();
      }
      menuBtn = null;
    }
    function dropMenu() { closeMenu(false); }
    function onMenuOutside(e) { if (!menuEl.contains(e.target) && !e.target.closest('.kebab')) closeMenu(false); }
    function onMenuScroll(e) { if (!menuEl.contains(e.target)) closeMenu(false); }

    function onMenuKey(e) {
      var items = Array.prototype.slice.call(menuEl.querySelectorAll('[role="menuitem"]'));
      var i = items.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(true); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
      else if (e.key === 'Tab') closeMenu(false);
    }

    function menuAction(what) {
      if (what === 'edit' || what === 'delete') openPicker(what);
      else if (what === 'opening') openOpening();
    }

    function toggleMenu(btn) {
      if (menuEl && menuBtn === btn) { closeMenu(true); return; }
      closeMenu(false);

      menuEl = document.createElement('div');
      menuEl.className = 'row-menu';
      menuEl.setAttribute('role', 'menu');
      menuEl.innerHTML =
        '<button type="button" role="menuitem" data-do="edit">Edit a voucher</button>' +
        '<button type="button" role="menuitem" data-do="delete" class="danger">Delete a voucher</button>' +
        '<div class="menu-sep" role="separator"></div>' +
        '<button type="button" role="menuitem" data-do="opening">Opening balance</button>';
      menuEl.addEventListener('click', function (ev) {
        var item = ev.target.closest('[data-do]');
        if (!item) return;
        closeMenu(false);
        menuAction(item.dataset.do);
      });
      document.body.appendChild(menuEl);

      // open below the button, right edges lined up; flip above when there is no room
      var r = btn.getBoundingClientRect(), w = menuEl.offsetWidth, h = menuEl.offsetHeight;
      menuEl.style.left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) + 'px';
      menuEl.style.top = (r.bottom + h + 8 > window.innerHeight && r.top > h + 8 ? r.top - h - 4 : r.bottom + 4) + 'px';

      menuBtn = btn;
      btn.setAttribute('aria-expanded', 'true');
      document.addEventListener('mousedown', onMenuOutside, true);
      document.addEventListener('keydown', onMenuKey, true);
      window.addEventListener('resize', dropMenu);
      window.addEventListener('scroll', onMenuScroll, true);
      menuEl.querySelector('[role="menuitem"]').focus();
    }

    // ---- voucher picker: choose which voucher to edit or delete -------------
    var pickMode = 'edit';
    var pickRows = [];      // the vouchers listed in the Delete dialog: { id, hay }

    function voucherLabel(e) {
      return e.voucher + ' · ' + P.fmtDate(e.date) + ' · ' + e.particulars + ' · ' + typeName(e.type) + ' ₹ ' + money(e.amount);
    }

    function openPicker(mode) {
      pickMode = mode;
      var list = sortedEntries().reverse();       // newest first
      var del = mode === 'delete';
      $('#pTitle').textContent = del ? 'Delete vouchers' : 'Edit a voucher';
      $('#pError').textContent = '';
      $('#pNone').hidden = list.length > 0;
      $('#pOne').hidden = del || !list.length;
      $('#pMany').hidden = !del || !list.length;
      $('#pGo').className = 'btn ' + (del ? 'btn-danger' : 'btn-primary');

      if (del) {
        // tick the vouchers to delete, or Select all (Select all follows the search box)
        picked = {};
        pickRows = list.map(function (e) { return { id: e.id, hay: (voucherLabel(e) + ' ' + (e.ref || '')).toLowerCase() }; });
        $('#pSearch').value = '';
        $('#pList').innerHTML = list.map(function (e) {
          return '<label class="pick-row" data-id="' + e.id + '"><input type="checkbox" data-bk="row" data-id="' + e.id + '">' +
            '<span class="pick-main"><b>' + esc(e.voucher) + '</b> · ' + P.fmtDate(e.date) + ' · ' + esc(e.particulars) +
            (e.ref ? ' <span class="muted">(' + esc(e.ref) + ')</span>' : '') + '</span>' +
            '<span class="pick-amt ' + e.type + '">' + typeName(e.type) + ' ₹ ' + money(e.amount) + '</span></label>';
        }).join('');
        filterPickList();
        $('#pGo').disabled = true;
        $('#cbPickDialog').showModal();
        $('#pSearch').focus();
      } else {
        $('#pVoucher').innerHTML = '<option value="">Select voucher...</option>' + list.map(function (e) {
          return '<option value="' + e.id + '">' + esc(voucherLabel(e)) + '</option>';
        }).join('');
        $('#pGo').textContent = 'Edit voucher';
        $('#pGo').disabled = !list.length;
        $('#cbPickDialog').showModal();
        $('#pVoucher').focus();
      }
    }

    function pickGo() {
      if (pickMode === 'delete') { deleteSelected(); return; }      // asks for confirmation, then deletes
      var id = $('#pVoucher').value;
      if (!id) { $('#pError').textContent = 'Choose a voucher first.'; return; }
      $('#cbPickDialog').close();
      loadEntry(id);
    }

    // ---- table ------------------------------------------------------------
    function render() {
      closeMenu(false);
      var c = compute();

      $('#cbCards').innerHTML =
        card('Opening balance', c.opening, '') +
        card('Total ' + INS.toLowerCase(), c.totalIn, 'in') +
        card('Total ' + OUTS.toLowerCase(), c.totalOut, 'out') +
        card('Closing balance', c.closing, c.closing < 0 ? 'neg' : 'close');

      var body = '<tr class="row-open"><td colspan="3">Opening balance' + (filters.from ? ' as on ' + P.fmtDate(filters.from) : '') +
        '</td><td class="num"></td><td class="num"></td><td class="num strong">' + bal(c.opening) + '</td></tr>';

      if (!c.rows.length) {
        body += '<tr><td colspan="6" class="empty">' + (c.count ? 'No entries match your filters.' :
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
          '<td class="num strong' + (r.balance < 0 ? ' neg' : '') + '">' + bal(r.balance) + '</td></tr>';
      });

      if (c.rows.length) {
        body += '<tr class="row-total"><td colspan="3">Total (' + c.rows.length + ' entr' + (c.rows.length === 1 ? 'y' : 'ies') + ')</td>' +
          '<td class="num in">' + money(rupees(visIn)) + '</td><td class="num out">' + money(rupees(visOut)) + '</td>' +
          '<td class="num"></td></tr>';
      }

      $('#cbTable').innerHTML =
        '<table><thead><tr><th>Date</th><th>Voucher</th><th>Particulars</th>' +
        '<th class="num">' + IN + ' (&#8377;)</th><th class="num">' + OUT + ' (&#8377;)</th><th class="num">Balance (&#8377;)</th></tr></thead>' +
        '<tbody>' + body + '</tbody></table>';
    }

    // ---- Delete a voucher: tick several, or Select all, then delete ----------
    function tickRow(id, on) {
      if (on) picked[id] = true; else delete picked[id];
      var cb = root.querySelector('[data-bk="row"][data-id="' + id + '"]');
      if (cb) cb.checked = on;
    }

    // Select all box, the count and the Delete button inside the dialog
    function syncPicked() {
      var n = Object.keys(picked).length, all = $('#pAll');
      all.disabled = !shownIds.length;
      all.checked = shownIds.length > 0 && shownIds.every(function (id) { return picked[id]; });
      all.indeterminate = !all.checked && shownIds.some(function (id) { return picked[id]; });
      $('#pCount').textContent = n ? n + ' selected' : '';
      $('#pGo').textContent = n ? 'Delete ' + n + ' voucher' + (n === 1 ? '' : 's') : 'Delete vouchers';
      $('#pGo').disabled = !n;
    }

    // the search box in the dialog hides vouchers that do not match; Select all then applies to those shown
    function filterPickList() {
      var q = $('#pSearch').value.trim().toLowerCase();
      shownIds = [];
      pickRows.forEach(function (r) {
        var show = !q || r.hay.indexOf(q) !== -1;
        var row = root.querySelector('.pick-row[data-id="' + r.id + '"]');
        if (row) row.hidden = !show;
        if (show) shownIds.push(r.id);
      });
      syncPicked();
    }

    async function deleteSelected() {
      var doomed = data.entries.filter(function (e) { return picked[e.id]; });
      if (!doomed.length) return;
      var inSum = 0, outSum = 0;
      doomed.forEach(function (e) { if (e.type === 'in') inSum += paise(e.amount); else outSum += paise(e.amount); });
      var ok = await P.confirm({
        title: 'Delete ' + doomed.length + ' voucher' + (doomed.length === 1 ? '' : 's') + '?',
        message: doomed.length + ' selected voucher' + (doomed.length === 1 ? '' : 's') + ' (' + INS.toLowerCase() + ' ₹ ' + money(rupees(inSum)) +
          ', ' + OUTS.toLowerCase() + ' ₹ ' + money(rupees(outSum)) + ') will be removed. This cannot be undone.',
        confirmText: 'Delete ' + doomed.length
      });
      if (!ok) return;
      $('#cbPickDialog').close();
      data.entries = data.entries.filter(function (e) { return !picked[e.id]; });
      if (editingId && picked[editingId]) resetForm();
      picked = {};
      save();
      render();
      P.toast(doomed.length + ' voucher' + (doomed.length === 1 ? '' : 's') + ' deleted');
    }

    function card(label, paiseVal, cls) {
      return '<div class="card ' + cls + '"><span class="card-label">' + label + '</span>' +
        '<span class="card-value">&#8377; ' + money(rupees(paiseVal)) + '</span></div>';
    }
    // 'drcr': 1,000.00 Dr / 250.00 Cr     'plain': 1,000.00 / -250.00
    function bal(p) {
      return drcr ? money(rupees(Math.abs(p))) + (p < 0 ? ' Cr' : p > 0 ? ' Dr' : '')
        : (p < 0 ? '-' : '') + money(rupees(Math.abs(p)));
    }

    // ---- new entry form ---------------------------------------------------
    function typeName(t) { return t === 'in' ? IN : OUT; }
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
      hint('Pick the ledger and ' + IN + ' or ' + OUT + ' is chosen for you.');
    }

    // in/out follows the chosen ledger (Income, Debtors... = in; Expenses, Creditors... = out)
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
        hint('Cannot tell from this ledger. Slide to choose ' + IN + ' or ' + OUT + '.');
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
        fields.voucher = cfg.prefix + ('0000' + data.counter).slice(-4);
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

    function openOpening() {
      $('#oTitle').textContent = 'Opening balance · ' + active;
      $('#oAmount').value = openingOf(active) || '';
      $('#cbOpenDialog').showModal();
      $('#oAmount').focus();
    }

    // What gets exported: the period and filters on screen, with a proper header block
    function buildReport() {
      var c = compute();
      var period = filters.from || filters.to
        ? (filters.from ? P.fmtDate(filters.from) : 'Beginning') + ' to ' + (filters.to ? P.fmtDate(filters.to) : 'Today')
        : 'All dates';
      var shown = [];
      if (filters.type !== 'all') shown.push(filters.type === 'in' ? INS + ' only' : OUTS + ' only');
      if (filters.q.trim()) shown.push('Search "' + filters.q.trim() + '"');

      var meta = [['Account', active], ['Period', period]];
      if (shown.length) meta.push(['Showing', shown.join(', ')]);
      meta.push(
        ['Opening balance', '₹ ' + bal(c.opening)],
        ['Total ' + INS.toLowerCase(), '₹ ' + money(rupees(c.totalIn))],
        ['Total ' + OUTS.toLowerCase(), '₹ ' + money(rupees(c.totalOut))],
        ['Closing balance', '₹ ' + bal(c.closing)],
        ['Generated', P.exporter.stamp() + (P.store.user() ? ' by ' + P.store.user() : '')]
      );

      // Balance column: positive = Dr, negative = Cr (or a signed amount in 'plain' mode)
      var rows = [{ kind: 'opening', cells: ['', '', 'Opening balance' + (filters.from ? ' as on ' + P.fmtDate(filters.from) : ''), '', '', rupees(c.opening)] }];
      var sumIn = 0, sumOut = 0;
      c.rows.forEach(function (r) {
        var e = r.e, isIn = e.type === 'in';
        if (isIn) sumIn += paise(e.amount); else sumOut += paise(e.amount);
        rows.push([P.fmtDate(e.date), e.voucher, e.particulars + (e.ref ? ' (Ref: ' + e.ref + ')' : ''),
          isIn ? e.amount : '', isIn ? '' : e.amount, rupees(r.balance)]);
      });
      if (c.rows.length) {
        rows.push({ kind: 'total', cells: ['', '', 'Total (' + c.rows.length + ' entr' + (c.rows.length === 1 ? 'y' : 'ies') + ')', rupees(sumIn), rupees(sumOut), ''] });
      }
      rows.push({ kind: 'total', cells: ['', '', 'Closing balance', '', '', rupees(c.closing)] });

      return {
        filename: cfg.title.toLowerCase().replace(/[^\w]+/g, '-') + '-' + active.replace(/[^\w-]+/g, '-').toLowerCase() + '-' + P.isoDate(),
        sheetName: cfg.title,
        company: 'Potafo Accounts',
        title: cfg.title + ' – ' + active,
        meta: meta,
        columns: [
          { label: 'Date', width: 13 },
          { label: 'Voucher', width: 11 },
          { label: 'Particulars', width: 32 },
          { label: IN + ' (₹)', width: 16, type: 'money' },
          { label: OUT + ' (₹)', width: 16, type: 'money' },
          { label: 'Balance (₹)', width: 19, type: drcr ? 'drcr' : 'money' }
        ],
        rows: rows
      };
    }

    function exportReport(kind) {
      try {
        P.exporter[kind](buildReport());
        P.toast(kind === 'xlsx' ? 'Excel file created' : 'PDF created');
      } catch (err) {
        P.toast('Could not create the file: ' + (err && err.message || err), true);
      }
    }

    // ---- events -----------------------------------------------------------
    function onClick(ev) {
      var dots = ev.target.closest('.kebab');
      if (dots) { toggleMenu(dots); return; }

      var b = ev.target.closest('[data-act]');
      if (!b) return;
      var act = b.dataset.act, today = P.isoDate();
      switch (act) {
        case 'cancel-edit': resetForm(); render(); break;
        case 'range-today': setRange(today, today); break;
        case 'range-month': var m = monthRange(0); setRange(m.from, m.to); break;
        case 'range-last': var l = monthRange(-1); setRange(l.from, l.to); break;
        case 'range-all': setRange('', ''); break;
        case 'xlsx': case 'pdf': exportReport(act); break;
        case 'pick-cancel': $('#cbPickDialog').close(); break;
        case 'pick-go': pickGo(); break;
        case 'open-cancel': $('#cbOpenDialog').close(); break;
        case 'open-save':
          var v = parseFloat($('#oAmount').value);
          data.openings[active] = isNaN(v) ? 0 : rupees(paise(v));
          if (save()) { $('#cbOpenDialog').close(); render(); P.toast('Opening balance updated'); }
          break;
      }
    }

    function onInput(ev) {
      var t = ev.target, id = t.id;

      // Delete a voucher dialog: a voucher's tick box, Select all, or the search box
      if (t.dataset && t.dataset.bk) {
        if (t.dataset.bk === 'all') shownIds.forEach(function (rowId) { tickRow(rowId, t.checked); });
        else tickRow(t.dataset.id, t.checked);
        syncPicked();
        return;
      }
      if (id === 'pSearch') { filterPickList(); return; }

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
        if (ev.key === 'Enter' && ev.target.tagName === 'INPUT' && dlg.id === 'cbOpenDialog') {
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
      id: cfg.id,
      title: cfg.title,
      icon: cfg.icon,
      mount: function (container) {
        root = container;
        data = load();
        editingId = null;
        lastDate = '';
        picked = {};
        shownIds = [];
        accounts =(P.ledgers && P.ledgers.accounts ? P.ledgers.accounts() : []).filter(function (a) {
          return cfg.kinds.indexOf(a.kind) !== -1;
        });
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
        closeMenu(false);
        document.removeEventListener('keydown', onKey);
        if (root) {
          root.removeEventListener('click', onClick);
          root.removeEventListener('input', onInput);
          root.removeEventListener('change', onInput);
        }
      }
    });
  };
})();
