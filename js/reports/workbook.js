/* Potafo Accounts - Reports: Excel workbook writer
   Writes an .xlsx with several sheets, live formulas, number formats, frozen headers, filters and print setup,
   in the same look as the other Potafo Accounts Excel files (Cambria, teal headers, light grid, shaded totals).
   No libraries. It uses the zip writer from js/export.js.

     Potafo.reports.workbook.save('file.xlsx', {
       sheets: [{
         name:    'Summary',                         // 31 characters at most; use workbook.uniqueNames() for several sheets
         widths:  [8, 30, 16],                       // column widths
         rows:    [ { ht: 24, cells: [ cell, null, cell ] }, ... ],     // cells[0] is column A; null leaves a gap
         merges:  ['A1:C1'],
         freeze:  5,                                 // keep rows 1..5 on screen while scrolling (optional)
         filter:  'A5:C20',                          // drop-down filters on that range (optional)
         landscape: true,
         titleRow: 5                                 // row repeated at the top of every printed page (optional)
       }]
     });

     cell = { v: 12.5 }                       a number          { v: 'Rent' }  text
          = { v: 12.5, s: 'money' }           with a named style (see STYLES)
          = { f: 'SUM(D6:D20)', v: 1234.5 }   a formula. v is the value shown by viewers that do not recalculate.
   The workbook is also flagged to recalculate when it is opened. */
(function () {
  'use strict';

  var P = window.Potafo;
  var X = P.exporter;

  var FONT = '<name val="Cambria"/><family val="1"/>';
  var TEAL = 'FF0F766E';

  // ---- building blocks of a style ----------------------------------------------------
  var FONTS = {
    normal: '<font><sz val="11"/>' + FONT + '</font>',
    bold: '<font><b/><sz val="11"/>' + FONT + '</font>',
    company: '<font><b/><sz val="13"/><color rgb="' + TEAL + '"/>' + FONT + '</font>',
    title: '<font><b/><sz val="16"/><color rgb="FF1C2430"/>' + FONT + '</font>',
    white: '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/>' + FONT + '</font>',
    note: '<font><i/><sz val="9"/><color rgb="FF667085"/>' + FONT + '</font>',
    input: '<font><b/><sz val="11"/><color rgb="FF1D4ED8"/>' + FONT + '</font>',
    muted: '<font><sz val="11"/><color rgb="FF667085"/>' + FONT + '</font>'
  };
  var FILLS = {
    none: '<fill><patternFill patternType="none"/></fill>',
    teal: '<fill><patternFill patternType="solid"><fgColor rgb="' + TEAL + '"/><bgColor indexed="64"/></patternFill></fill>',
    shade: '<fill><patternFill patternType="solid"><fgColor rgb="FFEEF2F1"/><bgColor indexed="64"/></patternFill></fill>',
    input: '<fill><patternFill patternType="solid"><fgColor rgb="FFFEF9E7"/><bgColor indexed="64"/></patternFill></fill>'
  };
  var GREY = '<color rgb="FFD5DBDF"/>';
  var BORDERS = {
    none: '<border><left/><right/><top/><bottom/><diagonal/></border>',
    thin: '<border><left style="thin">' + GREY + '</left><right style="thin">' + GREY + '</right><top style="thin">' + GREY +
      '</top><bottom style="thin">' + GREY + '</bottom><diagonal/></border>',
    total: '<border><left style="thin">' + GREY + '</left><right style="thin">' + GREY + '</right><top style="medium"><color rgb="' + TEAL +
      '"/></top><bottom style="thin">' + GREY + '</bottom><diagonal/></border>'
  };
  var FMTS = { general: 0, int: 1, money: 164, pct: 165, date: 166 };
  var FMT_XML =
    '<numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="0.00%"/>' +
    '<numFmt numFmtId="166" formatCode="dd\\-mm\\-yyyy"/></numFmts>';

  // ---- named styles the sheets use ------------------------------------------------------
  var STYLES = {
    company: { font: 'company' },
    title: { font: 'title' },
    label: { font: 'bold', v: 'center' },
    value: { font: 'normal', h: 'left', v: 'center' },
    note: { font: 'note' },
    head: { font: 'white', fill: 'teal', border: 'thin', h: 'left', v: 'center', wrap: true },
    headR: { font: 'white', fill: 'teal', border: 'thin', h: 'right', v: 'center', wrap: true },
    text: { border: 'thin', v: 'top' },
    textR: { border: 'thin', h: 'right', v: 'top' },
    date: { border: 'thin', fmt: 'date', h: 'left', v: 'top' },
    int: { border: 'thin', fmt: 'int', h: 'right', v: 'top' },
    money: { border: 'thin', fmt: 'money', h: 'right', v: 'top' },
    pct: { border: 'thin', fmt: 'pct', h: 'right', v: 'top' },
    muted: { font: 'muted', border: 'thin', v: 'top' },
    tText: { font: 'bold', fill: 'shade', border: 'total' },
    tInt: { font: 'bold', fill: 'shade', border: 'total', fmt: 'int', h: 'right' },
    tMoney: { font: 'bold', fill: 'shade', border: 'total', fmt: 'money', h: 'right' },
    inPct: { font: 'input', fill: 'input', border: 'thin', fmt: 'pct', h: 'right', v: 'center' }
  };

  // Collects the fonts / fills / borders / cell formats actually used and gives each a position in styles.xml
  function StyleBook() {
    var fonts = [], fills = [FILLS.none, '<fill><patternFill patternType="gray125"/></fill>'], borders = [], xfs = [], seen = {};
    function pos(list, xml) { var i = list.indexOf(xml); if (i < 0) { list.push(xml); i = list.length - 1; } return i; }
    pos(fonts, FONTS.normal); pos(borders, BORDERS.none);
    xfs.push('<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>');
    seen['{}'] = 0;

    this.index = function (name) {
      if (!name) return 0;
      var d = STYLES[name];
      if (!d) throw new Error('Unknown cell style "' + name + '".');
      if (seen[name] != null) return seen[name];
      var font = pos(fonts, FONTS[d.font || 'normal']), fill = pos(fills, FILLS[d.fill || 'none']), border = pos(borders, BORDERS[d.border || 'none']);
      var fmt = FMTS[d.fmt || 'general'];
      var align = '<alignment' + (d.h ? ' horizontal="' + d.h + '"' : '') + ' vertical="' + (d.v || 'center') + '"' + (d.wrap ? ' wrapText="1"' : '') + '/>';
      xfs.push('<xf numFmtId="' + fmt + '" fontId="' + font + '" fillId="' + fill + '" borderId="' + border + '" xfId="0"' +
        (fmt ? ' applyNumberFormat="1"' : '') + ' applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">' + align + '</xf>');
      seen[name] = xfs.length - 1;
      return seen[name];
    };
    this.xml = function () {
      return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + FMT_XML +
        '<fonts count="' + fonts.length + '">' + fonts.join('') + '</fonts>' +
        '<fills count="' + fills.length + '">' + fills.join('') + '</fills>' +
        '<borders count="' + borders.length + '">' + borders.join('') + '</borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="' + xfs.length + '">' + xfs.join('') + '</cellXfs>' +
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
    };
  }

  // ---- sheets ----------------------------------------------------------------------------------
  function num(n) { return String(Math.round(n * 1e6) / 1e6); }

  function cellXml(ref, c, book) {
    if (c == null) return '';
    var s = book.index(c.s), attr = ' r="' + ref + '"' + (s ? ' s="' + s + '"' : '');
    var v = c.v;
    if (c.f != null) {
      if (typeof v === 'number' && isFinite(v)) return '<c' + attr + '><f>' + X.xml(c.f) + '</f><v>' + num(v) + '</v></c>';
      if (typeof v === 'string') return '<c' + attr + ' t="str"><f>' + X.xml(c.f) + '</f><v>' + X.xml(v) + '</v></c>';
      return '<c' + attr + '><f>' + X.xml(c.f) + '</f></c>';
    }
    if (typeof v === 'number' && isFinite(v)) return '<c' + attr + '><v>' + num(v) + '</v></c>';
    if (v == null || v === '') return '<c' + attr + '/>';
    return '<c' + attr + ' t="inlineStr"><is><t xml:space="preserve">' + X.xml(v) + '</t></is></c>';
  }

  function sheetXml(sh, book, selected) {
    var rows = sh.rows.map(function (row, i) {
      var r = i + 1, cells = (row.cells || row).map(function (c, j) { return cellXml(X.colName(j) + r, c, book); }).join('');
      return '<row r="' + r + '"' + (row.ht ? ' ht="' + row.ht + '" customHeight="1"' : '') + '>' + cells + '</row>';
    }).join('');

    var cols = '<cols>' + sh.widths.map(function (w, j) {
      return '<col min="' + (j + 1) + '" max="' + (j + 1) + '" width="' + w + '" customWidth="1"/>';
    }).join('') + '</cols>';

    var pane = sh.freeze
      ? '<pane ySplit="' + sh.freeze + '" topLeftCell="A' + (sh.freeze + 1) + '" activePane="bottomLeft" state="frozen"/>' +
        '<selection pane="bottomLeft" activeCell="A' + (sh.freeze + 1) + '" sqref="A' + (sh.freeze + 1) + '"/>'
      : '';
    var view = '<sheetViews><sheetView workbookViewId="0" showGridLines="0"' + (selected ? ' tabSelected="1"' : '') + '>' + pane + '</sheetView></sheetViews>';

    var merges = (sh.merges || []).length
      ? '<mergeCells count="' + sh.merges.length + '">' + sh.merges.map(function (m) { return '<mergeCell ref="' + m + '"/>'; }).join('') + '</mergeCells>'
      : '';

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' + view + '<sheetFormatPr defaultRowHeight="15"/>' + cols +
      '<sheetData>' + rows + '</sheetData>' +
      (sh.filter ? '<autoFilter ref="' + sh.filter + '"/>' : '') + merges +
      '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.7" header="0.3" footer="0.3"/>' +
      '<pageSetup paperSize="9" orientation="' + (sh.landscape ? 'landscape' : 'portrait') + '" fitToWidth="1" fitToHeight="0"/>' +
      '<headerFooter><oddFooter>&amp;L' + X.xml(sh.footer || '') + '&amp;CPage &amp;P of &amp;N&amp;R&amp;D</oddFooter></headerFooter>' +
      '</worksheet>';
  }

  // Sheet names: at most 31 characters, none of []:*?/\ , all different (case ignored)
  function uniqueNames(names) {
    var used = {};
    return names.map(function (name) {
      var base = String(name == null ? '' : name).replace(/[\[\]:*?\/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Sheet', out = base;
      for (var n = 2; used[out.toLowerCase()]; n++) {
        var suffix = ' (' + n + ')';
        out = base.slice(0, 31 - suffix.length) + suffix;
      }
      used[out.toLowerCase()] = true;
      return out;
    });
  }

  // 'My Sheet' -> "'My Sheet'" for use inside a formula
  function ref(name) { return "'" + String(name).replace(/'/g, "''") + "'"; }

  function build(spec) {
    var book = new StyleBook(), sheets = spec.sheets;
    var sheetFiles = sheets.map(function (sh, i) {
      return { name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: sheetXml(sh, book, i === 0) };
    });

    var titles = sheets.map(function (sh, i) {
      return sh.titleRow ? '<definedName name="_xlnm.Print_Titles" localSheetId="' + i + '">' + X.xml(ref(sh.name)) + '!$' + sh.titleRow + ':$' + sh.titleRow + '</definedName>' : '';
    }).join('');

    var files = [
      { name: '[Content_Types].xml', data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        sheets.map(function (s, i) {
          return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
        }).join('') +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '</Types>' },
      { name: '_rels/.rels', data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>' },
      { name: 'xl/workbook.xml', data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<bookViews><workbookView activeTab="0"/></bookViews>' +
        '<sheets>' + sheets.map(function (s, i) {
          return '<sheet name="' + X.xml(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
        }).join('') + '</sheets>' +
        (titles ? '<definedNames>' + titles + '</definedNames>' : '') +
        '<calcPr calcId="191029" fullCalcOnLoad="1"/>' +
        '</workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets.map(function (s, i) {
          return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
        }).join('') +
        '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '</Relationships>' },
      { name: 'xl/styles.xml', data: book.xml() }
    ].concat(sheetFiles);

    return X.zip(files, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }

  function save(filename, spec) {
    var blob = build(spec), a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  P.reports.workbook = { build: build, save: save, uniqueNames: uniqueNames, ref: ref };
})();
