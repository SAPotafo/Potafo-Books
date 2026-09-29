/* Potafo Accounts - core: module registry and shared helpers.
   Data storage lives in js/store.js (Potafo.store), which also syncs with Supabase. */
(function () {
  'use strict';

  var modules = [];
  var toastTimer;

  var moneyFmt = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  window.Potafo = {
    modules: modules,

    // Register a module: { id, title, icon, mount(container), unmount() }
    register: function (mod) { modules.push(mod); },

    esc: function (s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    },

    money: function (n) { return moneyFmt.format(n); },

    // ISO yyyy-mm-dd -> dd-Mon-yyyy
    fmtDate: function (iso) {
      if (!iso) return '';
      var p = iso.split('-');
      var m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+p[1] - 1];
      return p[2] + '-' + m + '-' + p[0];
    },

    // Local date (not UTC) as yyyy-mm-dd
    isoDate: function (d) {
      d = d || new Date();
      var z = function (n) { return (n < 10 ? '0' : '') + n; };
      return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
    },

    uid: function () {
      return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    },

    toast: function (msg, isError) {
      var el = document.getElementById('toast');
      el.textContent = msg;
      el.className = 'toast show' + (isError ? ' error' : '');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { el.className = 'toast'; }, 2600);
    },

    // Styled replacement for window.confirm(). Resolves true (confirmed) or false (cancelled).
    // opts: { title, message, confirmText, cancelText }
    confirm: function (opts) {
      opts = opts || {};
      return new Promise(function (resolve) {
        var dlg = document.createElement('dialog');
        dlg.className = 'confirm';
        dlg.innerHTML =
          '<form method="dialog" novalidate>' +
            '<div class="cf-head"><span class="cf-icon" aria-hidden="true">&#10005;</span>' +
              '<div><h3 class="cf-title"></h3><p class="muted cf-msg"></p></div></div>' +
            '<div class="dlg-actions">' +
              '<button type="button" class="btn btn-ghost" data-r="0"></button>' +
              '<button type="button" class="btn btn-danger" data-r="1"></button>' +
            '</div>' +
          '</form>';
        dlg.querySelector('.cf-title').textContent = opts.title || 'Are you sure?';
        dlg.querySelector('.cf-msg').textContent = opts.message || '';
        dlg.querySelector('[data-r="0"]').textContent = opts.cancelText || 'Cancel';
        dlg.querySelector('[data-r="1"]').textContent = opts.confirmText || 'Delete';

        var done = false;
        function finish(result) {
          if (done) return;
          done = true;
          dlg.close();
          dlg.remove();
          resolve(result);
        }
        dlg.addEventListener('click', function (e) {
          var b = e.target.closest('[data-r]');
          if (b) finish(b.dataset.r === '1');
          else if (e.target === dlg) finish(false);      // click on the dimmed backdrop
        });
        dlg.addEventListener('cancel', function (e) { e.preventDefault(); finish(false); });   // Esc

        document.body.appendChild(dlg);
        dlg.showModal();
        dlg.querySelector('[data-r="0"]').focus();       // Enter cancels by default, so a slip cannot delete
      });
    },

    // Trigger a browser download of text content
    download: function (filename, text, mime) {
      var blob = new Blob([text], { type: mime || 'text/plain' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    }
  };
})();
