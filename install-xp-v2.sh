#!/bin/bash
set -e
cd /workspaces/yserbot
git pull origin main
# Unpack pack (place quantlab-xp-v2.tgz in /tmp first, or same folder)
PACK="${1:-/tmp/quantlab-xp-v2.tgz}"
if [ ! -f "$PACK" ]; then
  echo "Missing $PACK — download quantlab-xp-v2.tgz and pass path"
  exit 1
fi
tar xzf "$PACK" -C /workspaces/yserbot
# Surgical app.js patches
python3 << 'PY'
from pathlib import Path
app = Path('web/public/app.js')
t = app.read_text()
if "hide(nav('leveling')" not in t:
    t = t.replace(
        "hide(nav('tickets'), tixOff);\n\n  // Calendar panels only",
        "hide(nav('tickets'), tixOff);\n  hide(nav('leveling'), lvlOff);\n\n  // Calendar panels only",
        1,
    )
    t = t.replace(
        "|| (sec === 'tickets' && tixOff)) {",
        "|| (sec === 'tickets' && tixOff)\n      || (sec === 'leveling' && lvlOff)) {",
        1,
    )
t = t.replace(
    'function renderLevels() { /* leveling removed */ }',
    'function renderLevels() { try { if (typeof window.renderLeveling === "function") window.renderLeveling(); } catch {} }',
)
app.write_text(t)
print('app.js patched')
PY
node --check utils/levelingEngine.js
node --check events/messageCreate.js
node --check web/writes.js
node --check web/features.js
git add utils/levelingEngine.js events/messageCreate.js events/threadCreate.js utils/featureToggles.js \
  web/features.js web/writes.js web/public/leveling-ui.js web/public/glass-v2.css web/public/index.html web/public/app.js
git status
git commit -m "XP v2: contribution-weighted leveling engine + Leveling panel tab"
git push origin main
echo DONE — restart the bot
