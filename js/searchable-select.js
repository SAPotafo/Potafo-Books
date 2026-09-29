/* Potafo Accounts - searchable dropdowns
   Every <select> on the page is upgraded automatically (add data-plain to opt out).
   The native <select> stays in the page as the source of truth, so existing code that reads
   select.value, rewrites its <option>s or listens for "change" keeps working. */
(function () {
  'use strict';

  var valueProp = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  var current = null;   // the dropdown that is open right now
  var seq = 0;

  function enhance(sel) {
    if (sel._ss || sel.multiple || sel.hasAttribute('data-plain')) return;
    sel._ss = true;

    var wrap = document.createElement('div');
    wrap.className = 'ss-wrap';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ss-btn';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    var txt = document.createElement('span');
    txt.className = 'ss-text';
    btn.appendChild(txt);

    var pop = document.createElement('div');
    pop.className = 'ss-pop';
    pop.hidden = true;
    var search = document.createElement('input');
    search.type = 'text';
    search.className = 'ss-search';
    search.placeholder = 'Type to search...';
    search.setAttribute('autocomplete', 'off');
    search.setAttribute('aria-label', 'Search options');
    var list = document.createElement('ul');
    list.className = 'ss-list';
    list.setAttribute('role', 'listbox');
    pop.appendChild(search);
    pop.appendChild(list);

    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(btn);
    wrap.appendChild(sel);
    wrap.appendChild(pop);
    sel.tabIndex = -1;
    sel.setAttribute('aria-hidden', 'true');
    sel.classList.add('ss-native');

    // accessible name: the <label> for this select, else the label in the same field, else aria-label
    var label = sel.id && document.querySelector('label[for="' + sel.id + '"]');
    if (!label && wrap.parentNode) label = wrap.parentNode.querySelector('label');
    if (label) {
      if (!label.id) label.id = 'ss-label-' + (++seq);
      btn.setAttribute('aria-labelledby', label.id);
    } else if (sel.getAttribute('aria-label')) {
      btn.setAttribute('aria-label', sel.getAttribute('aria-label'));
    }

    var items = [], active = -1, isOpen = false;

    function refresh() {
      var o = sel.options[sel.selectedIndex];
      txt.textContent = o ? o.textContent.trim() || ' ' : ' ';
      txt.classList.toggle('ss-placeholder', !o || o.value === '');
      btn.disabled = sel.disabled;
      wrap.classList.toggle('bad', sel.classList.contains('bad'));
      if (isOpen) build(search.value);
    }

    function setActive(i, scroll) {
      if (active >= 0 && items[active]) { items[active].classList.remove('ss-active'); items[active].removeAttribute('aria-selected'); }
      active = items.length ? Math.max(0, Math.min(i, items.length - 1)) : -1;
      if (active >= 0) {
        items[active].classList.add('ss-active');
        items[active].setAttribute('aria-selected', 'true');
        if (scroll !== false) items[active].scrollIntoView({ block: 'nearest' });
      }
    }

    // Rebuild the list for the text typed in the search box (every word must match)
    function build(filter) {
      var words = filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
      list.textContent = '';
      items = [];

      function matches(text) {
        text = text.toLowerCase();
        return words.every(function (w) { return text.indexOf(w) !== -1; });
      }
      function add(o, force) {
        if (words.length && !force && !matches(o.textContent)) return false;
        var li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.className = 'ss-opt' + (o.value === '' ? ' ss-empty' : '') + (o.selected ? ' ss-chosen' : '');
        li.textContent = o.textContent.trim();
        li._opt = o;
        list.appendChild(li);
        items.push(li);
        return true;
      }

      Array.prototype.forEach.call(sel.children, function (ch) {
        if (ch.tagName === 'OPTGROUP') {
          var head = document.createElement('li');
          head.className = 'ss-group';
          head.setAttribute('role', 'presentation');
          head.textContent = ch.label;
          list.appendChild(head);
          var groupHit = words.length > 0 && matches(ch.label), any = false;   // typing a group name shows all of it
          Array.prototype.forEach.call(ch.children, function (o) { if (add(o, groupHit)) any = true; });
          if (!any) list.removeChild(head);
        } else if (ch.tagName === 'OPTION') {
          add(ch, false);
        }
      });

      if (!items.length) {
        var none = document.createElement('li');
        none.className = 'ss-none';
        none.textContent = 'No matches';
        list.appendChild(none);
      }
      var chosen = -1;
      items.forEach(function (li, i) { if (li._opt.selected) chosen = i; });
      active = -1;
      setActive(words.length || chosen < 0 ? 0 : chosen);
    }

    function place() {
      var r = btn.getBoundingClientRect();
      var w = Math.max(r.width, 240), vw = window.innerWidth, vh = window.innerHeight;
      var left = Math.max(8, Math.min(r.left, vw - 8 - w));
      var below = vh - r.bottom - 12, above = r.top - 12;
      pop.style.width = w + 'px';
      pop.style.left = left + 'px';
      if (below < 230 && above > below) {
        pop.style.top = 'auto';
        pop.style.bottom = (vh - r.top + 4) + 'px';
        list.style.maxHeight = Math.max(120, Math.min(260, above - 56)) + 'px';
      } else {
        pop.style.bottom = 'auto';
        pop.style.top = (r.bottom + 4) + 'px';
        list.style.maxHeight = Math.max(120, Math.min(260, below - 56)) + 'px';
      }
    }

    function onOutside(e) { if (!wrap.contains(e.target)) close(false); }
    function onScroll(e) { if (!pop.contains(e.target)) place(); }

    function open(prefill) {
      if (isOpen || sel.disabled) return;
      if (current) current.close(false);
      isOpen = true;
      current = api;
      pop.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      search.value = prefill || '';
      build(search.value);
      place();
      search.focus();
      document.addEventListener('mousedown', onOutside, true);
      window.addEventListener('resize', place);
      window.addEventListener('scroll', onScroll, true);
    }

    function close(refocus) {
      if (!isOpen) return;
      isOpen = false;
      if (current === api) current = null;
      pop.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('mousedown', onOutside, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
      if (refocus) btn.focus();
    }

    function pick(li) {
      if (!li) return;
      var o = li._opt, changed = sel.selectedIndex !== o.index;
      close(true);
      if (!changed) return;
      sel.dataset.prev = sel.value;      // lets a change handler see what was selected before
      o.selected = true;
      refresh();
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }

    var api = { close: close };

    btn.addEventListener('click', function () { if (isOpen) close(true); else open(); });
    btn.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault(); open();
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault(); open(e.key);     // start typing to search
      }
    });

    search.addEventListener('input', function () { build(search.value); });
    search.addEventListener('keydown', function (e) {
      var handled = true;
      if (e.key === 'ArrowDown') setActive(active + 1);
      else if (e.key === 'ArrowUp') setActive(active - 1);
      else if (e.key === 'Home') setActive(0);
      else if (e.key === 'End') setActive(items.length - 1);
      else if (e.key === 'Enter') pick(items[active]);
      else if (e.key === 'Escape') close(true);
      else if (e.key === 'Tab') { close(false); handled = false; }
      else handled = false;
      if (handled) { e.preventDefault(); e.stopPropagation(); }
    });

    list.addEventListener('click', function (e) {
      var li = e.target.closest('.ss-opt');
      if (li) pick(li);
    });
    list.addEventListener('mousemove', function (e) {
      var li = e.target.closest('.ss-opt');
      if (li && items[active] !== li) setActive(items.indexOf(li), false);
    });

    // a label click / select.focus() lands on the visible button
    sel.addEventListener('focus', function () { btn.focus(); });

    // code that sets select.value = ... or rewrites the options keeps the button in sync
    Object.defineProperty(sel, 'value', {
      configurable: true,
      get: function () { return valueProp.get.call(sel); },
      set: function (v) { valueProp.set.call(sel, v); refresh(); }
    });
    new MutationObserver(refresh).observe(sel, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'disabled', 'selected']
    });

    refresh();
  }

  function scan(node) {
    if (!node || node.nodeType !== 1) return;
    if (node.tagName === 'SELECT') enhance(node);
    else Array.prototype.forEach.call(node.querySelectorAll('select'), enhance);
  }

  // Upgrade selects in a container right now (also happens automatically a moment after they appear)
  window.Potafo.enhanceSelects = scan;

  function start() {
    scan(document.body);
    new MutationObserver(function (mutations) {
      mutations.forEach(function (m) { Array.prototype.forEach.call(m.addedNodes, scan); });
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
