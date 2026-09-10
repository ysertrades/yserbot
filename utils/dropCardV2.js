use strict';

/**
 * Components V2 drop cards (Syncie-style).
 * Flag IS_COMPONENTS_V2 = 1 << 15 — no classic embeds on the same message.
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
  return {
    type: 17,
    accent_color: accent,
    components: children.filter(Boolean),
  };
}

/** Label plain, value bold, always "Label: **value**" */
function line(label, value) {
  return `${label}: **${value}**`;
}

function buildLiveV2({
  prize,
  winnersCount,
  ends,
  endsAt,
  entries,
  requirements = [],
  dropId,
  iconUrl = null,
  imageUrl = null,
}) {
  const req = requirements.length ? `\n\n${requirements.join('\n')}` : '';
  // No duplicate prize under the title — only the labeled rows
  const body =
    `${line('Prize', prize)}\n` +
    `${line('Winners', winnersCount)}\n` +
    `${line('Ends', ends)}\n` +
    `${line('Entries', entries)}` +
    req;

  const kids = [];
  const gallery = media(imageUrl);
  if (gallery) kids.push(gallery);
  kids.push(sectionWithThumb(`# Quantlab Giveaway\n\n${body}`, iconUrl));
  kids.push(separator(true));
  kids.push(row(button({
    customId: 'giveaway_enter',
    label: 'Enter drop',
    style: 1,
    emoji: '🎁',
  })));
  kids.push(text(`-# Drop ID: QL-${dropId}  ·  ends ${endsAt}`));

  return {
    flags: IS_COMPONENTS_V2,
    components: [container(kids)],
    embeds: [],
    content: null,
  };
}

function buildClosedV2({
  prize,
  entries,
  winnersCount,
  hostId,
  dropId,
  iconUrl = null,
  imageUrl = null,
}) {
  const body =
    `The winners have been selected. Open the box to reveal your personal result.\n\n` +
    `${line('Valid entries', entries)}  ·  ${line('Winners', winnersCount)}`;
  const host = hostId ? `<@${hostId}>` : 'quantlab';

  const kids = [];
  const gallery = media(imageUrl);
  if (gallery) kids.push(gallery);
  kids.push(sectionWithThumb(`# THE DROP HAS LANDED 🎉\n\n${body}`, iconUrl));
  kids.push(separator(true));
  kids.push(row(button({
    customId: 'giveaway_reveal',
    label: 'Reveal',
    style: 3,
    emoji: '🎁',
  })));
  kids.push(text(`-# Drop provided by ${host}  ·  Drop ID: QL-${dropId}`));

  return {
    flags: IS_COMPONENTS_V2,
    components: [container(kids)],
    embeds: [],
    content: null,
  };
}

module.exports = { IS_COMPONENTS_V2, buildLiveV2, buildClosedV2 };
