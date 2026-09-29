/* Potafo Accounts - Module 2: Tally Ledgers
   Create ledgers with "Name of Ledger" and "Under" (group), the way Tally does.
   Groups can be Tally's standard groups or your own sub-groups (a sub-group sits under another group). */
(function () {
  'use strict';

  var P = window.Potafo;
  var esc = P.esc;
  var KEY = 'ledgers';
  var NEW = '__new__';

  // Tally's predefined groups, by nature
  var GROUPS = {
    'Assets': ['Bank Accounts', 'Cash-in-Hand', 'Current Assets', 'Deposits (Asset)', 'Fixed Assets', 'Investments',
      'Loans & Advances (Asset)', 'Misc. Expenses (ASSET)', 'Stock-in-Hand', 'Sundry Debtors', 'Suspense A/c'],
    'Liabilities': ['Bank OD A/c', 'Branch / Divisions', 'Capital Account', 'Current Liabilities', 'Duties & Taxes',
      'Loans (Liability)', 'Provisions', 'Reserves & Surplus', 'Secured Loans', 'Sundry Creditors', 'Unsecured Loans'],
    'Income': ['Direct Incomes', 'Indirect Incomes', 'Sales Accounts'],
    'Expenses': ['Direct Expenses', 'Indirect Expenses', 'Purchase Accounts']
  };
  // The four primary groups. Every group, sub-group and ledger ends up under one of these.
  var PRIMARY = Object.keys(GROUPS);   // Assets, Liabilities, Income, Expenses
  var NATURE = {};
  Object.keys(GROUPS).forEach(function (n) { GROUPS[n].forEach(function (g) { NATURE[g] = n; }); });
  PRIMARY.forEach(function (p) { NATURE[p] = p; });

  // Match group names loosely: case, spaces, "&"/"and" and "(Asset)" suffixes don't matter
  function norm(s) { return String(s).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, ''); }
  var STD_LOOKUP = {};
  Object.keys(NATURE).forEach(function (g) { STD_LOOKUP[norm(g)] = g; });
  Object.keys(NATURE).forEach(function (g) {
    var k = norm(g.replace(/\s*\(.*\)/, ''));
    if (!STD_LOOKUP[k]) STD_LOOKUP[k] = g;
  });
  // singular / plural spellings of the primaries
  STD_LOOKUP.asset = 'Assets';
  STD_LOOKUP.liability = 'Liabilities';
  STD_LOOKUP.incomes = 'Income';
  STD_LOOKUP.expense = 'Expenses';

  var data, root, editingId = null, query = '';
  var sgEditingId = null, sgOnSave = null;
  var selL = {}, selG = {};      // ticked rows: id -> true
  var plan = null;               // upload waiting for the user to pick parents

  // First run: Tally starts every company with a Cash ledger. Also used by the Cash Book,
  // so it has a Cash account even if Tally Ledgers was never opened.
  function seed() {
    var d = P.store.get(KEY, null);
    if (!d) {
      d = { ledgers: [{ id: P.uid(), name: 'Cash', under: 'Cash-in-Hand', ts: Date.now() }], groups: [] };
      P.store.set(KEY, d);
    }
    return d;
  }

  function load() {
    var d = seed();
    d.ledgers = d.ledgers || [];
    d.groups = d.groups || [];
    return d;
  }
  function save() { return P.store.set(KEY, data); }

  // ---- groups -----------------------------------------------------------
  function customGroup(name) {
    var k = norm(name);
    return data.groups.filter(function (g) { return norm(g.name) === k; })[0];
  }
  // Canonical group name (standard or custom) for a typed name, or ''
  function findGroup(name) {
    var k = norm(name);
    if (STD_LOOKUP[k]) return STD_LOOKUP[k];
    var c = customGroup(name);
    return c ? c.name : '';
  }
  // Follow the parents up to a standard group to find the nature
  function natureOf(name) {
    for (var i = 0; i < 25 && name; i++) {
      if (NATURE[name]) return NATURE[name];
      var c = customGroup(name);
      name = c ? c.parent : '';
    }
    return '';
  }
  // The group itself plus everything below it (used to stop loops)
  function branchOf(name) {
    var set = {}, grew = true;
    set[name] = true;
    while (grew) {
      grew = false;
      data.groups.forEach(function (g) {
        if (set[g.parent] && !set[g.name]) { set[g.name] = true; grew = true; }
      });
    }
    return set;
  }
  function usage(name) {
    return {
      ledgers: data.ledgers.filter(function (l) { return l.under === name; }).length,
      children: data.groups.filter(function (g) { return g.parent === name; }).length
    };
  }

  // Which way does cash move for a ledger? Used by the Cash Book to pick Receipt or Payment.
  //   'in'  = Receipt (Income, Sundry Debtors, Capital, Loans taken)
  //   'out' = Payment (Expenses, Purchases, Sundry Creditors, Assets, other Liabilities)
  //   null  = cannot tell (Bank Accounts, Cash-in-Hand, Suspense...), so the user decides
  var FLOW_GROUPS = {
    'Sundry Debtors': 'in', 'Capital Account': 'in', 'Loans (Liability)': 'in',
    'Secured Loans': 'in', 'Unsecured Loans': 'in', 'Bank OD A/c': 'in',
    'Bank Accounts': null, 'Cash-in-Hand': null, 'Branch / Divisions': null, 'Suspense A/c': null
  };
  var FLOW_PRIMARY = { 'Assets': 'out', 'Liabilities': 'out', 'Income': 'in', 'Expenses': 'out' };

  function flowOf(ledgerName) {
    var d = P.store.get(KEY, { ledgers: [], groups: [] });
    var ledger = (d.ledgers || []).filter(function (l) { return l.name === ledgerName; })[0];
    if (!ledger) return null;
    var name = ledger.under;
    for (var i = 0; i < 25 && name; i++) {
      if (Object.prototype.hasOwnProperty.call(FLOW_GROUPS, name)) return FLOW_GROUPS[name];
      if (FLOW_PRIMARY[name]) return FLOW_PRIMARY[name];
      if (NATURE[name]) { name = NATURE[name]; continue; }       // standard group -> its primary
      var k = norm(name);
      var sub = (d.groups || []).filter(function (g) { return norm(g.name) === k; })[0];
      name = sub ? sub.parent : '';                               // sub-group -> its parent
    }
    return null;
  }

  // Ledgers that are cash or bank accounts: anything under Cash-in-Hand or Bank Accounts,
  // including ledgers in sub-groups of those. Cash first, then banks, each A-Z.
  function accountsOf() {
    var d = seed();
    var out = [];
    (d.ledgers || []).forEach(function (l) {
      var name = l.under, kind = '';
      for (var i = 0; i < 25 && name && !kind; i++) {
        if (name === 'Cash-in-Hand') kind = 'cash';
        else if (name === 'Bank Accounts') kind = 'bank';
        else if (NATURE[name]) name = NATURE[name] === name ? '' : NATURE[name];
        else {
          var k = norm(name);
          var sub = (d.groups || []).filter(function (g) { return norm(g.name) === k; })[0];
          name = sub ? sub.parent : '';
        }
      }
      if (kind) out.push({ name: l.name, kind: kind });
    });
    return out.sort(function (a, b) {
      return a.kind === b.kind ? a.name.localeCompare(b.name) : (a.kind === 'cash' ? -1 : 1);
    });
  }

  // 'Assets' | 'Liabilities' | 'Income' | 'Expenses' for a ledger (found by following its groups up), or ''
  function natureOfLedger(ledgerName) {
    var d = P.store.get(KEY, { ledgers: [], groups: [] });
    var ledger = (d.ledgers || []).filter(function (l) { return l.name === ledgerName; })[0];
    if (!ledger) return '';
    var name = ledger.under;
    for (var i = 0; i < 25 && name; i++) {
      if (NATURE[name]) return NATURE[name];
      var k = norm(name);
      var sub = (d.groups || []).filter(function (g) { return norm(g.name) === k; })[0];
      name = sub ? sub.parent : '';
    }
    return '';
  }

  // Available to other modules
  P.ledgers = {
    all: function () { return (P.store.get(KEY, { ledgers: [] }).ledgers || []).slice(); },
    groups: function () { return (P.store.get(KEY, { groups: [] }).groups || []).slice(); },
    flow: flowOf,
    accounts: accountsOf,
    nature: natureOfLedger
  };

  // ---- markup -----------------------------------------------------------
  var TEMPLATE =
    '<section class="lg">' +
    '<div class="page-head"><div><h2>Tally Ledgers</h2>' +
    '<p class="muted">Create ledger accounts and file each one under a group or sub-group.</p></div>' +
    '<div class="btn-row">' +
      '<button type="button" class="btn btn-ghost" id="lgTpl">Download template</button>' +
      '<button type="button" class="btn btn-primary" id="lgUpload">Upload Excel (.xlsx)</button>' +
      '<input type="file" id="lgFile" accept=".xlsx,.csv" hidden>' +
    '</div></div>' +
    '<p class="muted hint">Upload a sheet with <b>Name of Ledger</b> in column A and <b>Under</b> in column B. ' +
    'Under can be a primary (Assets, Liabilities, Income, Expenses), a standard group or a sub-group. ' +
    'Anything else becomes a new sub-group; you choose which primary or group it sits under (or give it in optional column C). ' +
    'Duplicate ledger names are ignored. A header row is optional.</p>' +
    '<div id="lgReport"></div>' +

    '<form class="panel filters" id="lgForm" novalidate>' +
      '<div class="field grow"><label for="lgName">Name of Ledger</label>' +
        '<input type="text" id="lgName" maxlength="80" autocomplete="off" placeholder="e.g. Rent Expense" required></div>' +
      '<div class="field grow"><label for="lgUnder">Under</label><select id="lgUnder" required></select></div>' +
      '<div class="btn-row">' +
        '<button type="submit" class="btn btn-primary" id="lgSave">Create ledger</button>' +
        '<button type="button" class="btn btn-ghost" id="lgCancel" hidden>Cancel</button>' +
      '</div>' +
    '</form>' +
    '<p class="form-error" id="lgError"></p>' +

    '<div class="list-tools">' +
      '<div class="filters-lite"><input type="search" id="lgSearch" placeholder="Search ledgers or groups..." aria-label="Search ledgers"></div>' +
      '<div class="bulkbar" id="lgBulk"></div>' +
    '</div>' +
    '<div class="panel table-wrap" id="lgTable"></div>' +

    '<div class="page-head sg-head"><div><h3>Sub-groups</h3>' +
    '<p class="muted">Your own groups. Each one sits under a standard group or another sub-group.</p></div>' +
    '<button type="button" class="btn btn-ghost" id="sgAdd">+ Add sub-group</button></div>' +
    '<div class="bulkbar" id="sgBulk"></div>' +
    '<div class="panel table-wrap" id="sgTable"></div>' +

    // new / edit sub-group
    '<dialog id="sgDialog"><form id="sgForm" novalidate>' +
      '<h3 id="sgTitle">New sub-group</h3>' +
      '<div class="field"><label for="sgName">Name of Sub-group</label>' +
        '<input type="text" id="sgName" maxlength="80" autocomplete="off" placeholder="e.g. Shop Expenses"></div>' +
      '<div class="field"><label for="sgUnder">Under</label><select id="sgUnder"></select></div>' +
      '<p class="form-error" id="sgError"></p>' +
      '<div class="dlg-actions">' +
        '<button type="button" class="btn btn-ghost" id="sgCancel">Cancel</button>' +
        '<button type="submit" class="btn btn-primary">Save sub-group</button>' +
      '</div>' +
    '</form></dialog>' +

    // upload: choose the parent for new sub-groups
    '<dialog id="upDialog" class="wide"><form id="upForm" novalidate>' +
      '<h3>New sub-groups need an "Under"</h3>' +
      '<p class="muted">These names in your file are not standard groups, so they will be created as sub-groups. ' +
      'Choose what each one sits under, then the ledgers will be added.</p>' +
      '<div class="table-wrap up-list" id="upList"></div>' +
      '<p class="form-error" id="upError"></p>' +
      '<div class="dlg-actions">' +
        '<button type="button" class="btn btn-ghost" id="upCancel">Cancel upload</button>' +
        '<button type="submit" class="btn btn-primary">Create sub-groups &amp; add ledgers</button>' +
      '</div>' +
    '</form></dialog>' +
    '</section>';

  // <option>s for "Under" pickers. withNew adds the "+ Add sub-group" entry; skip hides groups (loop protection).
  function underOptions(selected, withNew, skip) {
    skip = skip || {};
    var html = '<option value="">Select group...</option>';
    html += '<optgroup label="Primary">' + PRIMARY.map(function (p) {
      return '<option' + (p === selected ? ' selected' : '') + '>' + p + '</option>';
    }).join('') + '</optgroup>';
    Object.keys(GROUPS).forEach(function (n) {
      html += '<optgroup label="Groups under ' + n + '">' + GROUPS[n].map(function (g) {
        return '<option' + (g === selected ? ' selected' : '') + '>' + esc(g) + '</option>';
      }).join('') + '</optgroup>';
    });
    var subs = data.groups.filter(function (g) { return !skip[g.name]; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
    if (subs.length) {
      html += '<optgroup label="Sub-groups">' + subs.map(function (g) {
        return '<option value="' + esc(g.name) + '"' + (g.name === selected ? ' selected' : '') + '>' +
          esc(g.name) + (g.parent ? ' (under ' + esc(g.parent) + ')' : '') + '</option>';
      }).join('') + '</optgroup>';
    }
    if (withNew) html += '<optgroup label="Not in the list?"><option value="' + NEW + '">+ Add sub-group...</option></optgroup>';
    return html;
  }

  // ---- rendering --------------------------------------------------------
  function render() {
    var q = query.trim().toLowerCase();
    var list = data.ledgers.slice().sort(function (a, b) { return a.name.localeCompare(b.name); })
      .filter(function (l) { return !q || (l.name + ' ' + l.under).toLowerCase().indexOf(q) !== -1; });

    // only rows you can see stay ticked
    var visible = {};
    list.forEach(function (l) { visible[l.id] = true; });
    Object.keys(selL).forEach(function (id) { if (!visible[id]) delete selL[id]; });

    var body = list.map(function (l, i) {
      var nat = natureOf(l.under), cls = (l.id === editingId ? 'row-open ' : '') + (selL[l.id] ? 'sel' : '');
      return '<tr class="' + cls + '">' +
        '<td class="chk"><input type="checkbox" data-sel="l" data-id="' + l.id + '" aria-label="Select ' + esc(l.name) + '"' + (selL[l.id] ? ' checked' : '') + '></td>' +
        '<td class="muted">' + (i + 1) + '</td>' +
        '<td class="strong">' + esc(l.name) + '</td>' +
        '<td>' + esc(l.under) + '</td>' +
        '<td>' + (nat ? '<span class="tag">' + nat + '</span>' : '<span class="muted">&mdash;</span>') + '</td>' +
        '<td class="actions">' +
          '<button class="icon-btn" data-act="edit" data-id="' + l.id + '" title="Edit" aria-label="Edit">&#9998;</button>' +
          '<button class="icon-btn danger" data-act="delete" data-id="' + l.id + '" title="Delete" aria-label="Delete">&#10005;</button>' +
        '</td></tr>';
    }).join('');

    if (!list.length) {
      body = '<tr><td colspan="6" class="empty">' + (data.ledgers.length ? 'No ledgers match your search.' :
        'No ledgers yet. Create your first one above.') + '</td></tr>';
    }

    root.querySelector('#lgTable').innerHTML =
      '<table><thead><tr><th class="chk"><input type="checkbox" data-selall="l" aria-label="Select all ledgers"></th>' +
      '<th>#</th><th>Name of Ledger</th><th>Under</th><th>Nature</th><th></th></tr></thead>' +
      '<tbody>' + body + '</tbody></table>';

    renderGroups();
    syncSel();
  }

  function renderGroups() {
    var groups = data.groups.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    var exists = {};
    groups.forEach(function (g) { exists[g.id] = true; });
    Object.keys(selG).forEach(function (id) { if (!exists[id]) delete selG[id]; });

    var rows = groups.map(function (g) {
      var nat = natureOf(g.name), u = usage(g.name);
      return '<tr class="' + (selG[g.id] ? 'sel' : '') + '">' +
        '<td class="chk"><input type="checkbox" data-sel="g" data-id="' + g.id + '" aria-label="Select ' + esc(g.name) + '"' + (selG[g.id] ? ' checked' : '') + '></td>' +
        '<td class="strong">' + esc(g.name) + '</td>' +
        '<td>' + (g.parent ? esc(g.parent) : '<span class="warn">Not set</span>') + '</td>' +
        '<td>' + (nat ? '<span class="tag">' + nat + '</span>' : '<span class="muted">&mdash;</span>') + '</td>' +
        '<td class="num">' + u.ledgers + '</td>' +
        '<td class="actions">' +
          '<button class="icon-btn" data-act="sg-edit" data-id="' + g.id + '" title="Edit" aria-label="Edit sub-group">&#9998;</button>' +
          '<button class="icon-btn danger" data-act="sg-delete" data-id="' + g.id + '" title="Delete" aria-label="Delete sub-group">&#10005;</button>' +
        '</td></tr>';
    }).join('');
    if (!rows) rows = '<tr><td colspan="6" class="empty">No sub-groups yet.</td></tr>';
    root.querySelector('#sgTable').innerHTML =
      '<table><thead><tr><th class="chk"><input type="checkbox" data-selall="g" aria-label="Select all sub-groups"></th>' +
      '<th>Sub-group</th><th>Under</th><th>Nature</th><th class="num">Ledgers</th><th></th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>';
  }

  // Refresh "select all" boxes and the bulk action bars from the current ticks
  function syncSel() {
    [['l', selL, '#lgTable', '#lgBulk'], ['g', selG, '#sgTable', '#sgBulk']].forEach(function (c) {
      var boxes = root.querySelectorAll(c[2] + ' [data-sel]'), on = 0;
      Array.prototype.forEach.call(boxes, function (b) { if (b.checked) on++; });
      var all = root.querySelector(c[2] + ' [data-selall]');
      if (all) {
        all.disabled = !boxes.length;
        all.checked = boxes.length > 0 && on === boxes.length;
        all.indeterminate = on > 0 && on < boxes.length;
      }
      var n = Object.keys(c[1]).length;
      root.querySelector(c[3]).innerHTML = n ?
        '<span class="bulk-count">' + n + ' selected</span>' +
        '<button type="button" class="btn btn-danger btn-sm" data-act="bulk-delete-' + c[0] + '">Delete selected</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-act="bulk-clear-' + c[0] + '">Clear</button>' : '';
    });
  }

  function onChange(ev) {
    var t = ev.target, kind = t.dataset.sel || t.dataset.selall;
    if (!kind) return;
    var set = kind === 'l' ? selL : selG;
    if (t.dataset.sel) {
      if (t.checked) set[t.dataset.id] = true; else delete set[t.dataset.id];
      t.closest('tr').classList.toggle('sel', t.checked);
    } else {
      var boxes = root.querySelectorAll((kind === 'l' ? '#lgTable' : '#sgTable') + ' [data-sel]');
      Array.prototype.forEach.call(boxes, function (b) {
        b.checked = t.checked;
        if (t.checked) set[b.dataset.id] = true; else delete set[b.dataset.id];
        b.closest('tr').classList.toggle('sel', t.checked);
      });
    }
    syncSel();
  }

  // ---- ledger form ------------------------------------------------------
  function resetForm() {
    editingId = null;
    root.querySelector('#lgName').value = '';
    root.querySelector('#lgUnder').innerHTML = underOptions('', true);
    root.querySelector('#lgSave').textContent = 'Create ledger';
    root.querySelector('#lgCancel').hidden = true;
    root.querySelector('#lgError').textContent = '';
  }

  function submit(ev) {
    ev.preventDefault();
    var name = root.querySelector('#lgName').value.trim().replace(/\s+/g, ' ');
    var under = root.querySelector('#lgUnder').value;
    var err = root.querySelector('#lgError');
    if (!name) { err.textContent = 'Enter the Name of Ledger.'; return; }
    if (!under || under === NEW) { err.textContent = 'Choose the group this ledger is Under.'; return; }
    var dup = data.ledgers.some(function (l) { return l.id !== editingId && l.name.toLowerCase() === name.toLowerCase(); });
    if (dup) { err.textContent = 'A ledger named "' + name + '" already exists.'; return; }

    if (editingId) {
      var l = data.ledgers.filter(function (x) { return x.id === editingId; })[0];
      l.name = name; l.under = under;
    } else {
      data.ledgers.push({ id: P.uid(), name: name, under: under, ts: Date.now() });
    }
    if (!save()) return;
    P.toast(editingId ? 'Ledger updated' : 'Ledger created');
    resetForm();
    render();
    root.querySelector('#lgName').focus();
  }

  // ---- sub-group dialog -------------------------------------------------
  // onSave(name) runs after a successful save (used to select the new group in the ledger form)
  function openSubgroup(group, onSave) {
    sgEditingId = group ? group.id : null;
    sgOnSave = onSave || null;
    root.querySelector('#sgTitle').textContent = group ? 'Edit sub-group' : 'New sub-group';
    root.querySelector('#sgName').value = group ? group.name : '';
    root.querySelector('#sgUnder').innerHTML = underOptions(group ? group.parent : '', false, group ? branchOf(group.name) : null);
    root.querySelector('#sgError').textContent = '';
    root.querySelector('#sgDialog').showModal();
    root.querySelector('#sgName').focus();
  }

  function saveSubgroup(ev) {
    ev.preventDefault();
    var name = root.querySelector('#sgName').value.trim().replace(/\s+/g, ' ');
    var parent = root.querySelector('#sgUnder').value;
    var err = root.querySelector('#sgError');
    if (!name) { err.textContent = 'Enter the name of the sub-group.'; return; }
    if (!parent) { err.textContent = 'Choose what this sub-group is Under.'; return; }
    var clash = findGroup(name);
    var self = sgEditingId && data.groups.filter(function (g) { return g.id === sgEditingId; })[0];
    if (clash && !(self && self.name === clash)) { err.textContent = '"' + clash + '" already exists as a group.'; return; }

    var saved = name;
    if (self) {
      var old = self.name;
      self.name = name; self.parent = parent;
      if (old !== name) {
        data.ledgers.forEach(function (l) { if (l.under === old) l.under = name; });
        data.groups.forEach(function (g) { if (g.parent === old) g.parent = name; });
      }
    } else {
      data.groups.push({ id: P.uid(), name: name, parent: parent });
    }
    if (!save()) return;
    root.querySelector('#sgDialog').close();
    var cb = sgOnSave; sgOnSave = null;
    render();
    if (cb) cb(saved);
    P.toast(self ? 'Sub-group updated' : 'Sub-group created');
  }

  // ---- upload -----------------------------------------------------------
  function clean(v) { return String(v == null ? '' : v).trim().replace(/\s+/g, ' '); }
  function showReport(html) { root.querySelector('#lgReport').innerHTML = html; }
  function reportError(msg) { showReport('<div class="panel report"><p class="form-error">' + esc(msg) + '</p></div>'); }

  // Read the sheet into a plan; nothing is saved yet.
  function planImport(rows) {
    var start = 0;
    if (rows.length && /ledger|name/i.test(rows[0][0] || '') && /under|group/i.test(rows[0][1] || '')) start = 1;

    var p = { items: [], invalid: [], dupes: 0, seen: 0, pending: {} };
    var taken = {};
    data.ledgers.forEach(function (l) { taken[l.name.toLowerCase()] = true; });

    for (var i = start; i < rows.length; i++) {
      var name = clean(rows[i][0]), under = clean(rows[i][1]), parentName = clean(rows[i][2]);
      if (!name && !under) continue;
      p.seen++;
      if (!name || !under) {
        p.invalid.push({ row: i + 1, name: name, under: under, why: !name ? 'Name of Ledger is empty' : 'Under is empty' });
        continue;
      }
      var key = name.toLowerCase();
      if (taken[key]) { p.dupes++; continue; }      // duplicates are ignored
      taken[key] = true;

      if (!findGroup(under)) {
        var gk = norm(under), pg = p.pending[gk];
        if (!pg) pg = p.pending[gk] = { name: under, parent: '', count: 0 };
        if (!pg.parent && parentName) pg.parent = findGroup(parentName);
        pg.count++;
      }
      p.items.push({ name: name, under: under });
    }
    return p;
  }

  // Save the planned ledgers (and the sub-groups they need), then show the result
  function commitImport(p) {
    var made = [];
    Object.keys(p.pending).forEach(function (k) {
      var g = p.pending[k];
      data.groups.push({ id: P.uid(), name: g.name, parent: g.parent });
      made.push(g.name);
    });
    p.items.forEach(function (it) {
      data.ledgers.push({ id: P.uid(), name: it.name, under: findGroup(it.under) || it.under, ts: Date.now() });
    });
    if ((p.items.length || made.length) && !save()) return;
    resetForm();
    render();

    var added = p.items.length;
    var html = '<div class="panel report">';
    if (!p.seen) html += '<p class="form-error">No ledger rows found. Put Name of Ledger in column A and Under in column B.</p>';
    else {
      html += '<p><b class="ok">' + added + ' ledger' + (added === 1 ? '' : 's') + ' added</b>' +
        (p.dupes ? ' &middot; <span class="muted">' + p.dupes + ' duplicate' + (p.dupes === 1 ? '' : 's') + ' ignored</span>' : '') +
        (p.invalid.length ? ' &middot; <b class="warn">' + p.invalid.length + ' skipped</b>' : '') + '</p>';
    }
    if (made.length) {
      html += '<p><b>' + made.length + ' new sub-group' + (made.length === 1 ? '' : 's') + ' created:</b> ' + made.map(esc).join(', ') + '.</p>';
    }
    if (p.invalid.length) {
      html += '<div class="table-wrap"><table><thead><tr><th>Row</th><th>Name of Ledger</th><th>Under</th><th>Reason</th></tr></thead><tbody>' +
        p.invalid.slice(0, 200).map(function (s) {
          return '<tr><td>' + s.row + '</td><td>' + esc(s.name) + '</td><td>' + esc(s.under) + '</td><td class="out">' + esc(s.why) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    html += '<div class="dlg-actions"><button type="button" class="btn btn-ghost" data-act="close-report">Dismiss</button></div></div>';
    showReport(html);
    if (added) P.toast(added + ' ledger' + (added === 1 ? '' : 's') + ' imported');
  }

  async function importFile(file) {
    var rows;
    try { rows = await P.readTable(file); }
    catch (e) { reportError(e.message || 'Could not read the file.'); return; }

    var p = planImport(rows);
    var missing = Object.keys(p.pending).filter(function (k) { return !p.pending[k].parent; });
    if (!missing.length) { commitImport(p); return; }

    // some sub-groups have no Under yet: ask first, then add the data
    plan = p;
    root.querySelector('#upList').innerHTML =
      '<table><thead><tr><th>New sub-group</th><th class="num">Ledgers</th><th>Under</th></tr></thead><tbody>' +
      missing.map(function (k) {
        return '<tr><td class="strong">' + esc(p.pending[k].name) + '</td><td class="num">' + p.pending[k].count + '</td>' +
          '<td><select data-key="' + esc(k) + '" aria-label="Under for ' + esc(p.pending[k].name) + '">' + underOptions('', false) + '</select></td></tr>';
      }).join('') + '</tbody></table>';
    root.querySelector('#upError').textContent = '';
    P.enhanceSelects(root.querySelector('#upList'));
    root.querySelector('#upDialog').showModal();
    var first = root.querySelector('#upList select');
    if (first) first.focus();
  }

  function confirmUpload(ev) {
    ev.preventDefault();
    var selects = root.querySelectorAll('#upList select'), ok = true;
    Array.prototype.forEach.call(selects, function (s) {
      s.classList.toggle('bad', !s.value);
      if (!s.value) ok = false;
    });
    if (!ok) { root.querySelector('#upError').textContent = 'Choose an Under for every new sub-group.'; return; }
    Array.prototype.forEach.call(selects, function (s) { plan.pending[s.dataset.key].parent = s.value; });
    var p = plan;
    plan = null;
    root.querySelector('#upDialog').close();
    commitImport(p);
  }

  function cancelUpload() {
    if (!plan) return;
    plan = null;
    var d = root.querySelector('#upDialog');
    if (d.open) d.close();
    showReport('<div class="panel report"><p class="muted">Upload cancelled. Nothing was added.</p>' +
      '<div class="dlg-actions"><button type="button" class="btn btn-ghost" data-act="close-report">Dismiss</button></div></div>');
  }

  function downloadTemplate() {
    var csv = 'Name of Ledger,Under,Sub-group Under (optional)\r\n' +
      'Rent Expense,Indirect Expenses,\r\n' +
      'ABC Traders,Sundry Debtors,\r\n' +
      'Shop Rent,Shop Expenses,Expenses\r\n' +
      'Petty Cash,Assets,\r\n' +
      'HDFC Bank,Bank Accounts,\r\n';
    P.download('ledgers-template.csv', '﻿' + csv, 'text/csv;charset=utf-8');
  }

  // ---- bulk delete ------------------------------------------------------
  async function bulkDeleteLedgers() {
    var ids = Object.keys(selL);
    if (!ids.length) return;
    var ok = await P.confirm({
      title: 'Delete ' + ids.length + ' ledger' + (ids.length === 1 ? '' : 's') + '?',
      message: 'The selected ledger' + (ids.length === 1 ? '' : 's') + ' will be removed. This cannot be undone.',
      confirmText: 'Delete ' + ids.length
    });
    if (!ok) return;
    ids = Object.keys(selL);
    data.ledgers = data.ledgers.filter(function (l) { return !selL[l.id]; });
    selL = {};
    save();
    if (editingId && !data.ledgers.some(function (l) { return l.id === editingId; })) resetForm();
    render();
    P.toast(ids.length + ' ledger' + (ids.length === 1 ? '' : 's') + ' deleted');
  }

  async function bulkDeleteGroups() {
    var ids = Object.keys(selG);
    if (!ids.length) return;
    var ok = await P.confirm({
      title: 'Delete ' + ids.length + ' sub-group' + (ids.length === 1 ? '' : 's') + '?',
      message: 'Any that still have ledgers or sub-groups under them will be kept.',
      confirmText: 'Delete ' + ids.length
    });
    if (!ok) return;
    ids = Object.keys(selG);
    var removed = 0, changed = true;
    // repeat so a parent and its (also selected) child can go together
    while (changed) {
      changed = false;
      data.groups = data.groups.filter(function (g) {
        if (!selG[g.id]) return true;
        var u = usage(g.name);
        if (u.ledgers || u.children) return true;
        removed++; changed = true;
        return false;
      });
    }
    selG = {};
    save();
    resetForm();
    render();
    var kept = ids.length - removed;
    P.toast(removed + ' sub-group' + (removed === 1 ? '' : 's') + ' deleted' + (kept ? ', ' + kept + ' kept because in use' : ''), kept > 0 && !removed);
  }

  // ---- events -----------------------------------------------------------
  function byId(list, id) { return list.filter(function (x) { return x.id === id; })[0]; }

  async function onClick(ev) {
    var b = ev.target.closest('[data-act]');
    if (!b) return;
    var act = b.dataset.act;
    if (act === 'close-report') { showReport(''); return; }
    if (act === 'bulk-delete-l') { bulkDeleteLedgers(); return; }
    if (act === 'bulk-delete-g') { bulkDeleteGroups(); return; }
    if (act === 'bulk-clear-l' || act === 'bulk-clear-g') {
      if (act === 'bulk-clear-l') selL = {}; else selG = {};
      render();
      return;
    }

    if (act === 'edit' || act === 'delete') {
      var l = byId(data.ledgers, b.dataset.id);
      if (!l) return;
      if (act === 'edit') {
        editingId = l.id;
        root.querySelector('#lgName').value = l.name;
        root.querySelector('#lgUnder').innerHTML = underOptions(l.under, true);
        root.querySelector('#lgSave').textContent = 'Update ledger';
        root.querySelector('#lgCancel').hidden = false;
        root.querySelector('#lgError').textContent = '';
        root.querySelector('#lgName').focus();
        render();
      } else {
        var okL = await P.confirm({
          title: 'Delete this ledger?', message: '"' + l.name + '" under ' + l.under + '. This cannot be undone.', confirmText: 'Delete'
        });
        if (!okL) return;
        data.ledgers = data.ledgers.filter(function (x) { return x.id !== l.id; });
        delete selL[l.id];
        save();
        if (editingId === l.id) resetForm();
        render();
        P.toast('Ledger deleted');
      }
      return;
    }

    if (act === 'sg-edit') { openSubgroup(byId(data.groups, b.dataset.id)); return; }
    if (act === 'sg-delete') {
      var g = byId(data.groups, b.dataset.id);
      if (!g) return;
      var u = usage(g.name);
      if (u.ledgers || u.children) {
        P.toast('"' + g.name + '" is in use (' + u.ledgers + ' ledger' + (u.ledgers === 1 ? '' : 's') +
          ', ' + u.children + ' sub-group' + (u.children === 1 ? '' : 's') + '). Move them first.', true);
        return;
      }
      var okG = await P.confirm({
        title: 'Delete this sub-group?', message: '"' + g.name + '" under ' + (g.parent || 'no group') + '. This cannot be undone.', confirmText: 'Delete'
      });
      if (!okG) return;
      data.groups = data.groups.filter(function (x) { return x.id !== g.id; });
      delete selG[g.id];
      save();
      resetForm();
      render();
      P.toast('Sub-group deleted');
    }
  }

  P.register({
    id: 'ledgers',
    title: 'Tally Ledgers',
    icon: '&#9636;',
    mount: function (container) {
      data = load();
      query = '';
      editingId = null;
      selL = {}; selG = {}; plan = null;
      container.innerHTML = TEMPLATE;
      // listeners live on the inner section, so they go away when the page is replaced
      root = container.querySelector('.lg');
      root.addEventListener('click', onClick);
      root.addEventListener('change', onChange);
      root.querySelector('#lgForm').addEventListener('submit', submit);
      root.querySelector('#lgCancel').addEventListener('click', function () { resetForm(); render(); });
      root.querySelector('#lgSearch').addEventListener('input', function (e) { query = e.target.value; render(); });

      // choosing "+ Add sub-group..." in Under opens the sub-group dialog
      var under = root.querySelector('#lgUnder');
      under.addEventListener('change', function () {
        if (under.value !== NEW) return;
        under.value = under.dataset.prev && under.dataset.prev !== NEW ? under.dataset.prev : '';   // put back what was there
        openSubgroup(null, function (name) { under.innerHTML = underOptions(name, true); });
      });

      root.querySelector('#sgAdd').addEventListener('click', function () { openSubgroup(null); });
      root.querySelector('#sgForm').addEventListener('submit', saveSubgroup);
      root.querySelector('#sgCancel').addEventListener('click', function () { root.querySelector('#sgDialog').close(); });

      root.querySelector('#upForm').addEventListener('submit', confirmUpload);
      root.querySelector('#upCancel').addEventListener('click', cancelUpload);
      root.querySelector('#upDialog').addEventListener('cancel', function (e) { e.preventDefault(); cancelUpload(); });
      root.querySelector('#upList').addEventListener('change', function (e) { e.target.classList.remove('bad'); });

      var fileInput = root.querySelector('#lgFile');
      root.querySelector('#lgUpload').addEventListener('click', function () { fileInput.click(); });
      root.querySelector('#lgTpl').addEventListener('click', downloadTemplate);
      fileInput.addEventListener('change', function () {
        var f = fileInput.files[0];
        fileInput.value = '';
        if (f) importFile(f);
      });

      resetForm();
      render();
      root.querySelector('#lgName').focus();
    }
  });
})();
