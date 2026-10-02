/* Potafo Accounts - Reports: Monthly statement as an Excel workbook
   Potafo.reports.statementWorkbook(report, sections) -> a workbook spec for Potafo.reports.workbook.save().

   Each vendor gets a sheet:
     - the title, vendor details (ID, Type, Period, Orders)
     - the rates in blue cells: TDS % (Restaurant) or TCS % (Mart), Commission % and GST % on commission
     - the orders, with formulas for every calculated column
     - a Total row of SUM formulas
   Change a blue rate and everything on the sheet recalculates.
       TDS / TCS         =ROUND(Amount x TDS or TCS %, 2)
       Commission %      = the Commission % cell above (a row can be overtyped)
       Commission Amount =ROUND(Amount x Commission %, 2)
       GST               =ROUND(Commission Amount x GST %, 2)
       Final Amount      =ROUND(Amount - TDS/TCS - Commission Amount - GST, 2)
   When two or more vendors are exported, a Summary sheet comes first and reads each vendor's totals by formula.
   Amounts are also stored as values so viewers that do not calculate (previews, phones) still show the numbers. */
(function () {
  'use strict';

  var P = window.Potafo;
  var X = P.exporter;
  var L = X.colName;

  var LABELS = { orderNo: 'Order No', date: 'Date', vendor: 'Vendor Name', amount: 'Amount' };
  var WIDTHS = { orderNo: 18, date: 13, vendor: 30, amount: 16 };
  var CALC = [{ w: 14 }, { w: 14 }, { w: 19 }, { w: 14 }, { w: 19 }];       // tax, commission %, commission amount, GST, final

  // Excel's ROUND: half away from zero
  function r2(n) { return (n < 0 ? -1 : 1) * Math.round(Math.abs(n) * 100 + 1e-9) / 100; }

  // yyyy-mm-dd -> Excel date number
  function serial(iso) {
    var p = iso.split('-');
    return Math.round((Date.UTC(+p[0], +p[1] - 1, +p[2]) - Date.UTC(1899, 11, 30)) / 86400000);
  }

  function periodOf(section) {
    var min = '', max = '';
    section.rows.forEach(function (r) {
      var d = r.rec && r.rec.dateKey;
      if (d && (!min || d < min)) min = d;
      if (d && (!max || d > max)) max = d;
    });
    return min ? (min === max ? P.fmtDate(min) : P.fmtDate(min) + ' to ' + P.fmtDate(max)) : '';
  }

  // ---- one vendor ------------------------------------------------------------------------------
  function vendorSheet(section, report, sheetName) {
    var keys = report.mappedKeys, hasAmount = report.hasAmount, x = section.x, n = keys.length;
    var cAmount = keys.indexOf('amount'), cTax = n, cPct = n + 1, cComm = n + 2, cGst = n + 3, cFinal = n + 4;
    var nCols = hasAmount ? n + 5 : n;
    var last = L(nCols - 1);

    var taxRate = x.taxRate / 100, commRate = (x.commission === '' ? 0 : x.commission) / 100, gstRate = report.gstRate / 100;
    var rows = [];
    function add(cells, ht) { rows.push({ cells: cells, ht: ht }); return rows.length; }

    add([{ v: 'Monthly Statement' + (report.filterVendors ? ' – ' + section.name : ''), s: 'title' }], 26);
    add([], 8);

    var details = [];
    if (report.filterVendors) {
      details.push(['Vendor', section.name]);
      if (x.vid) details.push(['Vendor ID', x.vid]);
      details.push(['Type', x.typeLabel || 'Not set (taxed as Restaurant)']);
    }
    var period = periodOf(section);
    if (period) details.push(['Period', period]);
    details.forEach(function (d) { add([{ v: d[0], s: 'label' }, { v: d[1], s: 'value' }]); });

    var ordersRow = add([{ v: 'Orders', s: 'label' }, { v: section.rows.length, s: 'value' }]);

    // rates the formulas read
    var taxRow, commRow, gstRow;
    if (hasAmount) {
      add([], 6);
      taxRow = add([{ v: x.taxName + ' %', s: 'label' }, { v: taxRate, s: 'inPct' }]);
      commRow = add([{ v: 'Commission %', s: 'label' }, { v: commRate, s: 'inPct' }]);
      gstRow = add([{ v: 'GST % on commission', s: 'label' }, { v: gstRate, s: 'inPct' }]);
      add([{ v: 'Rates in blue can be changed; every amount below recalculates.', s: 'note' }]);
      if (x.commission === '' && report.filterVendors) add([{ v: 'Commission % is not set in the Vendor List, so it is taken as 0.', s: 'note' }]);
      if (!x.typeLabel && report.filterVendors) add([{ v: 'Type is not set in the Vendor List, so TDS 1% (Restaurant) is used.', s: 'note' }]);
    }
    add([], 8);

    // table head
    var heads = keys.map(function (k) { return { v: LABELS[k], s: k === 'amount' ? 'headR' : 'head' }; });
    if (hasAmount) {
      [x.taxName, 'Commission %', 'Commission Amount', 'GST', 'Final Amount'].forEach(function (h) { heads.push({ v: h, s: 'headR' }); });
    }
    var headRow = add(heads, 30);

    // orders
    var first = headRow + 1, sum = { amount: 0, tax: 0, comm: 0, gst: 0, final: 0 };
    section.rows.forEach(function (row) {
      var rec = row.rec, r = rows.length + 1, cells = [];
      keys.forEach(function (k) {
        if (k === 'date') cells.push(rec.dateKey ? { v: serial(rec.dateKey), s: 'date' } : { v: rec.rawDate, s: 'text' });
        else if (k === 'amount') cells.push(rec.amount === null ? { v: rec.rawAmount, s: 'textR' } : { v: rec.amount, s: 'money' });
        else cells.push({ v: rec[k], s: 'text' });
      });
      if (hasAmount) {
        if (rec.amount === null) {
          cells.push({ s: 'money' }, { s: 'pct' }, { s: 'money' }, { s: 'money' }, { s: 'money' });
        } else {
          var a = rec.amount, A = L(cAmount) + r;
          var tax = r2(a * taxRate), comm = r2(a * commRate), gst = r2(comm * gstRate), fin = r2(a - tax - comm - gst);
          sum.amount += a; sum.tax += tax; sum.comm += comm; sum.gst += gst; sum.final += fin;
          cells.push(
            { f: 'ROUND(' + A + '*$B$' + taxRow + ',2)', v: tax, s: 'money' },
            { f: '$B$' + commRow, v: commRate, s: 'pct' },
            { f: 'ROUND(' + A + '*' + L(cPct) + r + ',2)', v: comm, s: 'money' },
            { f: 'ROUND(' + L(cComm) + r + '*$B$' + gstRow + ',2)', v: gst, s: 'money' },
            { f: 'ROUND(' + A + '-' + L(cTax) + r + '-' + L(cComm) + r + '-' + L(cGst) + r + ',2)', v: fin, s: 'money' }
          );
        }
      }
      add(cells);
    });
    var lastData = rows.length;

    // total
    var totalRow = 0;
    if (section.rows.length) {
      var t = keys.map(function (k, i) { return i === 0 ? { v: 'Total', s: 'tText' } : { s: 'tText' }; });
      if (hasAmount) {
        var S = function (c, v) { return { f: 'SUM(' + L(c) + first + ':' + L(c) + lastData + ')', v: r2(v), s: 'tMoney' }; };
        t[cAmount] = S(cAmount, sum.amount);
        t.push(S(cTax, sum.tax), { s: 'tText' }, S(cComm, sum.comm), S(cGst, sum.gst), S(cFinal, sum.final));
      }
      totalRow = add(t, 20);
    } else {
      add([{ v: 'No orders for this vendor.', s: 'note' }]);
    }

    // Orders count by formula, now that the range is known
    rows[ordersRow - 1].cells[1] = section.rows.length
      ? { f: 'ROWS(A' + first + ':A' + lastData + ')', v: section.rows.length, s: 'value' }
      : { v: 0, s: 'value' };

    var widths = keys.map(function (k) { return WIDTHS[k]; });
    widths[0] = Math.max(widths[0], 24);                  // room for the labels above the table
    if (hasAmount) CALC.forEach(function (c) { widths.push(c.w); });

    return {
      sheet: {
        name: sheetName, widths: widths, rows: rows,
        merges: nCols > 1 ? ['A1:' + last + '1'] : [],
        freeze: headRow, titleRow: headRow, landscape: nCols > 5,
        filter: section.rows.length ? 'A' + headRow + ':' + last + lastData : null
      },
      // where the Summary sheet finds this vendor's figures
      ref: {
        sheet: sheetName, ordersCell: 'B' + ordersRow, totalRow: totalRow,
        cols: hasAmount ? { amount: L(cAmount), tax: L(cTax), comm: L(cComm), gst: L(cGst), final: L(cFinal) } : null,
        count: section.rows.length, sum: sum
      }
    };
  }

  // ---- all vendors together -----------------------------------------------------------------
  function summarySheet(report, built, name) {
    var rows = [];
    function add(cells, ht) { rows.push({ cells: cells, ht: ht }); return rows.length; }
    add([{ v: 'Monthly Statement – Summary', s: 'title' }], 26);
    add([], 8);
    // labels sit in columns A:B (merged) and the values in C, because column A is narrow
    var merges = ['A1:I1'];
    [['Vendors', built.length]].forEach(function (d) {
      var r = add([{ v: d[0], s: 'label' }, { s: 'label' }, { v: d[1], s: 'value' }]);
      merges.push('A' + r + ':B' + r);
    });
    add([], 8);

    var heads = [['Sl', 'headR'], ['Vendor', 'head'], ['Type', 'head'], ['Orders', 'headR'], ['Amount', 'headR'],
      ['TDS / TCS', 'headR'], ['Commission', 'headR'], ['GST', 'headR'], ['Final Amount', 'headR']];
    var headRow = add(heads.map(function (h) { return { v: h[0], s: h[1] }; }), 30);
    var first = headRow + 1, totals = { count: 0, amount: 0, tax: 0, comm: 0, gst: 0, final: 0 };

    built.forEach(function (b, i) {
      var rf = b.ref, sh = P.reports.workbook.ref(rf.sheet);
      function link(col, v) {
        return rf.totalRow ? { f: sh + '!' + rf.cols[col] + rf.totalRow, v: r2(v), s: 'money' } : { v: 0, s: 'money' };
      }
      totals.count += rf.count; totals.amount += rf.sum.amount; totals.tax += rf.sum.tax;
      totals.comm += rf.sum.comm; totals.gst += rf.sum.gst; totals.final += rf.sum.final;
      add([
        { v: i + 1, s: 'int' },
        { v: built[i].title, s: 'text' },
        { v: built[i].type, s: 'text' },
        { f: sh + '!' + rf.ordersCell, v: rf.count, s: 'int' },
        link('amount', rf.sum.amount), link('tax', rf.sum.tax), link('comm', rf.sum.comm), link('gst', rf.sum.gst), link('final', rf.sum.final)
      ]);
    });
    var lastRow = rows.length;
    function S(col, v, s) { return { f: 'SUM(' + col + first + ':' + col + lastRow + ')', v: s === 'tInt' ? v : r2(v), s: s || 'tMoney' }; }
    add([{ s: 'tText' }, { v: 'Total', s: 'tText' }, { s: 'tText' }, S('D', totals.count, 'tInt'),
      S('E', totals.amount), S('F', totals.tax), S('G', totals.comm), S('H', totals.gst), S('I', totals.final)], 20);
    add([], 8);
    add([{ v: 'Each figure reads the Total row of that vendor’s sheet.', s: 'note' }]);

    return {
      name: name, widths: [7, 32, 14, 10, 17, 15, 15, 15, 19], rows: rows, merges: merges,
      freeze: headRow, titleRow: headRow, landscape: true, filter: 'A' + headRow + ':I' + lastRow
    };
  }

  // report = the generated statement, sections = the vendors to include (all, or just one)
  P.reports.statementWorkbook = function (report, sections) {
    var withSummary = sections.length > 1 && report.hasAmount;
    var names = P.reports.workbook.uniqueNames((withSummary ? ['Summary'] : []).concat(sections.map(function (s) { return s.name; })));
    var vendorNames = withSummary ? names.slice(1) : names;

    var built = sections.map(function (s, i) {
      var b = vendorSheet(s, report, vendorNames[i]);
      b.title = s.name;
      b.type = s.x.typeLabel || '—';
      return b;
    });
    var sheets = built.map(function (b) { return b.sheet; });
    if (withSummary) {
      sheets.unshift(summarySheet(report, built.map(function (b) { return { ref: b.ref, title: b.title, type: b.type }; }), names[0]));
    }
    return { sheets: sheets };
  };
})();
