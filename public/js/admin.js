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
          if (c === 'src') {
            inner = '<div class="imgfield" data-col="src" data-value="' + esc(v) + '"></div>';
          } else if (CHOICES[c]) {
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
    Array.prototype.forEach.call(host.querySelectorAll('.imgfield'), paintImageField);
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

  /* ---------- image fields & the media picker ---------- */
  function imgTag(src) {
    return src ? '<img src="/' + esc(src) + '.webp" alt="" onerror="this.src=\'/' + esc(src) + '.jpg\'">'
               : '<span class="none">None</span>';
  }

  function paintImageField(box) {
    var v = box.dataset.value || '';
    box.innerHTML =
      '<div class="imgprev">' + imgTag(v) + '</div>' +
      '<div class="imgmeta">' +
        '<p class="imgpath">' + (esc(v) || '—') + '</p>' +
        '<div class="imgacts">' +
          '<button class="sbtn" type="button" data-act="upload">Upload…</button>' +
          '<button class="sbtn" type="button" data-act="library">Library</button>' +
          (v ? '<button class="sbtn danger" type="button" data-act="clear">Clear</button>' : '') +
        '</div>' +
        '<div class="upbar"><i></i></div>' +
      '</div>' +
      '<input type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/tiff">';
  }

  function setImageValue(box, src, row) {
    box.dataset.value = src;
    paintImageField(box);
    if (row) {                                  // a collection row's image column
      state[row.t][row.i][row.col] = src;
      dirtyTables[row.t] = true;
    } else {
      dirtyContent[box.dataset.image] = src;
    }
    markDirty();
  }
  function rowOf(box) {
    var panel = box.closest('.panel[data-table]'), item = box.closest('.item');
    if (!panel || !item) return null;
    return { t: panel.dataset.table, i: +item.dataset.i, col: box.dataset.col };
  }

  function uploadFor(box, file) {
    var bar = box.querySelector('.upbar');
    if (bar) bar.classList.add('on');
    var fd = new FormData(); fd.append('image', file);
    return fetch('/api/upload', {
      method: 'POST', headers: { 'X-CSRF-Token': A.csrf }, credentials: 'same-origin', body: fd
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || 'Upload failed.');
        return j;
      });
    }).then(function (j) {
      var row = rowOf(box);
      setImageValue(box, j.src, row);
      // a gallery photograph carries its own dimensions
      if (row && state[row.t][row.i] && 'width' in state[row.t][row.i]) {
        state[row.t][row.i].width = j.width;
        state[row.t][row.i].height = j.height;
        renderTable(row.t);
      }
      toast('Image uploaded. Save to publish it.');
    }).catch(function (e) { toast(e.message, true); })
      .finally(function () { var b = box.querySelector('.upbar'); if (b) b.classList.remove('on'); });
  }

  var pickerFor = null;
  function openLibrary(box) {
    pickerFor = box;
    var modal = document.getElementById('media-modal');
    var body = modal.querySelector('.modal-body');
    body.innerHTML = '<p class="fhelp">Loading…</p>';
    modal.hidden = false;
    fetch('/api/media', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.media.length) { body.innerHTML = '<p class="fhelp">Nothing uploaded yet.</p>'; return; }
        body.innerHTML = '<div class="medgrid">' + j.media.map(function (m) {
          return '<div class="medcell" data-src="' + esc(m.src) + '" data-name="' + esc(m.name) + '">' +
                 '<button class="rm" type="button" data-rm="1" title="Delete">✕</button>' +
                 '<img src="/' + esc(m.src) + '.webp" alt="" loading="lazy">' +
                 '<div class="nm">' + esc(m.name) + '</div></div>';
        }).join('') + '</div>';
      })
      .catch(function () { body.innerHTML = '<p class="fhelp">Could not load the library.</p>'; });
  }
  function closeLibrary() {
    document.getElementById('media-modal').hidden = true;
    pickerFor = null;
  }

  document.addEventListener('click', function (e) {
    var box = e.target.closest('.imgfield');
    if (box) {
      var act = e.target.closest('[data-act]');
      if (act) {
        var a = act.dataset.act;
        if (a === 'upload') box.querySelector('input[type=file]').click();
        else if (a === 'library') openLibrary(box);
        else if (a === 'clear') setImageValue(box, '', rowOf(box));
        return;
      }
    }
    var cell = e.target.closest('.medcell');
    if (cell) {
      if (e.target.closest('[data-rm]')) {
        if (!confirm('Delete “' + cell.dataset.name + '” for good?\n\nAnything still pointing at it will lose its image.')) return;
        fetch('/api/media/' + encodeURIComponent(cell.dataset.name), {
          method: 'DELETE', headers: { 'X-CSRF-Token': A.csrf }, credentials: 'same-origin'
        }).then(function (r) { return r.json(); })
          .then(function (j) { if (j.error) throw new Error(j.error); cell.remove(); toast('Deleted.'); })
          .catch(function (err) { toast(err.message, true); });
        return;
      }
      if (pickerFor) { setImageValue(pickerFor, cell.dataset.src, rowOf(pickerFor)); closeLibrary(); }
      return;
    }
    if (e.target.closest('[data-close-modal]') ||
        (e.target.id === 'media-modal')) closeLibrary();
  });

  document.addEventListener('change', function (e) {
    if (e.target.type === 'file' && e.target.closest('.imgfield')) {
      var f = e.target.files && e.target.files[0];
      if (f) uploadFor(e.target.closest('.imgfield'), f);
      e.target.value = '';
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeLibrary();
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
  $$('.imgfield[data-image]').forEach(paintImageField);
})();
