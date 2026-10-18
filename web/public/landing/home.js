/* Quant Bot landing: entrances, the pointer-tilted stage, the panel window
   that straightens as you reach it, and the live numbers. */
(function () {
  'use strict';
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Rise in as they arrive. Everything is visible without this script.
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => {
    for (const e of es) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }) : null;
  document.querySelectorAll('.reveal, .stage').forEach(n => (io && !reduce ? io.observe(n) : n.classList.add('in')));

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
  const win = document.getElementById('window');
  if (win && !reduce) {
    let ticking = false;
    const update = () => {
      ticking = false;
      const r = win.getBoundingClientRect(), vh = innerHeight;
      const k = Math.max(0, Math.min(1, (vh - r.top) / (vh * 0.75)));
      const e = 1 - Math.pow(1 - k, 3);
      win.style.setProperty('--tilt', `${24 * (1 - e)}deg`);
      win.style.setProperty('--sc', String(0.92 + 0.08 * e));
    };
    addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    update();
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
    document.querySelectorAll('[data-stat="ping"]').forEach(el => { el.textContent = s.ping ? `${s.ping} ms` : '—'; });
    const dot = document.getElementById('nav-dot');
    if (dot && s.online) { dot.classList.add('live'); dot.title = 'Online'; }
    const live = document.getElementById('hero-live');
    if (live && s.servers) live.textContent = `in ${fmt(s.servers)} server${s.servers === 1 ? '' : 's'}`;
  }).catch(() => {});
})();
