/* ===========================================================================
   LOREN ODEN — "Lantern"
   (1) Higgsfield orbit scrubbed as a scroll image-sequence
   (2) Kinetic variable typography driven by pointer + scroll
   (3) A living particle field — dust in the beam
   =========================================================================== */
(function () {
  'use strict';
  var root = document.documentElement;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var coarse = window.matchMedia('(pointer: coarse)').matches;
  var yr = document.getElementById('yr'); if (yr) yr.textContent = new Date().getFullYear();

  /* ---------------------------------------------------------------------
     THE LIGHT — pointer position, eased, published as CSS custom props
     --------------------------------------------------------------------- */
  var L = { x: innerWidth * .34, y: innerHeight * .45, tx: innerWidth * .34, ty: innerHeight * .45, lit: 0 };
  var idleT = 0, idle = true;

  function ignite() {
    if (L.lit) return;
    L.lit = 1; root.style.setProperty('--lit', '1');
  }

  if (!reduce) {
    addEventListener('pointermove', function (e) {
      L.tx = e.clientX; L.ty = e.clientY; idle = false; idleT = 0; ignite();
    }, { passive: true });
    addEventListener('touchstart', function (e) {
      if (e.touches[0]) { L.tx = e.touches[0].clientX; L.ty = e.touches[0].clientY; idle = false; idleT = 0; ignite(); }
    }, { passive: true });
    // Touch / no-pointer visitors still get a lit room: the lantern drifts on its own.
    if (coarse) setTimeout(ignite, 900);
  } else {
    root.style.setProperty('--lit', '1');
  }

  /* ---------------------------------------------------------------------
     (1) SCROLL-SCRUBBED ORBIT
     --------------------------------------------------------------------- */
  var FRAMES = 96;
  var cv = document.getElementById('orbit');
  var ctx = cv && cv.getContext('2d', { alpha: false });
  var imgs = new Array(FRAMES);
  var loaded = 0, curFrame = -1, dpr = Math.min(devicePixelRatio || 1, 2);
  var track = document.querySelector('.hero-track');

  function pad(n) { return (n < 100 ? (n < 10 ? '00' : '0') : '') + n; }

  function loadFrames() {
    // first, last and middle up front so the hero is never empty
    var order = [], i;
    for (i = 0; i < FRAMES; i++) order.push(i);
    order.sort(function (a, b) {
      var w = function (n) { return n === 0 ? -3 : (n === FRAMES - 1 ? -2 : (n % 8 === 0 ? -1 : 0)); };
      return w(a) - w(b) || a - b;
    });
    order.forEach(function (n) {
      var im = new Image();
      im.decoding = 'async';
      im.onload = function () { loaded++; if (loaded === 1 || n === curFrame) draw(true); };
      im.src = 'assets/frames/orbit-' + pad(n) + '.webp';
      imgs[n] = im;
    });
  }

  function sizeCanvas() {
    if (!cv) return;
    var w = cv.clientWidth, h = cv.clientHeight;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    curFrame = -1; draw(true);
  }

  function nearestReady(n) {
    for (var d = 0; d < FRAMES; d++) {
      if (imgs[n - d] && imgs[n - d].complete && imgs[n - d].naturalWidth) return n - d;
      if (imgs[n + d] && imgs[n + d].complete && imgs[n + d].naturalWidth) return n + d;
    }
    return -1;
  }

  function draw(force) {
    if (!ctx || !track) return;
    var r = track.getBoundingClientRect();
    var span = r.height - innerHeight;
    var p = span > 0 ? Math.min(1, Math.max(0, -r.top / span)) : 0;
    var n = Math.min(FRAMES - 1, Math.round(p * (FRAMES - 1)));
    if (n === curFrame && !force) return;
    var k = nearestReady(n); if (k < 0) return;
    curFrame = n;
    var im = imgs[k], cw = cv.width, ch = cv.height;
    // cover
    var s = Math.max(cw / im.naturalWidth, ch / im.naturalHeight);
    var dw = im.naturalWidth * s, dh = im.naturalHeight * s;
    ctx.fillStyle = '#111110'; ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(im, (cw - dw) * .42, (ch - dh) * .5, dw, dh);
  }

  if (cv) { loadFrames(); addEventListener('resize', sizeCanvas); sizeCanvas(); }

  /* ---------------------------------------------------------------------
     (2) KINETIC VARIABLE TYPE
         The wordmark is split per letter; each letter's wdth/wght axes
         respond to how close the light is, plus a slow breath.
     --------------------------------------------------------------------- */
  var chars = [];
  document.querySelectorAll('[data-kinetic] .ln').forEach(function (ln) {
    var word = ln.getAttribute('data-word') || ln.textContent;
    ln.textContent = '';
    for (var i = 0; i < word.length; i++) {
      var s = document.createElement('span');
      s.className = 'ch'; s.textContent = word[i];
      s.setAttribute('aria-hidden', 'true');
      ln.appendChild(s); chars.push(s);
    }
    var sr = document.createElement('span');
    sr.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);';
    sr.textContent = word; ln.appendChild(sr);
  });

  // section headings widen as they scroll into the middle of the view
  var heads = [].slice.call(document.querySelectorAll('[data-kinetic-h]'));

  /* ---------------------------------------------------------------------
     (3) LIVING PARTICLE FIELD — dust, pulled through a flow field and
         pushed away from the light.
     --------------------------------------------------------------------- */
  var dc = document.getElementById('dust');
  var dx = dc && dc.getContext('2d');
  var P = [], NP = 0;

  function sizeDust() {
    if (!dc) return;
    dc.width = Math.round(innerWidth * dpr); dc.height = Math.round(innerHeight * dpr);
    dc.style.width = innerWidth + 'px'; dc.style.height = innerHeight + 'px';
    NP = Math.round(Math.min(420, Math.max(120, innerWidth * innerHeight / 5200)));
    P = [];
    for (var i = 0; i < NP; i++) {
      P.push({
        x: Math.random() * dc.width, y: Math.random() * dc.height,
        r: (Math.random() * 1.5 + .35) * dpr,
        v: Math.random() * .22 + .05,
        ph: Math.random() * Math.PI * 2,
        c: Math.random() < .78 ? 0 : 1          // 0 citron, 1 cyan
      });
    }
  }
  if (dc && !reduce) { sizeDust(); addEventListener('resize', sizeDust); }

  /* ---------------------------------------------------------------------
     ONE LOOP
     --------------------------------------------------------------------- */
  var t = 0, lastScroll = scrollY, scrollV = 0;

  function frame() {
    t += 1 / 60;

    // light drifts toward the pointer; when idle it wanders on its own
    idleT += 1 / 60;
    if (idleT > 2.6) idle = true;
    if (idle || coarse) {
      L.tx = innerWidth * (.5 + .27 * Math.cos(t * .17) + .08 * Math.sin(t * .41));
      L.ty = innerHeight * (.47 + .22 * Math.sin(t * .13));
      if (coarse && !L.lit) ignite();
    }
    L.x += (L.tx - L.x) * .085; L.y += (L.ty - L.y) * .085;
    root.style.setProperty('--mx', L.x.toFixed(1) + 'px');
    root.style.setProperty('--my', L.y.toFixed(1) + 'px');

    scrollV = scrollV * .88 + Math.abs(scrollY - lastScroll) * .12; lastScroll = scrollY;
    var breath = Math.sin(t * .62) * .5 + .5;              // 0..1, ~10s cycle
    root.style.setProperty('--lantern-r',
      (280 + breath * 48 + Math.min(scrollV, 60) * 1.1).toFixed(0) + 'px');

    draw(false);

    /* kinetic wordmark ------------------------------------------------- */
    if (chars.length) {
      for (var i = 0; i < chars.length; i++) {
        var c = chars[i], b = c.getBoundingClientRect();
        if (b.bottom < -200 || b.top > innerHeight + 200) continue;
        var cx = b.left + b.width / 2, cy = b.top + b.height / 2;
        var d = Math.hypot(cx - L.x, cy - L.y);
        var prox = Math.max(0, 1 - d / 560);                // 1 under the light
        var br = Math.sin(t * .8 + i * .55) * .5 + .5;      // per-letter breath
        var wd = 72 + prox * 58 + br * 16;                  // wdth 72..146
        var wg = 520 + prox * 330 + br * 50;                // wght 520..900
        c.style.fontVariationSettings = "'wdth' " + wd.toFixed(1) + ",'wght' " + wg.toFixed(0);
        c.style.transform = 'translateY(' + (-prox * 5).toFixed(2) + 'px)';
        if (prox > .5) c.style.color = '';
      }
    }

    /* section headings -------------------------------------------------- */
    for (var h = 0; h < heads.length; h++) {
      var hb = heads[h].getBoundingClientRect();
      if (hb.bottom < 0 || hb.top > innerHeight) continue;
      var k = 1 - Math.min(1, Math.abs((hb.top + hb.height / 2) - innerHeight * .5) / (innerHeight * .62));
      heads[h].style.fontVariationSettings =
        "'wdth' " + (82 + k * 26).toFixed(1) + ",'wght' " + (560 + k * 220).toFixed(0);
    }

    /* dust -------------------------------------------------------------- */
    if (dx) {
      dx.clearRect(0, 0, dc.width, dc.height);
      dx.globalCompositeOperation = 'lighter';
      var lx = L.x * dpr, ly = L.y * dpr, R = 330 * dpr;
      for (var p = 0; p < P.length; p++) {
        var q = P[p];
        // flow field: slow curling drift
        q.x += Math.cos(q.y * .0024 + t * .22 + q.ph) * q.v * dpr * 1.6;
        q.y -= (q.v * .9 + Math.sin(q.x * .0019 + t * .17) * .22) * dpr;
        // pushed gently out of the light
        var ddx = q.x - lx, ddy = q.y - ly, dd = Math.hypot(ddx, ddy);
        if (dd < R && dd > 1) { var f = (1 - dd / R) * .5 * dpr; q.x += ddx / dd * f; q.y += ddy / dd * f; }
        if (q.y < -10) { q.y = dc.height + 10; q.x = Math.random() * dc.width; }
        if (q.x < -10) q.x = dc.width + 10; else if (q.x > dc.width + 10) q.x = -10;
        // only visible where the light reaches
        var vis = Math.max(0, 1 - dd / (R * 1.25));
        if (vis <= .02) continue;
        var tw = .55 + .45 * Math.sin(t * 2.1 + q.ph * 3);
        dx.beginPath();
        dx.arc(q.x, q.y, q.r, 0, 6.2832);
        dx.fillStyle = q.c
          ? 'rgba(244,239,228,' + (vis * tw * .30).toFixed(3) + ')'
          : 'rgba(228,173,110,' + (vis * tw * .44).toFixed(3) + ')';
        dx.fill();
      }
      dx.globalCompositeOperation = 'source-over';
    }

    requestAnimationFrame(frame);
  }

  if (reduce) { draw(true); } else { requestAnimationFrame(frame); }

  /* nav gets a ground once the hero is behind us */
  var navEl = document.querySelector('.nav');
  function navState(){ if (navEl) navEl.classList.toggle('scrolled', scrollY > innerHeight * .7); }
  addEventListener('scroll', navState, { passive: true }); navState();

  /* ---------------------------------------------------------------------
     reveal on scroll
     --------------------------------------------------------------------- */
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -12% 0px', threshold: .08 });
    document.querySelectorAll('.rv').forEach(function (n) { io.observe(n); });
  } else {
    document.querySelectorAll('.rv').forEach(function (n) { n.classList.add('in'); });
  }
})();
