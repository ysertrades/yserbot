#!/usr/bin/env bash
# Careful, surgical updates only. Does not touch panel layout broadly,
# does not rewrite ready.js deploy, does not touch unrelated files.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

echo "== 1. Whop only via Feeds forms =="
bash scripts/whop-feeds-only.sh

echo "== 2. Econ High/Medium text embeds =="
python3 << 'PY'
from pathlib import Path
t = Path('utils/econCalRunner.js').read_text()
if 'PLACEHOLDER' in t or len(t) < 500:
    raise SystemExit('econCalRunner.js looks broken — abort')
if "require('./econEmbed')" not in t:
    if "require('./econEventVisual')" not in t:
        raise SystemExit('econEventVisual require missing')
    t = t.replace(
        "const { generateEconEventCard } = require('./econEventVisual');",
        "const { generateEconEventCard } = require('./econEventVisual');\nconst econEmbed = require('./econEmbed');",
    )
old = """function buildEventEmbed(key, e, guild, tokens, timeLabel) {
  const embed = messageStyle.build(guild.id, key, {
    color: impactColor(guild.id, e.impact),
    tokens,
  });
  if (!embed) return null;
  const attachment = buildEventCard(e, timeLabel);
  try { embed.setImage(`attachment://${attachment.name}`); } catch { /* card still sends without it */ }
  return { embed, files: [attachment] };
}"""
new = """function buildEventEmbed(key, e, guild, tokens, timeLabel) {
  if (e.impact === 'High' || e.impact === 'Medium') {
    const title = key === 'econ.reminder'
      ? ('Reminder · in ' + tokens.minutes + 'm')
      : 'News Update';
    const embed = econEmbed.buildSingleEventEmbed(guild.id, e, {
      title,
      footer: 'quantlab · economic calendar',
    });
    if (!embed) return null;
    try {
      const c = impactColor(guild.id, e.impact);
      if (c) embed.setColor(c);
    } catch { /* */ }
    return { embed, files: [] };
  }
  const embed = messageStyle.build(guild.id, key, {
    color: impactColor(guild.id, e.impact),
    tokens,
  });
  if (!embed) return null;
  const attachment = buildEventCard(e, timeLabel);
  try { embed.setImage(`attachment://${attachment.name}`); } catch { /* */ }
  return { embed, files: [attachment] };
}"""
if 'econEmbed.buildSingleEventEmbed' in t and old not in t:
    print('econ buildEventEmbed already patched')
elif old in t:
    t = t.replace(old, new, 1)
    print('econ buildEventEmbed OK')
else:
    raise SystemExit('econ buildEventEmbed pattern missing')

old_w = """    const attachment = buildEventCard(e, fmtEventTime(e));
    curFiles.push(attachment);
    const embed = createEmbed('info', { color: cardColor, image: `attachment://${attachment.name}` });
    embed.setTimestamp(null);
    curEmbeds.push(embed);"""
new_w = """    if (e.impact === 'High' || e.impact === 'Medium') {
      const te = econEmbed.buildSingleEventEmbed(guild.id, e, {
        title: 'News Update',
        footer: 'quantlab · economic calendar',
      });
      if (te) {
        try { te.setColor(impactColor(guild.id, e.impact)); } catch { /* */ }
        curEmbeds.push(te);
      }
    } else {
      const attachment = buildEventCard(e, fmtEventTime(e));
      curFiles.push(attachment);
      const embed = createEmbed('info', { color: cardColor, image: `attachment://${attachment.name}` });
      embed.setTimestamp(null);
      curEmbeds.push(embed);
    }"""
if old_w in t:
    t = t.replace(old_w, new_w, 1)
    print('econ weekly OK')
elif "e.impact === 'High'" in t:
    print('econ weekly already')
else:
    raise SystemExit('econ weekly pattern missing')
Path('utils/econCalRunner.js').write_text(t)
assert 'PLACEHOLDER' not in t
print('econCalRunner size', len(t))
PY

if [[ ! -f utils/econEmbed.js ]]; then
  echo "ERROR: utils/econEmbed.js missing — pull main first"
  exit 1
fi

echo "== 3. News card: remove window chrome =="
python3 << 'PY'
from pathlib import Path
import re
n = Path('utils/newsCardVisual.js').read_text()
n = re.sub(r'for \(let i = 0; i < 3; i\+\+\)[^\n]*TRAFFIC[^\n]*\n', '', n)
n = re.sub(r'\n  const urlText = [\s\S]*?drawText\(png, urlText[\s\S]*?\);\n', '\n', n, count=1)
n = n.replace('const chromeH = 46;', 'const chromeH = 8; // no window traffic-lights')
Path('utils/newsCardVisual.js').write_text(n)
print('news chrome stripped', 'TRAFFIC[i]' not in n)
PY

echo "== 4. writes: await featuretoggles save =="
python3 << 'PY'
from pathlib import Path
w = Path('web/writes.js').read_text()
old = 'const r = featureToggles.save(guildId, body);'
new = 'const r = await featureToggles.save(guildId, body, ctx);'
if old in w:
    Path('web/writes.js').write_text(w.replace(old, new, 1))
    print('writes await OK')
elif 'await featureToggles.save' in w:
    print('writes already awaits')
else:
    print('WARN: featuretoggles line not found')
PY

echo ""
echo "Done. Commit:"
echo "  git add -A && git commit -m 'Safe: econ text, news chrome, feature cmds, Whop feeds-only' && git push"
