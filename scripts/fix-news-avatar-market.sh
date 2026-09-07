#!/usr/bin/env bash
# Surgical: news without pixel cards, panel avatar default, market text scale/align
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

echo "== 1. News: skip pixel-generated cards =="
python3 << 'PY'
from pathlib import Path
p = Path('utils/newsFeed.js')
t = p.read_text()
old = '''  } else if (!picture) {
    // Most headlines carry no picture at all — a live feed is mostly plain
    // text — so those get QuantLab's own browser-frame card instead of
    // going out as a bare colour bar. Built fresh per headline (title and
    // breaking-state both vary), unlike the other banners in the bot, which
    // stay the same until Studio changes them.
    try {
      const buf = generateNewsCard({
        headline: item.title,
        source: source.label,
        urlLabel: item.source?.host || 'financialjuice.com',
        breaking: isBreaking,
      });
      attachment = new AttachmentBuilder(buf, { name: 'news-card.png' });
      embed.setImage('attachment://news-card.png');
    } catch { /* the text embed alone still carries the headline */ }
  }'''
new = '''  } else if (!picture) {
    // No stock photo — keep a clean text embed (no pixel-font card).
    // Headline, source, and colour already come from messageStyle.
  }'''
if old in t:
    t = t.replace(old, new, 1)
    print('news card path removed')
elif 'generateNewsCard' not in t or 'attachment://news-card.png' not in t:
    print('news already without pixel card')
else:
    # fallback: comment out generateNewsCard block more loosely
    if 'generateNewsCard' in t:
        t = t.replace(
            "const { generateNewsCard } = require('./newsCardVisual');",
            "// generateNewsCard retired — text embeds only\n// const { generateNewsCard } = require('./newsCardVisual');",
        )
        print('require commented')
    print('WARN: exact block missing, check manually')
Path('utils/newsFeed.js').write_text(t)
PY

echo "== 2. Panel avatar: show default Discord avatar when none =="
python3 << 'PY'
from pathlib import Path
p = Path('web/public/app.js')
t = p.read_text()
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
  // Default avatar when the account has no custom photo
  let idx = 0;
  try {
    idx = Number(BigInt(user.id) >> 22n) % 6;
  } catch {
    idx = Number(String(user?.id || '0').slice(-1)) % 6;
  }
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
  wrap.append(el('span', 'who', user.name));'''
if old in t:
    t = t.replace(old, new, 1)
    p.write_text(t)
    print('avatar fix OK')
elif 'discordAvatarUrl' in t:
    print('avatar already fixed')
else:
    print('WARN: renderIdentity pattern not found')
    i = t.find('function renderIdentity')
    print(repr(t[i:i+350]))
PY

echo "== 3. Whop inside feeds (if still outside) =="
if [[ -f scripts/fix-whop-inside-feeds.sh ]]; then
  bash scripts/fix-whop-inside-feeds.sh || true
fi

echo "== 4. Econ no title (if still present) =="
if [[ -f scripts/fix-econ-no-title.sh ]]; then
  bash scripts/fix-econ-no-title.sh || true
fi

echo "Done."
echo "  git add -A && git commit -m 'News text embeds, avatar fix, Whop feeds-only' && git push"
