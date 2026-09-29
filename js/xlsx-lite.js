/* Potafo Accounts - tiny spreadsheet reader (no libraries, works offline)
   Potafo.readTable(file) -> Promise<string[][]>  for .xlsx (first sheet) and .csv */
(function () {
  'use strict';

  var dec = new TextDecoder('utf-8');

  function u16(v, o) { return v.getUint16(o, true); }
  function u32(v, o) { return v.getUint32(o, true); }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('This browser cannot read .xlsx files. Use a current Chrome, Edge or Firefox, or upload a .csv.');
    }
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // Minimal zip reader: central directory + stored/deflate entries
  function openZip(buf) {
    var view = new DataView(buf), bytes = new Uint8Array(buf), eocd = -1, i;
    for (i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
      if (u32(view, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('This is not a valid .xlsx file. (Old .xls files must be re-saved as .xlsx.)');

    var count = u16(view, eocd + 10), p = u32(view, eocd + 16), files = {};
    for (var n = 0; n < count; n++) {
      if (u32(view, p) !== 0x02014b50) throw new Error('The .xlsx file looks damaged.');
      var nlen = u16(view, p + 28);
      files[dec.decode(bytes.subarray(p + 46, p + 46 + nlen))] = {
        method: u16(view, p + 10), size: u32(view, p + 20), offset: u32(view, p + 42)
      };
      p += 46 + nlen + u16(view, p + 30) + u16(view, p + 32);
    }

    return {
      has: function (name) { return !!files[name]; },
      read: async function (name) {
        var f = files[name];
        if (!f) return null;
        var start = f.offset + 30 + u16(view, f.offset + 26) + u16(view, f.offset + 28);
        var data = bytes.subarray(start, start + f.size);
        if (f.method === 0) return dec.decode(data);
        if (f.method === 8) return dec.decode(await inflateRaw(data));
        throw new Error('Unsupported compression inside the .xlsx file.');
      }
    };
  }

  function parseXml(text) {
    var doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('The .xlsx file looks damaged.');
    return doc;
  }

  // Text of an <si> or <is> element, ignoring phonetic runs
  function textOf(el) {
    var s = '', ts = el.getElementsByTagName('t');
    for (var i = 0; i < ts.length; i++) if (ts[i].parentNode.nodeName !== 'rPh') s += ts[i].textContent;
    return s;
  }

  function colIndex(ref) {
    var m = /^[A-Za-z]+/.exec(ref || ''), n = 0;
    if (!m) return -1;
    for (var i = 0; i < m[0].length; i++) n = n * 26 + m[0].toUpperCase().charCodeAt(i) - 64;
    return n - 1;
  }

  async function readXlsx(buf) {
    var zip = openZip(buf);

    var shared = [];
    var sstText = await zip.read('xl/sharedStrings.xml');
    if (sstText) {
      var sis = parseXml(sstText).getElementsByTagName('si');
      for (var i = 0; i < sis.length; i++) shared.push(textOf(sis[i]));
    }

    // first sheet in workbook order
    var sheetPath = 'xl/worksheets/sheet1.xml';
    var wb = await zip.read('xl/workbook.xml'), rels = await zip.read('xl/_rels/workbook.xml.rels');
    if (wb && rels) {
      var first = parseXml(wb).getElementsByTagName('sheet')[0];
      var rid = first && (first.getAttribute('r:id') || first.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'));
      var rl = parseXml(rels).getElementsByTagName('Relationship');
      for (var r = 0; r < rl.length; r++) {
        if (rl[r].getAttribute('Id') === rid) {
          var t = rl[r].getAttribute('Target');
          sheetPath = t.charAt(0) === '/' ? t.slice(1) : 'xl/' + t;
        }
      }
    }
    var sheetText = await zip.read(sheetPath);
    if (!sheetText) throw new Error('Could not find the first sheet in this file.');

    var rows = [], rowEls = parseXml(sheetText).getElementsByTagName('row');
    for (var a = 0; a < rowEls.length; a++) {
      var row = [], cells = rowEls[a].getElementsByTagName('c'), next = 0;
      for (var b = 0; b < cells.length; b++) {
        var c = cells[b], idx = colIndex(c.getAttribute('r'));
        if (idx < 0) idx = next;
        next = idx + 1;
        var type = c.getAttribute('t'), v = c.getElementsByTagName('v')[0], val = '';
        if (type === 'inlineStr') { var is = c.getElementsByTagName('is')[0]; val = is ? textOf(is) : ''; }
        else if (v) val = type === 's' ? (shared[+v.textContent] || '') : v.textContent;
        row[idx] = val;
      }
      var rn = +rowEls[a].getAttribute('r');
      if (rn) rows[rn - 1] = row; else rows.push(row);
    }
    for (var k = 0; k < rows.length; k++) rows[k] = rows[k] || [];
    return rows;
  }

  function parseCsv(text) {
    text = text.replace(/^﻿/, '');
    var rows = [], row = [], cur = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); rows.push(row); row = []; cur = '';
      } else cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }

  window.Potafo.readTable = async function (file) {
    var name = (file.name || '').toLowerCase();
    if (/\.xlsx$/.test(name)) return readXlsx(await file.arrayBuffer());
    if (/\.csv$/.test(name)) return parseCsv(await file.text());
    if (/\.xls$/.test(name)) throw new Error('Old .xls files are not supported. Open it in Excel and Save As .xlsx.');
    throw new Error('Please choose an .xlsx file.');
  };
})();
