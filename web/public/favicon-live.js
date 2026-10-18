/* The tab icon, alive. The static icon is /favicon-32.png (the bot's head on a
   rounded tile); once this runs it redraws that icon on a canvas so it can:
   - wear a green "online" dot, cut out of the tile like an app badge, while
     the bot is connected (checked on load and every few minutes);
   - blink now and then, the bot's two eyes closing for a moment.
   Nothing here is needed: if the image or the stats fail, the static icon stays. */
(function () {
  'use strict';
  const S = 64;                                  // drawn at 64, the browser scales it down
  const link = document.querySelector('link[rel="icon"][sizes="32x32"]') || document.querySelector('link[rel="icon"]');
  if (!link || !document.createElement('canvas').getContext) return;
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const img = new Image();
  img.src = '/favicon-96.png';
  let online = false, ready = false;

  // Where the eyes sit on the served icon (the crop the server uses), as
  // fractions of its side: measured from the blue pixels inside the visor.
  const EYES = [[0.375, 0.526], [0.615, 0.526]], EYE_W = 0.062, EYE_H = 0.114;

  function draw(blink) {
    const c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, S, S);
    if (blink > 0) {
      // Close the eyes: paint the visor's black over them, then a thin lid line.
      for (const [x, y] of EYES) {
        const w = EYE_W * S * 1.9, h = EYE_H * S * 1.45;
        g.fillStyle = '#0b0c10';
        g.fillRect(x * S - w / 2, y * S - h / 2, w, h * blink);
        if (blink === 1) { g.fillStyle = '#5ea2ff'; g.fillRect(x * S - w / 3, y * S + h * .1, w / 1.5, Math.max(1.5, S * 0.03)); }
      }
    }
    if (online) {
      const r = S * 0.13, cx = S - r - 2, cy = S - r - 2;
      g.globalCompositeOperation = 'destination-out';
      g.beginPath(); g.arc(cx, cy, r + S * 0.05, 0, Math.PI * 2); g.fill();
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = '#3ccf7a';
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    }
    try { link.type = 'image/png'; link.href = c.toDataURL('image/png'); } catch (_) {}
    // A browser picks one icon among several links (often the largest), so the
    // live one has to be the only one left for its changes to show.
    if (!pruned) { pruned = true; document.querySelectorAll('link[rel="icon"]').forEach(l => { if (l !== link) l.remove(); }); link.removeAttribute('sizes'); }
  }
  let pruned = false;

  function blinkOnce() {
    if (!ready || document.hidden) return;
    draw(0.6); setTimeout(() => draw(1), 60); setTimeout(() => draw(0.6), 140); setTimeout(() => draw(0), 200);
  }
  function loop() { setTimeout(() => { blinkOnce(); loop(); }, 3500 + Math.random() * 4000); }

  function status() {
    fetch('/api/public/stats', { credentials: 'omit' }).then(r => (r.ok ? r.json() : null)).then(s => {
      const next = !!(s && s.online);
      if (next !== online) { online = next; if (ready) draw(0); }
    }).catch(() => {});
  }

  img.onload = () => { ready = true; draw(0); if (!reduce) loop(); };
  status();
  setInterval(status, 5 * 60 * 1000);
})();
