/* Potafo Accounts - Reports: shared helpers and the list of report pages.
   The Reports module (js/modules/reports.js) is only a shell. Everything it can open is a "page" registered here:

     Potafo.reports.register({
       id: 'monthly-statement', title: 'Monthly statement',
       place: 'create',                  // 'create' = in the Create menu,  'tool' = a button next to it
       mount: function (container) {},   // draw the page
       unmount: function () {}           // let go of listeners (optional)
     });

   Pages live in their own files (monthly-statement.js, vendors.js) and use the helpers below to read an uploaded
   file, read dates and amounts, and write CSV. */
(function () {
  'use strict';

  var P = window.Potafo;
  var pages = [];

  // ---- reading an uploaded file ---------------------------------------------------
  // SheetJS reads every Excel flavour (.xlsx .xls .xlsm .xlsb .ods). It is loaded from the internet the first time
  // it is needed. CSV files never need it, and a plain .xlsx still opens without it (first sheet only).
  var SHEETJS = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  var sheetJs = null;

  function loadSheetJs() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (!sheetJs) {
      sheetJs = new Promise(function (resolve) {
        var s = document.createElement('script');
        s.src = SHEETJS;
        s.onload = function () { resolve(window.XLSX || null); };
        s.onerror = function () { sheetJs = null; resolve(null); };
        document.head.appendChild(s);
      });
    }
    return sheetJs;
  }

  // CSV text -> rows of strings. Handles quotes, "" and line breaks inside quotes. Blank rows are dropped.
  function parseCSV(text, delim) {
    delim = delim || ',';
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    var rows = [], row = [], field = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
        else field += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = '';
      } else field += ch;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return withoutBlankRows(rows);
  }

  function withoutBlankRows(rows) {
    return rows.filter(function (r) { return r.some(function (c) { return String(c == null ? '' : c).trim() !== ''; }); });
  }

  // One SheetJS worksheet -> rows of strings. Dates become yyyy-mm-dd, percentages "12.5%", other numbers keep their stored value.
  function sheetToRows(ws) {
    if (!ws['!ref']) return [];
    var XLSX = window.XLSX, range = XLSX.utils.decode_range(ws['!ref']), rows = [];
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    for (var r = range.s.r; r <= range.e.r; r++) {
      var row = [];
      for (var c = range.s.c; c <= range.e.c; c++) {
        var cell = ws[XLSX.utils.encode_cell({ r: r, c: c })], text = '';
        if (cell && cell.v != null) {
          if (cell.t === 'n' && cell.z && XLSX.SSF.is_date(cell.z)) {
            var d = XLSX.SSF.parse_date_code(cell.v);
            text = d ? d.y + '-' + pad(d.m) + '-' + pad(d.d) : String(cell.v);
          } else if (cell.t === 'n' && cell.z && String(cell.z).indexOf('%') !== -1) {
            text = Number((cell.v * 100).toFixed(6)) + '%';
          } else if (cell.t === 'n') text = String(cell.v);
          else text = String(cell.w != null ? cell.w : cell.v);
        }
        row.push(text);
      }
      rows.push(row);
    }
    return withoutBlankRows(rows);
  }

  // Uploaded file -> Promise of [{ name, rows }]  (rows are arrays of strings)
  async function readSpreadsheet(file) {
    var ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext === 'csv') return [{ name: 'CSV', rows: parseCSV(await file.text()) }];
    if (ext === 'tsv' || ext === 'txt') return [{ name: 'Text', rows: parseCSV(await file.text(), '\t') }];

    var XLSX = await loadSheetJs();
    if (XLSX) {
      var wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellNF: true });
      return wb.SheetNames.map(function (name) { return { name: name, rows: sheetToRows(wb.Sheets[name]) }; });
    }
    // The Excel reader could not be loaded (offline): the app's own reader still opens .xlsx
    if (ext === 'xlsx') {
      var rows = await P.readTable(file);
      return [{ name: 'Sheet1', rows: withoutBlankRows(rows.map(function (r) { return r.map(function (c) { return c == null ? '' : String(c); }); })) }];
    }
    throw new Error('the Excel reader could not be loaded (it needs an internet connection). Save the file as .xlsx or .csv and upload that instead.');
  }

  // ---- values ------------------------------------------------------------------------
  // "1,250.50", "₹ 300" -> number, otherwise null
  function toNumber(v) {
    var s = String(v == null ? '' : v).replace(/[,\s₹$]/g, '');
    if (s === '') return null;
    var n = Number(s);
    return isFinite(n) ? n : null;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // yyyy-mm-dd for the date formats found in exports (2026-10-02, 02/10/2026, 02-10-26, "2 Oct 2026", an Excel date number), else ''
  function parseDate(value) {
    var s = String(value == null ? '' : value).trim();
    if (!s) return '';
    var y, m, d, p = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?!\d)/.exec(s);
    if (p) { y = +p[1]; m = +p[2]; d = +p[3]; }
    else if ((p = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4}|\d{2})(?!\d)/.exec(s))) {
      d = +p[1]; m = +p[2]; y = +p[3];                   // day first; swapped only when it cannot be read that way
      if (m > 12 && d <= 12) { var t = d; d = m; m = t; }
      if (y < 100) y += 2000;
    } else if (/^\d{5}(\.\d+)?$/.test(s) && +s > 20000 && +s < 80000) {     // Excel date number
      var dt0 = new Date(Math.round((+s - 25569) * 86400000));
      y = dt0.getUTCFullYear(); m = dt0.getUTCMonth() + 1; d = dt0.getUTCDate();
    } else {
      var ms = Date.parse(s);
      if (isNaN(ms)) return '';
      var dt = new Date(ms);
      y = dt.getFullYear(); m = dt.getMonth() + 1; d = dt.getDate();
    }
    if (m < 1 || m > 12 || d < 1 || d > 31) return '';
    return y + '-' + pad2(m) + '-' + pad2(d);
  }

  // Names that differ only in case, spacing or special characters are the same vendor ("Rahmath 2" = "Rahmath.2")
  function vendorKey(name) {
    var text = String(name == null ? '' : name).trim().toLowerCase();
    return text.replace(/[^\p{L}\p{N}]+/gu, '') || text;
  }

  function compareValues(a, b) {
    var na = toNumber(a), nb = toNumber(b);
    if (na !== null && nb !== null) return na - nb;
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  }

  function toCSV(rows) {
    return rows.map(function (row) {
      return row.map(function (c) {
        var s = String(c == null ? '' : c);
        return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\r\n');
  }

  // BOM so Excel opens the UTF-8 file correctly
  function downloadCSV(filename, rows) {
    P.download(filename, '﻿' + toCSV(rows), 'text/csv;charset=utf-8');
  }

  function fileSafe(name) {
    return String(name).replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase() || 'report';
  }

  // ---- list of pages ------------------------------------------------------------------
  P.reports = {
    register: function (page) { pages.push(page); },
    pages: function () { return pages.slice(); },
    page: function (id) { return pages.filter(function (p) { return p.id === id; })[0]; },
    helpers: {
      readSpreadsheet: readSpreadsheet, loadSheetJs: loadSheetJs, parseCSV: parseCSV,
      toNumber: toNumber, parseDate: parseDate, vendorKey: vendorKey, compareValues: compareValues,
      toCSV: toCSV, downloadCSV: downloadCSV, fileSafe: fileSafe
    }
  };
})();
