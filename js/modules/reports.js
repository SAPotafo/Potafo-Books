/* Potafo Accounts - Module 6: Reports
   A shell with a "Create" menu and a "Vendor List" button. What they open lives in js/reports/:
     Create > Monthly statement   js/reports/monthly-statement.js   upload a file and make one report per vendor
     Vendor List                  js/reports/vendors.js             vendors and their Commission %
     Saved Reports                js/reports/saved.js               the reports saved with Save report
   A page has its own link (#/reports/monthly-statement, #/reports/saved/<id>), so it can be bookmarked.
   To add a report type: write a page file that calls Potafo.reports.register({ place: 'create', ... })
   (see js/reports/core.js) and add its <script> tag. It appears in the Create menu by itself. */
(function () {
  'use strict';

  var P = window.Potafo;
  var esc = P.esc;

  var root, openId = '', openKey = '', menuOpen = false;

  function $(sel) { return root.querySelector(sel); }

  function buildShell() {
    var pages = P.reports.pages();
    var create = pages.filter(function (p) { return p.place === 'create'; });
    var tools = pages.filter(function (p) { return p.place === 'tool'; });

    root.innerHTML =
      '<section class="rp">' +
      '<div class="page-head no-print">' +
        '<div><h2>Reports</h2><p class="muted" id="rpSub"></p></div>' +
        '<div class="btn-row rp-create">' +
          tools.map(function (p) {
            return '<button type="button" class="btn btn-ghost" data-act="open" data-id="' + esc(p.id) + '">' + esc(p.title) + '</button>';
          }).join('') +
          '<button type="button" class="btn btn-primary" data-act="menu" aria-haspopup="menu" aria-expanded="false">Create &#9662;</button>' +
          '<div class="rp-menu" id="rpMenu" role="menu" hidden>' +
            create.map(function (p) {
              return '<button type="button" role="menuitem" data-act="open" data-id="' + esc(p.id) + '">' + esc(p.title) + '</button>';
            }).join('') +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div id="rpBody"></div>' +
      '</section>';
  }

  function setMenu(open) {
    menuOpen = open;
    $('#rpMenu').hidden = !open;
    $('[data-act="menu"]').setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function closePage() {
    var cur = P.reports.page(openId);
    if (cur && cur.unmount) cur.unmount();
    openId = '';
    openKey = '';
  }

  // Show a page (or the starting message when id is empty). args = the rest of the link, e.g. a saved report's id.
  function show(id, args) {
    args = args || [];
    var page = P.reports.page(id), key = page ? page.id + '/' + args.join('/') : '';
    if (page && key === openKey) return;
    closePage();
    setMenu(false);

    var body = $('#rpBody');
    body.innerHTML = '';
    Array.prototype.forEach.call(root.querySelectorAll('.rp-create > .btn-ghost'), function (b) {
      b.classList.toggle('on', !!page && b.dataset.id === page.id);
    });

    if (!page) {
      $('#rpSub').textContent = 'Create a report, or open the Vendor List or Saved Reports.';
      body.innerHTML = '<div class="panel empty-state"><h3>Nothing open yet</h3>' +
        '<p class="muted">Press <b>Create</b> and choose <b>Monthly statement</b> to build a report from an uploaded file, then press <b>Save report</b>. ' +
        'Saved reports are kept in <b>Saved Reports</b>. Commission % and Type for each vendor come from the <b>Vendor List</b>.</p></div>';
      return;
    }
    openId = page.id;
    openKey = key;
    $('#rpSub').textContent = page.title;
    page.mount(body, args);
  }

  // #/reports/saved/abc123 -> { id: 'saved', args: ['abc123'] }   (null when the link is not for Reports)
  function parseHash() {
    var p = decodeURIComponent(location.hash.replace(/^#\/?/, '')).split(/[/?]/);
    return p[0] === 'reports' ? { id: p[1] || '', args: p.slice(2).filter(Boolean) } : null;
  }
  function onHash() {
    var h = parseHash();
    if (h && root) show(h.id, h.args);
  }

  function onClick(ev) {
    var b = ev.target.closest('[data-act]');
    if (!b) { if (menuOpen) setMenu(false); return; }
    if (b.dataset.act === 'menu') { setMenu(!menuOpen); return; }
    if (b.dataset.act === 'open') {
      setMenu(false);
      var h = parseHash();
      if (h && h.id === b.dataset.id && !h.args.length) show(b.dataset.id);        // same link: the hash will not change
      else location.hash = '#/reports/' + encodeURIComponent(b.dataset.id);
    }
  }
  function onKey(ev) { if (ev.key === 'Escape' && menuOpen) setMenu(false); }

  P.register({
    id: 'reports',
    title: 'Reports',
    icon: '&#9783;',
    mount: function (container) {
      root = container;
      openId = ''; openKey = '';
      buildShell();
      container.addEventListener('click', onClick);
      document.addEventListener('keydown', onKey);
      window.addEventListener('hashchange', onHash);
      var h = parseHash();
      show(h ? h.id : '', h ? h.args : []);
    },
    unmount: function () {
      closePage();
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('hashchange', onHash);
      if (root) root.removeEventListener('click', onClick);
      root = null;
    }
  });
})();
