#!/usr/bin/env bash
# Remove all images from newsfeed embeds (keep title/body/links).
set -euo pipefail
python3 << 'PY'
from pathlib import Path
p = Path('utils/newsFeed.js')
t = p.read_text()

old = '''  // Banner priority: the video's thumbnail, then the linked page's own share
  // image, then whatever picture the article itself carries — so a link that
  // turns out to have no banner never loses the image slot. Capped, because
  // none of it is worth making the headline late; see PICTURE_BUDGET_MS.
  const pictureUrl = await withBudget(resolvePicture(item, source), PICTURE_BUDGET_MS);
  const picture = isValidUrl(pictureUrl) ? pictureUrl : null;

  const embed = messageStyle.build(guildId, key, {
    thumbnailURL: picture,
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

  // The picture belongs across the card unless the catalogue's thumbnail
  // switch says otherwise — a chart or a video still is the story, not
  // decoration in the corner.
  let attachment = null;
  if (picture && !messageStyle.styleFor(guildId, key).thumbnail) {
    try { embed.setImage(picture); } catch { /* a URL Discord refuses is not worth the card */ }
  } else if (!picture) {
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
  }
  return { embed, attachment };
}'''

new = '''  // Text-only embeds — no image, thumbnail, or generated card.
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

  // Strip any image/thumbnail the style catalogue might still set
  try { embed.setImage(null); } catch { /* */ }
  try { embed.setThumbnail(null); } catch { /* */ }

  return { embed, attachment: null };
}'''

if old in t:
    t = t.replace(old, new, 1)
    print('newsfeed images removed')
elif 'Text-only embeds' in t:
    print('already text-only')
else:
    raise SystemExit('pattern not found — abort')

Path('utils/newsFeed.js').write_text(t)
assert 'setImage(picture)' not in t or 'Text-only' in t
print('OK')
PY
