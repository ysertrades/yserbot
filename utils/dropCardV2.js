'use strict';

/**
 * Components V2 drop cards.
 * IS_COMPONENTS_V2 = 1 << 15
 */

const IS_COMPONENTS_V2 = 1 << 15;
const ACCENT = 0x9397EE;

function text(content) {
  return { type: 10, content: String(content).slice(0, 4000) };
}
function separator(divider = true) {
  return { type: 14, divider: !!divider, spacing: 1 };
}
function button({ customId, label, style = 1, emoji }) {
  const b = { type: 2, style, label, custom_id: customId };
  if (emoji) b.emoji = typeof emoji === 'string' ? { name: emoji } : emoji;
  return b;
}
function row(...buttons) {
  return { type: 1, components: buttons };
}
function media(url) {
  if (!url || !/^https:\/\//i.test(url)) return null;
  // Full-width gallery is Discord's only image size in V2; order keeps it under the stats.
  return { type: 12, items: [{ media: { url } }] };
}
function sectionWithThumb(content, iconUrl) {
  if (!iconUrl) return text(content);
  return {
    type: 9,
    components: [text(content)],
    accessory: { type: 11, media: { url: iconUrl } },
  };
}
function container(children, accent = ACCENT) {
  return { type: 17, accent_color: accent, components: children.filter(Boolean) };
}
function line(label, value) {
  return label + ': **' + value + '**';
}

function buildLiveV2({
  prize, winnersCount, ends, endsAt, entries,
  requirements = [], dropId, iconUrl = null, imageUrl = null,
  brand = 'Quantlab',
}) {
  const req = requirements.length ? '\n\n' + requirements.join('\n') : '';
  const body =
    line('Prize', prize) + '\n' +
    line('Winners', winnersCount) + '\n' +
    line('Ends', ends) + '\n' +
    line('Entries', entries) +
    req;

  const kids = [];
  // 1) Title + stats (server icon as small thumbnail)
  kids.push(sectionWithThumb('# ' + brand + ' Giveaway\n\n' + body, iconUrl));
  // 2) Banner under stats (not under the button)
  const gallery = media(imageUrl);
  if (gallery) kids.push(gallery);
  // 3) Divider + Enter
  kids.push(separator(true));
  kids.push(row(
    button({
      customId: 'giveaway_enter', label: 'Enter', style: 1, emoji: '🎁',
    }),
    button({
      customId: 'giveaway_check', label: 'Check entry', style: 2, emoji: '🎟️',
    }),
  ));
  // 4) Divider + footer
  kids.push(separator(true));
  kids.push(text('-# Drop ID: QL-' + dropId + '  ·  ends ' + endsAt));

  return { flags: IS_COMPONENTS_V2, components: [container(kids)], embeds: [], content: null };
}

function buildClosedV2({
  prize, entries, winnersCount, hostId, dropId,
  iconUrl = null, imageUrl = null, brand = 'Quantlab',
}) {
  const n = Number(winnersCount) || 1;
  const selectedLine = n === 1
    ? 'The winner has been selected. Reveal to see if you won.'
    : 'The winners have been selected. Reveal to see if you won.';
  const winnersLabel = n === 1 ? 'Winner' : 'Winners';
  const body =
    selectedLine + '\n\n' +
    line('Valid entries', entries) + '  ·  ' + line(winnersLabel, n);
  const host = hostId ? '<@' + hostId + '>' : brand;

  const kids = [];
  kids.push(sectionWithThumb('# GIVEAWAY HAS ENDED 🎉\n\n' + body, iconUrl));
  const gallery = media(imageUrl);
  if (gallery) kids.push(gallery);
  kids.push(separator(true));
  kids.push(row(button({
    customId: 'giveaway_reveal', label: 'Reveal', style: 3, emoji: '🎁',
  })));
  kids.push(separator(true));
  kids.push(text('-# Giveaway provided by ' + host + '  ·  Drop ID: QL-' + dropId));

  return { flags: IS_COMPONENTS_V2, components: [container(kids)], embeds: [], content: null };
}

module.exports = { IS_COMPONENTS_V2, buildLiveV2, buildClosedV2 };
