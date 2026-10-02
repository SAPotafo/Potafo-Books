(function () {
  const $ = id => document.getElementById(id);

  // The four report columns, the <select> used to map each one to a column of
  // the uploaded file, and header keywords used to pre-select a likely match.
  const FIELDS = [
    { key: 'orderNo', label: 'Order No', select: 'colOrderNo', match: /order|invoice|bill|ref/ },
    { key: 'date', label: 'Date', select: 'colDate', match: /date|time/ },
    { key: 'vendor', label: 'Vendor Name', select: 'colVendor', match: /vendor|restaurant|supplier|merchant|shop|store|party/ },
    { key: 'amount', label: 'Amount', select: 'colAmount', match: /amount|total|value|price|amt/ },
  ];

  // Uploaded file: sheets as { name, rows } where rows are arrays of strings.
  let file = { name: '', sheets: [] };
  let columns = [];
  let dataRows = [];
  // Last generated report, kept for sorting, export and print.
  let report = null;

  // Vendor dropdown state: unique vendors as { key, label } and the selected keys.
  const MAX_OPTIONS = 2000;

  // Deduction rates used for the calculated report columns.
  const TDS_RATE = 1;   // % of Amount
  const GST_RATE = 18;  // % of Commission Amount
  let vendors = [];
  let selected = new Set();
  let activeOption = -1;

  function setMessage(id, text, isError) {
    const el = $(id);
    el.textContent = text;
    el.className = 'message' + (isError ? ' error' : '');
  }

  const pad = n => String(n).padStart(2, '0');

  // Returns yyyy-mm-dd for the date formats commonly found in exports
  // (yyyy-mm-dd, dd/mm/yyyy, dd-mm-yy, "2 Oct 2026"…), otherwise null.
  function parseDate(value) {
    const s = String(value == null ? '' : value).trim();
    if (!s) return null;
    let y, m, d;
    let parts = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?!\d)/.exec(s);
    if (parts) {
      [y, m, d] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
    } else if ((parts = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4}|\d{2})(?!\d)/.exec(s))) {
      // Day first; swap only when the value cannot be read that way.
      [d, m, y] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
      if (m > 12 && d <= 12) [d, m] = [m, d];
      if (y < 100) y += 2000;
    } else {
      const t = Date.parse(s);
      if (Number.isNaN(t)) return null;
      const dt = new Date(t);
      [y, m, d] = [dt.getFullYear(), dt.getMonth() + 1, dt.getDate()];
    }
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    return `${y}-${pad(m)}-${pad(d)}`;
  }

  function displayDate(iso) {
    const [y, m, d] = iso.split('-');
    return `${d}-${m}-${y}`;
  }

  function formatAmount(n) {
    return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function resetReport() {
    report = null;
    $('report').hidden = true;
    $('exportBtn').disabled = true;
    $('printBtn').disabled = true;
    setMessage('message', '');
  }

  function showSheet(index) {
    resetReport();
    const rows = file.sheets[index].rows;
    if (rows.length < 2) {
      $('options').hidden = true;
      setMessage('fileInfo', `${file.name}: this sheet has no data rows below the header row.`, true);
      return;
    }

    columns = rows[0].map((h, i) => h.trim() || `Column ${i + 1}`);
    dataRows = rows.slice(1);

    // Pre-select the first unused column whose header looks like each field.
    const used = new Set();
    FIELDS.forEach(f => {
      const guess = columns.findIndex((c, i) => !used.has(i) && f.match.test(c.toLowerCase()));
      if (guess !== -1) used.add(guess);
      $(f.select).innerHTML = '<option value="">(not in file)</option>' +
        columns.map((c, i) => `<option value="${i}">${esc(c)}</option>`).join('');
      $(f.select).value = guess === -1 ? '' : String(guess);
    });

    selected = new Set();
    $('options').hidden = false;
    updateMappingControls();
    setMessage('fileInfo', `${file.name}: ${dataRows.length} rows, ${columns.length} columns.`);
  }

  function mapping() {
    const map = {};
    FIELDS.forEach(f => {
      const v = $(f.select).value;
      map[f.key] = v === '' ? -1 : Number(v);
    });
    return map;
  }

  // Refreshes the controls that depend on which columns are selected.
  function updateMappingControls() {
    const map = mapping();
    resetReport();

    // One entry per vendor: names differing only in case or spacing are merged,
    // keeping the first spelling found in the file.
    const byKey = new Map();
    if (map.vendor !== -1) {
      dataRows.forEach(r => {
        const label = String(r[map.vendor] == null ? '' : r[map.vendor]).replace(/\s+/g, ' ').trim();
        const key = vendorKey(label);
        if (key && !byKey.has(key)) byKey.set(key, label);
      });
    }
    vendors = [...byKey.entries()]
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true }));
    selected = new Set([...selected].filter(key => byKey.has(key)));

    const input = $('vendorSearch');
    input.disabled = map.vendor === -1;
    input.value = '';
    activeOption = -1;
    $('vendorList').scrollTop = 0;
    renderVendorList();
  }

  // --- Searchable multi-select vendor list ---

  function vendorMatches() {
    const q = vendorKey($('vendorSearch').value);
    return q ? vendors.filter(v => v.key.includes(q)) : vendors;
  }

  // Row 0 is "Select all"; rows 1..n are the matching vendors.
  function renderVendorList() {
    const matches = vendorMatches();
    const shown = matches.slice(0, MAX_OPTIONS);
    const rowCount = matches.length ? shown.length + 1 : 0;
    if (activeOption >= rowCount) activeOption = rowCount - 1;

    const option = (index, label, checked, extra) =>
      `<div class="combo-option${extra}${index === activeOption ? ' active' : ''}" role="option" ` +
      `aria-selected="${checked}" data-index="${index}">` +
      `<input type="checkbox" tabindex="-1"${checked ? ' checked' : ''}> ${esc(label)}</div>`;

    let html;
    if ($('vendorSearch').disabled) {
      html = '<div class="combo-note">Select the Vendor Name column first.</div>';
    } else if (!matches.length) {
      html = `<div class="combo-note">${vendors.length ? 'No vendors match.' : 'No vendor names found in this column.'}</div>`;
    } else {
      const searching = matches.length !== vendors.length;
      const allChecked = matches.every(v => selected.has(v.key));
      html = option(0, searching ? `Select all matching (${matches.length})` : `Select all (${matches.length})`, allChecked, ' select-all') +
        shown.map((v, i) => option(i + 1, v.label, selected.has(v.key), '')).join('');
      if (matches.length > shown.length) {
        html += `<div class="combo-note">${matches.length - shown.length} more — keep typing to narrow down.</div>`;
      }
    }

    const list = $('vendorList');
    const scroll = list.scrollTop;
    list.innerHTML = html;
    list.scrollTop = scroll;
    $('vendorCount').textContent = vendors.length
      ? `${selected.size} of ${vendors.length} vendors selected`
      : '';
    // Keep the keyboard-highlighted row in view without scrolling the page.
    const active = list.querySelector('.active:not(.select-all)');
    if (active) {
      const top = active.offsetTop - list.querySelector('.select-all').offsetHeight;
      if (top < list.scrollTop) list.scrollTop = top;
      else if (active.offsetTop + active.offsetHeight > list.scrollTop + list.clientHeight) {
        list.scrollTop = active.offsetTop + active.offsetHeight - list.clientHeight;
      }
    }
  }

  function toggleVendor(index) {
    const matches = vendorMatches();
    if (index === 0) {
      const allChecked = matches.every(v => selected.has(v.key));
      matches.forEach(v => (allChecked ? selected.delete(v.key) : selected.add(v.key)));
    } else {
      const vendor = matches[index - 1];
      if (!vendor) return;
      if (selected.has(vendor.key)) selected.delete(vendor.key);
      else selected.add(vendor.key);
    }
    renderVendorList();
    if (selected.size) generate();
    else resetReport();
  }

  function generate() {
    const map = mapping();
    const mapped = FIELDS.filter(f => map[f.key] !== -1);
    if (!mapped.length) {
      setMessage('message', 'Select at least one column.', true);
      return;
    }

    const filterVendors = map.vendor !== -1;
    if (filterVendors && !selected.size) {
      resetReport();
      setMessage('message', 'Select at least one vendor.', true);
      return;
    }

    const cell = (row, key) => (map[key] === -1 ? '' : String(row[map[key]] == null ? '' : row[map[key]]).trim());
    let badDates = 0;
    let badAmounts = 0;

    const labelOf = new Map(vendors.map(v => [v.key, v.label]));
    const records = [];
    dataRows.forEach(row => {
      const rawDate = cell(row, 'date');
      const rawAmount = cell(row, 'amount');
      const rec = {
        orderNo: cell(row, 'orderNo'),
        vendor: cell(row, 'vendor'),
        dateKey: parseDate(rawDate),
        rawDate,
        amount: toNumber(rawAmount),
        rawAmount,
      };
      if (filterVendors) {
        rec.key = vendorKey(rec.vendor);
        if (!selected.has(rec.key)) return;
        // Show the same spelling as the vendor list for merged names.
        rec.vendor = labelOf.get(rec.key) || rec.vendor;
      }
      if (rawDate && !rec.dateKey) badDates++;
      if (rawAmount && rec.amount === null) badAmounts++;
      records.push(rec);
    });

    const hasAmount = map.amount !== -1;
    const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
    const money = n => ({ text: formatAmount(n), sort: n, num: true, csv: n.toFixed(2) });
    const blank = { text: '', sort: -Infinity, num: true };

    // Commission % per vendor comes from the Vendor List page.
    const commissionOf = new Map(
      loadVendors().filter(v => v.commission !== '').map(v => [vendorKey(v.name), v.commission]));
    const noCommission = new Set();

    const headers = mapped.map(f => f.label);
    if (hasAmount) headers.push(`TDS (${TDS_RATE}%)`, 'Commission %', 'Commission Amount', `GST (${GST_RATE}%)`, 'Final Amount');

    // One report section per selected vendor, in the order of the vendor list.
    const groups = filterVendors
      ? vendors.filter(v => selected.has(v.key))
          .map(v => ({ name: v.label, records: records.filter(r => r.key === v.key) }))
      : [{ name: 'All orders', records }];

    const sections = groups.map(group => buildSection(group.name, group.records));

    function buildSection(name, sectionRecords) {
    const totals = { amount: 0, tds: 0, commission: 0, gst: 0, final: 0 };
    const rows = sectionRecords.map(r => {
      const cells = mapped.map(f => {
        if (f.key === 'date') {
          return r.dateKey ? { text: displayDate(r.dateKey), sort: r.dateKey } : { text: r.rawDate, sort: r.rawDate };
        }
        if (f.key === 'amount') {
          return r.amount === null ? { text: r.rawAmount, sort: -Infinity, num: true } : money(r.amount);
        }
        return { text: r[f.key], sort: r[f.key] };
      });
      if (!hasAmount) return cells;

      const rate = commissionOf.get(vendorKey(r.vendor));
      if (rate === undefined) noCommission.add(r.vendor || '(blank)');
      const rateCell = rate === undefined
        ? { text: '—', sort: -Infinity, num: true, csv: '' }
        : { text: rate + '%', sort: rate, num: true, csv: String(rate) };
      if (r.amount === null) return cells.concat([blank, rateCell, blank, blank, blank]);

      // Final Amount = Amount - TDS - Commission Amount - GST on commission.
      const tds = round2(r.amount * TDS_RATE / 100);
      const commission = round2(r.amount * (rate || 0) / 100);
      const gst = round2(commission * GST_RATE / 100);
      const final = round2(r.amount - tds - commission - gst);
      totals.amount += r.amount;
      totals.tds += tds;
      totals.commission += commission;
      totals.gst += gst;
      totals.final += final;
      return cells.concat([money(tds), rateCell, money(commission), money(gst), money(final)]);
    });

    let foot = null;
    if (hasAmount) {
      foot = mapped.map((f, i) => (f.key === 'amount' ? formatAmount(totals.amount) : i === 0 ? 'Total' : ''))
        .concat([formatAmount(totals.tds), '', formatAmount(totals.commission), formatAmount(totals.gst), formatAmount(totals.final)]);
    }

    const meta = [`${rows.length} order${rows.length === 1 ? '' : 's'}`];
    if (hasAmount && filterVendors) {
      const rate = commissionOf.get(vendorKey(name));
      meta.push(rate === undefined ? 'Commission % not set' : `Commission ${rate}%`);
    }
    return { name, meta: meta.join(' · '), headers, rows, foot, sort: { index: -1, dir: 1 } };
    }

    const warnings = [];
    if (badDates) warnings.push(`${badDates} row${badDates === 1 ? ' has a date' : 's have dates'} that could not be read`);
    if (badAmounts) warnings.push(`${badAmounts} row${badAmounts === 1 ? ' has an amount' : 's have amounts'} that is not a number and is left out of the total`);
    if (noCommission.size) {
      const list = [...noCommission];
      warnings.push(`no Commission % in the Vendor List for ${list.slice(0, 5).join(', ')}` +
        `${list.length > 5 ? ` and ${list.length - 5} more` : ''} — commission taken as 0`);
    }
    setMessage('message', warnings.length ? 'Note: ' + warnings.join('; ') + '.' : '', warnings.length > 0);

    report = { sections };
    renderReport();
  }

  function compareCells(a, b) {
    if (typeof a.sort === 'number' && typeof b.sort === 'number') return a.sort - b.sort;
    return compareValues(a.sort, b.sort);
  }

  function sectionHtml(section, index) {
    const head = section.headers.map((h, i) => {
      const arrow = section.sort.index === i ? `<span class="arrow">${section.sort.dir === 1 ? '▲' : '▼'}</span>` : '';
      return `<th data-index="${i}">${esc(h)}${arrow}</th>`;
    }).join('');

    const body = section.rows.map(row =>
      '<tr>' + row.map(c => `<td${c.num ? ' class="num"' : ''}>${esc(c.text)}</td>`).join('') + '</tr>'
    ).join('');

    const numeric = section.rows.length ? section.rows[0].map(c => !!c.num) : [];
    const foot = section.foot && section.rows.length
      ? '<tfoot><tr>' + section.foot.map((text, i) => `<td${numeric[i] ? ' class="num"' : ''}>${esc(text)}</td>`).join('') + '</tr></tfoot>'
      : '';

    return `<section class="panel vendor-report" data-section="${index}">
      <div class="report-head">
        <div>
          <h2>${esc(section.name)}</h2>
          <p>${esc(section.meta)}</p>
        </div>
        <button class="small no-print" data-export="${index}">Export CSV</button>
      </div>
      <div class="table-wrap">
        <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table>
      </div>
      ${section.rows.length ? '' : '<div class="empty">No orders for this vendor.</div>'}
    </section>`;
  }

  function renderReport() {
    $('report').innerHTML = report.sections.map(sectionHtml).join('');
    $('report').hidden = false;
    $('exportBtn').disabled = false;
    $('printBtn').disabled = false;
  }

  function fileSafe(name) {
    return name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase() || 'report';
  }

  // Header, rows and total of one section as plain values; numbers stay numeric when asNumbers is set.
  function sectionLines(section, asNumbers) {
    const value = c => {
      if (c.csv == null) return c.text;
      return asNumbers && c.csv !== '' ? Number(c.csv) : c.csv;
    };
    const lines = [section.headers].concat(section.rows.map(row => row.map(value)));
    if (section.foot && section.rows.length) {
      lines.push(section.foot.map(t => {
        const n = toNumber(t);
        return n === null ? t : asNumbers ? n : n.toFixed(2);
      }));
    }
    return lines;
  }

  function exportAll() {
    const sections = report.sections;
    if (typeof XLSX !== 'undefined') {
      // One worksheet per vendor. Sheet names: max 31 chars, no []:*?/\ and unique.
      const wb = XLSX.utils.book_new();
      const used = new Set();
      sections.forEach(section => {
        const base = section.name.replace(/[\[\]:*?\/\\]/g, ' ').trim().slice(0, 31) || 'Vendor';
        let sheetName = base;
        for (let n = 2; used.has(sheetName.toLowerCase()); n++) {
          const suffix = ` (${n})`;
          sheetName = base.slice(0, 31 - suffix.length) + suffix;
        }
        used.add(sheetName.toLowerCase());
        const ws = XLSX.utils.aoa_to_sheet([[section.name], []].concat(sectionLines(section, true)));
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
      });
      XLSX.writeFile(wb, `vendor-reports-${todayStamp()}.xlsx`);
      return;
    }
    // Excel writer unavailable (offline): one CSV with the vendors one after another.
    let lines = [];
    sections.forEach(section => {
      lines = lines.concat([[section.name]], sectionLines(section, false), [[]]);
    });
    downloadFile(`vendor-reports-${todayStamp()}.csv`, toCSV(lines));
  }

  $('chooseFileBtn').addEventListener('click', () => $('file').click());

  $('file').addEventListener('change', async e => {
    const upload = e.target.files[0];
    e.target.value = '';
    if (!upload) return;
    try {
      const sheets = (await readSpreadsheet(upload)).filter(s => s.rows.length > 0);
      if (!sheets.length) throw new Error('the file is empty.');
      file = { name: upload.name, sheets };
      $('sheet').innerHTML = sheets.map((s, i) => `<option value="${i}">${esc(s.name)}</option>`).join('');
      $('sheetWrap').hidden = sheets.length < 2;
      showSheet(0);
    } catch (err) {
      $('options').hidden = true;
      $('sheetWrap').hidden = true;
      resetReport();
      setMessage('fileInfo', `Could not read ${upload.name}: ${err.message}`, true);
    }
  });

  $('sheet').addEventListener('change', e => showSheet(Number(e.target.value)));
  FIELDS.forEach(f => $(f.select).addEventListener('change', updateMappingControls));
  $('generateBtn').addEventListener('click', generate);

  $('report').addEventListener('click', e => {
    if (!report) return;
    const exportBtn = e.target.closest('[data-export]');
    if (exportBtn) {
      const section = report.sections[Number(exportBtn.dataset.export)];
      downloadFile(`${fileSafe(section.name)}-${todayStamp()}.csv`, toCSV(sectionLines(section, false)));
      return;
    }
    const th = e.target.closest('th[data-index]');
    if (!th) return;
    const el = th.closest('[data-section]');
    const section = report.sections[Number(el.dataset.section)];
    const index = Number(th.dataset.index);
    section.sort = { index, dir: section.sort.index === index ? -section.sort.dir : 1 };
    section.rows.sort((a, b) => section.sort.dir * compareCells(a[index], b[index]));
    el.outerHTML = sectionHtml(section, Number(el.dataset.section));
  });

  $('exportBtn').addEventListener('click', () => {
    if (report) exportAll();
  });

  $('printBtn').addEventListener('click', () => {
    if (report) window.print();
  });

  const vendorInput = $('vendorSearch');
  // Only drop the highlight here: re-rendering on blur would replace the row
  // being clicked and swallow the click.
  vendorInput.addEventListener('blur', () => {
    activeOption = -1;
    const active = $('vendorList').querySelector('.active');
    if (active) active.classList.remove('active');
  });
  vendorInput.addEventListener('input', () => {
    $('vendorList').scrollTop = 0;
    // Highlight the first matching vendor so Enter ticks it.
    activeOption = vendorInput.value.trim() ? 1 : -1;
    renderVendorList();
  });
  vendorInput.addEventListener('keydown', e => {
    const matches = vendorMatches().length;
    const count = matches ? Math.min(matches, MAX_OPTIONS) + 1 : 0;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!count) return;
      activeOption = e.key === 'ArrowDown'
        ? (activeOption + 1) % count
        : (activeOption - 1 + count) % count;
      renderVendorList();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeOption >= 0) toggleVendor(activeOption);
    } else if (e.key === 'Escape') {
      vendorInput.value = '';
      activeOption = -1;
      renderVendorList();
    }
  });
  $('vendorList').addEventListener('click', e => {
    const option = e.target.closest('.combo-option');
    if (option) toggleVendor(Number(option.dataset.index));
  });
})();
