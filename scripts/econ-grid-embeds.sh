#!/usr/bin/env bash
# Wire econCalRunner to grid embeds (max 3 per row).
set -euo pipefail
python3 << 'PY'
from pathlib import Path
p = Path('utils/econCalRunner.js')
t = p.read_text()
if 'PLACEHOLDER' in t or len(t) < 500:
    raise SystemExit('econCalRunner.js looks broken')

# 1) buildEventEmbed for High/Medium — single still uses grid helper
old_be = '''function buildEventEmbed(key, e, guild, tokens, timeLabel) {
  if (e.impact === 'High' || e.impact === 'Medium') {
    const embed = econEmbed.buildSingleEventEmbed(guild.id, e);
    if (!embed) return null;
    try {
      const c = impactColor(guild.id, e.impact);
      if (c) embed.setColor(c);
    } catch { /* */ }
    return { embed, files: [] };
  }'''

new_be = '''function buildEventEmbed(key, e, guild, tokens, timeLabel) {
  if (e.impact === 'High' || e.impact === 'Medium') {
    const mode = key === 'econ.reminder' ? 'reminder' : key === 'econ.release' ? 'release' : 'day';
    const embed = econEmbed.buildSingleEventEmbed(guild.id, e, {
      mode,
      minutes: tokens && tokens.minutes,
    });
    if (!embed) return null;
    return { embed, files: [] };
  }'''

if old_be in t:
    t = t.replace(old_be, new_be, 1)
    print('buildEventEmbed OK')
elif "mode = key === 'econ.reminder'" in t:
    print('buildEventEmbed already')
else:
    print('WARN buildEventEmbed pattern')

# 2) Replace weekly summary body to use grid for High/Medium events
# Find buildWeeklySummaryEmbeds and inject smarter packing after header

marker = 'function buildWeeklySummaryEmbeds'
if marker not in t:
    raise SystemExit('buildWeeklySummaryEmbeds missing')

# Replace the per-event High/Medium branch with deferred collection —
# simpler: replace whole loop section

old_loop = '''  for (const e of capped) {
    const dayKey     = dayKeyOf(e);
    const dayChanged = multiDay && dayKey !== lastDayKey;
    const needed     = (dayChanged ? 1 : 0) + 1; // day header (maybe) + the event card itself

    if (curEmbeds.length + needed > MAX_EMBEDS_PER_MSG) flush();

    if (dayChanged) {
      const divider = buildDayHeaderEmbed(e, guild);
      if (divider) curEmbeds.push(divider);
      lastDayKey = dayKey;
    }

    if (e.impact === 'High' || e.impact === 'Medium') {
      const te = econEmbed.buildSingleEventEmbed(guild.id, e);
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
    }
  }
  flush();'''

new_loop = '''  // High / Medium → one grid embed (max 3 per row). Low stays as cards.
  const gridEvents = [];
  for (const e of capped) {
    if (e.impact === 'High' || e.impact === 'Medium') gridEvents.push(e);
  }
  const lowEvents = capped.filter(e => e.impact !== 'High' && e.impact !== 'Medium');

  if (gridEvents.length) {
    const mode = scope === 'week' ? 'week' : 'day';
    const grids = econEmbed.buildGridEmbeds(guild.id, gridEvents, { mode });
    for (const g of grids) {
      if (curEmbeds.length >= MAX_EMBEDS_PER_MSG) flush();
      curEmbeds.push(g);
    }
  }

  for (const e of lowEvents) {
    if (curEmbeds.length >= MAX_EMBEDS_PER_MSG) flush();
    const attachment = buildEventCard(e, fmtEventTime(e));
    curFiles.push(attachment);
    const embed = createEmbed('info', { color: cardColor, image: `attachment://${attachment.name}` });
    embed.setTimestamp(null);
    curEmbeds.push(embed);
  }
  flush();'''

if old_loop in t:
    t = t.replace(old_loop, new_loop, 1)
    print('weekly grid OK')
elif 'buildGridEmbeds' in t:
    print('weekly already grid')
else:
    print('WARN weekly loop pattern — check manually')

# 3) Batch releases in the same minute into one grid embed
# Look for release posting loop - optional enhancement via comment
if 'buildGridEmbeds' in t and 'Releasing now' not in t:
    pass  # single path uses buildEventEmbed which sets release mode

Path('utils/econCalRunner.js').write_text(t)
assert 'PLACEHOLDER' not in t
print('econCalRunner size', len(t))
PY
