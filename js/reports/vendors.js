/* Potafo Accounts - Reports: Vendor List
   Each vendor has a Type (Restaurant or Mart) and the Commission % it is charged.
   The Monthly statement reads both from here: Restaurant vendors are charged TDS 1%, Mart vendors TCS 0.5%.
   Add vendors one by one, or upload a file:  column A Vendor ID · B Vendor Name · C Restaurant / Mart · D Commission % ·
   E Email (To) · F CC (both optional; several addresses can be separated by a comma or semicolon).
   A saved report is sent to the Email addresses, with the CC addresses copied.
   Tick vendors (or Select all) to delete several at once.
   Saved through Potafo.store under "reportvendors", so it syncs like the rest of the app. */
(function () {
  'use strict';

  var P = window.Potafo;
  var H = P.reports.helpers;
  var esc = P.esc;
  var KEY = 'reportvendors';

  // Vendor types and the tax taken from Amount for each (percent of Amount)
  var TYPES = {
    restaurant: { label: 'Restaurant', tax: 'TDS', rate: 1 },
    mart: { label: 'Mart', tax: 'TCS', rate: 0.5 }
  };

  // ---- data (also used by the Monthly statement) --------------------------------------
  // [{ id, vid, name, type: 'restaurant' | 'mart' | '', commission, email, cc }]
  //   id is the app's own key; vid is the Vendor ID typed or uploaded (text, '' when none)
  //   commission is a number (percent) or '' when not set;  email (To) and cc are '' or "a@b.com; c@d.com"
  function load() {
    var d = P.store.get(KEY, null) || {};
    return (Array.isArray(d.vendors) ? d.vendors : []).filter(function (v) { return v && v.name; }).map(function (v) {
      return {
        id: v.id || P.uid(), vid: v.vid == null ? '' : String(v.vid), name: String(v.name),
        type: TYPES[v.type] ? v.type : '',
        commission: typeof v.commission === 'number' ? v.commission : '',
        email: v.email == null ? '' : String(v.email),
        cc: v.cc == null ? '' : String(v.cc)
      };
    });
  }
  function save(list) { return P.store.set(KEY, { vendors: list }); }

  // vendor key -> { type, commission, vid, email, cc } for every vendor in the list
  function infoMap() {
    var map = Object.create(null);
    load().forEach(function (v) { map[H.vendorKey(v.name)] = { type: v.type, commission: v.commission, vid: v.vid, email: v.email, cc: v.cc }; });
    return map;
  }
  P.reports.vendors = { all: load, infoMap: infoMap, types: TYPES };

  function cleanName(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }

  // 'restaurant' | 'mart', or '' when the text is neither
  function parseType(v) {
    var t = String(v == null ? '' : v).trim().toLowerCase();
    return TYPES[t] ? t : '';
  }

  // percent as a number, '' when blank, null when it is not between 0 and 100
  function parseCommission(v) {
    var t = String(v == null ? '' : v).replace(/%/g, '').trim();
    if (t === '') return '';
    var n = H.toNumber(t);
    return n === null || n < 0 || n > 100 ? null : Math.round(n * 100) / 100;
  }

  // Email text -> { value: "a@b.com; c@d.com", bad: true when something in it is not an address }
  var EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
  function parseEmails(v) {
    var parts = String(v == null ? '' : v).split(/[,;\s]+/).filter(Boolean), good = [], seen = Object.create(null), bad = false;
    parts.forEach(function (p) {
      if (!EMAIL.test(p)) { bad = true; return; }
      if (!seen[p.toLowerCase()]) { seen[p.toLowerCase()] = true; good.push(p); }       // each address once, whatever its capitals
    });
    return { value: good.join('; '), bad: bad };
  }
  P.reports.vendors.emails = function (text) { return parseEmails(text).value ? parseEmails(text).value.split('; ') : []; };

  // ---- page ---------------------------------------------------------------------------------
  var COLUMNS = [
    { key: 'vid', label: 'Vendor ID' },
    { key: 'name', label: 'Vendor Name' },
    { key: 'type', label: 'Type' },
    { key: 'commission', label: 'Commission %', num: true },
    { key: 'email', label: 'Email (To)' },
    { key: 'cc', label: 'CC' }
  ];

  var TEMPLATE =
    '<section class="rv">' +
    '<div class="panel filters no-print">' +
      '<div class="field grow"><label for="rvSearch">Search</label><input type="search" id="rvSearch" placeholder="Search vendors..."></div>' +
      '<div class="btn-row">' +
        '<button type="button" class="btn btn-ghost" data-act="upload">Upload vendor list</button>' +
        '<button type="button" class="btn btn-ghost" data-act="export" id="rvExport">Export CSV</button>' +
        '<button type="button" class="btn btn-primary" data-act="add">+ Add Vendor</button>' +
        '<input type="file" id="rvFile" accept=".xlsx,.xls,.xlsm,.xlsb,.ods,.csv" hidden>' +
      '</div>' +
    '</div>' +
    '<p class="muted hint">Upload file format (Excel or CSV): column A <b>Vendor ID</b>, column B <b>Vendor Name</b>, column C <b>Restaurant</b> or <b>Mart</b>, column D <b>Commission %</b>, column E <b>Email</b> (To), column F <b>CC</b> (both optional, used to send saved reports; several addresses can be separated by a comma). ' +
      'Vendors already in the list are updated. Restaurant vendors are charged TDS 1%, Mart vendors TCS 0.5%.</p>' +
    '<p class="form-error" id="rvMsg"></p>' +
    '<div class="bulkbar" id="rvBulk"></div>' +
    '<div class="panel table-wrap" id="rvTable"></div>' +
    '<p class="sub" id="rvCount"></p>' +

    '<dialog id="rvDialog"><form id="rvForm" novalidate>' +
      '<h3 id="rvTitle">Add Vendor</h3>' +
      '<div class="field"><label for="rvVid">Vendor ID</label><input type="text" id="rvVid" maxlength="40" autocomplete="off"></div>' +
      '<div class="field"><label for="rvName">Vendor Name</label><input type="text" id="rvName" maxlength="120" autocomplete="off"></div>' +
      '<div class="field"><label for="rvType">Type</label><select id="rvType">' +
        '<option value="">Select type...</option>' +
        Object.keys(TYPES).map(function (k) { return '<option value="' + k + '">' + TYPES[k].label + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="field"><label for="rvComm">Commission %</label><input type="text" id="rvComm" inputmode="decimal" maxlength="8" autocomplete="off" placeholder="e.g. 12.5"></div>' +
      '<div class="field"><label for="rvEmail">Email (To) <span class="muted">(optional, several allowed)</span></label>' +
        '<input type="text" id="rvEmail" maxlength="400" autocomplete="off" placeholder="name@example.com, accounts@example.com"></div>' +
      '<div class="field"><label for="rvCc">CC <span class="muted">(optional, several allowed)</span></label>' +
        '<input type="text" id="rvCc" maxlength="400" autocomplete="off" placeholder="manager@example.com"></div>' +
      '<p class="form-error" id="rvErr"></p>' +
      '<div class="dlg-actions">' +
        '<button type="button" class="btn btn-ghost" data-act="cancel">Cancel</button>' +
        '<button type="submit" class="btn btn-primary">Save</button>' +
      '</div>' +
    '</form></dialog>' +
    '</section>';

  var root, vendors, sort, editingId;
  var picked;                         // ticked vendors: id -> true
  function $(sel) { return root.querySelector(sel); }

  function message(text, isError) {
    var el = $('#rvMsg');
    el.textContent = text || '';
    el.style.color = isError ? '' : 'var(--muted)';
  }

  function typeLabel(t) { return t ? TYPES[t].label : ''; }

  function visible() {
    var q = H.vendorKey($('#rvSearch').value);
    return vendors.filter(function (v) {
      return !q || H.vendorKey(v.name).indexOf(q) !== -1 || H.vendorKey(v.vid).indexOf(q) !== -1;
    }).sort(function (a, b) {
      if (sort.key === 'vid') {
        // vendors without an ID go last in either direction
        if (a.vid === '' || b.vid === '') return (a.vid === '') - (b.vid === '') || H.compareValues(a.name, b.name);
        return sort.dir * H.compareValues(a.vid, b.vid) || H.compareValues(a.name, b.name);
      }
      if (sort.key === 'commission') {
        // vendors without a commission go last in either direction
        if (a.commission === '' || b.commission === '') {
          return (a.commission === '') - (b.commission === '') || H.compareValues(a.name, b.name);
        }
        return sort.dir * (a.commission - b.commission) || H.compareValues(a.name, b.name);
      }
      if (sort.key === 'type') {
        if (a.type === '' || b.type === '') return (a.type === '') - (b.type === '') || H.compareValues(a.name, b.name);
        return sort.dir * H.compareValues(a.type, b.type) || H.compareValues(a.name, b.name);
      }
      return sort.dir * H.compareValues(a.name, b.name);
    });
  }

  function render() {
    // forget ticks for vendors that no longer exist
    var ids = Object.create(null);
    vendors.forEach(function (v) { ids[v.id] = true; });
    Object.keys(picked).forEach(function (id) { if (!ids[id]) delete picked[id]; });

    var list = visible();
    var head = '<th class="chk"><input type="checkbox" id="rvAll" data-pick="all" aria-label="Select all"></th>' +
      COLUMNS.map(function (c) {
        var arrow = sort.key === c.key ? ' <span class="rp-arrow">' + (sort.dir === 1 ? '&#9650;' : '&#9660;') + '</span>' : '';
        return '<th class="rp-sort' + (c.num ? ' num' : '') + '" data-key="' + c.key + '">' + esc(c.label) + arrow + '</th>';
      }).join('') + '<th></th>';

    var body = list.map(function (v) {
      return '<tr' + (picked[v.id] ? ' class="sel"' : '') + '>' +
        '<td class="chk"><input type="checkbox" data-pick="row" data-id="' + esc(v.id) + '"' + (picked[v.id] ? ' checked' : '') +
          ' aria-label="Select ' + esc(v.name) + '"></td>' +
        '<td class="nowrap">' + (v.vid ? esc(v.vid) : '&mdash;') + '</td>' +
        '<td>' + esc(v.name) + '</td>' +
        '<td>' + (v.type ? esc(typeLabel(v.type)) : '&mdash;') + '</td>' +
        '<td class="num">' + (v.commission === '' ? '&mdash;' : esc(v.commission) + '%') + '</td>' +
        '<td>' + (v.email ? esc(v.email) : '&mdash;') + '</td>' +
        '<td>' + (v.cc ? esc(v.cc) : '&mdash;') + '</td>' +
        '<td class="actions"><button type="button" class="btn btn-ghost btn-sm" data-act="edit" data-id="' + esc(v.id) + '">Edit</button> ' +
        '<button type="button" class="btn btn-ghost btn-sm" data-act="delete" data-id="' + esc(v.id) + '">Delete</button></td></tr>';
    }).join('');
    if (!list.length) {
      body = '<tr><td colspan="8" class="empty">' + (vendors.length ? 'No vendors match the search.' :
        'No vendors yet. Upload a vendor list or click "+ Add Vendor".') + '</td></tr>';
    }
    $('#rvTable').innerHTML = '<table><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table>';
    $('#rvCount').textContent = vendors.length ? 'Showing ' + list.length + ' of ' + vendors.length + ' vendor' + (vendors.length === 1 ? '' : 's') : '';
    $('#rvExport').disabled = !vendors.length;
    syncPicked(list);
  }

  // Select all box (applies to the vendors shown, so a search narrows it) and the delete bar
  function syncPicked(list) {
    list = list || visible();
    var all = $('#rvAll'), shownPicked = list.filter(function (v) { return picked[v.id]; }).length;
    all.disabled = !list.length;
    all.checked = list.length > 0 && shownPicked === list.length;
    all.indeterminate = shownPicked > 0 && shownPicked < list.length;

    var n = Object.keys(picked).length;
    $('#rvBulk').innerHTML = n
      ? '<span class="bulk-count">' + n + ' selected</span>' +
        '<button type="button" class="btn btn-danger btn-sm" data-act="delete-picked">Delete selected</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-act="clear-picked">Clear</button>'
      : '';
  }

  function openDialog(v) {
    editingId = v ? v.id : null;
    $('#rvTitle').textContent = v ? 'Edit Vendor' : 'Add Vendor';
    $('#rvVid').value = v ? v.vid : '';
    $('#rvName').value = v ? v.name : '';
    $('#rvType').value = v ? v.type : '';
    $('#rvComm').value = v ? v.commission : '';
    $('#rvEmail').value = v ? v.email : '';
    $('#rvCc').value = v ? v.cc : '';
    $('#rvErr').textContent = '';
    $('#rvDialog').showModal();
    $('#rvName').focus();
  }

  function submit(ev) {
    ev.preventDefault();
    var vid = cleanName($('#rvVid').value);
    var name = cleanName($('#rvName').value), type = $('#rvType').value, commission = parseCommission($('#rvComm').value), err = $('#rvErr');
    if (!name) { err.textContent = 'Enter the vendor name.'; return; }
    if (vid && vendors.some(function (v) { return v.id !== editingId && v.vid.toLowerCase() === vid.toLowerCase(); })) {
      err.textContent = 'Vendor ID "' + vid + '" is already used by another vendor.';
      return;
    }
    if (!type) { err.textContent = 'Choose Restaurant or Mart.'; return; }
    if (commission === null) { err.textContent = 'Commission % must be a number between 0 and 100.'; return; }
    var mail = parseEmails($('#rvEmail').value), copy = parseEmails($('#rvCc').value);
    if (mail.bad) { err.textContent = 'Email (To): enter valid email addresses, separated by a comma.'; return; }
    if (copy.bad) { err.textContent = 'CC: enter valid email addresses, separated by a comma.'; return; }
    var key = H.vendorKey(name);
    if (vendors.some(function (v) { return v.id !== editingId && H.vendorKey(v.name) === key; })) {
      err.textContent = '"' + name + '" is already in the vendor list.';
      return;
    }
    var wasEditing = !!editingId;
    if (editingId) {
      var v = vendors.filter(function (x) { return x.id === editingId; })[0];
      if (v) { v.vid = vid; v.name = name; v.type = type; v.commission = commission; v.email = mail.value; v.cc = copy.value; }
    } else {
      vendors.push({ id: P.uid(), vid: vid, name: name, type: type, commission: commission, email: mail.value, cc: copy.value });
    }
    if (!save(vendors)) return;
    $('#rvDialog').close();
    message('');
    render();
    P.toast(wasEditing ? 'Vendor updated' : 'Vendor added');
  }

  async function removeMany(list) {
    if (!list.length) return;
    var one = list.length === 1;
    var ok = await P.confirm({
      title: one ? 'Delete vendor?' : 'Delete ' + list.length + ' vendors?',
      message: one ? '"' + list[0].name + '" will be removed from the vendor list.' :
        list.length + ' selected vendors will be removed from the vendor list. This cannot be undone.',
      confirmText: one ? 'Delete' : 'Delete ' + list.length
    });
    if (!ok) return;
    var gone = Object.create(null);
    list.forEach(function (v) { gone[v.id] = true; delete picked[v.id]; });
    vendors = vendors.filter(function (v) { return !gone[v.id]; });
    save(vendors);
    render();
    P.toast(one ? 'Vendor deleted' : list.length + ' vendors deleted');
  }

  async function upload(file) {
    try {
      var sheet = (await H.readSpreadsheet(file)).filter(function (s) { return s.rows.length; })[0];
      if (!sheet) throw new Error('the file is empty.');

      // The first row is skipped when it is a header ("Vendor ID", "Vendor Name", "Type", "Commission %")
      var rows = sheet.rows, r0 = rows[0];
      if (parseCommission(r0[3]) === null ||
          (cleanName(r0[3]) === '' && !parseType(r0[2]) && /id|vendor|name/i.test(cleanName(r0[0]) + ' ' + cleanName(r0[1])))) rows = rows.slice(1);

      // A vendor already in the list is found by its Vendor ID, or else by its name
      var byName = Object.create(null), byVid = Object.create(null);
      vendors.forEach(function (v) {
        byName[H.vendorKey(v.name)] = v;
        if (v.vid) byVid[v.vid.toLowerCase()] = v;
      });
      var added = 0, updated = 0, badType = 0, badComm = 0, badMail = 0, badCc = 0;
      rows.forEach(function (row) {
        var vid = cleanName(row[0]), name = cleanName(row[1]);
        if (!name) return;
        var type = parseType(row[2]), commission = parseCommission(row[3]), mail = parseEmails(row[4]), copy = parseEmails(row[5]);
        if (!type && cleanName(row[2]) !== '') badType++;
        if (commission === null) { badComm++; commission = ''; }
        if (mail.bad) badMail++;
        if (copy.bad) badCc++;

        var existing = (vid && byVid[vid.toLowerCase()]) || byName[H.vendorKey(name)];
        if (existing) {
          // a blank or invalid value never wipes an ID, type or commission already set
          if (vid && !existing.vid) { existing.vid = vid; byVid[vid.toLowerCase()] = existing; }
          if (vid && existing.vid.toLowerCase() === vid.toLowerCase()) {
            var other = byName[H.vendorKey(name)];                 // renamed in the file, unless the new name is taken
            if (!other || other === existing) {
              delete byName[H.vendorKey(existing.name)];
              existing.name = name;
              byName[H.vendorKey(name)] = existing;
            }
          }
          if (type) existing.type = type;
          if (commission !== '') existing.commission = commission;
          if (mail.value) existing.email = mail.value;
          if (copy.value) existing.cc = copy.value;
          updated++;
        } else {
          var v = { id: P.uid(), vid: vid, name: name, type: type, commission: commission, email: mail.value, cc: copy.value };
          vendors.push(v);
          byName[H.vendorKey(name)] = v;
          if (vid) byVid[vid.toLowerCase()] = v;
          added++;
        }
      });
      if (!added && !updated) throw new Error('no vendor names found in column B.');

      save(vendors);
      render();
      var parts = [added + ' added', updated + ' already in the list (updated)'];
      if (badType) parts.push(badType + ' with a Type that is not Restaurant or Mart (left blank)');
      if (badComm) parts.push(badComm + ' with a Commission % that is not a number between 0 and 100 (left blank)');
      if (badMail) parts.push(badMail + ' with an Email that is not valid (invalid addresses left out)');
      if (badCc) parts.push(badCc + ' with a CC that is not valid (invalid addresses left out)');
      message(file.name + ': ' + parts.join(', ') + '.', badType + badComm + badMail + badCc > 0);
    } catch (err) {
      message('Could not upload ' + file.name + ': ' + (err && err.message || err), true);
    }
  }

  function onClick(ev) {
    var th = ev.target.closest('th[data-key]');
    if (th) {
      sort = { key: th.dataset.key, dir: sort.key === th.dataset.key ? -sort.dir : 1 };
      render();
      return;
    }
    var b = ev.target.closest('[data-act]');
    if (!b) return;
    var v = b.dataset.id ? vendors.filter(function (x) { return x.id === b.dataset.id; })[0] : null;
    switch (b.dataset.act) {
      case 'add': openDialog(null); break;
      case 'edit': if (v) openDialog(v); break;
      case 'delete': if (v) removeMany([v]); break;
      case 'delete-picked': removeMany(vendors.filter(function (x) { return picked[x.id]; })); break;
      case 'clear-picked': picked = {}; render(); break;
      case 'cancel': $('#rvDialog').close(); break;
      case 'upload': $('#rvFile').click(); break;
      case 'export':
        H.downloadCSV('vendors-' + P.isoDate() + '.csv', [['Vendor ID', 'Vendor Name', 'Type', 'Commission %', 'Email', 'CC']].concat(
          visible().map(function (x) { return [x.vid, x.name, typeLabel(x.type), x.commission, x.email, x.cc]; })));
        break;
    }
  }

  function onInput(ev) {
    var t = ev.target;
    if (t.id === 'rvSearch') { render(); return; }
    if (!t.dataset || !t.dataset.pick) return;
    if (t.dataset.pick === 'all') {
      visible().forEach(function (x) { if (t.checked) picked[x.id] = true; else delete picked[x.id]; });
      render();
    } else {
      if (t.checked) picked[t.dataset.id] = true; else delete picked[t.dataset.id];
      t.closest('tr').classList.toggle('sel', t.checked);
      syncPicked();
    }
  }

  function onChange(ev) {
    if (ev.target.id !== 'rvFile') return;
    var file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (file) upload(file);
  }

  // Add or fill in several vendors at once (used by "Add the missing vendors" in the Monthly statement).
  //   items = [{ name, type, commission, email, cc }]  (type: 'restaurant' | 'mart'; commission: text or number; email / cc: text)
  // A vendor already in the list is updated with the values given (an empty value never wipes what is there); a new one is added
  // and needs a Type. Nothing is saved when something is wrong. Returns { added, updated } or { error }.
  P.reports.vendors.upsert = function (items) {
    var list = load(), byKey = Object.create(null), prepared = [];
    list.forEach(function (v) { byKey[H.vendorKey(v.name)] = v; });

    for (var i = 0; i < items.length; i++) {
      var it = items[i], name = cleanName(it.name), existing = byKey[H.vendorKey(name)];
      var type = parseType(it.type) || (existing && existing.type) || '';
      var commission = parseCommission(it.commission), mail = parseEmails(it.email), copy = parseEmails(it.cc);
      if (!name) return { error: 'A vendor has no name.' };
      if (!type) return { error: 'Choose Restaurant or Mart for "' + name + '".' };
      if (commission === null) return { error: 'Commission % for "' + name + '" must be a number between 0 and 100.' };
      if (mail.bad) return { error: 'Email (To) for "' + name + '" has an address that is not valid.' };
      if (copy.bad) return { error: 'CC for "' + name + '" has an address that is not valid.' };
      prepared.push({ name: name, type: type, commission: commission, email: mail.value, cc: copy.value });
    }

    var added = 0, updated = 0;
    prepared.forEach(function (p) {
      var existing = byKey[H.vendorKey(p.name)];
      if (existing) {
        existing.type = p.type;
        if (p.commission !== '') existing.commission = p.commission;
        if (p.email) existing.email = p.email;
        if (p.cc) existing.cc = p.cc;
        updated++;
      } else {
        var v = { id: P.uid(), vid: '', name: p.name, type: p.type, commission: p.commission, email: p.email, cc: p.cc };
        list.push(v);
        byKey[H.vendorKey(p.name)] = v;
        added++;
      }
    });
    if (!save(list)) return { error: 'Could not save the Vendor List.' };
    return { added: added, updated: updated };
  };
  P.reports.register({
    id: 'vendors',
    title: 'Vendor List',
    place: 'tool',
    mount: function (container) {
      root = container;
      vendors = load();
      picked = {};
      sort = { key: 'name', dir: 1 };
      container.innerHTML = TEMPLATE;
      container.addEventListener('click', onClick);
      container.addEventListener('input', onInput);
      container.addEventListener('change', onChange);
      container.querySelector('#rvForm').addEventListener('submit', submit);
      render();
    },
    unmount: function () {
      if (root) {
        root.removeEventListener('click', onClick);
        root.removeEventListener('input', onInput);
        root.removeEventListener('change', onChange);
      }
      root = null;
    }
  });
})();
