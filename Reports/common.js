// Shared helpers for the Vendor List and Report Generator pages.

const VENDOR_STORAGE_KEY = 'reports.vendors';

// Vendors are stored as { id, name, commission } where commission is a
// percentage number, or '' when not set.
function loadVendors() {
  try {
    const list = JSON.parse(localStorage.getItem(VENDOR_STORAGE_KEY));
    if (!Array.isArray(list)) return [];
    return list
      .filter(v => v && v.name)
      .map(v => ({
        id: v.id || newId(),
        name: String(v.name),
        commission: typeof v.commission === 'number' ? v.commission : '',
      }));
  } catch (e) {
    return [];
  }
}

// Names that differ only in case, spacing or special characters count as the
// same vendor ("Rahmath 2", "Rahmath  2" and "Rahmath.2" all give "rahmath2").
// Different letters or digits still give different vendors.
function vendorKey(name) {
  const text = String(name == null ? '' : name).trim().toLowerCase();
  const key = text.replace(/[^\p{L}\p{N}]+/gu, '');
  // A name made only of special characters keeps its text so it is not treated as blank.
  return key || text;
}

function saveVendors(list) {
  localStorage.setItem(VENDOR_STORAGE_KEY, JSON.stringify(list));
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Parses CSV text into an array of rows (arrays of strings).
// Handles quoted fields, escaped quotes ("") and line breaks inside quotes.
function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter(r => r.some(cell => cell.trim() !== ''));
}

function toCSV(rows) {
  return rows
    .map(row => row
      .map(cell => {
        const s = String(cell == null ? '' : cell);
        return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      })
      .join(','))
    .join('\r\n');
}

function downloadFile(filename, text, type) {
  // BOM so Excel opens UTF-8 CSVs correctly.
  const blob = new Blob(['﻿' + text], { type: type || 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

// Converts a SheetJS worksheet to rows of strings. Date cells become
// yyyy-mm-dd, percent cells become e.g. "12.5%" and other numbers keep their
// full stored value.
function sheetToRows(ws) {
  if (!ws['!ref']) return [];
  const pad = n => String(n).padStart(2, '0');
  const range = XLSX.utils.decode_range(ws['!ref']);
  const rows = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      let text = '';
      if (cell && cell.v != null) {
        if (cell.t === 'n' && cell.z && XLSX.SSF.is_date(cell.z)) {
          const p = XLSX.SSF.parse_date_code(cell.v);
          text = p ? `${p.y}-${pad(p.m)}-${pad(p.d)}` : String(cell.v);
        } else if (cell.t === 'n' && cell.z && String(cell.z).includes('%')) {
          text = Number((cell.v * 100).toFixed(6)) + '%';
        } else if (cell.t === 'n') {
          text = String(cell.v);
        } else {
          text = String(cell.w != null ? cell.w : cell.v);
        }
      }
      row.push(text);
    }
    rows.push(row);
  }
  return rows.filter(row => row.some(cell => cell.trim() !== ''));
}

// Reads an uploaded CSV or Excel/ODS file into sheets of { name, rows }.
// Excel files need the SheetJS script (XLSX) to be loaded on the page.
async function readSpreadsheet(upload) {
  const ext = (upload.name.split('.').pop() || '').toLowerCase();
  if (ext === 'csv') {
    return [{ name: 'CSV', rows: parseCSV(await readFileAsText(upload)) }];
  }
  if (typeof XLSX === 'undefined') {
    throw new Error('the Excel reader could not be loaded (it needs an internet connection). Save the file as CSV and upload that instead.');
  }
  const wb = XLSX.read(await upload.arrayBuffer(), { type: 'array', cellNF: true });
  return wb.SheetNames.map(name => ({ name, rows: sheetToRows(wb.Sheets[name]) }));
}

// Returns a number for values like "1,250.50" or "₹ 300", otherwise null.
function toNumber(value) {
  const s = String(value == null ? '' : value).replace(/[,\s₹$]/g, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function compareValues(a, b) {
  const na = toNumber(a);
  const nb = toNumber(b);
  if (na !== null && nb !== null) return na - nb;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

function todayStamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
