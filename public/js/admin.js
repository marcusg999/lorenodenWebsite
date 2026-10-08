/* ===========================================================================
   Loren Oden — admin portal
   =========================================================================== */
(function () {
  'use strict';
  var boot = document.getElementById('admin-data');
  if (!boot) return;
  var A = JSON.parse(boot.textContent);
  window.ADMIN = A;
  var dirtyContent = Object.create(null);     // key -> value
  var dirtyTables = Object.create(null);      // table -> true
  var state = JSON.parse(JSON.stringify(A.rows));
  var original = JSON.parse(JSON.stringify(A.rows));

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ---------- labels for the collection editors ---------- */
  var LABELS = {
    label: 'Label', href: 'Link', tag: 'Badge', title: 'Title', body: 'Description',
    link_label: 'Link label', url: 'Link', artist: 'Artist', album: 'Album',
    category: 'Category', role: 'Role', source: 'Source link', embed: 'Player embed URL',
    kind: 'When', date_label: 'Date', venue: 'Venue / event', location: 'Location',
    note: 'Note', meta: 'Publication / format', src: 'Image path', alt: 'Alt text',
    caption_bold: 'Caption — bold part', caption: 'Caption', width: 'Width',
    height: 'Height', shape: 'Layout'
  };
  var LONG = ['body', 'note', 'alt', 'embed'];
  var CHOICES = {
    category: ['Solo', 'Features', 'Screen', 'Live'],
    kind: ['upcoming', 'past'],
    shape: ['a', 'b', 'c']
  };
  var TITLE_COL = { nav: 'label', releases: 'title', tracks: 'title', shows: 'venue',
                    credits: 'title', press: 'title', shots: 'caption_bold', links: 'label' };

  /* ---------- panels ---------- */
  $$('.ad-nav').forEach(function (b) {
    b.addEventListener('click', function () {
      $$('.ad-nav').forEach(function (o) { o.removeAttribute('aria-current'); });
      b.setAttribute('aria-current', 'true');
      $$('.panel').forEach(function (p) { p.hidden = p.id !== b.dataset.panel; });
      window.scrollTo({ top: 0, behavior: 'smooth' });
      var t = b.dataset.panel.replace(/^c-/, '');
      if (b.dataset.panel.indexOf('c-') === 0) renderTable(t);
    });
  });

  /* ---------- content fields ---------- */
  $$('[data-key]').forEach(function (el) {
    var ev = el.type === 'checkbox' ? 'change' : 'input';
    el.addEventListener(ev, function () {
      dirtyContent[el.dataset.key] = el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value;
      markDirty();
    });
  });

  /* ---------- collection editors ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function renderTable(t) {
    var host = document.getElementById('items-' + t);
    if (!host) return;
    var cols = A.columns[t].filter(function (c) { return c !== 'position'; });
    host.innerHTML = state[t].map(function (row, i) {
      var titleCol = TITLE_COL[t] || cols[0];
      return '<div class="item" data-i="' + i + '">' +
        '<div class="item-bar">' +
          '<span class="item-no">' + ('0' + (i + 1)).slice(-2) + '</span>' +
          '<span class="item-title">' + (esc(row[titleCol]) || '<em style="color:#55554f">Untitled</em>') + '</span>' +
          '<button class="ibtn" type="button" data-move="-1" title="Move up"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
          '<button class="ibtn" type="button" data-move="1" title="Move down"' + (i === state[t].length - 1 ? ' disabled' : '') + '>↓</button>' +
          '<button class="ibtn del" type="button" data-del="1" title="Remove">✕</button>' +
        '</div><div class="grid2">' +
        cols.map(function (c) {
          var v = row[c] == null ? '' : row[c];
          var wide = LONG.indexOf(c) >= 0 || c === 'source' || c === 'url' || c === 'href';
          var inner;
          if (CHOICES[c]) {
            inner = '<select class="fs" data-col="' + c + '">' + CHOICES[c].map(function (o) {
              return '<option value="' + esc(o) + '"' + (String(v) === o ? ' selected' : '') + '>' + esc(o) + '</option>';
            }).join('') + '</select>';
          } else if (LONG.indexOf(c) >= 0) {
            inner = '<textarea class="ft" data-col="' + c + '" rows="2">' + esc(v) + '</textarea>';
          } else {
            inner = '<input class="fi" data-col="' + c + '" type="text" value="' + esc(v) + '">';
          }
          return '<div class="field' + (wide ? ' wide' : '') + '">' +
                 '<label class="fl">' + (LABELS[c] || c) + '</label>' + inner + '</div>';
        }).join('') +
        '</div></div>';
    }).join('') || '<p class="fhelp">Nothing here yet.</p>';
  }

  document.addEventListener('input', function (e) {
    var col = e.target.dataset && e.target.dataset.col;
    if (!col) return;
    var panel = e.target.closest('.panel[data-table]');
    var item = e.target.closest('.item');
    if (!panel || !item) return;
    var t = panel.dataset.table, i = +item.dataset.i;
    state[t][i][col] = e.target.value;
    dirtyTables[t] = true;
    if (col === (TITLE_COL[t] || '')) {
      var lab = item.querySelector('.item-title');
      if (lab) lab.textContent = e.target.value || 'Untitled';
    }
    markDirty();
  });
  document.addEventListener('change', function (e) {
    if (e.target.tagName === 'SELECT' && e.target.dataset.col) {
      var panel = e.target.closest('.panel[data-table]'), item = e.target.closest('.item');
      if (!panel || !item) return;
      state[panel.dataset.table][+item.dataset.i][e.target.dataset.col] = e.target.value;
      dirtyTables[panel.dataset.table] = true;
      markDirty();
    }
  });

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn) return;

    if (btn.dataset.add) {
      var t = btn.dataset.add;
      var row = {};
      A.columns[t].forEach(function (c) { if (c !== 'position') row[c] = CHOICES[c] ? CHOICES[c][0] : ''; });
      if (t === 'shows') row.kind = 'upcoming';
      if (t === 'shots') { row.width = 1600; row.height = 1000; }
      state[t].push(row); dirtyTables[t] = true; renderTable(t); markDirty();
      var items = document.querySelectorAll('#items-' + t + ' .item');
      if (items.length) items[items.length - 1].scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    var panel = btn.closest('.panel[data-table]');
    if (!panel) return;
    var t = panel.dataset.table, item = btn.closest('.item');
    if (!item) return;
    var i = +item.dataset.i;

    if (btn.dataset.move) {
      var j = i + (+btn.dataset.move);
      if (j < 0 || j >= state[t].length) return;
      var tmp = state[t][i]; state[t][i] = state[t][j]; state[t][j] = tmp;
      dirtyTables[t] = true; renderTable(t); markDirty();
    } else if (btn.dataset.del) {
      var name = state[t][i][TITLE_COL[t]] || 'this item';
      if (!confirm('Remove “' + name + '”?\n\nIt is only removed for good once you save.')) return;
      state[t].splice(i, 1); dirtyTables[t] = true; renderTable(t); markDirty();
    }
  });

  /* ---------- save ---------- */
  var bar = $('#savebar'), msg = $('#savemsg'), toastEl = $('#toast');
  function nDirty() { return Object.keys(dirtyContent).length + Object.keys(dirtyTables).length; }
  function markDirty() {
    var n = nDirty();
    bar.classList.toggle('on', n > 0);
    if (n) msg.innerHTML = '<b>Unsaved changes</b>';
  }
  function toast(text, bad) {
    toastEl.textContent = text;
    toastEl.classList.toggle('bad', !!bad);
    toastEl.classList.add('on');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { toastEl.classList.remove('on'); }, 3200);
  }

  function send(method, url, body) {
    return fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': A.csrf },
      credentials: 'same-origin',
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || ('Request failed (' + r.status + ')'));
        return j;
      });
    });
  }

  $('#save').addEventListener('click', function () {
    var jobs = [], btn = this;
    if (Object.keys(dirtyContent).length) jobs.push(send('PUT', '/api/content', dirtyContent));
    Object.keys(dirtyTables).forEach(function (t) {
      jobs.push(send('PUT', '/api/collection/' + t, { rows: state[t] }));
    });
    if (!jobs.length) return;
    btn.disabled = true; msg.textContent = 'Saving…';
    Promise.all(jobs).then(function () {
      dirtyContent = Object.create(null); dirtyTables = Object.create(null);
      original = JSON.parse(JSON.stringify(state));
      bar.classList.remove('on');
      toast('Saved. The site is updated.');
    }).catch(function (e) {
      msg.innerHTML = '<b style="color:var(--magenta)">' + e.message + '</b>';
      toast(e.message, true);
    }).finally(function () { btn.disabled = false; });
  });

  $('#revert').addEventListener('click', function () {
    if (!confirm('Discard every unsaved change on this page?')) return;
    location.reload();
  });

  window.addEventListener('beforeunload', function (e) {
    if (nDirty()) { e.preventDefault(); e.returnValue = ''; }
  });

  /* ---------- password ---------- */
  var pwGo = $('#pw-go');
  if (pwGo) pwGo.addEventListener('click', function () {
    var cur = $('#pw-cur').value, nw = $('#pw-new').value, rep = $('#pw-rep').value;
    if (nw !== rep) return toast('The new passwords do not match.', true);
    if (nw.length < 12) return toast('Use at least twelve characters.', true);
    pwGo.disabled = true;
    send('POST', '/api/password', { current: cur, next: nw })
      .then(function () {
        $('#pw-cur').value = $('#pw-new').value = $('#pw-rep').value = '';
        toast('Password updated.');
      })
      .catch(function (e) { toast(e.message, true); })
      .finally(function () { pwGo.disabled = false; });
  });

  /* first render of whichever collection panels exist */
  Object.keys(A.rows).forEach(renderTable);
})();
