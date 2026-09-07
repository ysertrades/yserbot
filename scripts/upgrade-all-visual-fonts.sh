#!/usr/bin/env bash
# Upgrades shared text rendering so every *Visual.js using pixelArt gets
# anti-aliased fonts when `canvas` is installed. Also strips newsfeed images.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

echo "== 1. Patch pixelArt.js text layer =="
python3 << 'PY'
from pathlib import Path
p = Path('utils/pixelArt.js')
t = p.read_text()
if 'HQ_CANVAS_TEXT' in t:
    print('pixelArt already has HQ text')
else:
    old = '''function textWidth(text, scale) {
  const chars = [...normalizeForFont(text)].filter(hasGlyph);
  if (chars.length === 0) return 0;
  return chars.length * (GLYPH_W + GLYPH_GAP) * scale - GLYPH_GAP * scale;
}

function drawText(png, text, x, y, scale, color, alpha = 1) {
  let cx = x;
  for (const ch of normalizeForFont(text)) {
    if (!hasGlyph(ch)) continue;
    drawChar(png, ch, cx, y, scale, color, alpha);
    cx += (GLYPH_W + GLYPH_GAP) * scale;
  }
}

function drawTextCentered(png, text, cx, y, scale, color, alpha = 1) {
  drawText(png, text, Math.round(cx - textWidth(text, scale) / 2), y, scale, color, alpha);
}'''

    new = '''// ─── HQ_CANVAS_TEXT ─────────────────────────────────────────────────────────
// When `canvas` is installed, text is drawn anti-aliased with a real UI font.
// Layout still uses the same scale units so existing cards keep their spacing.
// If canvas is missing (or fails), the original 5×7 pixel font is used.
let _Canvas = null;
try { _Canvas = require('canvas'); } catch { /* optional dependency */ }

function hqFontSize(scale) {
  return Math.max(11, Math.round(GLYPH_H * scale * 1.25));
}

function hqFont(scale) {
  const px = hqFontSize(scale);
  // QuantLab-like UI stack — system fonts, no extra font files required
  return `600 ${px}px "Segoe UI", "Helvetica Neue", Arial, "Noto Sans", sans-serif`;
}

function hqMeasure(text, scale) {
  if (!_Canvas) return null;
  try {
    const c = _Canvas.createCanvas(1, 1);
    const ctx = c.getContext('2d');
    ctx.font = hqFont(scale);
    const m = ctx.measureText(String(text));
    return {
      width: Math.ceil(m.width),
      height: Math.ceil(hqFontSize(scale) * 1.35),
    };
  } catch {
    return null;
  }
}

function textWidth(text, scale) {
  const hq = hqMeasure(String(text), scale);
  if (hq) return hq.width;
  const chars = [...normalizeForFont(text)].filter(hasGlyph);
  if (chars.length === 0) return 0;
  return chars.length * (GLYPH_W + GLYPH_GAP) * scale - GLYPH_GAP * scale;
}

function drawTextBitmap(png, text, x, y, scale, color, alpha = 1) {
  let cx = x;
  for (const ch of normalizeForFont(text)) {
    if (!hasGlyph(ch)) continue;
    drawChar(png, ch, cx, y, scale, color, alpha);
    cx += (GLYPH_W + GLYPH_GAP) * scale;
  }
}

function drawTextHQ(png, text, x, y, scale, color, alpha = 1) {
  if (!_Canvas) return false;
  try {
    const str = String(text);
    const cMeasure = _Canvas.createCanvas(1, 1);
    const ctx0 = cMeasure.getContext('2d');
    ctx0.font = hqFont(scale);
    const metrics = ctx0.measureText(str);
    const w = Math.max(1, Math.ceil(metrics.width) + 2);
    const h = Math.max(1, Math.ceil(hqFontSize(scale) * 1.4));
    const c = _Canvas.createCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.font = hqFont(scale);
    ctx.textBaseline = 'top';
    ctx.imageSmoothingEnabled = true;
    const a = alpha == null ? 1 : alpha;
    ctx.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},${a})`;
    ctx.fillText(str, 0, 0);
    const img = ctx.getImageData(0, 0, w, h);
    const ox = Math.round(x), oy = Math.round(y);
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const i = (py * w + px) * 4;
        const pa = img.data[i + 3] / 255;
        if (pa < 0.02) continue;
        setPxBlend(png, ox + px, oy + py, [img.data[i], img.data[i + 1], img.data[i + 2], 255], pa);
      }
    }
    return true;
  } catch {
    return false;
  }
}

function drawText(png, text, x, y, scale, color, alpha = 1) {
  if (drawTextHQ(png, text, x, y, scale, color, alpha)) return;
  drawTextBitmap(png, text, x, y, scale, color, alpha);
}

function drawTextCentered(png, text, cx, y, scale, color, alpha = 1) {
  drawText(png, text, Math.round(cx - textWidth(text, scale) / 2), y, scale, color, alpha);
}'''

    if old not in t:
        raise SystemExit('pixelArt text block not found')
    p.write_text(t.replace(old, new, 1))
    print('pixelArt HQ text layer installed')

assert 'function drawText' in p.read_text()
print('pixelArt OK')
PY

echo "== 2. Newsfeed: no embed images =="
if [[ -f scripts/newsfeed-no-images.sh ]]; then
  bash scripts/newsfeed-no-images.sh || true
else
  python3 << 'PY'
from pathlib import Path
t = Path('utils/newsFeed.js').read_text()
if 'Text-only embeds' in t:
    print('news already text-only')
elif 'setImage(picture)' in t:
    print('WARN: run newsfeed-no-images.sh manually')
else:
    print('news ok')
PY
fi

echo "== 3. npm install canvas (anti-aliased fonts) =="
if command -v npm >/dev/null 2>&1; then
  npm install canvas@^2.11.2 --save 2>&1 | tail -20 || echo "WARN: canvas install failed — bitmap font remains until canvas builds"
else
  echo "npm not available here — install canvas on the host: npm install canvas"
fi

echo ""
echo "Done. All visuals that use pixelArt drawText() get HQ fonts when canvas loads."
echo "  git add -A && git commit -m 'HQ fonts for all visuals via canvas' && git push"
echo "Restart the bot after npm install succeeds."
