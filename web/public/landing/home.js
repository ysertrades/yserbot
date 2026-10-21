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

  // Ranks that pay out: the ladder, climbed. Each bar is a level; as it rises the
  // pill rolls up to the rank it pays out, its XP line fills, "+XP" floats off
  // the bar and the role chip names the role handed out. The gold bar is the top
  // rank: a little burst, the role given, a hold, then the climb starts over.
  // It only runs while the card is on screen. Without the script (or with
  // reduced motion) the card keeps its still picture: Lv 12 · Trader.
  const lv = document.getElementById('lv');
  if (lv && !reduce) {
    const RANKS = [['Lv 1', 'Newcomer', '#8b8b92'], ['Lv 2', 'Rookie', '#9aa3ff'], ['Lv 4', 'Member', '#7c8bff'], ['Lv 6', 'Regular', '#6574ff'],
      ['Lv 8', 'Analyst', '#4d5cff'], ['Lv 10', 'Strategist', '#3343ff'], ['Lv 12', 'Trader', '#2233f5'], ['Lv 15', 'Legend', '#f5b84b']];
    const bars = [...lv.querySelectorAll('.bars i')], pill = lv.querySelector('.lvpill'), roll = lv.querySelector('.lv-roll'),
      xp = lv.querySelector('.lv-xp i'), who = lv.querySelector('.lv-who'), role = lv.querySelector('.lv-role'), dot = lv.querySelector('.lv-dot');
    const GAINS = [120, 180, 240, 320, 410, 520, 880];
    let timers = [], running = false;
    const at = (ms, f) => timers.push(setTimeout(f, ms));
    const rankText = (i) => `${RANKS[i][0]} · ${RANKS[i][1]}`;
    function rollTo(i) {   // the old rank slides up and out, the new one rises in under it
      const old = roll.querySelector('b:not(.out)'), next = document.createElement('b');
      next.textContent = rankText(i); next.className = 'in';
      if (old) { old.classList.remove('in'); old.classList.add('out'); setTimeout(() => old.remove(), 420); }
      roll.append(next);
      pill.classList.remove('pop'); void pill.offsetWidth; pill.classList.add('pop');
      pill.style.setProperty('--rk', RANKS[i][2]);
    }
    function plus(bar, n) {   // "+XP", floating off the top of the bar that just rose
      const p = document.createElement('span'); p.className = 'lv-plus'; p.textContent = `+${n} XP`;
      p.style.left = `${bar.offsetLeft + bar.offsetWidth / 2}px`; p.style.bottom = `${lv.clientHeight - bar.offsetTop + 6}px`;
      lv.append(p); setTimeout(() => p.remove(), 1300);
    }
    function burst() {   // the top rank: flat gold and green flecks thrown out from the pill
      for (let k = 0; k < 10; k++) {
        const s = document.createElement('i'), a = (k / 10) * Math.PI * 2 + Math.random() * 0.4, d = 26 + Math.random() * 22;
        s.className = 'lv-fleck'; s.style.setProperty('--dx', `${Math.cos(a) * d}px`); s.style.setProperty('--dy', `${Math.sin(a) * d}px`);
        s.style.background = k % 3 ? '#f5b84b' : '#3ccf7a';
        pill.append(s); setTimeout(() => s.remove(), 900);
      }
    }
    function setRole(i, given) {
      role.textContent = given ? `${RANKS[i][1]} role given` : i ? `Role · ${RANKS[i][1]}` : '@alice';
      dot.style.background = RANKS[i][2];
      who.classList.toggle('given', !!given);
      who.classList.remove('pop'); void who.offsetWidth; who.classList.add('pop');
    }
    function cycle() {
      timers.forEach(clearTimeout); timers = [];
      lv.classList.add('run'); pill.classList.remove('gold');
      bars.forEach((b) => b.classList.remove('on', 'flash'));
      roll.innerHTML = `<b>${rankText(0)}</b>`; pill.style.setProperty('--rk', RANKS[0][2]); setRole(0);
      xp.style.transition = 'none'; xp.style.transform = 'scaleX(0)';
      const STEP = 560;
      bars.forEach((b, i) => {
        const t = 500 + i * STEP;
        at(t - STEP + 120, () => { xp.style.transition = `transform ${STEP - 140}ms linear`; xp.style.transform = 'scaleX(1)'; });   // the XP line fills toward the next level
        at(t, () => {
          b.classList.add('on', 'flash'); plus(b, GAINS[i]);
          rollTo(i + 1); setRole(i + 1);
          xp.style.transition = 'none'; xp.style.transform = 'scaleX(0)';
          if (i === bars.length - 1) { pill.classList.add('gold'); burst(); at(450, () => setRole(i + 1, true)); }
        });
      });
      const end = 500 + bars.length * STEP + 2400;
      at(end, () => bars.forEach((b) => b.classList.remove('on', 'flash')));   // the bars sink, and the climb begins again
      at(end + 650, () => { if (running) cycle(); });
    }
    const start = () => { if (running) return; running = true; cycle(); };
    const stop = () => { running = false; timers.forEach(clearTimeout); timers = []; };
    if ('IntersectionObserver' in window) new IntersectionObserver((es) => es.forEach((e) => (e.isIntersecting ? start() : stop())), { threshold: 0.35 }).observe(lv);
    else start();
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else if (lv.getBoundingClientRect().top < innerHeight && lv.getBoundingClientRect().bottom > 0) start(); });
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
