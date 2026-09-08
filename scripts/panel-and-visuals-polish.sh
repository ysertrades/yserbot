#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

echo "== 1. Build quantbotLogo.js from Quantbot.jpg if present =="
python3 << 'PY'
from pathlib import Path
import base64, io
candidates = [
    Path('Quantbot.jpg'), Path('quantbot.jpg'), Path('web/public/quantbot.jpg'),
    Path('/home/workdir/attachments/Quantbot.jpg'),
]
src = next((p for p in candidates if p.exists()), None)
out = Path('utils/quantbotLogo.js')
if src is None:
    if out.exists() and 'Buffer.from' in out.read_text() and 'placeholder' not in out.read_text():
        print('logo module already present')
    else:
        print('WARN: place Quantbot.jpg in repo root then re-run this script')
        out.write_text("'use strict';\nmodule.exports = { png64: null, png256: null, dataUri64: '' };\n")
else:
    try:
        from PIL import Image
    except ImportError:
        import subprocess, sys
        subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'pillow', '-q'])
        from PIL import Image
    im = Image.open(src).convert('RGBA')
    w, h = im.size
    s = min(w, h)
    im = im.crop(((w - s) // 2, (h - s) // 2, (w + s) // 2, (h + s) // 2))
    buf = io.BytesIO()
    im.resize((128, 128), Image.Resampling.LANCZOS).save(buf, format='PNG', optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode()
    content = (
        "'use strict';\n"
        "/** Quantbot mascot (embedded PNG). */\n"
        "const BUF = Buffer.from('" + b64 + "', 'base64');\n"
        "module.exports = { png64: BUF, png256: BUF, dataUri64: 'data:image/png;base64," + b64 + "' };\n"
    )
    out.write_text(content)
    Path('web/public/quantbot.png').write_bytes(buf.getvalue())
    print('logo embedded from', src)
PY

echo "== 2. Panel brand mark -> Quantbot =="
python3 << 'PY'
from pathlib import Path
p = Path('web/public/index.html')
t = p.read_text()
old = '''  <div class="brand">
    <svg class="mark" viewBox="0 0 26 26" aria-hidden="true" focusable="false">
      <rect x="0.5" y="0.5" width="25" height="25" rx="7"></rect>
      <g class="y"><path d="M7 15.5 11 11l3 3 5-6"></path></g>
    </svg>
    <span class="wordmark">quantlab</span>'''
new = '''  <div class="brand">
    <img class="mark" src="/quantbot.png" width="26" height="26" alt="" decoding="async">
    <span class="wordmark">quantlab</span>'''
if old in t:
    t = t.replace(old, new, 1)
    print('brand mark -> img')
elif '<img class="mark"' in t:
    print('brand already img')
else:
    print('WARN brand')
Path('web/public/index.html').write_text(t)
PY

echo "== 3. Remove verification panels =="
python3 << 'PY'
from pathlib import Path
import re
p = Path('web/public/index.html')
t = p.read_text()
t, n1 = re.subn(r'\s*<article class="panel">\s*<h2>Verification</h2>[\s\S]*?<form id="form-verify"[\s\S]*?</article>', '', t, count=1)
t, n2 = re.subn(r'\s*<div class="panel">\s*<h2>Post the verification panel</h2>[\s\S]*?<form id="form-verifypanel"[\s\S]*?</div>', '', t, count=1)
Path('web/public/index.html').write_text(t)
print('removed verify blocks', n1, n2)
PY

echo "== 4. Skip verify command + feature toggle =="
python3 << 'PY'
from pathlib import Path
import re
p = Path('utils/featureToggles.js')
t = p.read_text()
t2, n = re.subn(r"\s*\{\s*key: 'verification'[\s\S]*?\},", '', t, count=1)
if n:
    Path('utils/featureToggles.js').write_text(t2)
    print('toggle removed')
else:
    print('toggle skip')
v = Path('commands/utility/verify.js')
if v.exists():
    v.write_text(
        "'use strict';\n"
        "const { SlashCommandBuilder, MessageFlags } = require('discord.js');\n"
        "module.exports = {\n"
        "  data: new SlashCommandBuilder().setName('verify').setDescription('(Retired) Verification removed.'),\n"
        "  async execute(i) {\n"
        "    await i.reply({ content: 'Member verification has been removed from this bot.', flags: MessageFlags.Ephemeral });\n"
        "  },\n"
        "};\n"
    )
    print('verify command retired')
PY

echo "== 5. Studio banners prize-only =="
python3 << 'PY'
from pathlib import Path
import re
p = Path('utils/bannerCopy.js')
t = p.read_text()
new = "const BANNERS = {\n  prize: { label: 'Prize giveaway', dynamicKey: 'prizeGiveawayBanner', defaults: PRIZE_DEFAULTS },\n};"
t2, n = re.subn(r'const BANNERS = \{[\s\S]*?\};', new, t, count=1)
if n:
    p.write_text(t2)
    print('BANNERS prize-only')
else:
    print('WARN banners')
PY

echo "== 6. contentSeed stop TV/whop =="
python3 << 'PY'
from pathlib import Path
p = Path('utils/contentSeed.js')
t = p.read_text()
for key in ["'tradingview-banner':", "'whop-banner':"]:
    pos = t.find(key)
    if pos >= 0 and '// retired' not in t[max(0, pos-30):pos]:
        t = t.replace(key, '// retired ' + key + ' ', 1)
p.write_text(t)
print('seed updated')
PY

echo "== 7. pixelArt AA circles =="
python3 << 'PY'
from pathlib import Path
p = Path('utils/pixelArt.js')
t = p.read_text()
if 'fillCircleAA' in t:
    print('exists')
else:
    inject = '''
function fillCircleAA(png, cx, cy, r, color, alpha = 1) {
  const x0 = Math.floor(cx - r - 1), y0 = Math.floor(cy - r - 1);
  const x1 = Math.ceil(cx + r + 1), y1 = Math.ceil(cy + r + 1);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    if (d > r + 0.6) continue;
    let a = d > r - 0.5 ? Math.max(0, r + 0.5 - d) : 1;
    if (a < 0.02) continue;
    setPxBlend(png, x, y, color, alpha * a);
  }
}
function strokeCircleAA(png, cx, cy, r, color, alpha = 1, thickness = 2) {
  const x0 = Math.floor(cx - r - thickness - 1), y0 = Math.floor(cy - r - thickness - 1);
  const x1 = Math.ceil(cx + r + thickness + 1), y1 = Math.ceil(cy + r + thickness + 1);
  const inner = r - thickness / 2, outer = r + thickness / 2;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    if (d < inner - 0.6 || d > outer + 0.6) continue;
    let a = 1;
    if (d < inner + 0.5) a = Math.max(0, d - (inner - 0.5));
    else if (d > outer - 0.5) a = Math.max(0, outer + 0.5 - d);
    if (a < 0.02) continue;
    setPxBlend(png, x, y, color, alpha * Math.min(1, a));
  }
}
'''
    t = t.replace('module.exports = {', inject + 'module.exports = {', 1)
    t = t.replace(
        'fillRect, fillRectBlend, line, dot, dotBlend, ringBlend, ringStroke,',
        'fillRect, fillRectBlend, line, dot, dotBlend, ringBlend, ringStroke, fillCircleAA, strokeCircleAA,',
        1,
    )
    p.write_text(t)
    print('AA added')
PY

echo "== 8. Prize banner quantbot under gift =="
python3 << 'PY'
from pathlib import Path
import re
p = Path('utils/prizeGiveawayVisual.js')
t = p.read_text()
if 'quantbotLogo' not in t:
    t = t.replace(
        "const { drawFlowLattice, drawFlowSignature, signatureWidth } = require('./brandSignature');",
        "const { drawFlowLattice } = require('./brandSignature');\nconst quantbotLogo = require('./quantbotLogo');",
    )
if 'function blitLogo' not in t:
    helper = '''
function blitLogo(dest, dx, dy, size) {
  try {
    if (!quantbotLogo.png256) return;
    const src = PNG.sync.read(quantbotLogo.png256);
    const scale = size / Math.max(src.width, src.height);
    const dw = Math.round(src.width * scale), dh = Math.round(src.height * scale);
    for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
      const sx = Math.min(src.width - 1, Math.floor(x / scale));
      const sy = Math.min(src.height - 1, Math.floor(y / scale));
      const i = (src.width * sy + sx) << 2;
      const a = src.data[i + 3] / 255;
      if (a < 0.05) continue;
      setPxBlend(dest, dx + x, dy + y, [src.data[i], src.data[i + 1], src.data[i + 2], 255], a);
    }
  } catch { /* optional */ }
}
'''
    t = t.replace('function giftBox', helper + 'function giftBox', 1)
t2, n = re.subn(r'drawFlowSignature\([^;]+;', 'blitLogo(png, 140, 300, 72);', t, count=1)
if n:
    t = t2
    print('logo under gift')
else:
    print('signature replace skip')
Path('utils/prizeGiveawayVisual.js').write_text(t)
PY

echo "== 9. CSS =="
python3 << 'PY'
from pathlib import Path
p = Path('web/public/app.css')
t = p.read_text()
if 'img.mark' not in t:
    t += '''
.brand img.mark {
  width: 26px; height: 26px; border-radius: 7px;
  object-fit: cover; display: block; flex: none;
}
.demb img.big, .gaw-preview img, .stage-frame img {
  image-rendering: auto;
  image-rendering: high-quality;
}
'''
    p.write_text(t)
    print('css ok')
else:
    print('css already')
PY

echo ""
echo "Done."
echo "  git add -A && git commit -m 'Panel Quantbot logo, verification off, prize-only studio, AA shapes'"
echo "  git push && restart"
