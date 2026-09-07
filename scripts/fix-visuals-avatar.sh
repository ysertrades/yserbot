#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

echo "== News: remove pixel-font cards =="
python3 << 'PY'
from pathlib import Path
p = Path('utils/newsFeed.js')
t = p.read_text()
if "attachment://news-card.png" not in t:
    print('news already clean')
else:
    # Remove the else-if block that attaches generateNewsCard
    start = t.find('} else if (!picture) {')
    if start < 0:
        raise SystemExit('news block start not found')
    # find matching end: next '  return { embed, attachment };' after start
    end = t.find('  return { embed, attachment };', start)
    if end < 0:
        raise SystemExit('news block end not found')
    replacement = '''  } else if (!picture) {
    // No external photo — text embed only (no pixel-font card).
  }
'''
    t = t[:start] + replacement + t[end:]
    Path('utils/newsFeed.js').write_text(t)
    print('news pixel card removed')
PY

echo "== Panel avatar always visible =="
python3 << 'PY'
from pathlib import Path
p = Path('web/public/app.js')
t = p.read_text()
if 'function discordAvatarUrl' in t:
    print('avatar already fixed')
else:
    old = '''function renderIdentity(user) {
  const wrap = $('#bar-right');
  wrap.replaceChildren();
  if (user.avatar) {
    const img = el('img');
    img.src = `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`;
    img.alt = '';
    wrap.append(img);
  }
  wrap.append(el('span', 'who', user.name));'''
    new = '''function discordAvatarUrl(user) {
  if (user?.avatar) {
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`;
  }
  let idx = 0;
  try { idx = Number(BigInt(user.id) >> 22n) % 6; }
  catch { idx = Number(String(user?.id || '0').slice(-1)) % 6; }
  return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
}

function renderIdentity(user) {
  const wrap = $('#bar-right');
  wrap.replaceChildren();
  if (user) {
    const img = el('img');
    img.src = discordAvatarUrl(user);
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.onerror = () => { img.style.display = 'none'; };
    wrap.append(img);
  }
  wrap.append(el('span', 'who', user?.name || 'You'));'''
    if old not in t:
        raise SystemExit('renderIdentity pattern missing')
    Path('web/public/app.js').write_text(t.replace(old, new, 1))
    print('avatar fixed')
PY

echo "== Whop panel inside Feeds section =="
if [[ -f scripts/fix-whop-inside-feeds.sh ]]; then bash scripts/fix-whop-inside-feeds.sh || true; fi

echo "== Econ no News Update title =="
if [[ -f scripts/fix-econ-no-title.sh ]]; then bash scripts/fix-econ-no-title.sh || true; fi

echo ""
echo "All surgical fixes applied."
echo "  git add -A"
echo "  git commit -m 'News text embeds, avatar visible, Whop feeds-only'"
echo "  git push origin main"
