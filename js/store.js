/* Potafo Accounts - store
   The ONE place all app data is saved. Every module (Cash Book, Tally Ledgers and any future one)
   reads and writes through Potafo.store.get / Potafo.store.set and never touches localStorage or Supabase itself.

   How it works
   - Reads are instant (from a copy kept in memory and in the browser), so the screens stay fast and work offline.
   - Every set() is saved in the browser first, then sent to Supabase in the background.
   - Changes made while offline are remembered and sent when the connection is back.
   - Each key (for example "cashbook", "ledgers") is one row in the Supabase table "potafo_store".
   - With no Supabase settings in js/config.js it simply saves in this browser.
*/
(function () {
  'use strict';

  var P = window.Potafo;
  var PREFIX = 'potafo.accounts.';
  var TABLE = 'potafo_store';
  var LOCAL_ONLY = { theme: true, lastModule: true };   // per-device settings: never sent to Supabase

  var cfg = window.POTAFO_CONFIG || {};
  var configured = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && /^https?:\/\//.test(cfg.supabaseUrl));

  var client = null, session = null;
  var cache = {};           // key -> value (kept in step with localStorage)
  var dirty = {};           // key -> version, for changes not yet confirmed by Supabase
  var flushing = false, flushTimer = null, retryTimer = null;
  var status = configured ? 'offline' : 'local', statusDetail = '';
  var handlers = { status: [], remote: [] };

  // ---- browser storage --------------------------------------------------
  function lsGet(k) {
    try { var v = localStorage.getItem(PREFIX + k); return v === null ? undefined : JSON.parse(v); }
    catch (e) { return undefined; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem(PREFIX + k, JSON.stringify(v)); return true; }
    catch (e) { return false; }
  }
  function lsKeys() {
    var out = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(PREFIX) === 0) out.push(k.slice(PREFIX.length));
      }
    } catch (e) { /* storage blocked */ }
    return out;
  }

  function clone(v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); }

  // Same text for the same data whatever the key order (Supabase may reorder JSON keys)
  function canon(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
  }

  // start-up: load everything saved in this browser
  lsKeys().forEach(function (k) {
    if (k.indexOf('__') === 0) return;                 // internal bookkeeping
    var v = lsGet(k);
    if (v !== undefined) cache[k] = v;
  });
  (lsGet('__dirty') || []).forEach(function (k) { if (k in cache) dirty[k] = 1; });

  function saveDirtyList() { lsSet('__dirty', Object.keys(dirty)); }

  // ---- status -----------------------------------------------------------
  function emit(name, a, b) { handlers[name].forEach(function (fn) { try { fn(a, b); } catch (e) { /* ignore */ } }); }
  function setStatus(s, detail) {
    status = s; statusDetail = detail || '';
    emit('status', status, statusDetail);
  }
  function idleStatus() {
    if (!configured) return setStatus('local');
    if (!client || !session || (navigator.onLine === false)) return setStatus('offline');
    setStatus(Object.keys(dirty).length ? 'pending' : 'synced');
  }

  // ---- reading and writing ---------------------------------------------
  function get(key, fallback) {
    return Object.prototype.hasOwnProperty.call(cache, key) ? clone(cache[key]) : fallback;
  }

  function set(key, value) {
    if (value === undefined) return false;
    var v = clone(value);
    cache[key] = v;
    var kept = lsSet(key, v);
    if (!kept && !configured) {
      P.toast('Could not save data: browser storage unavailable', true);
      return false;
    }
    if (configured && !LOCAL_ONLY[key]) {
      dirty[key] = (dirty[key] || 0) + 1;
      saveDirtyList();
      if (status !== 'syncing') idleStatus();
      scheduleFlush();
    }
    return true;
  }

  // ---- Supabase: send ---------------------------------------------------
  function scheduleFlush(ms) {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, ms == null ? 700 : ms);
  }

  async function flush() {
    if (!client || !session || flushing) return;
    var keys = Object.keys(dirty);
    if (!keys.length) { idleStatus(); return; }
    if (navigator.onLine === false) { idleStatus(); return; }

    flushing = true;
    setStatus('syncing');
    var sent = {};
    try {
      var now = new Date().toISOString();
      var rows = keys.map(function (k) {
        sent[k] = dirty[k];
        return { key: k, value: cache[k], updated_by: session.user.id, updated_at: now };
      });
      var res = await client.from(TABLE).upsert(rows, { onConflict: 'key' });
      if (res.error) throw res.error;
      keys.forEach(function (k) { if (dirty[k] === sent[k]) delete dirty[k]; });   // keep it if edited again meanwhile
      saveDirtyList();
      clearTimeout(retryTimer);
    } catch (e) {
      setStatus('error', (e && e.message) || 'Could not reach Supabase');
      clearTimeout(retryTimer);
      retryTimer = setTimeout(flush, 30000);
    }
    flushing = false;
    if (status === 'syncing') idleStatus();
    if (Object.keys(dirty).length && status !== 'error') scheduleFlush(300);
  }

  // ---- Supabase: receive ------------------------------------------------
  // Returns true when something on screen may be out of date.
  async function pull() {
    var res = await client.from(TABLE).select('key,value');
    if (res.error) throw res.error;
    var remote = {}, changed = false, firstLink = !lsGet('__linked');
    (res.data || []).forEach(function (r) { remote[r.key] = r.value; });

    Object.keys(remote).forEach(function (k) {
      if (LOCAL_ONLY[k] || dirty[k]) return;                       // edits not sent yet win, and go up next
      if (canon(cache[k]) === canon(remote[k])) return;
      if (firstLink && k in cache) lsSet('__backup.' + k, cache[k]); // first connection: keep a copy of what was here
      cache[k] = remote[k];
      lsSet(k, remote[k]);
      changed = true;
    });

    // data that exists here but not yet in Supabase (made before connecting) goes up
    Object.keys(cache).forEach(function (k) {
      if (!LOCAL_ONLY[k] && !(k in remote) && !dirty[k]) dirty[k] = 1;
    });
    saveDirtyList();
    lsSet('__linked', true);
    return changed;
  }

  async function afterSignIn() {
    setStatus('syncing');
    try {
      await pull();
      await flush();
    } catch (e) {
      setStatus('error', (e && e.message) || 'Could not load data from Supabase');
      return;
    }
    idleStatus();
  }

  async function refreshFromCloud() {
    if (!client || !session || flushing || navigator.onLine === false) return;
    try {
      await flush();
      if (await pull()) emit('remote');
      idleStatus();
    } catch (e) {
      setStatus('error', (e && e.message) || 'Could not reach Supabase');
    }
  }

  // ---- sign in / out ----------------------------------------------------
  async function init() {
    if (!configured) { setStatus('local'); return { needsLogin: false }; }
    if (!window.supabase || !window.supabase.createClient) {
      setStatus('offline', 'The Supabase library could not load. Working from this device.');
      return { needsLogin: false };
    }
    try {
      client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true }
      });
      var r = await client.auth.getSession();
      session = r.data && r.data.session;
    } catch (e) {
      setStatus('offline', 'Could not reach Supabase. Working from this device.');
      return { needsLogin: false };
    }

    client.auth.onAuthStateChange(function (ev, s) { session = s; });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flush(); else refreshFromCloud();
    });
    window.addEventListener('online', function () { flush(); idleStatus(); });
    window.addEventListener('offline', idleStatus);

    if (!session) { setStatus('signed-out'); return { needsLogin: true }; }
    await afterSignIn();
    return { needsLogin: false };
  }

  async function signIn(email, password) {
    var r = await client.auth.signInWithPassword({ email: email, password: password });
    if (r.error) throw r.error;
    session = r.data.session;
    await afterSignIn();
  }

  // Sends any waiting changes, then clears this device's copy so the next person starts clean.
  async function signOut() {
    if (!client) return { ok: true };
    await flush();
    if (Object.keys(dirty).length) return { ok: false, reason: 'Some changes are not synced yet. Connect to the internet and try again.' };
    await client.auth.signOut();
    session = null;
    lsKeys().forEach(function (k) {
      if (!LOCAL_ONLY[k]) { try { localStorage.removeItem(PREFIX + k); } catch (e) { /* ignore */ } }
    });
    cache = {};
    return { ok: true };
  }

  P.store = {
    get: get,
    set: set,
    init: init,
    signIn: signIn,
    signOut: signOut,
    syncNow: refreshFromCloud,
    configured: function () { return configured; },
    status: function () { return { status: status, detail: statusDetail }; },
    user: function () { return session && session.user ? session.user.email : ''; },
    on: function (name, fn) { if (handlers[name]) handlers[name].push(fn); }
  };
})();
