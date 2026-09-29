/* Potafo Accounts - app shell: hash routing (#/cashbook), sidebar and dark mode */
(function () {
  'use strict';

  var P = window.Potafo;
  var nav = document.getElementById('nav');
  var content = document.getElementById('content');
  var title = document.getElementById('pageTitle');
  var sidebar = document.getElementById('sidebar');
  var active = null;

  // ---- hash routing -----------------------------------------------------
  function routeId() {
    return decodeURIComponent(location.hash.replace(/^#\/?/, '')).split(/[/?]/)[0];
  }

  function find(id) {
    return P.modules.filter(function (m) { return m.id === id; })[0];
  }

  function render() {
    if (!started) return;          // wait until the store is ready (and the user has signed in)
    var id = routeId();
    var mod = find(id);
    if (!mod) {
      // unknown or empty hash: go to the last used (or first) module
      var fallback = find(P.store.get('lastModule', '')) || P.modules[0];
      if (fallback) location.replace('#/' + fallback.id);
      return;
    }
    if (active === mod) return;
    if (active && active.unmount) active.unmount();
    active = mod;
    title.textContent = mod.title;
    document.title = mod.title + ' - Potafo Accounts';
    content.innerHTML = '';
    mod.mount(content);
    Array.prototype.forEach.call(nav.children, function (a) {
      a.classList.toggle('active', a.dataset.id === mod.id);
    });
    sidebar.classList.remove('open');
    P.store.set('lastModule', mod.id);
  }

  nav.innerHTML = P.modules.map(function (m) {
    return '<a class="nav-item" href="#/' + encodeURIComponent(m.id) + '" data-id="' + P.esc(m.id) + '">' +
      '<span class="nav-icon">' + m.icon + '</span>' + P.esc(m.title) + '</a>';
  }).join('');

  window.addEventListener('hashchange', render);

  document.getElementById('menuBtn').addEventListener('click', function () {
    sidebar.classList.toggle('open');
  });

  // ---- dark mode --------------------------------------------------------
  var root = document.documentElement;
  var btns = [document.getElementById('themeBtn'), document.getElementById('themeBtnTop')];
  var osDark = window.matchMedia('(prefers-color-scheme: dark)');

  function isDark() {
    var t = root.getAttribute('data-theme');
    return t ? t === 'dark' : osDark.matches;
  }

  function paintButtons() {
    var label = isDark() ? '☀ Light mode' : '☾ Dark mode';
    btns.forEach(function (b) { b.textContent = label; });
  }

  btns.forEach(function (b) {
    b.addEventListener('click', function () {
      var next = isDark() ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      P.store.set('theme', next);
      paintButtons();
    });
  });
  if (osDark.addEventListener) osDark.addEventListener('change', paintButtons);
  paintButtons();

  // ---- sync status (Supabase) -------------------------------------------
  var syncDot = document.getElementById('syncDot');
  var syncText = document.getElementById('syncText');
  var userBox = document.getElementById('userBox');
  var LABELS = {
    local: ['off', 'Saved in this browser'],
    synced: ['ok', 'Synced with Supabase'],
    syncing: ['busy', 'Syncing...'],
    pending: ['busy', 'Saved here, syncing soon'],
    offline: ['busy', 'Offline. Saved on this device'],
    error: ['bad', 'Sync problem. Will retry'],
    'signed-out': ['off', 'Signed out']
  };

  function paintSync(status, detail) {
    var l = LABELS[status] || LABELS.local;
    syncDot.className = 'sync-dot ' + l[0];
    syncText.textContent = l[1];
    document.getElementById('sync').title = detail || '';
    var email = P.store.user();
    userBox.hidden = !(P.store.configured() && email);
    document.getElementById('userEmail').textContent = email;
  }
  P.store.on('status', paintSync);

  document.getElementById('signOutBtn').addEventListener('click', async function () {
    var r = await P.store.signOut();
    if (!r.ok) { P.toast(r.reason, true); return; }
    location.reload();
  });

  // Data changed in Supabase from another device: show the fresh data
  P.store.on('remote', function () {
    if (active && active.unmount) active.unmount();
    active = null;
    render();
  });

  // ---- sign in ----------------------------------------------------------
  function showLogin() {
    var box = document.createElement('div');
    box.className = 'login';
    box.innerHTML =
      '<form class="login-card panel" novalidate>' +
        '<span class="brand-mark">P</span>' +
        '<h2>Potafo Accounts</h2>' +
        '<p class="muted">Sign in to open your books.</p>' +
        '<div class="field"><label for="lgEmail">Email</label><input type="email" id="lgEmail" autocomplete="username"></div>' +
        '<div class="field"><label for="lgPass">Password</label><input type="password" id="lgPass" autocomplete="current-password"></div>' +
        '<p class="form-error" id="lgMsg"></p>' +
        '<button type="submit" class="btn btn-primary" id="lgGo">Sign in</button>' +
      '</form>';
    document.body.appendChild(box);
    var email = box.querySelector('#lgEmail'), pass = box.querySelector('#lgPass');
    var msg = box.querySelector('#lgMsg'), go = box.querySelector('#lgGo');
    email.focus();

    box.querySelector('form').addEventListener('submit', async function (e) {
      e.preventDefault();
      if (!email.value.trim() || !pass.value) { msg.textContent = 'Enter your email and password.'; return; }
      msg.textContent = '';
      go.disabled = true;
      go.textContent = 'Signing in...';
      try {
        await P.store.signIn(email.value.trim(), pass.value);
        box.remove();
        start();
      } catch (err) {
        msg.textContent = /fetch|network/i.test(err.message || '') ? 'Could not reach Supabase. Check your internet.' :
          (err.message || 'Could not sign in.');
        go.disabled = false;
        go.textContent = 'Sign in';
      }
    });
  }

  // ---- start ------------------------------------------------------------
  var started = false;
  function start() {
    started = true;
    paintSync(P.store.status().status, P.store.status().detail);
    render();
  }

  P.store.init().then(function (r) {
    if (r.needsLogin) showLogin(); else start();
  }).catch(function () { start(); });
})();
