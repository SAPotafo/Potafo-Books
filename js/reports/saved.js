/* Potafo Accounts - Reports: Saved Reports
   Where "Save report" (Monthly statement) puts a report. Each saved report keeps
     - the columns and vendors that were chosen, and which reports were ticked for export
     - the data: the orders of the chosen vendors, with the Type and Commission % each vendor had at that time
   so it opens again exactly as it was saved, even when the Vendor List has changed since.
   Open shows the report on the same screen as the Monthly statement (without the upload steps), with search, ticks and
   Excel export. Ticking or unticking a report there is remembered. Rename and Delete are in the list.

   Saved with Potafo.store (so it syncs like the rest of the app):
     "reportsaved"            the list:   { list: [{ id, name, savedAt, fileName, vendors, orders, amount }] }
     "reportsaved.<id>"       one report: { id, name, savedAt, picks, input }   (input is packed: orders are short arrays) */
(function () {
  'use strict';

  var P = window.Potafo;
  var H = P.reports.helpers;
  var esc = P.esc, money = P.money;
  var INDEX = 'reportsaved', DOC = 'reportsaved.';

  // ---- storage -----------------------------------------------------------------------------
  function readIndex() {
    var d = P.store.get(INDEX, null) || {};
    return Array.isArray(d.list) ? d.list : [];
  }
  function writeIndex(list) { return P.store.set(INDEX, { list: list }); }

  // The orders of a report are stored as [orderNo, vendorNumber, date, amount] to keep a large file small
  function pack(input) {
    var at = Object.create(null);
    input.vendors.forEach(function (v, i) { at[v.key] = i; });
    return {
      mappedKeys: input.mappedKeys, filterVendors: input.filterVendors, source: input.source,
      vendors: input.vendors.map(function (v) { return { key: v.key, label: v.label }; }),
      info: input.info,
      orders: input.orders.map(function (o) { return [o.orderNo, input.filterVendors ? at[o.key] : -1, o.rawDate, o.rawAmount]; })
    };
  }
  function unpack(p) {
    return {
      mappedKeys: p.mappedKeys, filterVendors: p.filterVendors, source: p.source, vendors: p.vendors,
      info: Object.assign(Object.create(null), p.info || {}),
      orders: p.orders.map(function (a) {
        var v = a[1] >= 0 ? p.vendors[a[1]] : null;
        return { orderNo: a[0], vendor: v ? v.label : '', key: v ? v.key : '', rawDate: a[2], rawAmount: a[3] };
      })
    };
  }

  function stampOf(iso) { return P.exporter.stamp(new Date(iso)); }

  var api = {
    // newest first
    list: function () { return readIndex().slice().sort(function (a, b) { return a.savedAt < b.savedAt ? 1 : a.savedAt > b.savedAt ? -1 : 0; }); },

    get: function (id) {
      var d = P.store.get(DOC + id, null);
      if (!d || !d.input) return null;
      return { id: d.id, name: d.name, savedAt: d.savedAt, picks: d.picks || {}, input: unpack(d.input) };
    },

    // input = what the Monthly statement report was made from; picks = { vendor name: ticked }.  Returns the list entry, or null.
    add: function (input, picks) {
      var dates = [], amount = 0;
      input.orders.forEach(function (o) {
        var d = H.parseDate(o.rawDate), n = H.toNumber(o.rawAmount);
        if (d) dates.push(d);
        if (n !== null) amount += n;
      });
      dates.sort();
      var period = dates.length ? (dates[0] === dates[dates.length - 1] ? P.fmtDate(dates[0]) : P.fmtDate(dates[0]) + ' to ' + P.fmtDate(dates[dates.length - 1])) : '';
      var base = String(input.source || 'Monthly statement').replace(/\.[^.]+$/, '');

      var entry = {
        id: P.uid(), name: base + (period ? ' · ' + period : ''), savedAt: new Date().toISOString(), fileName: input.source || '',
        vendors: input.filterVendors ? input.vendors.length : 1, orders: input.orders.length, amount: Math.round(amount * 100) / 100
      };
      if (!P.store.set(DOC + entry.id, { id: entry.id, name: entry.name, savedAt: entry.savedAt, picks: picks || {}, input: pack(input) })) return null;
      var list = readIndex();
      list.push(entry);
      if (!writeIndex(list)) return null;
      return entry;
    },

    rename: function (id, name) {
      var list = readIndex(), e = list.filter(function (x) { return x.id === id; })[0], d = P.store.get(DOC + id, null);
      if (!e) return false;
      e.name = name;
      if (d) { d.name = name; P.store.set(DOC + id, d); }
      return writeIndex(list);
    },

    remove: function (id) {
      P.store.set(DOC + id, { deleted: true });                        // the store has no delete: the data is replaced by a marker (an empty value cannot be synced)
      return writeIndex(readIndex().filter(function (x) { return x.id !== id; }));
    },

    setPicks: function (id, picks) {
      var d = P.store.get(DOC + id, null);
      if (!d) return false;
      d.picks = picks;
      return P.store.set(DOC + id, d);
    }
  };
  P.reports.saved = api;

  // ---- the list ------------------------------------------------------------------------------
  var LIST =
    '<section class="sv">' +
    '<div class="panel filters no-print">' +
      '<div class="field grow"><label for="svSearch">Search</label><input type="search" id="svSearch" placeholder="Report or file name..."></div>' +
    '</div>' +
    '<div class="panel table-wrap" id="svTable"></div>' +
    '<p class="sub" id="svCount"></p>' +
    '<dialog id="svDialog"><form id="svForm" novalidate>' +
      '<h3>Rename report</h3>' +
      '<div class="field"><label for="svName">Name</label><input type="text" id="svName" maxlength="120" autocomplete="off"></div>' +
      '<p class="form-error" id="svErr"></p>' +
      '<div class="dlg-actions">' +
        '<button type="button" class="btn btn-ghost" data-act="cancel">Cancel</button>' +
        '<button type="submit" class="btn btn-primary">Save</button>' +
      '</div>' +
    '</form></dialog>' +
    '</section>';

  var root, renaming, mode = '';

  function $(sel) { return root.querySelector(sel); }

  function render() {
    var q = H.vendorKey($('#svSearch').value);
    var all = api.list();
    var list = all.filter(function (e) { return !q || H.vendorKey(e.name).indexOf(q) !== -1 || H.vendorKey(e.fileName).indexOf(q) !== -1; });

    var body = list.map(function (e) {
      return '<tr>' +
        '<td><a href="#/reports/saved/' + encodeURIComponent(e.id) + '"><b>' + esc(e.name) + '</b></a></td>' +
        '<td class="muted">' + esc(e.fileName) + '</td>' +
        '<td class="num">' + e.vendors + '</td>' +
        '<td class="num">' + e.orders + '</td>' +
        '<td class="num">' + money(e.amount) + '</td>' +
        '<td class="nowrap muted">' + esc(stampOf(e.savedAt)) + '</td>' +
        '<td class="actions">' +
          '<a class="btn btn-primary btn-sm" href="#/reports/saved/' + encodeURIComponent(e.id) + '">Open</a> ' +
          '<button type="button" class="btn btn-ghost btn-sm" data-act="rename" data-id="' + esc(e.id) + '">Rename</button> ' +
          '<button type="button" class="btn btn-ghost btn-sm" data-act="delete" data-id="' + esc(e.id) + '">Delete</button></td></tr>';
    }).join('');
    if (!list.length) {
      body = '<tr><td colspan="7" class="empty">' + (all.length ? 'No saved reports match the search.' :
        'No saved reports yet. Press <b>Create</b> &rarr; <b>Monthly statement</b>, build a report and press <b>Save report</b>.') + '</td></tr>';
    }
    $('#svTable').innerHTML = '<table><thead><tr><th>Report</th><th>Source file</th><th class="num">Vendors</th><th class="num">Orders</th>' +
      '<th class="num">Amount (&#8377;)</th><th>Saved on</th><th></th></tr></thead><tbody>' + body + '</tbody></table>';
    $('#svCount').textContent = all.length ? 'Showing ' + list.length + ' of ' + all.length + ' saved report' + (all.length === 1 ? '' : 's') : '';
  }

  async function remove(e) {
    var ok = await P.confirm({ title: 'Delete saved report?', message: '"' + e.name + '" and its saved data will be removed. This cannot be undone.', confirmText: 'Delete' });
    if (!ok) return;
    api.remove(e.id);
    render();
    P.toast('Report deleted');
  }

  function onClick(ev) {
    var b = ev.target.closest('[data-act]');
    if (!b) return;
    var e = b.dataset.id ? readIndex().filter(function (x) { return x.id === b.dataset.id; })[0] : null;
    if (b.dataset.act === 'rename' && e) {
      renaming = e.id;
      $('#svName').value = e.name;
      $('#svErr').textContent = '';
      $('#svDialog').showModal();
      $('#svName').focus();
    } else if (b.dataset.act === 'delete' && e) remove(e);
    else if (b.dataset.act === 'cancel') $('#svDialog').close();
  }

  function onSubmit(ev) {
    ev.preventDefault();
    var name = $('#svName').value.replace(/\s+/g, ' ').trim();
    if (!name) { $('#svErr').textContent = 'Enter a name.'; return; }
    if (api.rename(renaming, name)) { $('#svDialog').close(); render(); P.toast('Report renamed'); }
  }

  function onInput(ev) { if (ev.target.id === 'svSearch') render(); }

  // ---- the page: the list, or one saved report when the link has an id (#/reports/saved/<id>) ---------
  P.reports.register({
    id: 'saved',
    title: 'Saved Reports',
    place: 'tool',
    mount: function (container, args) {
      root = container;
      var id = args && args[0] ? decodeURIComponent(args[0]) : '';
      var doc = id ? api.get(id) : null;

      if (id && !doc) {                                                  // a link to a report that was deleted
        P.toast('That saved report was not found.', true);
        location.replace('#/reports/saved');
        return;
      }
      if (doc) {
        mode = 'view';
        P.reports.statementApi.mountSaved(container, doc, { picks: function (picks) { api.setPicks(doc.id, picks); } });
        return;
      }

      mode = 'list';
      container.innerHTML = LIST;
      container.addEventListener('click', onClick);
      container.addEventListener('input', onInput);
      container.querySelector('#svForm').addEventListener('submit', onSubmit);
      render();
    },
    unmount: function () {
      if (mode === 'view') P.reports.statementApi.unmount();
      else if (root) {
        root.removeEventListener('click', onClick);
        root.removeEventListener('input', onInput);
      }
      mode = '';
      root = null;
    }
  });
})();
