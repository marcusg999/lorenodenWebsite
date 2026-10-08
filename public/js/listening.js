/* ===========================================================================
   THE LISTENING ROOM — 62 sourced selections, official players only.
   =========================================================================== */
(function () {
  'use strict';
  var ALL = window.LO_CATALOG || [];
  if (!ALL.length) return;
  var list = document.getElementById('tracklist');
  if (!list) return;

  var els = {
    no: document.getElementById('pcNo'), title: document.getElementById('pcTitle'),
    artist: document.getElementById('pcArtist'), album: document.getElementById('pcAlbum'),
    role: document.getElementById('pcRole'), embed: document.getElementById('pcEmbed'),
    src: document.getElementById('pcSrc')
  };
  var view = ALL.slice(), cur = 0, filter = 'All';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function render() {
    list.innerHTML = view.map(function (t) {
      return '<li><button class="trk" type="button" data-o="' + t.order + '">' +
        '<span class="trk-no">' + ('0' + t.order).slice(-2) + '</span>' +
        '<span><span class="trk-t">' + esc(t.title) + '</span>' +
        '<span class="trk-a">' + esc(t.artist) + '</span></span>' +
        '<span class="trk-c">' + esc(t.category) + '</span></button></li>';
    }).join('');
  }

  function load(order, autoplayOk) {
    var t = ALL.filter(function (x) { return x.order === order; })[0];
    if (!t) return;
    cur = order;
    els.no.textContent = ('0' + t.order).slice(-2) + ' / 62';
    els.title.textContent = t.title;
    els.artist.textContent = t.artist;
    els.album.textContent = t.album;
    els.role.textContent = t.role;
    els.src.href = t.source;

    els.embed.innerHTML = '';
    if (t.embed) {
      var f = document.createElement('iframe');
      f.src = t.embed;
      var isBC = /bandcamp/.test(t.embed);
      f.height = isBC ? '120' : '175';
      f.setAttribute('allow', 'autoplay *; encrypted-media *; clipboard-write; fullscreen');
      f.setAttribute('referrerpolicy', 'origin');
      f.setAttribute('title', 'Player — ' + t.title + ' by ' + t.artist);
      f.style.cssText = 'width:100%;border:0;display:block;height:' + (isBC ? 120 : 175) + 'px;';
      els.embed.appendChild(f);
    } else {
      els.embed.innerHTML = '<p class="fallback">No embeddable player is available for this ' +
        'selection. <a href="' + esc(t.source) + '" target="_blank" rel="noopener">' +
        'Open it at the source ↗</a></p>';
    }

    [].forEach.call(list.querySelectorAll('.trk'), function (b) {
      b.setAttribute('aria-current', +b.dataset.o === order ? 'true' : 'false');
    });
    if (autoplayOk) {
      var act = list.querySelector('.trk[aria-current="true"]');
      if (act) act.scrollIntoView({ block: 'nearest' });
    }
  }

  list.addEventListener('click', function (e) {
    var b = e.target.closest('.trk'); if (b) load(+b.dataset.o, false);
  });

  function step(dir) {
    var i = view.findIndex(function (t) { return t.order === cur; });
    if (i < 0) i = 0;
    i = (i + dir + view.length) % view.length;
    load(view[i].order, true);
  }
  document.getElementById('pcPrev').addEventListener('click', function () { step(-1); });
  document.getElementById('pcNext').addEventListener('click', function () { step(1); });

  [].forEach.call(document.querySelectorAll('.filt'), function (b) {
    b.addEventListener('click', function () {
      filter = b.dataset.f;
      [].forEach.call(document.querySelectorAll('.filt'), function (o) {
        o.setAttribute('aria-pressed', o === b ? 'true' : 'false');
      });
      view = filter === 'All' ? ALL.slice() : ALL.filter(function (t) { return t.category === filter; });
      render();
      if (!view.some(function (t) { return t.order === cur; })) load(view[0].order, false);
      else load(cur, false);
    });
  });

  render();
  load(1, false);
})();
