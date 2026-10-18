/* Quant Bot landing: entrances, the pointer-tilted stage, the panel window
   that straightens as you reach it, and the live numbers. */
(function () {
  'use strict';
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Rise in as they arrive. Everything is visible without this script.
  // What is already on screen is revealed at once, in this frame; waiting for
  // the observer's first (asynchronous) callback left a beat of empty floor.
  function startReveals() {
    const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => {
      for (const e of es) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }) : null;
    document.querySelectorAll('.reveal, .stage').forEach(n => {
      if (!io || reduce || n.getBoundingClientRect().top < innerHeight * 0.92) n.classList.add('in');
      else io.observe(n);
    });
  }

  // The intro plays to its end before it lifts: the last of its entrances (the
  // sheen across the logo) finishes at ~2.1s, so it holds at least MIN, and
  // never longer than MAX however slow the images are. Then a "lift and land":
  // as the intro's card lifts and dissolves (FADE, #intro's 0.75s transition),
  // the hero rises into place beneath it, starting LAND into the fade, once
  // the intro's card has visibly started to clear. Starting the page only
  // after the fade had finished left a gap of empty floor.
  const intro = document.getElementById('intro');
  if (!intro) startReveals();
  else {
    let seen = false;
    try { seen = sessionStorage.getItem('qb-intro') === '1'; sessionStorage.setItem('qb-intro', '1'); } catch (_) {}
    const MIN = reduce ? 0 : seen ? 1800 : 2300, MAX = 4000, FADE = reduce ? 0 : 750, LAND = reduce ? 0 : 260, t0 = performance.now();
    let gone = false;
    const lift = () => {
      if (gone) return; gone = true;
      intro.classList.add('out');
      setTimeout(startReveals, LAND);
      setTimeout(() => intro.remove(), FADE + 50);
    };
    const whenLoaded = () => setTimeout(lift, Math.max(0, MIN - (performance.now() - t0)));
    if (document.readyState === 'complete') whenLoaded(); else addEventListener('load', whenLoaded, { once: true });
    setTimeout(lift, MAX);
  }

  // The stage leans toward the pointer: a few degrees, eased, never a snap.
  const plane = document.getElementById('plane');
  const stage = document.getElementById('stage');
  if (plane && stage && !reduce && matchMedia('(hover: hover)').matches) {
    let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0;
    const loop = () => {
      cx += (tx - cx) * 0.08; cy += (ty - cy) * 0.08;
      plane.style.setProperty('--rx', `${50 - cy * 7}deg`);
      plane.style.setProperty('--rz', `${-24 + cx * 8}deg`);
      raf = Math.abs(tx - cx) + Math.abs(ty - cy) > 0.001 ? requestAnimationFrame(loop) : 0;
    };
    window.addEventListener('pointermove', e => {
      const r = stage.getBoundingClientRect();
      tx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width / 2)));
      ty = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (r.height / 2)));
      plane.style.transition = 'none';
      if (!raf) raf = requestAnimationFrame(loop);
    }, { passive: true });
  }

  // The panel window lies back and straightens as it reaches the middle.
  // Three rules keep it from shaking (it used to, scrolling back up on iOS):
  //  - measure the untransformed wrapper, never the window itself: its tilt
  //    and scale move its own rect, so reading it fed each frame's output into
  //    the next frame's input;
  //  - hold the viewport height steady: iOS Safari changes innerHeight as its
  //    toolbar slides back in on scroll-up, which jolted the progress; it is
  //    only re-read when the width changes (rotation);
  //  - ease toward the target here, every frame, with no CSS transition on top
  //    (a transition re-targeted each frame lags and overshoots).
  const win = document.getElementById('window');
  const wrap = win && win.parentElement;
  if (win && wrap && !reduce) {
    let vw = innerWidth, vh = innerHeight, cur = -1, raf = 0;
    const target = () => {
      const k = Math.max(0, Math.min(1, (vh - wrap.getBoundingClientRect().top) / (vh * 0.75)));
      return 1 - Math.pow(1 - k, 3);
    };
    const paint = e => {
      win.style.setProperty('--tilt', `${(24 * (1 - e)).toFixed(3)}deg`);
      win.style.setProperty('--sc', (0.92 + 0.08 * e).toFixed(4));
    };
    const step = () => {
      const t = target();
      cur = cur < 0 ? t : cur + (t - cur) * 0.2;
      if (Math.abs(t - cur) < 0.0005) cur = t;
      paint(cur);
      raf = cur === t ? 0 : requestAnimationFrame(step);
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(step); };
    addEventListener('scroll', kick, { passive: true });
    addEventListener('resize', () => { if (innerWidth !== vw) { vw = innerWidth; vh = innerHeight; kick(); } }, { passive: true });
    paint(target()); cur = target();
  }

  // Live numbers: aggregate counts only, counted up once.
  const fmt = n => Number(n).toLocaleString('en-US');
  function countUp(el, to, suffix = '') {
    if (reduce) { el.textContent = fmt(to) + suffix; return; }
    const t0 = performance.now(), d = 1100;
    const step = now => { const k = Math.min(1, (now - t0) / d), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(Math.round(to * e)) + suffix; if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  fetch('/api/public/stats', { credentials: 'omit' }).then(r => (r.ok ? r.json() : null)).then(s => {
    if (!s) return;
    document.querySelectorAll('[data-stat="servers"]').forEach(el => countUp(el, s.servers || 0));
    document.querySelectorAll('[data-stat="members"]').forEach(el => countUp(el, s.members || 0));
    document.querySelectorAll('[data-stat="ping"]').forEach(el => { el.textContent = s.ping > 0 ? `${s.ping} ms` : '—'; });
    const dot = document.getElementById('nav-dot');
    if (dot && s.online) { dot.classList.add('live'); dot.title = 'Online'; }
    const live = document.getElementById('hero-live');
    if (live && s.servers) live.textContent = `in ${fmt(s.servers)} server${s.servers === 1 ? '' : 's'}`;
  }).catch(() => {});
})();
