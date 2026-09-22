#!/bin/bash
set -e
cd /workspaces/yserbot
git pull origin main
cat scripts/tgz-part-*.b64 | tr -d '\n' | base64 -d > quantlab-xp-v2.tgz
tar xzf quantlab-xp-v2.tgz
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
git add utils/levelingEngine.js events/messageCreate.js events/threadCreate.js utils/featureToggles.js web/features.js web/writes.js web/public/leveling-ui.js web/public/glass-v2.css web/public/index.html web/public/app.js
git commit -m "XP v2: contribution-weighted leveling + Leveling panel" || true
git pull --rebase origin main
git push origin main
echo DONE
