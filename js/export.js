/* Potafo Accounts - export
   Turns a report into an Excel (.xlsx) or PDF file. No libraries, works offline.
   Any module can use it:

     Potafo.exporter.xlsx(report);   Potafo.exporter.pdf(report);

   report = {
     filename:    'cash-book-cash-2026-09-29',        // without extension
     company:     'Potafo Accounts',
     title:       'Cash Book - Cash',
     meta:        [['Period', '01-09-2026 to 30-09-2026'], ['Account', 'Cash']],   // lines under the title
     columns:     [{ label: 'Date', width: 13 },
                   { label: 'Particulars', width: 38 },
                   { label: 'Receipt (₹)', width: 15, type: 'money' },   // right aligned, 1,23,456.00
                   { label: 'Balance (₹)', width: 17, type: 'drcr' }],   // signed number shown as Dr (+) / Cr (-)
     rows:        [ ['12-09-2026', 'Sales', 500, 500],                   // a plain array is a normal row
                    { kind: 'opening' | 'total', cells: [...] } ],       // shaded and bold
     orientation: 'portrait' | 'landscape'                               // optional, default portrait
   }
*/
(function () {
  'use strict';

  var P = window.Potafo;
  var MONEY = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // ---- shared ---------------------------------------------------------------
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function fmtMoney(v) { return isNum(v) ? MONEY.format(v) : ''; }
  function fmtDrCr(v) {
    if (!isNum(v)) return '';
    return v > 0 ? MONEY.format(v) + ' Dr' : v < 0 ? MONEY.format(-v) + ' Cr' : MONEY.format(0);
  }
  function isNumeric(col) { return col.type === 'money' || col.type === 'drcr'; }
  function display(col, v) {
    if (col.type === 'money') return fmtMoney(v);
    if (col.type === 'drcr') return fmtDrCr(v);
    return v == null ? '' : String(v);
  }
  function normRows(rows) {
    return (rows || []).map(function (r) {
      return Array.isArray(r) ? { cells: r, kind: 'normal' } : { cells: r.cells || [], kind: r.kind || 'normal' };
    });
  }
  function two(n) { return (n < 10 ? '0' : '') + n; }

  // "29-09-2026 10:32 AM"
  function stamp(d) {
    d = d || new Date();
    var h = d.getHours(), ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return two(d.getDate()) + '-' + two(d.getMonth() + 1) + '-' + d.getFullYear() + ' ' + two(h) + ':' + two(d.getMinutes()) + ' ' + ap;
  }

  function saveBlob(filename, blob) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  // ---- Excel (.xlsx = a zip of XML files) ----------------------------------
  var crcTable = (function () {
    var t = [];
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  // Minimal zip writer (files stored without compression)
  function zip(files, mime) {
    var enc = new TextEncoder(), chunks = [], central = [], offset = 0, d = new Date();
    var dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    var dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();

    files.forEach(function (f) {
      var name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);   // text, or bytes (Uint8Array)

      var lh = new Uint8Array(30 + name.length), v = new DataView(lh.buffer);
      v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true);
      v.setUint16(8, 0, true); v.setUint16(10, dosTime, true); v.setUint16(12, dosDate, true);
      v.setUint32(14, crc, true); v.setUint32(18, data.length, true); v.setUint32(22, data.length, true);
      v.setUint16(26, name.length, true); v.setUint16(28, 0, true);
      lh.set(name, 30);
      chunks.push(lh, data);

      var ch = new Uint8Array(46 + name.length), c = new DataView(ch.buffer);
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint16(10, 0, true); c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true);
      c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
      c.setUint16(28, name.length, true); c.setUint16(30, 0, true); c.setUint16(32, 0, true);
      c.setUint16(34, 0, true); c.setUint16(36, 0, true); c.setUint32(38, 0, true); c.setUint32(42, offset, true);
      ch.set(name, 46);
      central.push(ch);

      offset += lh.length + data.length;
    });

    var size = 0;
    central.forEach(function (ch) { size += ch.length; });
    var end = new Uint8Array(22), e = new DataView(end.buffer);
    e.setUint32(0, 0x06054b50, true); e.setUint16(4, 0, true); e.setUint16(6, 0, true);
    e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, size, true); e.setUint32(16, offset, true); e.setUint16(20, 0, true);

    return new Blob(chunks.concat(central, [end]), { type: mime });
  }

  function xml(s) {
    return String(s == null ? '' : s)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function colName(i) {
    var s = '';
    for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s;
    return s;
  }

  // cell styles (positions in styles.xml -> cellXfs)
  var S = { company: 1, title: 2, meta: 3, headL: 4, headR: 5, body: 6, footer: 15 };
  // body styles: 6 + kind * 3 + type   (kind: normal 0, opening 1, total 2   type: text 0, money 1, drcr 2)
  var KIND = { normal: 0, opening: 1, total: 2 };

  var FONT = '<name val="Cambria"/><family val="1"/>';       // the whole sheet is Cambria
  var STYLES =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/>' +
      '<numFmt numFmtId="165" formatCode="#,##0.00&quot; Dr&quot;;#,##0.00&quot; Cr&quot;;0.00"/></numFmts>' +
    '<fonts count="6">' +
      '<font><sz val="11"/>' + FONT + '</font>' +                                          // content: 11
      '<font><b/><sz val="11"/>' + FONT + '</font>' +
      '<font><b/><sz val="16"/><color rgb="FF1C2430"/>' + FONT + '</font>' +
      '<font><b/><sz val="13"/><color rgb="FF0F766E"/>' + FONT + '</font>' +
      '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/>' + FONT + '</font>' +
      '<font><i/><sz val="9"/><color rgb="FF667085"/>' + FONT + '</font>' +
    '</fonts>' +
    '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FF0F766E"/><bgColor indexed="64"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFEEF2F1"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border>' +
      '<border><left style="thin"><color rgb="FFD5DBDF"/></left><right style="thin"><color rgb="FFD5DBDF"/></right>' +
        '<top style="thin"><color rgb="FFD5DBDF"/></top><bottom style="thin"><color rgb="FFD5DBDF"/></bottom><diagonal/></border>' +
      '<border><left style="thin"><color rgb="FFD5DBDF"/></left><right style="thin"><color rgb="FFD5DBDF"/></right>' +
        '<top style="medium"><color rgb="FF0F766E"/></top><bottom style="thin"><color rgb="FFD5DBDF"/></bottom><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="16">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +                                                    // 0
      '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +                                      // 1 company
      '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +                                      // 2 title
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +                                                    // 3 meta
      '<xf numFmtId="0" fontId="4" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>' +   // 4 head left
      '<xf numFmtId="0" fontId="4" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" wrapText="1"/></xf>' +  // 5 head right
      row(0, 0) + row(0, 164) + row(0, 165) +                                                                              // 6-8 normal
      row(1, 0) + row(1, 164) + row(1, 165) +                                                                              // 9-11 opening
      row(2, 0) + row(2, 164) + row(2, 165) +                                                                              // 12-14 total
      '<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +                                      // 15 footer
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  // one body style: kind 0 normal, 1 opening (shaded, bold), 2 total (shaded, bold, top rule)
  function row(kind, fmt) {
    var font = kind ? 1 : 0, fill = kind ? 3 : 0, border = kind === 2 ? 2 : 1;
    var align = fmt ? '<alignment horizontal="right" vertical="top"/>' : '<alignment vertical="top" wrapText="1"/>';
    return '<xf numFmtId="' + fmt + '" fontId="' + font + '" fillId="' + fill + '" borderId="' + border + '" xfId="0"' +
      (fmt ? ' applyNumberFormat="1"' : '') + ' applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">' + align + '</xf>';
  }

  function buildSheet(rep, sheetName) {
    var cols = rep.columns, n = cols.length, last = colName(n - 1), rn = 0;
    var out = [], merges = [];

    function addRow(cells, ht) {
      rn++;
      out.push('<row r="' + rn + '"' + (ht ? ' ht="' + ht + '" customHeight="1"' : '') + '>' + cells(rn) + '</row>');
      return rn;
    }
    function fullWidth(r) { if (n > 1) merges.push('A' + r + ':' + last + r); }
    function text(ref, style, s) {
      return '<c r="' + ref + '" s="' + style + '" t="inlineStr"><is><t xml:space="preserve">' + xml(s) + '</t></is></c>';
    }

    var r = addRow(function (r) { return text('A' + r, S.company, rep.company || ''); }, 20); fullWidth(r);
    r = addRow(function (r) { return text('A' + r, S.title, rep.title || ''); }, 26); fullWidth(r);

    (rep.meta || []).forEach(function (m) {
      var r2 = addRow(function (r) {
        return '<c r="A' + r + '" s="' + S.meta + '" t="inlineStr"><is>' +
          '<r><rPr><b/><sz val="11"/><rFont val="Cambria"/></rPr><t xml:space="preserve">' + xml(m[0]) + ': </t></r>' +
          '<r><rPr><sz val="11"/><rFont val="Cambria"/></rPr><t xml:space="preserve">' + xml(m[1]) + '</t></r></is></c>';
      });
      fullWidth(r2);
    });

    addRow(function () { return ''; }, 8);

    var headRow = addRow(function (r) {
      return cols.map(function (c, j) {
        return text(colName(j) + r, isNumeric(c) || c.align === 'right' ? S.headR : S.headL, c.label);
      }).join('');
    }, 24);

    normRows(rep.rows).forEach(function (row) {
      var k = KIND[row.kind] || 0;
      addRow(function (r) {
        return cols.map(function (c, j) {
          var ref = colName(j) + r, v = row.cells[j];
          if (c.type === 'money' || c.type === 'drcr') {
            var style = S.body + k * 3 + (c.type === 'money' ? 1 : 2);
            return isNum(v) ? '<c r="' + ref + '" s="' + style + '"><v>' + (Math.round(v * 100) / 100) + '</v></c>' :
              '<c r="' + ref + '" s="' + style + '"/>';
          }
          var s = S.body + k * 3;
          return v == null || v === '' ? '<c r="' + ref + '" s="' + s + '"/>' : text(ref, s, v);
        }).join('');
      });
    });

    addRow(function () { return ''; }, 8);
    var f = addRow(function (r) { return text('A' + r, S.footer, 'Generated by Potafo Accounts on ' + stamp()); });
    fullWidth(f);

    var colsXml = '<cols>' + cols.map(function (c, j) {
      return '<col min="' + (j + 1) + '" max="' + (j + 1) + '" width="' + (c.width || 14) + '" customWidth="1"/>';
    }).join('') + '</cols>';

    var view = '<sheetViews><sheetView workbookViewId="0" showGridLines="0">' +
      '<pane ySplit="' + headRow + '" topLeftCell="A' + (headRow + 1) + '" activePane="bottomLeft" state="frozen"/>' +
      '<selection pane="bottomLeft" activeCell="A' + (headRow + 1) + '" sqref="A' + (headRow + 1) + '"/></sheetView></sheetViews>';

    return {
      headRow: headRow,
      xml: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' + view + '<sheetFormatPr defaultRowHeight="15"/>' + colsXml +
        '<sheetData>' + out.join('') + '</sheetData>' +
        (merges.length ? '<mergeCells count="' + merges.length + '">' + merges.map(function (m) { return '<mergeCell ref="' + m + '"/>'; }).join('') + '</mergeCells>' : '') +
        '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.7" header="0.3" footer="0.3"/>' +
        '<pageSetup paperSize="9" orientation="' + (rep.orientation === 'landscape' ? 'landscape' : 'portrait') + '" fitToWidth="1" fitToHeight="0"/>' +
        '<headerFooter><oddFooter>&amp;L' + xml(rep.company || '') + '&amp;CPage &amp;P of &amp;N&amp;R&amp;D</oddFooter></headerFooter>' +
        '</worksheet>'
    };
  }

  function xlsx(rep) {
    var sheetName = String(rep.sheetName || rep.title || 'Report').replace(/[\[\]:*?\/\\]/g, ' ').slice(0, 31) || 'Report';
    var sheet = buildSheet(rep, sheetName);
    var quoted = "'" + sheetName.replace(/'/g, "''") + "'";

    var blob = zip([
      { name: '[Content_Types].xml', data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
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
        '<sheets><sheet name="' + xml(sheetName) + '" sheetId="1" r:id="rId1"/></sheets>' +
        '<definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">' + xml(quoted) + '!$' + sheet.headRow + ':$' + sheet.headRow + '</definedName></definedNames>' +
        '</workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '</Relationships>' },
      { name: 'xl/styles.xml', data: STYLES },
      { name: 'xl/worksheets/sheet1.xml', data: sheet.xml }
    ], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    saveBlob((rep.filename || 'report') + '.xlsx', blob);
  }

  // ---- PDF (written by hand: A4, header on the first page, column heads and footer on every page) ----
  // Font: Times, the built-in serif of every PDF viewer. Cambria itself cannot be built into a PDF without
  // its font file, and Times is the closest built-in match. Content is 11 pt.
  var TEAL = '0.059 0.463 0.431', DARK = '0.11 0.14 0.19', GREY = '0.40 0.44 0.52',
      SHADE = '0.93 0.95 0.95', RULE = '0.84 0.86 0.87';
  var measureCtx = null;

  // Keep only characters the standard PDF font can show
  function pdfText(s) {
    s = String(s == null ? '' : s).replace(/₹/g, 'Rs.').replace(/[–—]/g, '-')
      .replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
    var o = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      o += c === 9 ? ' ' : (c < 32 || (c > 126 && c < 160) || c > 255) ? '?' : s.charAt(i);
    }
    return o;
  }
  function pdfStr(s) { return '(' + pdfText(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)') + ')'; }

  function width(s, size, bold) {
    var t = pdfText(s);
    if (measureCtx === null) {
      try { measureCtx = document.createElement('canvas').getContext('2d') || false; } catch (e) { measureCtx = false; }
    }
    if (!measureCtx) return t.length * size * 0.53;
    measureCtx.font = (bold ? 'bold ' : '') + '100px "Times New Roman", Times, serif';
    return measureCtx.measureText(t).width * size / 100;
  }

  function wrap(s, maxW, size, bold) {
    var lines = [], cur = '';
    String(s == null ? '' : s).split(/\s+/).forEach(function (word) {
      if (!word) return;
      var test = cur ? cur + ' ' + word : word;
      if (width(test, size, bold) <= maxW) { cur = test; return; }
      if (cur) lines.push(cur);
      cur = '';
      while (width(word, size, bold) > maxW && word.length > 1) {         // a word wider than the column
        var k = word.length - 1;
        while (k > 1 && width(word.slice(0, k), size, bold) > maxW) k--;
        lines.push(word.slice(0, k));
        word = word.slice(k);
      }
      cur = word;
    });
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  }

  function num(n) { return (Math.round(n * 100) / 100).toString(); }

  function pdf(rep) {
    var landscape = rep.orientation === 'landscape';
    var W = landscape ? 841.89 : 595.28, H = landscape ? 595.28 : 841.89;
    var M = 36, FOOT = 30, SIZE = 11, LINE = 14, PADX = 5, PADY = 4.5;
    var contentW = W - 2 * M, cols = rep.columns, rows = normRows(rep.rows);

    var sum = 0;
    cols.forEach(function (c) { sum += c.width || 12; });
    var widths = cols.map(function (c) { return contentW * (c.width || 12) / sum; });
    var xs = [], acc = M;
    widths.forEach(function (w) { xs.push(acc); acc += w; });

    var pages = [], ops, y;
    function newPage() { ops = []; pages.push(ops); y = M; }

    // drawing helpers: y is measured from the top of the page
    function put(x, base, s, size, bold, color) {
      ops.push('BT ' + color + ' rg /F' + (bold ? 2 : 1) + ' ' + size + ' Tf ' + num(x) + ' ' + num(H - base) + ' Td ' + pdfStr(s) + ' Tj ET');
    }
    function box(x, top, w, h, color) { ops.push(color + ' rg ' + num(x) + ' ' + num(H - top - h) + ' ' + num(w) + ' ' + num(h) + ' re f'); }
    function rule(x1, x2, top, color, lw) {
      ops.push(num(lw || 0.5) + ' w ' + color + ' RG ' + num(x1) + ' ' + num(H - top) + ' m ' + num(x2) + ' ' + num(H - top) + ' l S');
    }

    function tableHead() {
      var heads = cols.map(function (c, j) { return wrap(c.label, widths[j] - 2 * PADX, SIZE, true); });
      var h = Math.max.apply(null, heads.map(function (l) { return l.length; })) * LINE + 2 * PADY;
      box(M, y, contentW, h, TEAL);
      cols.forEach(function (c, j) {
        var right = isNumeric(c) || c.align === 'right';
        heads[j].forEach(function (ln, i) {
          var x = right ? xs[j] + widths[j] - PADX - width(ln, SIZE, true) : xs[j] + PADX;
          put(x, y + PADY + SIZE * 0.85 + i * LINE, ln, SIZE, true, '1 1 1');
        });
      });
      y += h;
    }

    // first page: company, title, details
    newPage();
    put(M, y + 14, rep.company || '', 14, true, TEAL); y += 24;
    put(M, y + 17, rep.title || '', 19, true, DARK); y += 30;
    var labelW = 0;
    (rep.meta || []).forEach(function (m) { labelW = Math.max(labelW, width(m[0] + ':', SIZE, true)); });
    (rep.meta || []).forEach(function (m) {
      put(M, y + 10, m[0] + ':', SIZE, true, DARK);
      put(M + labelW + 8, y + 10, m[1], SIZE, false, DARK);
      y += 15;
    });
    y += 4;
    rule(M, M + contentW, y, RULE, 0.75);
    y += 10;
    tableHead();

    rows.forEach(function (r) {
      var bold = r.kind !== 'normal';
      var lines = cols.map(function (c, j) {
        var t = display(c, r.cells[j]);
        return isNumeric(c) ? [t] : wrap(t, widths[j] - 2 * PADX, SIZE, bold);
      });
      var h = Math.max.apply(null, lines.map(function (l) { return l.length; })) * LINE + 2 * PADY;

      if (y + h > H - M - FOOT) { newPage(); tableHead(); }
      if (bold) box(M, y, contentW, h, SHADE);
      cols.forEach(function (c, j) {
        var right = isNumeric(c) || c.align === 'right';
        lines[j].forEach(function (ln, i) {
          if (!ln) return;
          var x = right ? xs[j] + widths[j] - PADX - width(ln, SIZE, bold) : xs[j] + PADX;
          put(x, y + PADY + SIZE * 0.85 + i * LINE, ln, SIZE, bold, DARK);
        });
      });
      if (r.kind === 'total') rule(M, M + contentW, y, TEAL, 1); else rule(M, M + contentW, y + h, RULE, 0.5);
      y += h;
    });
    rule(M, M + contentW, y, RULE, 0.5);

    // footer on every page
    var when = stamp();
    pages.forEach(function (pg, i) {
      ops = pg;
      rule(M, M + contentW, H - M - FOOT + 12, RULE, 0.5);
      put(M, H - M - FOOT + 24, (rep.company || '') + '  ·  Generated ' + when, 8, false, GREY);
      var label = 'Page ' + (i + 1) + ' of ' + pages.length;
      put(M + contentW - width(label, 8, false), H - M - FOOT + 24, label, 8, false, GREY);
    });

    // assemble the file
    var d = new Date();
    var created = 'D:' + d.getFullYear() + two(d.getMonth() + 1) + two(d.getDate()) + two(d.getHours()) + two(d.getMinutes()) + two(d.getSeconds());
    var objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '',                                                                                       // Pages, filled in below
      '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold /Encoding /WinAnsiEncoding >>',
      '<< /Title ' + pdfStr(rep.title || 'Report') + ' /Author ' + pdfStr(rep.company || '') +
        ' /Creator (Potafo Accounts) /Producer (Potafo Accounts) /CreationDate (' + created + ') >>'
    ];
    var kids = [];
    pages.forEach(function (pg, i) {
      var pageNo = objs.length + 1, content = pg.join('\n');
      kids.push(pageNo + ' 0 R');
      objs.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + num(W) + ' ' + num(H) + '] ' +
        '/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ' + (pageNo + 1) + ' 0 R >>');
      objs.push('<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream');
    });
    objs[1] = '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + pages.length + ' >>';

    var out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', offsets = [];
    objs.forEach(function (body, i) {
      offsets.push(out.length);
      out += (i + 1) + ' 0 obj\n' + body + '\nendobj\n';
    });
    var xref = out.length;
    out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
    offsets.forEach(function (o) { out += ('0000000000' + o).slice(-10) + ' 00000 n \n'; });
    out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R /Info 5 0 R >>\nstartxref\n' + xref + '\n%%EOF';

    var bytes = new Uint8Array(out.length);
    for (var i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
    saveBlob((rep.filename || 'report') + '.pdf', new Blob([bytes], { type: 'application/pdf' }));
  }

  // zip / xml / colName are shared with js/reports/workbook.js (multi-sheet workbooks with formulas)
  P.exporter = { xlsx: xlsx, pdf: pdf, stamp: stamp, zip: zip, xml: xml, colName: colName };
})();
