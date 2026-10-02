/* Potafo Accounts - Reports: Grouping
   The "Grouping" box beside "3. Select vendor" in the Monthly statement.
   Tick vendors in the list, type a group name and press Create group. A vendor can be in one group only.
   Typing the name of a group that exists adds the ticked vendors to it.
   When the statement is exported separately, each group becomes ONE Excel file with a sheet per vendor,
   and every vendor not in a group gets its own file.
   Groups are saved (Potafo.store, key "reportgroups") so next month's file can use them again;
   a vendor is remembered by its name, so it is found again in the next file.

     var box = Potafo.reports.createGroupBox(containerElement, {
       selected: function () { return [{ key, label }]; },     // the vendors ticked in the list
       present:  function () { return { key: true }; }         // the vendors found in the uploaded file
     });
     box.refresh();            // redraw (after a new file)
     box.groups();             // the groups                    box.groupOf(key)   the group a vendor is in
     opts.onChange()           // called after a group is created, changed or removed
     box.plan(sections);       // -> [{ name, sections: [...], group: true | undefined }]  the files to make (one per group, one per other vendor)
     box.destroy();                                                                                      */
(function () {
  'use strict';

  var P = window.Potafo;
  var H = P.reports.helpers;
  var esc = P.esc;
  var KEY = 'reportgroups';

  // [{ id, name, members: [{ key, label }] }]
  function load() {
    var d = P.store.get(KEY, null) || {};
    return (Array.isArray(d.groups) ? d.groups : []).filter(function (g) { return g && g.name; }).map(function (g) {
      return {
        id: g.id || P.uid(), name: String(g.name),
        members: (Array.isArray(g.members) ? g.members : []).filter(function (m) { return m && m.key; })
          .map(function (m) { return { key: String(m.key), label: String(m.label || m.key) }; })
      };
    });
  }
  function save(list) { return P.store.set(KEY, { groups: list }); }

  function cleanName(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

  P.reports.createGroupBox = function (container, opts) {
    var groups = load();

    container.innerHTML =
      '<div class="rp-group">' +
        '<h4>Grouping</h4>' +
        '<p class="muted">Tick vendors in the list, type a group name and press <b>Create group</b>. ' +
          'A group is exported as one Excel file, each vendor on its own sheet.</p>' +
        '<div class="rp-group-new">' +
          '<input type="text" data-g="name" maxlength="60" placeholder="Group name" autocomplete="off" aria-label="Group name">' +
          '<button type="button" class="btn btn-primary" data-g="create">Create group</button>' +
        '</div>' +
        '<p class="form-error" data-g="msg"></p>' +
        '<div class="rp-group-list" data-g="list"></div>' +
      '</div>';

    function $(sel) { return container.querySelector('[data-g="' + sel + '"]'); }
    function say(text) { $('msg').textContent = text || ''; }

    function draw() {
      var present = opts.present() || {};
      $('list').innerHTML = groups.length ? groups.map(function (g) {
        var inFile = g.members.filter(function (m) { return present[m.key]; }).length;
        return '<div class="rp-gcard" data-id="' + esc(g.id) + '">' +
          '<div class="rp-ghead"><div><b>' + esc(g.name) + '</b> <span class="sub">' + g.members.length + ' vendor' + (g.members.length === 1 ? '' : 's') +
            (inFile !== g.members.length ? ' &middot; ' + inFile + ' in this file' : '') + '</span></div>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-g="remove-group" data-id="' + esc(g.id) + '">Remove group</button></div>' +
          '<div class="op-chips">' + g.members.map(function (m) {
            return '<span class="op-chip' + (present[m.key] ? '' : ' gone') + '"' + (present[m.key] ? '' : ' title="Not in the uploaded file"') + '>' + esc(m.label) +
              '<button type="button" data-g="remove-member" data-id="' + esc(g.id) + '" data-key="' + esc(m.key) + '" aria-label="Remove ' + esc(m.label) + ' from the group">&times;</button></span>';
          }).join('') + '</div></div>';
      }).join('') : '<p class="muted">No groups yet.</p>';
    }

    function create() {
      var name = cleanName($('name').value), picked = opts.selected() || [];
      if (!name) { say('Type a name for the group.'); return; }
      if (picked.length < 2) { say('Tick at least two vendors in the list to make a group.'); return; }

      var taken = Object.create(null);
      picked.forEach(function (v) { taken[v.key] = true; });
      // a vendor belongs to one group only: take the ticked vendors out of any other group
      groups.forEach(function (g) { g.members = g.members.filter(function (m) { return !taken[m.key]; }); });

      var target = groups.filter(function (g) { return g.name.toLowerCase() === name.toLowerCase(); })[0];
      if (!target) { target = { id: P.uid(), name: name, members: [] }; groups.push(target); }
      picked.forEach(function (v) { target.members.push({ key: v.key, label: v.label }); });
      groups = groups.filter(function (g) { return g.members.length; });      // a group left empty is dropped

      if (!save(groups)) return;
      $('name').value = '';
      say('');
      draw();
      changed();
      P.toast('Group "' + target.name + '" saved');
    }

    function changed() { if (opts.onChange) opts.onChange(); }

    function onClick(ev) {
      var b = ev.target.closest('[data-g]');
      if (!b) return;
      if (b.dataset.g === 'create') { create(); return; }
      var g = groups.filter(function (x) { return x.id === b.dataset.id; })[0];
      if (!g) return;
      if (b.dataset.g === 'remove-group') groups = groups.filter(function (x) { return x !== g; });
      else if (b.dataset.g === 'remove-member') {
        g.members = g.members.filter(function (m) { return m.key !== b.dataset.key; });
        groups = groups.filter(function (x) { return x.members.length; });
      } else return;
      save(groups);
      draw();
      changed();
    }
    function onKey(ev) {
      if (ev.key === 'Enter' && ev.target.dataset && ev.target.dataset.g === 'name') { ev.preventDefault(); create(); }
    }
    container.addEventListener('click', onClick);
    container.addEventListener('keydown', onKey);
    draw();

    return {
      refresh: draw,
      // [{ id, name, members: [{ key, label }] }]
      groups: function () { return groups.slice(); },
      // name of the group a vendor key is in, or ''
      groupOf: function (key) {
        for (var i = 0; i < groups.length; i++) {
          if (groups[i].members.some(function (m) { return m.key === key; })) return groups[i].name;
        }
        return '';
      },
      // The files to make from the vendors in `sections`: one per group (vendors in the order shown), then one per vendor not in a group
      plan: function (sections) {
        var files = [], grouped = Object.create(null);
        groups.forEach(function (g) {
          var inGroup = Object.create(null);
          g.members.forEach(function (m) { inGroup[m.key] = true; });
          var secs = sections.filter(function (s) { return inGroup[H.vendorKey(s.name)]; });
          secs.forEach(function (s) { grouped[H.vendorKey(s.name)] = true; });
          if (secs.length) files.push({ name: g.name, sections: secs, group: true });
        });
        sections.forEach(function (s) {
          if (!grouped[H.vendorKey(s.name)]) files.push({ name: s.name, sections: [s] });
        });
        return files;
      },
      destroy: function () {
        container.removeEventListener('click', onClick);
        container.removeEventListener('keydown', onKey);
      }
    };
  };
})();
