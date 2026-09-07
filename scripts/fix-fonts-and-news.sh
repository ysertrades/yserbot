#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

echo "== 1. pixelArt: prefer @napi-rs/canvas =="
python3 << 'PY'
from pathlib import Path
p = Path('utils/pixelArt.js')
t = p.read_text()
old = "try { _Canvas = require('canvas'); } catch { /* optional dependency */ }"
new = """try { _Canvas = require('@napi-rs/canvas'); }
catch {
  try { _Canvas = require('canvas'); } catch { /* optional */ }
}"""
if old in t:
    t = t.replace(old, new, 1)
    print('napi-rs require OK')
elif '@napi-rs/canvas' in t:
    print('already napi-rs')
else:
    print('WARN: canvas require line not found')
Path('utils/pixelArt.js').write_text(t)
PY

echo "== 2. Newsfeed: never attach images =="
python3 << 'PY'
from pathlib import Path
p = Path('utils/newsFeed.js')
t = p.read_text()

# Replace entire image section with text-only
import re

# Pattern from picture resolution through return
pat = r"  // Banner priority:.*?return \{ embed, attachment \};"
new = '''  // Text-only embeds — no image or thumbnail (brand decision).
  const embed = messageStyle.build(guildId, key, {
    tokens: {
      headline: item.title,
      text: item.body && item.body !== item.title ? item.body : '',
      url: headlineUrl || '',
      source: source.label,
      via: item.source?.host || '',
      readmore, context,
    },
  });
  if (!embed) return null;
  try { if (typeof embed.setImage === 'function') embed.setImage(null); } catch { /* */ }
  try { if (typeof embed.setThumbnail === 'function') embed.setThumbnail(null); } catch { /* */ }
  return { embed, attachment: null };'''

t2, n = re.subn(pat, new, t, count=1, flags=re.S)
if n:
    Path('utils/newsFeed.js').write_text(t2)
    print('newsfeed text-only OK')
elif 'Text-only embeds' in t and 'setImage(picture)' not in t:
    print('newsfeed already text-only')
else:
    # looser fix: remove setImage(picture) lines and thumbnailURL
    t = t.replace('thumbnailURL: picture,', '')
    t = re.sub(r"if \(picture && !messageStyle\.styleFor\(guildId, key\)\.thumbnail\) \{[\s\S]*?\}\n", '', t, count=1)
    t = t.replace('  const pictureUrl = await withBudget(resolvePicture(item, source), PICTURE_BUDGET_MS);\n  const picture = isValidUrl(pictureUrl) ? pictureUrl : null;\n\n', '')
    Path('utils/newsFeed.js').write_text(t)
    print('newsfeed loose fix applied')
PY

echo "== 3. Install @napi-rs/canvas (prebuilds, no node-gyp) =="
npm uninstall canvas 2>/dev/null || true
npm install @napi-rs/canvas@^0.1.65 --save 2>&1 | tail -25

echo ""
echo "Verify:"
node -e "try{require('@napi-rs/canvas');console.log('canvas OK')}catch(e){console.log('canvas FAIL',e.message)}"
echo ""
echo "Then: git add package.json package-lock.json utils/pixelArt.js utils/newsFeed.js"
echo "      git commit -m 'napi-rs canvas fonts + news text-only' && git push"
echo "Do NOT commit node_modules. Restart the bot after install."
