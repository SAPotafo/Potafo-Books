/* Potafo Accounts - Reports: Monthly statement
   1. Upload a file (Excel .xlsx / .xls, or .csv). The first row holds the column names.
   2. Say which column is the Order No, Date, Vendor Name and Amount.
   3. Tick the vendors. One report is made for each, with these calculated columns:
        TDS or TCS (% of Amount) · Commission % (from the Vendor List) · Commission Amount · GST (18% of Commission Amount) · Final Amount
        The tax follows the vendor's Type in the Vendor List: Restaurant = TDS 1%, Mart = TCS 0.5%.
        Final Amount = Amount - TDS/TCS - Commission Amount - GST
   Export all (Excel) gives one workbook with a Summary and one sheet per vendor. Export separately gives one zip with an Excel file
   per vendor, except that vendors put in a group (the Grouping box, js/reports/groups.js) share one file, a sheet each.
   Each vendor card also has its own Export Excel and Export CSV.
   Save report keeps the report (the chosen columns and vendors, the ticked reports, the orders of those vendors and the
   Type / Commission % they had) in Saved Reports (js/reports/saved.js) and opens that list. A saved report opens again
   on this same screen, without the upload steps (see mountSaved at the bottom). */
(function () {
  'use strict';

  var P = window.Potafo;
  var H = P.reports.helpers;
  var esc = P.esc, money = P.money;

  var GST_RATE = 18;       // % of Commission Amount
  var MAX_OPTIONS = 2000;  // vendors drawn in the list at once; keep typing to narrow it down

  // The four report columns, the dropdown that maps each to a column of the file,
  // and header words used to pre-select a likely match.
  var FIELDS = [
    { key: 'orderNo', label: 'Order No', select: 'msColOrderNo', match: /order|invoice|bill|ref/ },
    { key: 'date', label: 'Date', select: 'msColDate', match: /date|time/ },
    { key: 'vendor', label: 'Vendor Name', select: 'msColVendor', match: /vendor|restaurant|supplier|merchant|shop|store|party/ },
    { key: 'amount', label: 'Amount', select: 'msColAmount', match: /amount|total|value|price|amt/ }
  ];

  var TEMPLATE =
    '<section class="ms">' +
    '<div class="no-print">' +
      '<div class="panel ms-step">' +
        '<h3>1. Upload file</h3>' +
        '<div class="ms-row">' +
          '<button type="button" class="btn btn-primary" data-act="choose">Choose file&hellip;</button>' +
          '<input type="file" id="msFile" accept=".xlsx,.xls,.xlsm,.xlsb,.ods,.csv,.tsv,.txt" hidden>' +
          '<div class="field" id="msSheetWrap" hidden><label for="msSheet">Sheet</label><select id="msSheet"></select></div>' +
        '</div>' +
        '<p class="muted" id="msInfo">Excel (.xlsx, .xls), CSV, TSV or ODS. The first row must contain the column names.</p>' +
      '</div>' +

      '<div id="msOptions" hidden>' +
        '<div class="panel ms-step">' +
          '<h3>2. Select columns</h3>' +
          '<div class="ms-grid">' + FIELDS.map(function (f) {
            return '<div class="field"><label for="' + f.select + '">' + f.label + '</label><select id="' + f.select + '"></select></div>';
          }).join('') + '</div>' +
          '<p class="muted hint">Pick which column of your file holds each value. Columns left as "(not in file)" are omitted from the report.</p>' +
        '</div>' +

        '<div class="panel ms-step">' +
          '<h3>3. Select vendor</h3>' +
          '<div class="ms-split">' +
            '<div class="rp-combo">' +
              '<input type="search" id="msVendorSearch" placeholder="Search vendors..." autocomplete="off" aria-label="Search vendors">' +
              '<div class="rp-combo-list" id="msVendorList" role="listbox" aria-multiselectable="true" aria-label="Vendors"></div>' +
              '<p class="sub" id="msVendorCount"></p>' +
            '</div>' +
            '<div id="msGroupBox"></div>' +
          '</div>' +
        '</div>' +

        '<div class="panel ms-step">' +
          '<div class="ms-row">' +
            '<button type="button" class="btn btn-primary" data-act="save">Save report</button>' +
            '<button type="button" class="btn btn-ghost" data-act="export-all" id="msExport" disabled>Export all (Excel)</button>' +
            '<button type="button" class="btn btn-ghost" data-act="export-each" id="msExportEach" disabled>Export separately</button>' +
          '</div>' +
          '<p class="muted" id="msMsg"></p>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div id="msReport" hidden></div>' +
    '</section>';

  var root, file, columns, dataRows, report;
  var vendors, selected, activeOption;
  var groupBox;                      // the Grouping box (js/reports/groups.js)
  var repQuery = '';                 // what is typed in "Search reports"
  var savedDoc = null, savedHooks = null;      // set while a saved report is open instead of the upload steps

  // A saved report: the same report screen, without the upload / column / vendor steps
  var SAVED_TEMPLATE =
    '<section class="ms">' +
    '<div class="ms-savedhead no-print">' +
      '<a class="btn btn-ghost btn-sm" href="#/reports/saved">&larr; Saved reports</a>' +
      '<div><h3 id="msSavedName"></h3><p class="sub" id="msSavedMeta"></p></div>' +
    '</div>' +
    '<div class="panel ms-step no-print">' +
      '<div class="ms-row">' +
        '<button type="button" class="btn btn-ghost" data-act="export-all" id="msExport" disabled>Export all (Excel)</button>' +
        '<button type="button" class="btn btn-ghost" data-act="export-each" id="msExportEach" disabled>Export separately</button>' +
      '</div>' +
      '<p class="muted" id="msMsg"></p>' +
    '</div>' +
    '<div id="msSendBox" class="no-print"></div>' +
    '<div id="msGroupBox" hidden></div>' +
    '<div id="msReport" hidden></div>' +
    '</section>';

  function $(sel) { return root.querySelector(sel); }

  // A message line: red when it is a problem, grey otherwise
  function say(sel, text, isError) {
    var el = $(sel);
    el.textContent = text || '';
    el.className = isError ? 'form-error' : 'muted';
  }

  function resetReport() {
    report = null;
    $('#msReport').hidden = true;
    $('#msExport').disabled = true;
    $('#msExportEach').disabled = true;
    say('#msMsg', '');
  }

  // ---- upload and column choice ---------------------------------------------------
  // The columns chosen in step 2 are remembered by header name ("Restaurant Name"), so the next file with the same headers
  // opens with them already picked. "" means the field was left as "(not in file)".
  var COLUMNS_KEY = 'reportcolumns';
  function rememberedColumns() {
    var d = P.store.get(COLUMNS_KEY, null);
    return d && d.map ? d.map : {};
  }
  function rememberColumns() {
    var map = mapping(), out = {};
    FIELDS.forEach(function (f) { out[f.key] = map[f.key] === -1 ? '' : columns[map[f.key]]; });
    P.store.set(COLUMNS_KEY, { map: out });
  }

  async function onFile(upload) {
    try {
      var sheets = (await H.readSpreadsheet(upload)).filter(function (s) { return s.rows.length > 0; });
      if (!sheets.length) throw new Error('the file is empty.');
      file = { name: upload.name, sheets: sheets };
      repQuery = '';
      $('#msSheet').innerHTML = sheets.map(function (s, i) { return '<option value="' + i + '">' + esc(s.name) + '</option>'; }).join('');
      $('#msSheetWrap').hidden = sheets.length < 2;
      showSheet(0);
    } catch (err) {
      $('#msOptions').hidden = true;
      $('#msSheetWrap').hidden = true;
      resetReport();
      say('#msInfo', 'Could not read ' + upload.name + ': ' + (err && err.message || err), true);
    }
  }

  function showSheet(index) {
    resetReport();
    var rows = file.sheets[index].rows;
    if (rows.length < 2) {
      $('#msOptions').hidden = true;
      say('#msInfo', file.name + ': this sheet has no data rows below the header row.', true);
      return;
    }
    columns = rows[0].map(function (h, i) { return String(h).trim() || 'Column ' + (i + 1); });
    dataRows = rows.slice(1);

    // pre-select the column used last time (found by its header name); otherwise the first unused column whose header looks like the field
    var used = Object.create(null), remembered = rememberedColumns();
    FIELDS.forEach(function (f) {
      var guess = -1, last = remembered[f.key];
      if (last === '') guess = -2;                       // last time this one was left as "(not in file)"
      else if (last) {
        for (var j = 0; j < columns.length && guess === -1; j++) {
          if (!used[j] && columns[j].toLowerCase() === last.toLowerCase()) guess = j;
        }
      }
      for (var i = 0; i < columns.length && guess === -1; i++) {
        if (!used[i] && f.match.test(columns[i].toLowerCase())) guess = i;
      }
      if (guess === -2) guess = -1;
      if (guess !== -1) used[guess] = true;
      var sel = $('#' + f.select);
      sel.innerHTML = '<option value="">(not in file)</option>' +
        columns.map(function (c, i) { return '<option value="' + i + '">' + esc(c) + '</option>'; }).join('');
      sel.value = guess === -1 ? '' : String(guess);
    });

    selected = Object.create(null);
    $('#msOptions').hidden = false;
    updateMapping();
    say('#msInfo', file.name + ': ' + dataRows.length + ' rows, ' + columns.length + ' columns.');
  }

  function mapping() {
    var map = {};
    FIELDS.forEach(function (f) {
      var v = $('#' + f.select).value;
      map[f.key] = v === '' ? -1 : Number(v);
    });
    return map;
  }

  // Redo what depends on the chosen columns: the vendor list
  function updateMapping() {
    var map = mapping();
    resetReport();

    // one entry per vendor: names differing only in case or spacing are merged, keeping the first spelling
    var byKey = Object.create(null), order = [];
    if (map.vendor !== -1) {
      dataRows.forEach(function (r) {
        var label = String(r[map.vendor] == null ? '' : r[map.vendor]).replace(/\s+/g, ' ').trim();
        var key = H.vendorKey(label);
        if (key && !byKey[key]) { byKey[key] = label; order.push(key); }
      });
    }
    vendors = order.map(function (k) { return { key: k, label: byKey[k] }; })
      .sort(function (a, b) { return a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true }); });
    Object.keys(selected).forEach(function (k) { if (!byKey[k]) delete selected[k]; });

    var input = $('#msVendorSearch');
    input.disabled = map.vendor === -1;
    input.value = '';
    activeOption = -1;
    $('#msVendorList').scrollTop = 0;
    renderVendorList();
    if (groupBox) groupBox.refresh();                 // which grouped vendors are in this file
  }

  // ---- searchable multi-select vendor list ------------------------------------------
  // The list is, in order: "Select all", the groups that have a vendor in this file, then the vendors.
  // Typing searches both: a group is found by its name or by the name of a vendor in it.
  function listRows() {
    var q = H.vendorKey($('#msVendorSearch').value);
    var matches = q ? vendors.filter(function (v) { return v.key.indexOf(q) !== -1; }) : vendors;

    var present = Object.create(null);
    vendors.forEach(function (v) { present[v.key] = true; });
    var groups = (groupBox ? groupBox.groups() : []).map(function (g) {
      return { g: g, keys: g.members.map(function (m) { return m.key; }).filter(function (k) { return present[k]; }) };
    }).filter(function (r) {
      if (!r.keys.length) return false;
      return !q || H.vendorKey(r.g.name).indexOf(q) !== -1 || r.keys.some(function (k) { return k.indexOf(q) !== -1; });
    });

    var shown = matches.slice(0, MAX_OPTIONS), rows = [];
    if (matches.length) rows.push({ type: 'all' });
    groups.forEach(function (r) { rows.push({ type: 'group', g: r.g, keys: r.keys }); });
    shown.forEach(function (v) { rows.push({ type: 'vendor', v: v }); });
    return { rows: rows, matches: matches, more: matches.length - shown.length, groups: groups.length };
  }

  // Each row's number is its position in listRows().rows (0 is "Select all")
  function renderVendorList() {
    var L = listRows(), rows = L.rows;
    if (activeOption >= rows.length) activeOption = rows.length - 1;

    function option(index, label, checked, extra, sub) {
      return '<div class="rp-opt' + extra + (index === activeOption ? ' active' : '') + '" role="option" aria-selected="' + checked +
        '" data-index="' + index + '"><input type="checkbox" tabindex="-1"' + (checked ? ' checked' : '') + '> <span>' + esc(label) +
        (sub ? ' <span class="sub">' + esc(sub) + '</span>' : '') + '</span></div>';
    }

    var html;
    if ($('#msVendorSearch').disabled) {
      html = '<div class="rp-note">Select the Vendor Name column first.</div>';
    } else if (!rows.length) {
      html = '<div class="rp-note">' + (vendors.length ? 'No vendors or groups match.' : 'No vendor names found in this column.') + '</div>';
    } else {
      html = '';
      rows.forEach(function (r, i) {
        if (r.type === 'all') {
          var searching = L.matches.length !== vendors.length;
          html += option(0, (searching ? 'Select all matching (' : 'Select all (') + L.matches.length + ')',
            L.matches.length > 0 && L.matches.every(function (v) { return selected[v.key]; }), ' rp-all');
        } else if (r.type === 'group') {
          if (i === 0 || rows[i - 1].type === 'all') html += '<div class="rp-head">Groups</div>';
          html += option(i, r.g.name, r.keys.every(function (k) { return selected[k]; }), ' rp-grp',
            r.keys.length + ' vendor' + (r.keys.length === 1 ? '' : 's'));
        } else {
          if (L.groups && rows[i - 1].type !== 'vendor') html += '<div class="rp-head">Vendors</div>';
          html += option(i, r.v.label, !!selected[r.v.key], '');
        }
      });
      if (L.more > 0) html += '<div class="rp-note">' + L.more + ' more &mdash; keep typing to narrow down.</div>';
    }

    var list = $('#msVendorList'), scroll = list.scrollTop;
    list.innerHTML = html;
    list.scrollTop = scroll;
    $('#msVendorCount').textContent = vendors.length ? Object.keys(selected).length + ' of ' + vendors.length + ' vendors selected' : '';

    // keep the keyboard-highlighted row in view without scrolling the page
    var active = list.querySelector('.active:not(.rp-all)'), all = list.querySelector('.rp-all');
    if (active && all) {
      var top = active.offsetTop - all.offsetHeight;
      if (top < list.scrollTop) list.scrollTop = top;
      else if (active.offsetTop + active.offsetHeight > list.scrollTop + list.clientHeight) {
        list.scrollTop = active.offsetTop + active.offsetHeight - list.clientHeight;
      }
    }
  }

  function toggleVendor(index) {
    var L = listRows(), r = L.rows[index];
    if (!r) return;
    function flip(keys, on) { keys.forEach(function (k) { if (on) selected[k] = true; else delete selected[k]; }); }
    if (r.type === 'all') {
      var every = L.matches.every(function (v) { return selected[v.key]; });
      flip(L.matches.map(function (v) { return v.key; }), !every);
    } else if (r.type === 'group') {
      flip(r.keys, !r.keys.every(function (k) { return selected[k]; }));      // a group ticks or unticks all its vendors in this file
    } else {
      flip([r.v.key], !selected[r.v.key]);
    }
    renderVendorList();
    if (Object.keys(selected).length) generate(); else resetReport();
  }
  // ---- building the report -------------------------------------------------------------
  // The raw orders of the selected vendors, read from the sheet by the columns chosen in step 2.
  // [{ orderNo, vendor, key, rawDate, rawAmount }]  (key is the vendor's key, '' when there is no vendor column)
  function collectOrders(map) {
    function cell(row, key) { return map[key] === -1 ? '' : String(row[map[key]] == null ? '' : row[map[key]]).trim(); }
    var filterVendors = map.vendor !== -1;
    var labelOf = Object.create(null);
    vendors.forEach(function (v) { labelOf[v.key] = v.label; });
    var orders = [];
    dataRows.forEach(function (row) {
      var o = { orderNo: cell(row, 'orderNo'), vendor: cell(row, 'vendor'), key: '', rawDate: cell(row, 'date'), rawAmount: cell(row, 'amount') };
      if (filterVendors) {
        o.key = H.vendorKey(o.vendor);
        if (!selected[o.key]) return;
        o.vendor = labelOf[o.key] || o.vendor;          // same spelling as the vendor list for merged names
      }
      orders.push(o);
    });
    return orders;
  }

  // From orders and the vendor facts to the finished report. Used for a new report and for a saved one, so a saved
  // report is rebuilt with the Type and Commission % it was saved with, not today's Vendor List.
  //   input = { mappedKeys, filterVendors, vendors: [{ key, label }], orders, info: { key: { type, commission, vid } }, source }
  //   returns { report, warnings }
  function buildStatement(input) {
    var mapped = FIELDS.filter(function (f) { return input.mappedKeys.indexOf(f.key) !== -1; });
    var filterVendors = input.filterVendors, hasAmount = input.mappedKeys.indexOf('amount') !== -1;

    var badDates = 0, badAmounts = 0, records = input.orders.map(function (o) {
      var r = {
        orderNo: o.orderNo, vendor: o.vendor, key: o.key, rawDate: o.rawDate, rawAmount: o.rawAmount,
        dateKey: H.parseDate(o.rawDate), amount: H.toNumber(o.rawAmount)
      };
      if (r.rawDate && !r.dateKey) badDates++;
      if (r.rawAmount && r.amount === null) badAmounts++;
      return r;
    });

    function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
    function cellMoney(n) { return { text: money(n), sort: n, num: true, csv: n.toFixed(2) }; }
    var blank = { text: '', sort: -Infinity, num: true };

    // Type (Restaurant / Mart) and Commission % per vendor
    var info = input.info, TYPES = P.reports.vendors.types;
    var noCommission = [], noType = [];
    var FALLBACK = TYPES.restaurant;        // a vendor with no type is taxed as a Restaurant

    function infoFor(vendorName) { return info[H.vendorKey(vendorName)] || { type: '', commission: '', vid: '' }; }
    function taxFor(vendorName) { return TYPES[infoFor(vendorName).type] || FALLBACK; }
    function rateFor(vendorName) { var c = infoFor(vendorName).commission; return c === '' ? undefined : c; }

    function buildSection(name, recs) {
      var tax = filterVendors ? taxFor(name) : FALLBACK;
      var headers = mapped.map(function (f) { return f.label; });
      if (hasAmount) headers.push(tax.tax + ' (' + tax.rate + '%)', 'Commission %', 'Commission Amount', 'GST (' + GST_RATE + '%)', 'Final Amount');
      var totals = { amount: 0, tds: 0, commission: 0, gst: 0, final: 0 };
      function makeRow(r) {
        var cells = mapped.map(function (f) {
          if (f.key === 'date') {
            return r.dateKey ? { text: P.fmtDate(r.dateKey), sort: r.dateKey } : { text: r.rawDate, sort: r.rawDate };
          }
          if (f.key === 'amount') {
            return r.amount === null ? { text: r.rawAmount, sort: -Infinity, num: true } : cellMoney(r.amount);
          }
          return { text: r[f.key], sort: r[f.key] };
        });
        if (!hasAmount) return cells;

        var rate = rateFor(r.vendor), who = r.vendor || '(blank)';
        if (rate === undefined && noCommission.indexOf(who) === -1) noCommission.push(who);
        if (filterVendors && !TYPES[infoFor(r.vendor).type] && noType.indexOf(who) === -1) noType.push(who);
        var rateCell = rate === undefined
          ? { text: '—', sort: -Infinity, num: true, csv: '' }
          : { text: rate + '%', sort: rate, num: true, csv: String(rate) };
        if (r.amount === null) return cells.concat([blank, rateCell, blank, blank, blank]);

        // Final Amount = Amount - TDS/TCS - Commission Amount - GST on commission
        var tds = round2(r.amount * tax.rate / 100);
        var commission = round2(r.amount * (rate || 0) / 100);
        var gst = round2(commission * GST_RATE / 100);
        var final = round2(r.amount - tds - commission - gst);
        totals.amount += r.amount; totals.tds += tds; totals.commission += commission; totals.gst += gst; totals.final += final;
        return cells.concat([cellMoney(tds), rateCell, cellMoney(commission), cellMoney(gst), cellMoney(final)]);
      }
      // each row keeps its raw record (.rec) so the Excel file can be built from the real values, in the order shown
      var rows = recs.map(function (r) { var out = makeRow(r); out.rec = r; return out; });

      var foot = null;
      if (hasAmount) {
        foot = mapped.map(function (f, i) { return f.key === 'amount' ? money(totals.amount) : i === 0 ? 'Total' : ''; })
          .concat([money(totals.tds), '', money(totals.commission), money(totals.gst), money(totals.final)]);
      }

      var meta = [rows.length + ' order' + (rows.length === 1 ? '' : 's')];
      if (filterVendors) {
        var inf = infoFor(name);
        meta.push(TYPES[inf.type] ? TYPES[inf.type].label : 'Type not set (taxed as Restaurant)');
        if (hasAmount) meta.push(inf.commission === '' ? 'Commission % not set' : 'Commission ' + inf.commission + '%');
      }
      var vendorInfo = filterVendors ? infoFor(name) : { type: '', commission: '', vid: '' };
      return {
        name: name, meta: meta.join(' · '), headers: headers, rows: rows, foot: foot, sort: { index: -1, dir: 1 },
        // what the Excel file needs to know about this vendor
        x: {
          vid: vendorInfo.vid || '', typeLabel: TYPES[vendorInfo.type] ? TYPES[vendorInfo.type].label : '',
          taxName: tax.tax, taxRate: tax.rate, commission: vendorInfo.commission
        }
      };
    }

    // one report section per selected vendor, in the order of the vendor list
    var groups = filterVendors
      ? input.vendors.map(function (v) {
          return { name: v.label, records: records.filter(function (r) { return r.key === v.key; }) };
        })
      : [{ name: 'All orders', records: records }];

    var sections = groups.map(function (g) { return buildSection(g.name, g.records); });

    var warnings = [];
    if (badDates) warnings.push(badDates + ' row' + (badDates === 1 ? ' has a date' : 's have dates') + ' that could not be read');
    if (badAmounts) warnings.push(badAmounts + ' row' + (badAmounts === 1 ? ' has an amount' : 's have amounts') + ' that is not a number and is left out of the total');
    if (noType.length) {
      warnings.push('no Type (Restaurant or Mart) in the Vendor List for ' + noType.slice(0, 5).join(', ') +
        (noType.length > 5 ? ' and ' + (noType.length - 5) + ' more' : '') + ' — taxed as Restaurant (TDS ' + FALLBACK.rate + '%)');
    }
    if (noCommission.length) {
      warnings.push('no Commission % in the Vendor List for ' + noCommission.slice(0, 5).join(', ') +
        (noCommission.length > 5 ? ' and ' + (noCommission.length - 5) + ' more' : '') + ' — commission taken as 0');
    }

    // every vendor the notes above are about (not the "(blank)" row), once
    var missing = [];
    noType.concat(noCommission).forEach(function (n) { if (n !== '(blank)' && missing.indexOf(n) === -1) missing.push(n); });

    return {
      warnings: warnings,
      missing: missing,
      report: {
        sections: sections, mappedKeys: mapped.map(function (f) { return f.key; }), hasAmount: hasAmount,
        gstRate: GST_RATE, source: input.source, filterVendors: filterVendors
      }
    };
  }

  // The vendors ticked in step 3, in list order, and what the Vendor List says about each of them right now
  function selectedVendors() { return vendors.filter(function (v) { return selected[v.key]; }); }

  function infoOf(list) {
    var all = P.reports.vendors.infoMap(), out = Object.create(null);
    list.forEach(function (v) { out[v.key] = all[v.key] || { type: '', commission: '', vid: '' }; });
    return out;
  }

  // What a report is made from. Keep it, and the same report can be rebuilt later.
  function currentInput() {
    var map = mapping();
    var mappedKeys = FIELDS.filter(function (f) { return map[f.key] !== -1; }).map(function (f) { return f.key; });
    var chosen = selectedVendors();
    return {
      mappedKeys: mappedKeys, filterVendors: map.vendor !== -1, vendors: chosen, orders: collectOrders(map),
      info: infoOf(chosen), source: file.name
    };
  }

  function generate() {
    var map = mapping();
    if (FIELDS.every(function (f) { return map[f.key] === -1; })) { say('#msMsg', 'Select at least one column.', true); return; }
    if (map.vendor !== -1 && !Object.keys(selected).length) {
      resetReport();
      say('#msMsg', 'Select at least one vendor.', true);
      return;
    }

    rememberColumns();                  // a column choice that was accepted as suggested is remembered too
    var input = currentInput(), out = buildStatement(input);
    showWarnings(out);

    // reports already ticked or unticked for export keep their choice when the vendor selection changes
    var picks = Object.create(null);
    if (report) report.sections.forEach(function (s) { picks[s.name] = s.pick; });
    out.report.sections.forEach(function (s) { s.pick = picks[s.name] !== false; });

    report = out.report;
    report.input = input;               // kept so the report can be saved
    renderReport();
  }
  // ---- showing it ---------------------------------------------------------------------------
  function sectionHtml(section, index) {
    var numeric = section.rows.length ? section.rows[0].map(function (c) { return !!c.num; }) : [];

    var head = section.headers.map(function (h, i) {
      var arrow = section.sort.index === i ? ' <span class="rp-arrow">' + (section.sort.dir === 1 ? '&#9650;' : '&#9660;') + '</span>' : '';
      return '<th class="rp-sort' + (numeric[i] ? ' num' : '') + '" data-index="' + i + '">' + esc(h) + arrow + '</th>';
    }).join('');

    var body = section.rows.map(function (row) {
      return '<tr>' + row.map(function (c) { return '<td' + (c.num ? ' class="num"' : '') + '>' + esc(c.text) + '</td>'; }).join('') + '</tr>';
    }).join('');

    var foot = section.foot && section.rows.length
      ? '<tfoot><tr class="row-total">' + section.foot.map(function (t, i) {
          return '<td' + (numeric[i] ? ' class="num"' : '') + '>' + esc(t) + '</td>';
        }).join('') + '</tr></tfoot>'
      : '';

    return '<section class="panel ms-vendor" data-section="' + index + '"' + (reportVisible(section) ? '' : ' hidden') + '>' +
      '<div class="ms-vhead"><div class="ms-vtitle">' +
        '<input type="checkbox" class="no-print" data-rep="pick" data-section="' + index + '"' + (section.pick ? ' checked' : '') +
          ' aria-label="Include ' + esc(section.name) + ' in the export">' +
        '<div><h3>' + esc(section.name) + '</h3><p class="sub">' + esc(section.meta) + '<span class="ms-gtag">' + groupTag(section) + '</span></p></div></div>' +
      '<div class="btn-row no-print">' +
        (savedDoc ? '<button type="button" class="btn btn-primary btn-sm" data-act="send-vendor" data-section="' + index + '">Send</button>' : '') +
        '<button type="button" class="btn btn-ghost btn-sm" data-act="export-xlsx" data-section="' + index + '">Export Excel</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-act="export-one" data-section="' + index + '">Export CSV</button>' +
      '</div></div>' +
      '<div class="table-wrap"><table><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody>' + foot + '</table></div>' +
      (section.rows.length ? '' : '<p class="empty">No orders for this vendor.</p>') +
      '</section>';
  }

  // Search and select over the generated reports. A report matches by the vendor's name or by the name of its group.
  function groupTag(section) {
    var g = groupBox ? groupBox.groupOf(H.vendorKey(section.name)) : '';
    return g ? ' · Group: ' + esc(g) : '';
  }

  function reportVisible(section) {
    var q = H.vendorKey(repQuery);
    if (!q) return true;
    var g = groupBox ? groupBox.groupOf(H.vendorKey(section.name)) : '';
    return H.vendorKey(section.name).indexOf(q) !== -1 || (g !== '' && H.vendorKey(g).indexOf(q) !== -1);
  }

  // Hide the reports that do not match the search, and bring the Select all box and the count up to date
  function applyReportFilter() {
    if (!report || !root) return;
    var shown = 0, shownPicked = 0, picked = 0;
    report.sections.forEach(function (s, i) {
      var vis = reportVisible(s), el = $('#msReport [data-section="' + i + '"].ms-vendor');
      if (el) el.hidden = !vis;
      if (vis) { shown++; if (s.pick) shownPicked++; }
      if (s.pick) picked++;
    });
    var all = $('#msRepAll');
    all.disabled = !shown;
    all.checked = shown > 0 && shownPicked === shown;
    all.indeterminate = shownPicked > 0 && shownPicked < shown;
    $('#msRepCount').textContent = picked + ' of ' + report.sections.length + ' report' + (report.sections.length === 1 ? '' : 's') + ' selected for export';
    $('#msRepNone').hidden = shown > 0;
  }

  // The group shown under each vendor's name changes when groups are created or removed
  function refreshGroupTags() {
    if (!report || !root) return;
    report.sections.forEach(function (s, i) {
      var tag = $('#msReport [data-section="' + i + '"] .ms-gtag');
      if (tag) tag.innerHTML = groupTag(s);
    });
    applyReportFilter();
    renderSendBox();
  }

  function pickedSections() { return report ? report.sections.filter(function (s) { return s.pick; }) : []; }

  // ---- sending a saved report by email (see js/reports/mail.js) ---------------------------------
  // The addresses of these vendors from the Vendor List as it is now (or, failing that, as it was when the report was saved).
  // field is 'email' (To) or 'cc'. Each address appears once, whichever vendor it belongs to.
  function addressesFor(sections, field) {
    var current = P.reports.vendors.infoMap(), snap = (report.input && report.input.info) || {}, seen = Object.create(null), out = [];
    sections.forEach(function (s) {
      var key = H.vendorKey(s.name), text = (current[key] && current[key][field]) || (snap[key] && snap[key][field]) || '';
      P.reports.vendors.emails(text).forEach(function (e) {
        if (!seen[e.toLowerCase()]) { seen[e.toLowerCase()] = true; out.push(e); }
      });
    });
    return out;
  }
  function emailsFor(sections) { return addressesFor(sections, 'email'); }
  // CC addresses, leaving out anyone who is already in To
  function ccFor(sections) {
    var inTo = Object.create(null);
    emailsFor(sections).forEach(function (e) { inTo[e.toLowerCase()] = true; });
    return addressesFor(sections, 'cc').filter(function (e) { return !inTo[e.toLowerCase()]; });
  }
  // The groups that have a ticked report here: [{ g, sections }]
  function groupsInReport() {
    return (groupBox ? groupBox.groups() : []).map(function (g) {
      var keys = Object.create(null);
      g.members.forEach(function (m) { keys[m.key] = true; });
      return { g: g, sections: report.sections.filter(function (s) { return keys[H.vendorKey(s.name)]; }) };
    }).filter(function (r) { return r.sections.length; });
  }

  function renderSendBox() {
    var box = root && $('#msSendBox');
    if (!box || !savedDoc || !report) return;
    var rows = groupsInReport(), files = groupBox.plan(pickedSections());
    var noAddress = files.filter(function (f) { return !emailsFor(f.sections).length; }).length;

    box.innerHTML = '<div class="panel ms-step"><h3>Send by email</h3>' +
      '<p class="muted">A vendor&rsquo;s <b>Send</b> opens Gmail with the message ready. Gmail cannot take the Excel from a web page, so ' +
        '<b>Prepare Gmail drafts</b> is the way to have it attached for you: it saves one file with every ticked email and its Excel, ' +
        'and Claude turns it into drafts in your Gmail (Drafts folder) with the Excel attached, ready for you to send.</p>' +
      '<div class="ms-sendrow"><div><b>All ticked reports</b> <span class="sub">' + files.length + ' email' + (files.length === 1 ? '' : 's') +
        ' (a group is one email)' + (noAddress ? ' &middot; ' + noAddress + ' without an address in the Vendor List' : '') + '</span></div>' +
        '<button type="button" class="btn btn-primary btn-sm" data-act="prepare-drafts"' + (files.length ? '' : ' disabled') + '>Prepare Gmail drafts</button></div>' +
      rows.map(function (r) {
        var ticked = r.sections.filter(function (s) { return s.pick; }), to = emailsFor(ticked);
        return '<div class="ms-sendrow"><div><b>' + esc(r.g.name) + '</b> <span class="sub">group &middot; ' + ticked.length + ' of ' + r.sections.length + ' ticked &middot; ' +
          (to.length ? 'to ' + esc(to.join('; ')) : 'no email saved in the Vendor List') + (ccFor(ticked).length ? ' &middot; cc ' + esc(ccFor(ticked).join('; ')) : '') + '</span></div>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-act="send-group" data-id="' + esc(r.g.id) + '"' + (ticked.length ? '' : ' disabled') + '>Send</button></div>';
      }).join('') + '</div>';
  }

  // One file with every email to make: who it goes to, the subject, the message and the Excel (as text) to attach.
  // Claude reads it and creates the Gmail drafts, because a web page cannot attach files to Gmail itself.
  async function prepareDrafts() {
    var files = groupBox.plan(pickedSections());
    if (!files.length) { P.toast('Tick at least one report first.', true); return; }
    try {
      var items = [];
      for (var i = 0; i < files.length; i++) {
        var f = files[i], names = f.group ? f.sections.map(function (s) { return s.name; }) : null;
        var month = P.reports.mail.monthLabel(f.sections, savedDoc.savedAt), msg = P.reports.mail.message(f.name, month, names);
        var fileName = statementFile(f.name, f.sections, 'xlsx');
        items.push({
          for: f.name, group: !!f.group, vendors: f.sections.map(function (s) { return s.name; }),
          to: emailsFor(f.sections), cc: ccFor(f.sections), subject: msg.subject, body: msg.body,
          attachment: {
            filename: fileName, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            content: await P.reports.mail.blobToBase64(P.reports.workbook.build(P.reports.statementWorkbook(report, f.sections)))
          }
        });
      }
      var name = 'gmail-drafts-' + H.fileSafe(savedDoc.name) + '-' + P.isoDate() + '.json';
      P.download(name, JSON.stringify({ report: savedDoc.name, created: new Date().toISOString(), emails: items }, null, 1), 'application/json');

      var el = $('#msMsg');
      el.className = 'muted';
      el.innerHTML = 'Saved <b>' + esc(name) + '</b> (' + items.length + ' email' + (items.length === 1 ? '' : 's') + ') to your Downloads folder. ' +
        'Now tell Claude: <b>&ldquo;Create the Gmail drafts from ' + esc(name) + '&rdquo;</b>. The drafts appear in Gmail &rarr; Drafts with the Excel attached.';
      P.toast('Drafts file saved. Ask Claude to create the Gmail drafts.');
    } catch (err) {
      P.toast('Could not prepare the drafts: ' + (err && err.message || err), true);
    }
  }
  // Send these vendors' statement by Gmail (see js/reports/mail.js): a draft with the Excel attached when the Google client ID is
  // set in js/config.js, otherwise a Gmail message to attach the downloaded Excel to. It starts straight from the click, which is
  // what lets the browser open Google's window and the new tab.
  function sendMail(sections, greeting, vendorNames) {
    var el = $('#msMsg'), name = esc(greeting);
    try {
      var to = emailsFor(sections), cc = ccFor(sections), fileName = statementFile(greeting, sections, 'xlsx');
      el.className = 'muted';
      el.innerHTML = 'Preparing the email for <b>' + name + '</b>&hellip;';

      P.reports.mail.send({
        to: to, cc: cc, greeting: greeting, vendorNames: vendorNames,
        month: P.reports.mail.monthLabel(sections, savedDoc.savedAt),
        fileName: fileName, workbook: P.reports.workbook.build(P.reports.statementWorkbook(report, sections))
      }).then(function (r) {
        if (!root) return;                                           // the page was closed meanwhile
        var who = (to.length ? ' (to ' + esc(to.join(', ')) : ' &mdash; no email is saved for it in the Vendor List, so type the address') +
          (cc.length ? (to.length ? ', ' : ' (') + 'cc ' + esc(cc.join(', ')) + ')' : (to.length ? ')' : ''));
        var link = ' <a href="' + esc(r.url) + '" target="_blank" rel="noopener">' + (r.mode === 'draft' ? 'Open the draft in Gmail' : 'Open Gmail') + '</a>.';
        el = $('#msMsg');
        if (r.mode === 'draft') {
          el.className = 'muted';
          el.innerHTML = 'A Gmail draft for <b>' + name + '</b>' + who + ' was created with <b>' + esc(fileName) + '</b> attached. ' +
            'Check it and press Send in Gmail.' + link;
          P.toast(r.opened ? 'Gmail draft created with the Excel attached.' : 'Draft created. Use the link under the buttons to open it.', !r.opened);
        } else {
          el.className = r.error ? 'form-error' : 'muted';
          el.innerHTML = (r.error ? 'The draft with the Excel attached could not be made (' + esc(r.error) + '). ' : '') +
            'Gmail is opening for <b>' + name + '</b>' + who + '. Attach <b>' + esc(fileName) + '</b> by dragging it from your browser&rsquo;s ' +
            'downloads into the message, or with the paperclip.' + (r.opened ? '' : link);
          P.toast(r.opened ? 'Gmail opened. Attach the downloaded Excel file.' : 'Allow pop-ups to open Gmail.', !r.opened);
        }
      });
    } catch (err) {
      el.className = 'form-error';
      el.textContent = 'Could not prepare the email: ' + (err && err.message || err);
    }
  }
  function sendVendor(index) {
    var s = report.sections[index];
    if (s) sendMail([s], s.name, null);
  }

  function sendGroup(id) {
    var r = groupsInReport().filter(function (x) { return x.g.id === id; })[0];
    if (!r) return;
    var ticked = r.sections.filter(function (s) { return s.pick; });
    if (!ticked.length) { P.toast('Tick at least one report of this group.', true); return; }
    sendMail(ticked, r.g.name, ticked.map(function (s) { return s.name; }));
  }

  function renderReport() {
    $('#msReport').innerHTML =
      '<div class="panel filters no-print ms-repbar">' +
        '<div class="field grow"><label for="msRepSearch">Search reports</label>' +
          '<input type="search" id="msRepSearch" placeholder="Vendor or group name..." autocomplete="off" value="' + esc(repQuery) + '"></div>' +
        '<label class="ms-repall"><input type="checkbox" id="msRepAll"> <span>Select all</span></label>' +
        '<span class="muted" id="msRepCount"></span>' +
      '</div>' +
      '<p class="panel empty" id="msRepNone" hidden>No reports match the search.</p>' +
      report.sections.map(sectionHtml).join('');
    $('#msReport').hidden = false;
    $('#msExport').disabled = false;
    $('#msExportEach').disabled = false;
    applyReportFilter();
    renderSendBox();
  }

  function compareCells(a, b) {
    if (typeof a.sort === 'number' && typeof b.sort === 'number') return a.sort - b.sort;
    return H.compareValues(a.sort, b.sort);
  }

  // ---- exporting ---------------------------------------------------------------------------
  // Header, rows and total of one section as plain values; numbers stay numbers when asNumbers is set
  function sectionLines(section, asNumbers) {
    function value(c) {
      if (c.csv == null) return c.text;
      return asNumbers && c.csv !== '' ? Number(c.csv) : c.csv;
    }
    var lines = [section.headers].concat(section.rows.map(function (row) { return row.map(value); }));
    if (section.foot && section.rows.length) {
      lines.push(section.foot.map(function (t) {
        var n = H.toNumber(t);
        return n === null ? t : asNumbers ? n : n.toFixed(2);
      }));
    }
    return lines;
  }

  // File names: the vendor (or group), the month its orders are in, and the word Statement, e.g. "Alankar Restaurant September 2026 Statement.xlsx".
  function statementFile(who, sections, ext) {
    var month = P.reports.mail.monthLabel(sections, savedDoc ? savedDoc.savedAt : null);
    var name = (who + ' ' + month + ' Statement').replace(/[\\\\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
    return name.slice(0, 120).trim() + '.' + ext;
  }

  // Excel workbook with live formulas (see js/reports/statement-xlsx.js). index = one vendor, otherwise every vendor.
  function exportExcel(index) {
    try {
      var one = index != null;
      var sections = one ? [report.sections[index]] : pickedSections();
      if (!sections.length) { P.toast('Tick at least one report to export.', true); return; }
      P.reports.workbook.save(statementFile(one ? sections[0].name : 'All Vendors', sections, 'xlsx'), P.reports.statementWorkbook(report, sections));
      P.toast('Excel file created');
    } catch (err) {
      P.toast('Could not create the Excel file: ' + (err && err.message || err), true);
    }
  }

  // Separate Excel files in ONE zip: one file per group (a sheet per vendor) and one per vendor that is in no group.
  async function exportEach() {
    var files = groupBox.plan(pickedSections()), used = Object.create(null);
    if (!files.length) { P.toast('Tick at least one report to export.', true); return; }
    $('#msExportEach').disabled = true;
    try {
      var entries = [];
      for (var i = 0; i < files.length; i++) {
        var f = files[i], name = statementFile(f.name, f.sections, 'xlsx');
        for (var n = 2; used[name.toLowerCase()]; n++) name = statementFile(f.name, f.sections, 'xlsx').replace(/\.xlsx$/, ' (' + n + ').xlsx');   // a group and a vendor can give the same name
        used[name.toLowerCase()] = true;
        var blob = P.reports.workbook.build(P.reports.statementWorkbook(report, f.sections));
        entries.push({ name: name, data: new Uint8Array(await blob.arrayBuffer()) });
      }
      var zipName = P.reports.mail.monthLabel(pickedSections(), savedDoc ? savedDoc.savedAt : null) + ' Statements.zip';
      P.reports.workbook.download(zipName, P.exporter.zip(entries, 'application/zip'));
      P.toast(entries.length + ' Excel file' + (entries.length === 1 ? '' : 's') + ' saved in ' + zipName);
    } catch (err) {
      P.toast('Could not create the zip file: ' + (err && err.message || err), true);
    }
    if (root && report) $('#msExportEach').disabled = false;
  }
  // ---- vendors missing from the Vendor List ----------------------------------------------------------
  var lastMissing = [];               // the vendors the note is about, for the "Add the missing vendors" form

  // The note under the buttons: what is missing, with the way to fix it. extra = another sentence to add.
  function showWarnings(out, extra) {
    lastMissing = out.missing || [];
    var el = root && $('#msMsg');
    if (!el) return;
    el.className = out.warnings.length ? 'form-error' : 'muted';
    el.innerHTML = esc(out.warnings.length ? 'Note: ' + out.warnings.join('; ') + '.' : '') +
      (lastMissing.length
        ? ' <button type="button" class="btn btn-primary btn-sm" data-act="add-missing">Add the ' + lastMissing.length + ' missing vendor' + (lastMissing.length === 1 ? '' : 's') + '</button>' +
          (savedDoc ? ' <a href="#/reports/vendors">or open the Vendor List</a>' : '')
        : '') +
      (extra ? (out.warnings.length ? ' ' : '') + '<span class="muted">' + esc(extra) + '</span>' : '');
  }

  // A saved report was saved with the vendors' details of that day: rebuild it with what the Vendor List says now
  // (only blanks are filled in), keeping the ticks.
  function rebuildSaved(extra) {
    var picks = Object.create(null);
    report.sections.forEach(function (s) { picks[s.name] = s.pick; });
    var out = buildStatement(savedDoc.input);
    out.report.sections.forEach(function (s) { s.pick = picks[s.name] !== false; });
    out.report.input = savedDoc.input;
    report = out.report;
    showWarnings(out, extra);
    renderReport();
  }

  // A form with one row per missing vendor: Type, Commission %, Email, CC. Saved straight into the Vendor List.
  function openMissingDialog() {
    if (!lastMissing.length) return;
    var existing = Object.create(null);
    P.reports.vendors.all().forEach(function (v) { existing[H.vendorKey(v.name)] = v; });

    var dlg = document.createElement('dialog');
    dlg.className = 'ms-missing';
    dlg.innerHTML =
      '<form method="dialog" novalidate>' +
        '<h3>Add the missing vendors</h3>' +
        '<p class="muted">These vendors are in the file but have no Type or Commission % in the Vendor List. Fill in what you know and press <b>Save vendors</b>; ' +
          'they are added to the Vendor List and this report is updated. Rows you leave empty are skipped.</p>' +
        '<div class="ms-missing-body"><table><thead><tr><th>Vendor</th><th>Type</th><th>Commission %</th><th>Email (To)</th><th>CC</th></tr></thead><tbody>' +
        lastMissing.map(function (name, i) {
          return '<tr data-i="' + i + '"><td>' + esc(name) + '</td>' +
            '<td><select data-plain data-f="type"><option value="">Select...</option><option value="restaurant">Restaurant</option><option value="mart">Mart</option></select></td>' +
            '<td><input type="text" data-f="commission" inputmode="decimal" maxlength="8" placeholder="e.g. 12.5" autocomplete="off"></td>' +
            '<td><input type="text" data-f="email" maxlength="400" placeholder="a@x.com, b@x.com" autocomplete="off"></td>' +
            '<td><input type="text" data-f="cc" maxlength="400" autocomplete="off"></td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<p class="form-error" data-m="err"></p>' +
        '<div class="dlg-actions">' +
          '<button type="button" class="btn btn-ghost" data-m="cancel">Cancel</button>' +
          '<button type="button" class="btn btn-primary" data-m="save">Save vendors</button>' +
        '</div>' +
      '</form>';

    // start from what the Vendor List already has for these vendors
    lastMissing.forEach(function (name, i) {
      var v = existing[H.vendorKey(name)], tr = dlg.querySelector('tr[data-i="' + i + '"]');
      if (!v) return;
      tr.querySelector('[data-f=type]').value = v.type;
      tr.querySelector('[data-f=commission]').value = v.commission;
      tr.querySelector('[data-f=email]').value = v.email;
      tr.querySelector('[data-f=cc]').value = v.cc;
    });

    function close() { dlg.close(); dlg.remove(); }
    dlg.addEventListener('cancel', function (e) { e.preventDefault(); close(); });
    dlg.addEventListener('click', function (e) {
      var b = e.target.closest('[data-m]');
      if (!b) return;
      if (b.dataset.m === 'cancel') { close(); return; }
      if (b.dataset.m !== 'save') return;

      var items = [];
      Array.prototype.forEach.call(dlg.querySelectorAll('tbody tr'), function (tr) {
        function val(f) { return tr.querySelector('[data-f=' + f + ']').value.trim(); }
        var it = { name: lastMissing[Number(tr.dataset.i)], type: val('type'), commission: val('commission'), email: val('email'), cc: val('cc') };
        var v = existing[H.vendorKey(it.name)];
        // skip a row that has nothing new: empty, or just what the Vendor List already holds
        var changed = it.type !== (v ? v.type : '') || it.commission !== String(v ? v.commission : '') || it.email !== (v ? v.email : '') || it.cc !== (v ? v.cc : '');
        if (changed && (it.type || it.commission || it.email || it.cc)) items.push(it);
      });
      if (!items.length) { dlg.querySelector('[data-m=err]').textContent = 'Fill in at least one vendor.'; return; }

      var r = P.reports.vendors.upsert(items);
      if (r.error) { dlg.querySelector('[data-m=err]').textContent = r.error; return; }
      close();
      vendorsChanged(r);
    });

    document.body.appendChild(dlg);
    dlg.showModal();
    var first = dlg.querySelector('[data-f=type]');
    if (first) first.focus();
  }

  // The Vendor List changed: bring the report up to date (a saved report is updated and saved too)
  function vendorsChanged(r) {
    var count = (r.added || 0) + (r.updated || 0);
    if (!root || !report) return;
    if (savedDoc) {
      var n = P.reports.saved.refreshInfo(savedDoc);
      rebuildSaved(n ? 'Saved report updated for ' + n + ' vendor' + (n === 1 ? '' : 's') + '.' : '');
    } else {
      generate();
    }
    P.toast(count + ' vendor' + (count === 1 ? '' : 's') + ' saved in the Vendor List. The report is updated.');
  }
  // ---- saving ------------------------------------------------------------------------------------
  // Keep the report in Saved Reports, then show that list. The report is rebuilt first so what is saved is what is on screen.
  function saveReport() {
    generate();
    if (!report) return;
    var picks = {};
    report.sections.forEach(function (s) { picks[s.name] = s.pick; });
    if (!P.reports.saved.add(report.input, picks)) return;
    P.toast('Report saved');
    location.hash = '#/reports/saved';
  }

  // In a saved report, ticking or unticking a report is remembered
  function notifyPicks() {
    if (!savedHooks || !report) return;
    var picks = {};
    report.sections.forEach(function (s) { picks[s.name] = s.pick; });
    savedHooks.picks(picks);
    renderSendBox();                    // the group rows show how many of their vendors are ticked
  }

  // ---- events -----------------------------------------------------------------------------------
  function onClick(ev) {
    var th = ev.target.closest('th[data-index]');
    if (th && report) {
      var el = th.closest('[data-section]'), idx = Number(el.dataset.section), section = report.sections[idx], col = Number(th.dataset.index);
      section.sort = { index: col, dir: section.sort.index === col ? -section.sort.dir : 1 };
      section.rows.sort(function (a, b) { return section.sort.dir * compareCells(a[col], b[col]); });
      el.outerHTML = sectionHtml(section, idx);
      return;
    }

    var opt = ev.target.closest('.rp-opt');
    if (opt) { toggleVendor(Number(opt.dataset.index)); return; }

    var b = ev.target.closest('[data-act]');
    if (!b) return;
    switch (b.dataset.act) {
      case 'choose': $('#msFile').click(); break;
      case 'save': saveReport(); break;
      case 'export-all': if (report) exportExcel(); break;
      case 'export-each': if (report) exportEach(); break;
      case 'export-xlsx': if (report) exportExcel(Number(b.dataset.section)); break;
      case 'send-vendor': if (report && savedDoc) sendVendor(Number(b.dataset.section)); break;
      case 'send-group': if (report && savedDoc) sendGroup(b.dataset.id); break;
      case 'prepare-drafts': if (report && savedDoc) prepareDrafts(); break;
      case 'add-missing': openMissingDialog(); break;
      case 'export-one':
        var s = report && report.sections[Number(b.dataset.section)];
        if (s) H.downloadCSV(statementFile(s.name, [s], 'csv'), sectionLines(s, false));
        break;
    }
  }

  function onChange(ev) {
    var t = ev.target;
    if (t.id === 'msFile') {
      var f = t.files && t.files[0];
      t.value = '';                                  // choosing the same file again still fires
      if (f) onFile(f);
    } else if (t.id === 'msSheet') showSheet(Number(t.value));
    else if (t.id === 'msRepAll' && report) {
      // ticks or unticks the reports shown (those matching the search)
      report.sections.forEach(function (s, i) {
        if (!reportVisible(s)) return;
        s.pick = t.checked;
        var box = $('#msReport [data-rep="pick"][data-section="' + i + '"]');
        if (box) box.checked = t.checked;
      });
      applyReportFilter();
      notifyPicks();
    } else if (t.dataset && t.dataset.rep === 'pick' && report) {
      report.sections[Number(t.dataset.section)].pick = t.checked;
      applyReportFilter();
      notifyPicks();
    } else if (FIELDS.some(function (f) { return f.select === t.id; })) { rememberColumns(); updateMapping(); }
  }

  function onInput(ev) {
    if (ev.target.id === 'msRepSearch') {
      repQuery = ev.target.value;
      applyReportFilter();
      return;
    }
    if (ev.target.id !== 'msVendorSearch') return;
    $('#msVendorList').scrollTop = 0;
    activeOption = ev.target.value.trim() ? 1 : -1;      // highlight the first match so Enter ticks it
    renderVendorList();
  }

  function onKey(ev) {
    if (ev.target.id !== 'msVendorSearch') return;
    var count = listRows().rows.length;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (!count) return;
      activeOption = ev.key === 'ArrowDown' ? (activeOption + 1) % count : (activeOption - 1 + count) % count;
      renderVendorList();
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      if (activeOption >= 0) toggleVendor(activeOption);
    } else if (ev.key === 'Escape') {
      ev.target.value = '';
      activeOption = -1;
      renderVendorList();
    }
  }

  // Only drop the highlight on blur: redrawing here would replace the row being clicked and lose the click
  function onBlur(ev) {
    if (ev.target.id !== 'msVendorSearch') return;
    activeOption = -1;
    var a = $('#msVendorList').querySelector('.active');
    if (a) a.classList.remove('active');
  }

  function attach(container) {
    container.addEventListener('click', onClick);
    container.addEventListener('change', onChange);
    container.addEventListener('input', onInput);
    container.addEventListener('keydown', onKey);
    container.addEventListener('focusout', onBlur);
  }

  function unmountPage() {
    if (groupBox) groupBox.destroy();
    groupBox = null;
    if (root) {
      root.removeEventListener('click', onClick);
      root.removeEventListener('change', onChange);
      root.removeEventListener('input', onInput);
      root.removeEventListener('keydown', onKey);
      root.removeEventListener('focusout', onBlur);
    }
    root = null;
    savedDoc = null;
    savedHooks = null;
  }

  P.reports.register({
    id: 'monthly-statement',
    title: 'Monthly statement',
    place: 'create',
    mount: function (container) {
      root = container;
      savedDoc = null; savedHooks = null;
      file = null; columns = []; dataRows = []; report = null; vendors = []; selected = Object.create(null); activeOption = -1;
      container.innerHTML = TEMPLATE;
      repQuery = '';
      groupBox = P.reports.createGroupBox(container.querySelector('#msGroupBox'), {
        onChange: function () { renderVendorList(); refreshGroupTags(); },       // groups are searchable in the list, and shown on each report
        selected: selectedVendors,
        present: function () { var m = Object.create(null); vendors.forEach(function (v) { m[v.key] = true; }); return m; }
      });
      attach(container);
    },
    unmount: unmountPage
  });

  // A saved report on this same screen (used by js/reports/saved.js).
  //   doc = the saved report, hooks.picks(map) is told whenever a report is ticked or unticked
  P.reports.statementApi = {
    mountSaved: function (container, doc, hooks) {
      root = container;
      savedDoc = doc; savedHooks = hooks;
      file = null; report = null; repQuery = '';
      container.innerHTML = SAVED_TEMPLATE;
      groupBox = P.reports.createGroupBox(container.querySelector('#msGroupBox'), {
        onChange: refreshGroupTags,
        selected: function () { return []; },
        present: function () { return Object.create(null); }
      });

      var filled = P.reports.saved.refreshInfo(doc);       // vendors added to the Vendor List since this was saved are filled in
      var out = buildStatement(doc.input);
      out.report.sections.forEach(function (s) { s.pick = !doc.picks || doc.picks[s.name] !== false; });
      out.report.input = doc.input;
      report = out.report;

      $('#msSavedName').textContent = doc.name;
      var orders = doc.input.orders.length;
      $('#msSavedMeta').textContent = doc.input.source + ' \u00B7 ' + (doc.input.filterVendors ? doc.input.vendors.length : 1) + ' vendor' +
        ((doc.input.filterVendors ? doc.input.vendors.length : 1) === 1 ? '' : 's') + ' \u00B7 ' + orders + ' order' + (orders === 1 ? '' : 's') +
        ' \u00B7 saved ' + P.exporter.stamp(new Date(doc.savedAt)) + ' with the Type and Commission % as they were then';
      showWarnings(out, filled ? 'Updated ' + filled + ' vendor' + (filled === 1 ? '' : 's') + ' in this saved report from the Vendor List.' : '');
      renderReport();
      attach(container);
      P.reports.mail.prepare();                      // loads Google's sign-in (only when a client ID is set) so Send can use it at once
    },
    unmount: unmountPage
  };
})();