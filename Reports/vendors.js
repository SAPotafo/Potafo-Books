(function () {
  const $ = id => document.getElementById(id);

  const COLUMNS = [
    { key: 'name', label: 'Vendor Name' },
    { key: 'commission', label: 'Commission %' },
  ];

  let vendors = loadVendors();
  let sort = { key: 'name', dir: 1 };
  let editingId = null;

  const dialog = $('vendorDialog');
  const form = $('vendorForm');

  function showMessage(text, isError) {
    const el = $('message');
    el.textContent = text;
    el.className = 'message' + (isError ? ' error' : '');
    el.hidden = !text;
  }

  function persist() {
    try {
      saveVendors(vendors);
    } catch (e) {
      showMessage('Could not save to browser storage: ' + e.message, true);
    }
  }

  function cleanName(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  // Returns the percentage as a number, '' for a blank value, or null when
  // the value is not a percentage between 0 and 100.
  function parseCommission(value) {
    const text = String(value == null ? '' : value).replace(/%/g, '').trim();
    if (text === '') return '';
    const n = toNumber(text);
    if (n === null || n < 0 || n > 100) return null;
    return Math.round(n * 100) / 100;
  }

  function renderHead() {
    $('headRow').innerHTML = COLUMNS.map(c => {
      const arrow = sort.key === c.key ? `<span class="arrow">${sort.dir === 1 ? '▲' : '▼'}</span>` : '';
      return `<th data-key="${c.key}">${esc(c.label)}${arrow}</th>`;
    }).join('') + '<th class="no-sort"></th>';
  }

  function visibleVendors() {
    const q = vendorKey($('search').value);
    return vendors
      .filter(v => !q || vendorKey(v.name).includes(q))
      .sort((a, b) => {
        if (sort.key === 'commission') {
          // Vendors without a commission go last in either direction.
          if (a.commission === '' || b.commission === '') {
            return (a.commission === '') - (b.commission === '') || compareValues(a.name, b.name);
          }
          return sort.dir * (a.commission - b.commission) || compareValues(a.name, b.name);
        }
        return sort.dir * compareValues(a.name, b.name);
      });
  }

  function render() {
    renderHead();

    const list = visibleVendors();
    $('vendorRows').innerHTML = list.map(v => `
      <tr>
        <td>${esc(v.name)}</td>
        <td class="num">${v.commission === '' ? '—' : esc(v.commission) + '%'}</td>
        <td class="actions">
          <button class="small" data-action="edit" data-id="${esc(v.id)}">Edit</button>
          <button class="small danger" data-action="delete" data-id="${esc(v.id)}">Delete</button>
        </td>
      </tr>`).join('');

    const empty = $('empty');
    empty.hidden = list.length > 0;
    empty.textContent = vendors.length === 0
      ? 'No vendors yet. Upload a vendor list or click "+ Add Vendor".'
      : 'No vendors match the search.';

    $('count').textContent = vendors.length
      ? `Showing ${list.length} of ${vendors.length} vendor${vendors.length === 1 ? '' : 's'}`
      : '';
    $('exportBtn').disabled = vendors.length === 0;
  }

  function showFormError(text) {
    $('formError').textContent = text;
    $('formError').hidden = !text;
  }

  function openDialog(vendor) {
    editingId = vendor ? vendor.id : null;
    $('dialogTitle').textContent = vendor ? 'Edit Vendor' : 'Add Vendor';
    form.reset();
    showFormError('');
    if (vendor) {
      form.elements.name.value = vendor.name;
      form.elements.commission.value = vendor.commission;
    }
    dialog.showModal();
    form.elements.name.focus();
  }

  form.addEventListener('submit', e => {
    e.preventDefault();
    const name = cleanName(form.elements.name.value);
    const commission = parseCommission(form.elements.commission.value);

    if (!name) return showFormError('Enter the vendor name.');
    if (commission === null) return showFormError('Commission % must be a number between 0 and 100.');
    const key = vendorKey(name);
    if (vendors.some(v => v.id !== editingId && vendorKey(v.name) === key)) {
      return showFormError(`"${name}" is already in the vendor list.`);
    }

    if (editingId) {
      const vendor = vendors.find(v => v.id === editingId);
      if (vendor) Object.assign(vendor, { name, commission });
    } else {
      vendors.push({ id: newId(), name, commission });
    }
    persist();
    dialog.close();
    showMessage('');
    render();
  });

  $('cancelBtn').addEventListener('click', () => dialog.close());
  $('addBtn').addEventListener('click', () => openDialog(null));

  $('vendorRows').addEventListener('click', e => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const vendor = vendors.find(v => v.id === btn.dataset.id);
    if (!vendor) return;

    if (btn.dataset.action === 'edit') {
      openDialog(vendor);
    } else if (confirm(`Delete vendor "${vendor.name}"?`)) {
      vendors = vendors.filter(v => v.id !== vendor.id);
      persist();
      render();
    }
  });

  $('headRow').addEventListener('click', e => {
    const th = e.target.closest('th[data-key]');
    if (!th) return;
    sort = { key: th.dataset.key, dir: sort.key === th.dataset.key ? -sort.dir : 1 };
    render();
  });

  $('search').addEventListener('input', render);

  $('exportBtn').addEventListener('click', () => {
    const rows = [COLUMNS.map(c => c.label)]
      .concat(visibleVendors().map(v => [v.name, v.commission]));
    downloadFile(`vendors-${todayStamp()}.csv`, toCSV(rows));
  });

  $('uploadBtn').addEventListener('click', () => $('uploadFile').click());

  $('uploadFile').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;

    try {
      const sheet = (await readSpreadsheet(file)).find(s => s.rows.length > 0);
      if (!sheet) throw new Error('the file is empty.');

      // Column 1 is the vendor name, column 2 the commission. The first row is
      // skipped when it is a header (e.g. "Vendor Name", "Commission %").
      let rows = sheet.rows;
      const firstCommission = parseCommission(rows[0][1]);
      const isHeader = firstCommission === null ||
        (firstCommission === '' && /vendor|name|restaurant/i.test(rows[0][0]));
      if (isHeader) rows = rows.slice(1);

      const byKey = new Map(vendors.map(v => [vendorKey(v.name), v]));
      let added = 0;
      let updated = 0;
      let invalid = 0;

      rows.forEach(row => {
        const name = cleanName(row[0]);
        if (!name) return;
        let commission = parseCommission(row[1]);
        if (commission === null) {
          invalid++;
          commission = '';
        }

        const existing = byKey.get(vendorKey(name));
        if (existing) {
          // A blank or invalid value does not wipe a commission already set.
          if (commission !== '') existing.commission = commission;
          updated++;
        } else {
          const vendor = { id: newId(), name, commission };
          vendors.push(vendor);
          byKey.set(vendorKey(name), vendor);
          added++;
        }
      });

      if (!added && !updated) throw new Error('no vendor names found in the first column.');

      persist();
      render();
      const parts = [`${added} added`, `${updated} already in the list (commission updated)`];
      if (invalid) parts.push(`${invalid} with a Commission % that is not a number between 0 and 100 (left blank)`);
      showMessage(`${file.name}: ${parts.join(', ')}.`, invalid > 0);
    } catch (err) {
      showMessage(`Could not upload ${file.name}: ${err.message}`, true);
    }
  });

  render();
})();
