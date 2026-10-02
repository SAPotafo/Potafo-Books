/* Potafo Accounts - Module 5: Delivery Staff
   A dropdown list at the top picks what to record: Joining, Add or Replacement or Resignation.
   All three use the same form: Date, DE Details, Security Deposit and Inventory. Add or Replacement and
   Resignation pick the ID of a staff member who has joined and add the Returned columns to Inventory.
   Every entry is saved in one list. */
(function () {
  'use strict';

  var P = window.Potafo;
  var esc = P.esc;
  var KEY = 'deliverystaff';

  var ADD = 'Add or Replacement';
  var TABS = ['Joining', ADD, 'Resignation'];
  var METHODS = ['Razorpay', 'Cash', 'Deduction'];

  var data, root, editingId = null, query = '', listQuery = '', section = 'Joining';

  function load() {
    var d = P.store.get(KEY, null);
    if (!d || !Array.isArray(d.staff)) d = { staff: [] };
    return d;
  }
  function save() { return P.store.set(KEY, data); }

  // Entries saved before the types existed are joinings
  function typeOf(s) { return s.type || 'Joining'; }

  // Available to other modules
  P.deliveryStaff = {
    all: function () { return (P.store.get(KEY, { staff: [] }).staff || []).slice(); }
  };

  // ---- markup -----------------------------------------------------------
  function methodOptions() {
    return '<option value="">Select</option>' + METHODS.map(function (m) {
      return '<option>' + m + '</option>';
    }).join('');
  }

  // Method dropdown plus a Payment ID box that only shows for Razorpay
  function methodField(p) {
    return '<select id="' + p + 'Method" data-pay="' + p + '" aria-label="Method">' + methodOptions() + '</select>';
  }
  // Sits in the next column after Method; invisible (but keeps its space) until Razorpay is chosen
  function pidField(p, heading) {
    return '<div class="dsf-pid off' + (heading ? '' : ' dsf-n') + '" id="' + p + 'PidBox">' +
      (heading ? '<label for="' + p + 'Pid">Payment ID</label>' : '') +
      '<input type="text" id="' + p + 'Pid" maxlength="60" autocomplete="off" placeholder="Payment ID" aria-label="Payment ID"></div>';
  }

  function amountField(id, label) {
    return '<input type="number" id="' + id + '" min="0" step="0.01" inputmode="decimal" aria-label="' + (label || 'Amount') + '">';
  }

  function qtyField(id, label) {
    return '<input type="number" id="' + id + '" min="1" step="1" inputmode="numeric" aria-label="' + (label || 'Qty') + '">';
  }

  var TEMPLATE =
    '<section class="ds">' +
    '<div class="page-head"><div><h2>Delivery Staff</h2></div>' +
    '<div class="ds-top">' +
      '<button type="button" class="btn btn-ghost ds-listbtn" id="dsListBtn">Delivery Staff List</button>' +
      // the empty first option shows while the staff list is open, so any section can be picked again
      '<select id="dsSection" class="ds-section" aria-label="Section" data-plain><option value="" hidden>Select</option>' +
        TABS.map(function (t) { return '<option>' + esc(t) + '</option>'; }).join('') +
      '</select>' +
    '</div></div>' +

    '<div id="dsStaffList" hidden>' +
      '<div class="list-tools">' +
        '<div class="filters-lite"><input type="search" id="dsListSearch" placeholder="Search by ID, name or phone..." aria-label="Search delivery staff list"></div>' +
      '</div>' +
      '<div class="panel table-wrap"><table class="ds-table"><thead><tr>' +
        '<th>#</th><th>ID</th><th>Name</th><th>Phone</th><th>Joined</th><th>Status</th>' +
      '</tr></thead><tbody id="dsListRows"></tbody></table></div>' +
    '</div>' +

    '<div id="dsJoining">' +
    // Rows, top to bottom: Date, DE Details, Security Deposit, Inventory. Fields sit in columns under headings.
    '<div class="panel dsf" id="dsForm">' +
      '<div class="dsf-mode" id="dsMode">Joining</div>' +
      '<div class="dsf-row"><div class="dsf-lbl">Date</div>' +
        '<div class="dsf-cols dsf-3"><div><label for="dsDate">Date</label><input type="date" id="dsDate" required></div></div></div>' +

      '<div class="dsf-row"><div class="dsf-lbl">DE Details</div>' +
        '<div class="dsf-cols dsf-3">' +
          // Joining: type a new ID. Add or Replacement: pick the ID from a searchable dropdown list of the joined staff
          '<div><label for="dsStaffId" id="dsIdLabel">ID</label>' +
            '<div id="dsIdText"><input type="text" id="dsStaffId" maxlength="30" autocomplete="off"></div>' +
            '<div id="dsIdSel" hidden><select id="dsStaffSel" aria-label="ID"></select></div></div>' +
          '<div><label for="dsName">Name</label><input type="text" id="dsName" maxlength="80" autocomplete="off"></div>' +
          '<div><label for="dsPhone">Phone</label><input type="tel" id="dsPhone" maxlength="20" autocomplete="off" inputmode="tel"></div>' +
        '</div></div>' +

      '<div class="dsf-row" id="dsRowSd"><div class="dsf-lbl">Security Deposit</div>' +
        '<div class="dsf-cols dsf-3">' +
          '<div><label for="dsDepAmount">Amount</label>' + amountField('dsDepAmount') + '</div>' +
          '<div><label for="dsDepMethod">Method</label>' + methodField('dsDep') + '</div>' +
          pidField('dsDep', true) +
        '</div></div>' +

      '<div class="dsf-row" id="dsRowInv"><div class="dsf-lbl">Inventory</div>' +
        // Returned Qty / Returned Value (class dsf-r) come first in Add or Replacement and Resignation, not in Joining.
        // Qty / Amount / Method / Payment ID (class dsf-n) are not used in Resignation.
        '<div class="dsf-cols dsf-inv" id="dsInv">' +
          '<div class="dsf-h">Item</div><div class="dsf-h dsf-r">Returned Qty</div><div class="dsf-h dsf-r">Returned Value</div>' +
          '<div class="dsf-h dsf-n">Qty</div><div class="dsf-h dsf-n">Amount</div><div class="dsf-h dsf-n">Method</div><div class="dsf-h dsf-n dsf-hpid off">Payment ID</div>' +
          '<div class="dsf-item">T-Shirt</div><div class="dsf-r">' + qtyField('dsTsRetQty', 'T-Shirt Returned Qty') + '</div><div class="dsf-r">' + amountField('dsTsRetValue', 'T-Shirt Returned Value') + '</div>' +
            '<div class="dsf-n">' + qtyField('dsTsQty', 'T-Shirt Qty') + '</div><div class="dsf-n">' + amountField('dsTsAmount', 'T-Shirt Amount') + '</div><div class="dsf-n">' + methodField('dsTs') + '</div>' + pidField('dsTs') +
          '<div class="dsf-item">Delivery Bag</div><div class="dsf-r">' + qtyField('dsBagRetQty', 'Delivery Bag Returned Qty') + '</div><div class="dsf-r">' + amountField('dsBagRetValue', 'Delivery Bag Returned Value') + '</div>' +
            '<div class="dsf-n">' + qtyField('dsBagQty', 'Delivery Bag Qty') + '</div><div class="dsf-n">' + amountField('dsBagAmount', 'Delivery Bag Amount') + '</div><div class="dsf-n">' + methodField('dsBag') + '</div>' + pidField('dsBag') +
        '</div></div>' +

      '<div class="dsf-row dsf-actions"><div class="dsf-lbl"></div><div class="btn-row">' +
        '<button type="button" class="btn btn-primary" id="dsSave">Add</button>' +
        '<button type="button" class="btn btn-ghost" id="dsCancel" hidden>Cancel</button>' +
      '</div></div>' +
    '</div>' +
    '<p class="form-error" id="dsError"></p>' +

    '<div class="list-tools">' +
      '<div class="filters-lite"><input type="search" id="dsSearch" placeholder="Search by ID, name or phone..." aria-label="Search delivery staff"></div>' +
    '</div>' +
    '<div class="panel table-wrap"><table class="ds-table" id="dsTable">' +
      '<thead id="dsHead"></thead>' +
      '<tbody id="dsRows"></tbody>' +
    '</table></div>' +
    '</div>' +
    '</section>';

  // ---- top buttons ------------------------------------------------------
  // Add or Replacement has the same form as Joining
  function applyMode() {
    var joining = section === 'Joining';
    $('dsMode').textContent = section;
    // Returned Qty / Returned Value are not used in Joining; Qty / Amount / Method are not used in Resignation
    var resigning = section === 'Resignation';
    $('dsInv').classList.toggle('with-ret', !joining && !resigning);
    $('dsInv').classList.toggle('ret-only', resigning);
    Array.prototype.forEach.call(root.querySelectorAll('.dsf-r'), function (c) { c.hidden = joining; });
    Array.prototype.forEach.call(root.querySelectorAll('.dsf-n'), function (c) { c.hidden = resigning; });
    // Joining types the ID; Add or Replacement picks it from the joined staff, and Name / Phone follow the ID
    $('dsIdText').hidden = !joining;
    $('dsIdSel').hidden = joining;
    $('dsIdLabel').setAttribute('for', joining ? 'dsStaffId' : 'dsStaffSel');
    $('dsName').readOnly = !joining;
    $('dsPhone').readOnly = !joining;
  }

  // The ID in the form: typed for Joining, picked for Add or Replacement
  function idValue() {
    return (section === 'Joining' ? $('dsStaffId').value : $('dsStaffSel').value).trim().replace(/\s+/g, ' ');
  }
  function focusId() {
    if (section === 'Joining') $('dsStaffId').focus(); else $('dsStaffSel').focus();
  }

  function showSection(name) {
    var changed = name !== section;
    section = name;
    $('dsSection').value = name;
    $('dsStaffList').hidden = true;
    $('dsJoining').hidden = false;
    $('dsListBtn').classList.remove('btn-primary');
    $('dsListBtn').classList.add('btn-ghost');
    if (changed) resetForm();      // a half-filled form (or an edit) does not carry over to another section
    applyMode();
    render();
  }

  // Delivery Staff List: everyone saved under Joining, with their status
  function showList() {
    $('dsJoining').hidden = true;
    $('dsStaffList').hidden = false;
    $('dsSection').value = '';
    $('dsListBtn').classList.add('btn-primary');
    $('dsListBtn').classList.remove('btn-ghost');
    renderList();
  }

  function renderList() {
    var q = listQuery.trim().toLowerCase();
    var resigned = {};
    data.staff.forEach(function (s) { if (typeOf(s) === 'Resignation' && s.staffId) resigned[s.staffId.toLowerCase()] = true; });
    var list = data.staff.filter(function (s) {
      return typeOf(s) === 'Joining' && (!q || ((s.staffId || '') + ' ' + s.name + ' ' + (s.phone || '')).toLowerCase().indexOf(q) !== -1);
    }).sort(function (a, b) { return (a.staffId || '').localeCompare(b.staffId || '', undefined, { numeric: true }); });

    $('dsListRows').innerHTML = list.length ? list.map(function (s, i) {
      var gone = resigned[(s.staffId || '').toLowerCase()];
      return '<tr><td class="muted">' + (i + 1) + '</td><td>' + esc(s.staffId || '') + '</td><td class="strong">' + esc(s.name) + '</td>' +
        '<td>' + esc(s.phone || '') + '</td><td>' + esc(P.fmtDate(s.date)) + '</td>' +
        '<td><span class="tag">' + (gone ? 'Resigned' : 'Active') + '</span></td></tr>';
    }).join('') : '<tr><td colspan="6" class="empty">' + (q ? 'No delivery staff match your search.' : 'No delivery staff yet. Add them under Joining.') + '</td></tr>';
  }

  // Which section an entry belongs to: Joining, Resignation, or Add or Replacement (anything else)
  function sectionOf(s) {
    var t = typeOf(s);
    return t === 'Joining' || t === 'Resignation' ? t : ADD;
  }

  // ---- list -------------------------------------------------------------
  var DASH = '<span class="muted">&mdash;</span>';
  // Cells for one payment: [qty], amount, method (Payment ID under it for Razorpay).
  // The first cell starts a column group, which gets a divider line.
  function payCells(p, withQty) {
    var has = p && p.amount, cells = [];
    if (withQty) cells.push('<td class="num">' + (has ? p.qty : DASH) + '</td>');
    cells.push('<td class="num">' + (has ? P.money(p.amount) : DASH) + '</td>');
    cells.push('<td>' + (has ? esc(p.method) + (p.paymentId ? '<div class="muted ds-sub">' + esc(p.paymentId) + '</div>' : '') : DASH) + '</td>');
    cells[0] = cells[0].replace('<td class="num">', '<td class="num grp">');
    return cells.join('');
  }

  // Cells for one inventory item: [returned qty, returned value,] [qty, amount, method].
  // Joining has no Returned columns; Resignation has no Qty / Amount / Method.
  function itemCells(p, ret, buy) {
    var hasRet = p && p.retQty, has = p && p.amount;
    return (ret ? '<td class="num grp">' + (hasRet ? p.retQty : DASH) + '</td>' +
        '<td class="num">' + (hasRet ? P.money(p.retValue) : DASH) + '</td>' : '') +
      (buy ? '<td class="num' + (ret ? '' : ' grp') + '">' + (has ? p.qty : DASH) + '</td>' +
        '<td class="num">' + (has ? P.money(p.amount) : DASH) + '</td>' +
        '<td>' + (has ? esc(p.method) + (p.paymentId ? '<div class="muted ds-sub">' + esc(p.paymentId) + '</div>' : '') : DASH) + '</td>' : '');
  }

  // Two-level heading over the list, matching the columns of the chosen section
  function headHtml(ret, buy) {
    var n = (ret ? 2 : 0) + (buy ? 3 : 0);
    var sub = (ret ? '<th class="num grp">Returned Qty</th><th class="num">Returned Value</th>' : '') +
      (buy ? '<th class="num' + (ret ? '' : ' grp') + '">Qty</th><th class="num">Amount</th><th>Method</th>' : '');
    return '<tr><th rowspan="3">Date</th><th colspan="3" rowspan="2" class="grp">DE Details</th>' +
        '<th colspan="2" rowspan="2" class="grp">Security Deposit</th><th colspan="' + (n * 2) + '" class="grp">Inventory</th><th rowspan="3"></th></tr>' +
      '<tr><th colspan="' + n + '" class="grp">T-Shirt</th><th colspan="' + n + '" class="grp">Delivery Bag</th></tr>' +
      '<tr><th class="grp">ID</th><th>Name</th><th>Phone</th><th class="num grp">Amount</th><th>Method</th>' + sub + sub + '</tr>';
  }

  function render() {
    var q = query.trim().toLowerCase();
    var ret = section !== 'Joining', buy = section !== 'Resignation';
    // the list shows the entries of the chosen section
    var list = data.staff.slice().sort(function (a, b) {
      return (b.date || '').localeCompare(a.date || '') || a.name.localeCompare(b.name);
    }).filter(function (s) {
      if (sectionOf(s) !== section) return false;
      return !q || ((s.staffId || '') + ' ' + s.name + ' ' + (s.phone || '')).toLowerCase().indexOf(q) !== -1;
    });

    root.querySelector('#dsHead').innerHTML = headHtml(ret, buy);

    var body = list.map(function (s) {
      return '<tr class="' + (s.id === editingId ? 'row-open' : '') + '">' +
        '<td>' + esc(P.fmtDate(s.date)) + '</td>' +
        '<td class="grp">' + esc(s.staffId || '') + '</td>' +
        '<td class="strong">' + esc(s.name) + '</td>' +
        '<td>' + esc(s.phone || '') + '</td>' +
        payCells(s.deposit, false) + itemCells(s.tshirt, ret, buy) + itemCells(s.bag, ret, buy) +
        '<td class="actions">' +
          '<button class="icon-btn" data-act="edit" data-id="' + s.id + '" title="Edit" aria-label="Edit">&#9998;</button>' +
          '<button class="icon-btn danger" data-act="delete" data-id="' + s.id + '" title="Delete" aria-label="Delete">&#10005;</button>' +
        '</td></tr>';
    }).join('');

    if (!list.length) {
      body = '<tr><td colspan="' + (7 + 2 * ((ret ? 2 : 0) + (buy ? 3 : 0))) + '" class="empty">' + (q ? 'No entries match your search.' :
        'No entries yet. Fill in the form above and press Add.') + '</td></tr>';
    }

    root.querySelector('#dsRows').innerHTML = body;

    // IDs offered for Add or Replacement: every joined staff member (the dropdown list is searchable)
    var sel = $('dsStaffSel'), keep = sel.value;
    sel.innerHTML = '<option value="">Select ID</option>' +
      data.staff.filter(function (s) { return typeOf(s) === 'Joining' && s.staffId; })
        .sort(function (a, b) { return a.staffId.localeCompare(b.staffId, undefined, { numeric: true }); })
        .map(function (s) { return '<option value="' + esc(s.staffId) + '">' + esc(s.staffId) + ' - ' + esc(s.name) + '</option>'; }).join('');
    sel.value = keep;      // stays on the chosen ID; falls back to "Select ID" if it is gone
  }

  // ---- form -------------------------------------------------------------
  function $(id) { return root.querySelector('#' + id); }

  // The joining entry of a staff ID, or undefined
  function joiningOf(staffId) {
    var k = String(staffId || '').trim().toLowerCase();
    return k && data.staff.filter(function (s) { return typeOf(s) === 'Joining' && (s.staffId || '').toLowerCase() === k; })[0];
  }

  function syncPid(p) {
    var razor = $(p + 'Method').value === 'Razorpay';
    $(p + 'PidBox').classList.toggle('off', !razor);
    if (!razor) $(p + 'Pid').value = '';
    // the Inventory "Payment ID" heading only shows while a T-Shirt or Bag line uses Razorpay
    var any = $('dsTsMethod').value === 'Razorpay' || $('dsBagMethod').value === 'Razorpay';
    root.querySelector('.dsf-hpid').classList.toggle('off', !any);
  }

  function setPay(p, rec) {
    $(p + 'Method').value = rec ? rec.method : '';
    $(p + 'Pid').value = rec && rec.paymentId ? rec.paymentId : '';
    syncPid(p);
  }

  function resetForm() {
    editingId = null;
    ['dsStaffId', 'dsName', 'dsPhone', 'dsDepAmount', 'dsTsQty', 'dsTsAmount', 'dsBagQty', 'dsBagAmount',
      'dsTsRetQty', 'dsTsRetValue', 'dsBagRetQty', 'dsBagRetValue', 'dsStaffSel'].forEach(function (id) { $(id).value = ''; });
    $('dsDate').value = P.isoDate();
    ['dsDep', 'dsTs', 'dsBag'].forEach(function (p) { setPay(p, null); });
    $('dsSave').textContent = 'Add';
    $('dsCancel').hidden = true;
    $('dsError').textContent = '';
  }

  // Method (+ Payment ID for Razorpay) for one payment; returns an error text or ''
  function readPay(p, out, label) {
    var method = $(p + 'Method').value, pid = $(p + 'Pid').value.trim();
    if (!method) return 'Choose the Method for ' + label + '.';
    if (method === 'Razorpay' && !pid) return 'Enter the Payment ID for ' + label + '.';
    out.method = method;
    if (method === 'Razorpay') out.paymentId = pid;
    return '';
  }

  // Read the form. Returns { rec } or { err }.
  function read() {
    var type = section;
    var date = $('dsDate').value;
    var staffId = idValue();
    var name = $('dsName').value.trim().replace(/\s+/g, ' ');
    var phone = $('dsPhone').value.trim();
    if (!date) return { err: 'Enter the Date.' };
    if (type === 'Joining') {
      if (!staffId) return { err: 'Enter the ID.' };
      if (!name) return { err: 'Enter the Name.' };
      if (phone.replace(/\D/g, '').length < 10) return { err: 'Enter a valid Phone number (at least 10 digits).' };
      var dup = data.staff.some(function (s) {
        return s.id !== editingId && typeOf(s) === 'Joining' && (s.staffId || '').toLowerCase() === staffId.toLowerCase();
      });
      if (dup) return { err: 'ID "' + staffId + '" is already used.' };
    } else {
      // Name and Phone always come from the joined staff member of the chosen ID
      var joined = joiningOf(staffId);
      if (!joined) return { err: 'Choose the ID.' };
      staffId = joined.staffId; name = joined.name; phone = joined.phone || '';
    }

    var rec = { type: type, date: date, staffId: staffId, name: name, phone: phone };
    var e;

    var depAmt = parseFloat($('dsDepAmount').value);
    if ($('dsDepAmount').value !== '' && !(depAmt >= 0)) return { err: 'Security Deposit amount is not valid.' };
    if (depAmt > 0) {
      rec.deposit = { amount: depAmt };
      if ((e = readPay('dsDep', rec.deposit, 'Security Deposit'))) return { err: e };
    }

    var items = [['tshirt', 'dsTs', 'T-Shirt'], ['bag', 'dsBag', 'Delivery Bag']];
    for (var i = 0; i < items.length; i++) {
      var key = items[i][0], p = items[i][1], label = items[i][2];
      var item = {};
      if (type !== 'Joining') {
        var rqRaw = $(p + 'RetQty').value, rvRaw = $(p + 'RetValue').value;
        if (rqRaw !== '' || rvRaw !== '') {
          var rq = parseInt(rqRaw, 10), rv = parseFloat(rvRaw);
          if (!(rq > 0)) return { err: 'Enter the Returned Qty for ' + label + '.' };
          if (!(rv >= 0)) return { err: 'Enter the Returned Value for ' + label + '.' };
          item.retQty = rq; item.retValue = rv;
        }
      }
      var qRaw = $(p + 'Qty').value, aRaw = $(p + 'Amount').value;
      if (type !== 'Resignation' && (qRaw !== '' || aRaw !== '')) {      // no Qty / Amount / Method in Resignation
        var qty = parseInt(qRaw, 10), amt = parseFloat(aRaw);
        if (!(qty > 0)) return { err: 'Enter the Qty for ' + label + '.' };
        if (!(amt > 0)) return { err: 'Enter the Amount for ' + label + '.' };
        item.qty = qty; item.amount = amt;
        if ((e = readPay(p, item, label))) return { err: e };
      }
      if (Object.keys(item).length) rec[key] = item;
    }

    if (type !== 'Joining' && !rec.deposit && !rec.tshirt && !rec.bag) {
      return { err: type === 'Resignation' ? 'Enter the Security Deposit or the Returned Qty / Value.' :
        'Enter the Security Deposit or the T-Shirt / Delivery Bag details.' };
    }
    return { rec: rec };
  }

  function submit(ev) {
    ev.preventDefault();
    var r = read();
    var err = $('dsError');
    if (r.err) { err.textContent = r.err; return; }
    err.textContent = '';

    var wasEditing = !!editingId;
    if (wasEditing) {
      var s = data.staff.filter(function (x) { return x.id === editingId; })[0];
      ['deposit', 'tshirt', 'bag'].forEach(function (k) { delete s[k]; });
      Object.keys(r.rec).forEach(function (k) { s[k] = r.rec[k]; });
    } else {
      r.rec.id = P.uid();
      r.rec.ts = Date.now();
      data.staff.push(r.rec);
    }
    if (!save()) return;
    P.toast(r.rec.type + (wasEditing ? ' updated' : ' saved'));
    resetForm();
    render();
    focusId();
  }

  function startEdit(s) {
    showSection(sectionOf(s));      // switch to the entry's own form first (this clears the form)
    editingId = s.id;
    $('dsDate').value = s.date || P.isoDate();
    if (typeOf(s) === 'Joining') {
      $('dsStaffId').value = s.staffId || '';
    } else {
      var sel = $('dsStaffSel');
      if (!Array.prototype.some.call(sel.options, function (o) { return o.value === s.staffId; })) {
        sel.insertAdjacentHTML('beforeend', '<option value="' + esc(s.staffId) + '">' + esc(s.staffId) + ' - ' + esc(s.name) + '</option>');
      }
      sel.value = s.staffId || '';
    }
    $('dsName').value = s.name;
    $('dsPhone').value = s.phone || '';
    $('dsDepAmount').value = s.deposit ? s.deposit.amount : '';
    setPay('dsDep', s.deposit);
    [['dsTs', s.tshirt], ['dsBag', s.bag]].forEach(function (it) {
      var p = it[0], rec = it[1] || {};
      $(p + 'RetQty').value = rec.retQty || '';
      $(p + 'RetValue').value = rec.retQty ? rec.retValue : '';
      $(p + 'Qty').value = rec.qty || '';
      $(p + 'Amount').value = rec.amount || '';
      setPay(p, rec.amount ? rec : null);
    });
    $('dsSave').textContent = 'Update';
    $('dsCancel').hidden = false;
    $('dsError').textContent = '';
    $('dsForm').scrollIntoView({ block: 'nearest' });
    $('dsDate').focus();
    render();
  }

  // ---- events -----------------------------------------------------------
  function onChange(ev) {
    if (ev.target.id === 'dsSection') { if (ev.target.value) showSection(ev.target.value); return; }
    if (ev.target.id === 'dsStaffSel') {
      // Add or Replacement: Name and Phone follow the chosen ID
      var j = joiningOf(ev.target.value);
      $('dsName').value = j ? j.name : '';
      $('dsPhone').value = j ? (j.phone || '') : '';
      return;
    }
    var p = ev.target.dataset && ev.target.dataset.pay;
    if (p) syncPid(p);
  }

  async function onClick(ev) {
    if (ev.target.closest('#dsListBtn')) { showList(); return; }
    var b = ev.target.closest('[data-act]');
    if (!b) return;
    var s = data.staff.filter(function (x) { return x.id === b.dataset.id; })[0];
    if (!s) return;

    if (b.dataset.act === 'edit') {
      startEdit(s);
    } else if (b.dataset.act === 'delete') {
      var ok = await P.confirm({ title: 'Delete this entry?', message: typeOf(s) + ' for "' + s.name + '" will be removed. This cannot be undone.', confirmText: 'Delete' });
      if (!ok) return;
      data.staff = data.staff.filter(function (x) { return x.id !== s.id; });
      save();
      if (editingId === s.id) resetForm();
      render();
      P.toast('Entry deleted');
    }
  }

  P.register({
    id: 'deliverystaff',
    title: 'Delivery Staff',
    icon: '&#9992;',
    mount: function (container) {
      data = load();
      query = '';
      listQuery = '';
      editingId = null;
      section = 'Joining';
      container.innerHTML = TEMPLATE;
      root = container.querySelector('.ds');
      root.addEventListener('click', onClick);
      root.addEventListener('change', onChange);
      root.querySelector('#dsSave').addEventListener('click', submit);
      root.querySelector('#dsForm').addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && e.target.tagName === 'INPUT') submit(e);      // Enter in a box saves the form
      });
      root.querySelector('#dsCancel').addEventListener('click', function () { resetForm(); render(); });
      root.querySelector('#dsSearch').addEventListener('input', function (e) { query = e.target.value; render(); });
      root.querySelector('#dsListSearch').addEventListener('input', function (e) { listQuery = e.target.value; renderList(); });
      resetForm();
      showSection('Joining');
      focusId();
    }
  });
})();
