/* Potafo Accounts - Reports: email a statement through Gmail
   Two ways, chosen automatically:

   1. WITH the Google client ID set in js/config.js (gmailClientId):  Send makes a Gmail DRAFT for you through the Gmail API,
      with the recipient, subject, message AND the Excel statement attached, then opens it in Gmail. You check it and press
      Send. The first time, Google asks you to allow the app to create drafts (it cannot read or send mail).
      The page must be opened from an http(s) address (for example http://localhost:8080), not from a file on disk.

   2. WITHOUT it (or if Google cannot be reached):  Send opens a Gmail compose window with the recipient, subject and message
      filled in and downloads the Excel. Gmail cannot take an attachment through a web link, so you drag the file in yourself.

   The message:
       Dear <vendor or group>,

       Please find attached the statement for the month of <Month Year>[ (<vendor names>, for a group)]. If you have any
       questions or require further information, please do not hesitate to contact us.

     Potafo.reports.mail.prepare();      // call when a saved report opens: loads Google's sign-in so the click can use it at once
     Potafo.reports.mail.send({ to: [emails], cc: [emails], greeting: 'Alankar Restaurant', vendorNames: null | ['A', 'B'],
                                month: 'September 2026', fileName: 'monthly-statement-alankar.xlsx', workbook: Blob })
        -> Promise of { mode: 'draft' | 'compose', url, opened, subject, body, error }
   Call send straight from a click, so the browser lets the sign-in and the new tab open. */
(function () {
  'use strict';

  var P = window.Potafo;
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var GIS = 'https://accounts.google.com/gsi/client';
  var SCOPE = 'https://www.googleapis.com/auth/gmail.compose';           // create and edit drafts only
  var API = 'https://gmail.googleapis.com/gmail/v1/users/me';

  // "September 2026": the month most of the orders are in (the later month when two tie); the saved date when no order has a date
  function monthLabel(sections, fallbackIso) {
    var count = Object.create(null), best = '', top = 0;
    sections.forEach(function (s) {
      s.rows.forEach(function (r) {
        var d = r.rec && r.rec.dateKey;
        if (!d) return;
        var k = d.slice(0, 7);
        count[k] = (count[k] || 0) + 1;
        if (count[k] > top || (count[k] === top && k > best)) { best = k; top = count[k]; }
      });
    });
    if (!best) {
      var d0 = fallbackIso ? new Date(fallbackIso) : new Date();
      best = d0.getFullYear() + '-' + (d0.getMonth() < 9 ? '0' : '') + (d0.getMonth() + 1);
    }
    var p = best.split('-');
    return MONTHS[+p[1] - 1] + ' ' + p[0];
  }

  function message(greeting, month, vendorNames) {
    var list = vendorNames && vendorNames.length ? ' (' + vendorNames.join(', ') + ')' : '';
    return {
      subject: 'Statement for ' + month,
      body: 'Dear ' + greeting + ',\n\n' +
        'Please find attached the statement for the month of ' + month + list + '. ' +
        'If you have any questions or require further information, please do not hesitate to contact us.\n'
    };
  }

  // ---- the email itself (MIME), for the Gmail API ----------------------------------------------------
  function bytesToBase64(u8) {
    var bin = '', CH = 0x8000;
    for (var i = 0; i < u8.length; i += CH) bin += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return btoa(bin);
  }
  function textToBase64(s) { return bytesToBase64(new TextEncoder().encode(s)); }
  function lines76(s) { return (s.match(/.{1,76}/g) || ['']).join('\r\n'); }
  function asciiName(name) { return String(name).replace(/[^\x20-\x7E]/g, '-').replace(/["\\]/g, '-'); }

  // The whole message as text: To, Subject, the message and the Excel attached (all ASCII, the parts are base64)
  function buildMime(o) {
    var boundary = '----=_Potafo_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), fn = asciiName(o.fileName);
    return [
      o.to.length ? 'To: ' + o.to.join(', ') : null,
      o.cc && o.cc.length ? 'Cc: ' + o.cc.join(', ') : null,
      'Subject: =?UTF-8?B?' + textToBase64(o.subject) + '?=',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="' + boundary + '"',
      '',
      '--' + boundary,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      lines76(textToBase64(o.body)),
      '--' + boundary,
      'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet; name="' + fn + '"',
      'Content-Transfer-Encoding: base64',
      'Content-Disposition: attachment; filename="' + fn + '"',
      '',
      lines76(bytesToBase64(o.bytes)),
      '--' + boundary + '--',
      ''
    ].filter(function (l) { return l !== null; }).join('\r\n');
  }
  function base64url(ascii) { return btoa(ascii).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

  // ---- Google sign-in (token only, kept in memory) ------------------------------------------------------
  var tokenClient = null, gisReady = null, token = null, pending = null;

  function clientId() { return String((window.POTAFO_CONFIG || {}).gmailClientId || '').trim(); }
  function apiAvailable() { return !!clientId() && /^https?:$/.test(location.protocol); }

  function loadGis() {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) return Promise.resolve(true);
    if (!gisReady) {
      gisReady = new Promise(function (resolve) {
        var s = document.createElement('script');
        s.src = GIS;
        s.onload = function () { resolve(!!(window.google && window.google.accounts && window.google.accounts.oauth2)); };
        s.onerror = function () { gisReady = null; resolve(false); };
        document.head.appendChild(s);
      });
    }
    return gisReady;
  }

  function makeTokenClient() {
    if (tokenClient || !(window.google && window.google.accounts && window.google.accounts.oauth2)) return;
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId(),
      scope: SCOPE,
      callback: function (r) {
        var p = pending; pending = null;
        if (!p) return;
        if (r && r.access_token) { token = { value: r.access_token, until: Date.now() + (Number(r.expires_in) || 3000) * 1000 }; p.resolve(token.value); }
        else p.reject(new Error((r && (r.error_description || r.error)) || 'Google did not give access.'));
      },
      error_callback: function (e) {
        var p = pending; pending = null;
        if (p) p.reject(new Error(e && e.type === 'popup_closed' ? 'The Google window was closed.' : (e && (e.message || e.type)) || 'Google sign-in failed.'));
      }
    });
  }

  // Loads Google's sign-in ahead of time. The sign-in window can only open straight from a click, so it must already be loaded.
  function prepare() {
    if (!apiAvailable()) return;
    loadGis().then(function (ok) { if (ok) makeTokenClient(); });
  }

  // Must be called straight from the click when no token is held yet (that is what opens Google's window)
  function getToken() {
    if (token && token.until - 60000 > Date.now()) return Promise.resolve(token.value);
    if (!tokenClient) { makeTokenClient(); }
    if (!tokenClient) return Promise.reject(new Error('Google sign-in is not loaded yet. Check the internet connection and try again.'));
    return new Promise(function (resolve, reject) {
      pending = { resolve: resolve, reject: reject };
      tokenClient.requestAccessToken({ prompt: token ? '' : 'select_account' });
    });
  }

  async function gmail(path, tok, body) {
    var res = await fetch(API + path, {
      method: body ? 'POST' : 'GET',
      headers: Object.assign({ Authorization: 'Bearer ' + tok }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
      var text = '';
      try { var j = await res.json(); text = j && j.error && j.error.message; } catch (e) { /* not JSON */ }
      throw new Error((text || 'Gmail answered ' + res.status) + (res.status === 401 ? ' (sign in again)' : ''));
    }
    return res.json();
  }

  // ---- sending --------------------------------------------------------------------------------------------
  // The plain Gmail compose link (no attachment possible)
  function gmailUrl(to, subject, body, cc) {
    return 'https://mail.google.com/mail/?view=cm&fs=1&tf=1' +
      '&to=' + encodeURIComponent(to.join(',')) +
      (cc && cc.length ? '&cc=' + encodeURIComponent(cc.join(',')) : '') +
      '&su=' + encodeURIComponent(subject) +
      '&body=' + encodeURIComponent(body);
  }

  function saveBlob(name, blob) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  function openTab(url) {
    var win = window.open(url, '_blank');
    if (win) win.opener = null;
    return !!win;
  }

  // The fallback: download the Excel and open the compose window
  function composeInstead(o, msg, error) {
    var url = gmailUrl(o.to, msg.subject, msg.body, o.cc);
    saveBlob(o.fileName, o.workbook);
    return { mode: 'compose', url: url, opened: openTab(url), subject: msg.subject, body: msg.body, error: error || '' };
  }

  function send(o) {
    var msg = message(o.greeting, o.month, o.vendorNames);
    if (!apiAvailable()) return Promise.resolve(composeInstead(o, msg, ''));

    var asking = getToken();                       // started here, inside the click, so Google's window may open
    return asking.then(async function (tok) {
      var bytes = new Uint8Array(await o.workbook.arrayBuffer());
      var raw = base64url(buildMime({ to: o.to, cc: o.cc, subject: msg.subject, body: msg.body, fileName: o.fileName, bytes: bytes }));
      var draft = await gmail('/drafts', tok, { message: { raw: raw } });
      var who = '0';
      try { who = (await gmail('/profile', tok)).emailAddress || '0'; } catch (e) { /* the default account is used */ }
      var url = 'https://mail.google.com/mail/u/' + encodeURIComponent(who) + '/#drafts?compose=' + encodeURIComponent(draft.message.id);
      return { mode: 'draft', url: url, opened: openTab(url), subject: msg.subject, body: msg.body, error: '' };
    }).catch(function (err) {
      return composeInstead(o, msg, (err && err.message) || String(err));
    });
  }

  // A Blob's bytes as base64 text (used to put the Excel inside the drafts file)
  async function blobToBase64(blob) { return bytesToBase64(new Uint8Array(await blob.arrayBuffer())); }

  P.reports.mail = {
    send: send, prepare: prepare, message: message, monthLabel: monthLabel, gmailUrl: gmailUrl,
    apiAvailable: apiAvailable, buildMime: buildMime, blobToBase64: blobToBase64
  };
})();
