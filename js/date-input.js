/* Potafo Accounts - dd-mm-yyyy date boxes
   Every <input type="date"> is upgraded automatically (add data-plain to opt out).
   You type or paste dd-mm-yyyy (dashes are added for you) or press the calendar button.
   The original input stays in the page, hidden, and keeps the value as yyyy-mm-dd, so existing code that
   reads input.value, sets it, or listens for "input" / "change" keeps working. */
(function () {
  'use strict';

  var valueProp = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

  function toShown(iso) {                       // yyyy-mm-dd -> dd-mm-yyyy
    var p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return p ? p[3] + '-' + p[2] + '-' + p[1] : '';
  }

  function toIso(text) {                        // dd-mm-yyyy -> yyyy-mm-dd, or '' when not a real date
    var p = /^(\d{2})-(\d{2})-(\d{4})$/.exec(text);
    if (!p) return '';
    var d = +p[1], m = +p[2], y = +p[3], dt = new Date(y, m - 1, d);
    if (y < 1900 || dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return '';
    return p[3] + '-' + p[2] + '-' + p[1];
  }

  function mask(raw) {                          // 12042026 -> 12-04-2026 as you type
    var d = raw.replace(/\D/g, '').slice(0, 8);
    return d.length > 4 ? d.slice(0, 2) + '-' + d.slice(2, 4) + '-' + d.slice(4) :
      d.length > 2 ? d.slice(0, 2) + '-' + d.slice(2) : d;
  }

  function enhance(native) {
    if (native._di || native.hasAttribute('data-plain')) return;
    native._di = true;

    var wrap = document.createElement('div');
    wrap.className = 'di-wrap';
    var text = document.createElement('input');
    text.type = 'text';
    text.className = 'di-text';
    text.placeholder = 'dd-mm-yyyy';
    text.maxLength = 10;
    text.inputMode = 'numeric';
    text.setAttribute('autocomplete', 'off');
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'di-btn';
    btn.setAttribute('aria-label', 'Choose date from calendar');
    btn.innerHTML = '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false">' +
      '<rect x="3" y="4" width="14" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/>' +
      '<path d="M3 8h14M7 2.5v3M13 2.5v3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/></svg>';

    native.parentNode.insertBefore(wrap, native);
    wrap.appendChild(text);
    wrap.appendChild(btn);
    wrap.appendChild(native);
    native.tabIndex = -1;
    native.setAttribute('aria-hidden', 'true');
    native.classList.add('di-native');

    var label = native.id && document.querySelector('label[for="' + native.id + '"]');
    if (!label && wrap.parentNode) label = wrap.parentNode.querySelector('label');
    if (label) {
      if (!label.id) label.id = 'di-label-' + (native.id || Math.random().toString(36).slice(2, 8));
      text.setAttribute('aria-labelledby', label.id);
    } else if (native.getAttribute('aria-label')) {
      text.setAttribute('aria-label', native.getAttribute('aria-label'));
    }
    if (native.required) text.required = true;

    var own = false;                            // true while this script is the one changing the value

    function show() {
      text.value = toShown(valueProp.get.call(native));
      wrap.classList.remove('bad');
    }

    function commit(iso) {
      if (valueProp.get.call(native) === iso) return;
      own = true;
      valueProp.set.call(native, iso);
      native.dispatchEvent(new Event('input', { bubbles: true }));
      native.dispatchEvent(new Event('change', { bubbles: true }));
      own = false;
    }

    text.addEventListener('input', function () {
      if (/^\d{4}-\d{2}-\d{2}$/.test(text.value)) text.value = toShown(text.value);   // pasted yyyy-mm-dd
      var m = mask(text.value);
      if (m !== text.value) text.value = m;
      if (!m) { wrap.classList.remove('bad'); commit(''); return; }
      if (m.length < 10) { wrap.classList.remove('bad'); return; }      // still typing
      var iso = toIso(m);
      wrap.classList.toggle('bad', !iso);
      if (iso) commit(iso);
    });
    text.addEventListener('blur', function () {   // half-typed or impossible dates go back to the last good one
      text.value = toShown(valueProp.get.call(native));
      wrap.classList.remove('bad');
    });

    btn.addEventListener('click', function () {
      try {
        if (native.showPicker) native.showPicker(); else { native.focus(); native.click(); }
      } catch (e) { text.focus(); }
    });
    native.addEventListener('change', function () { if (!own) show(); });   // picked in the calendar
    native.addEventListener('focus', function () { text.focus(); });         // label click lands on the text box

    // code that sets input.value = 'yyyy-mm-dd' keeps the box in step
    Object.defineProperty(native, 'value', {
      configurable: true,
      get: function () { return valueProp.get.call(native); },
      set: function (v) { valueProp.set.call(native, v); show(); }
    });

    show();
  }

  function scan(node) {
    if (!node || node.nodeType !== 1) return;
    if (node.tagName === 'INPUT' && node.type === 'date') enhance(node);
    else Array.prototype.forEach.call(node.querySelectorAll('input[type="date"]'), enhance);
  }

  window.Potafo.enhanceDates = scan;

  function start() {
    scan(document.body);
    new MutationObserver(function (mutations) {
      mutations.forEach(function (m) { Array.prototype.forEach.call(m.addedNodes, scan); });
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
