#!/bin/bash
set -e
cd "$(dirname "$0")/.." || exit 1
echo "Restoring web/public/app.js from dcd03bc + paren fix..."
git fetch origin
git show dcd03bc:web/public/app.js > web/public/app.js
python3 -c "
from pathlib import Path
p = Path('web/public/app.js')
t = p.read_text()
bad = \"imgRow.append(el('label', null, 'Optional image (full quality)');\"
good = \"imgRow.append(el('label', null, 'Optional image (full quality)'));\"
if bad in t:
    t = t.replace(bad, good)
    p.write_text(t)
    print('paren fixed')
elif good in t:
    print('paren already ok')
else:
    print('WARN: image label pattern not found')
"
node --check web/public/app.js
echo "OK — commit and push:"
echo "  git add web/public/app.js && git commit -m 'FIX: restore app.js (Loading screen)' && git push origin main"
