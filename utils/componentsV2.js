'use strict';

/**
 * Shared Discord Components V2 builders.
 * Same wire format as utils/dropCardV2.js (giveaways).
 */

const IS_COMPONENTS_V2 = 1 << 15;
const ACCENT_DEFAULT = 0x5865F2;

function text(content) {
  return { type: 10, content: String(content ?? '').slice(0, 4000) };
}

/** Real V2 horizontal separator (not ASCII dashes). */
function separator({ divider = true, spacing = 1 } = {}) {
  return { type: 14, divider: !!divider, spacing: spacing === 2 ? 2 : 1 };
}

function button({ customId, label, style = 1, emoji, url, disabled = false }) {
  const b = { type: 2, style: Number(style) || 1, disabled: !!disabled };
  if (label) b.label = String(label).slice(0, 80);
  if (url) {
    b.style = 5;
    b.url = String(url).slice(0, 512);
  } else if (customId) {
    b.custom_id = String(customId).slice(0, 100);
  }
  if (emoji) {
    b.emoji = typeof emoji === 'string'
      ? (/^\d{5,25}$/.test(emoji) ? { id: emoji } : { name: emoji })
      : emoji;
  }
  return b;
}

function row(...children) {
  return { type: 1, components: children.filter(Boolean).slice(0, 5) };
}

function stringSelect({ customId, placeholder, options, minValues = 1, maxValues = 1 }) {
  const opts = (options || []).slice(0, 25).map((o) => {
    const out = {
      label: String(o.label || o.value || 'Option').slice(0, 100),
      value: String(o.value || o.label || 'opt').slice(0, 100),
    };
    if (o.description) out.description = String(o.description).slice(0, 100);
    if (o.emoji) {
      out.emoji = typeof o.emoji === 'string'
        ? (/^\d{5,25}$/.test(o.emoji) ? { id: o.emoji } : { name: o.emoji })
        : o.emoji;
    }
    if (o.default) out.default = true;
    return out;
  });
  return {
    type: 3,
    custom_id: String(customId).slice(0, 100),
    placeholder: String(placeholder || 'Select…').slice(0, 150),
    min_values: Math.max(0, Math.min(25, minValues)),
    max_values: Math.max(1, Math.min(25, maxValues)),
    options: opts.length ? opts : [{ label: '—', value: '_none' }],
  };
}

function media(url) {
  if (!url) return null;
  const u = String(url);
  if (!/^https:\/\//i.test(u) && !/^attachment:\/\//i.test(u)) return null;
  return { type: 12, items: [{ media: { url: u } }] };
}

function sectionWithThumb(content, iconUrl) {
  if (!iconUrl) return text(content);
  return {
    type: 9,
    components: [text(content)],
    accessory: { type: 11, media: { url: iconUrl } },
  };
}

function container(children, accent = ACCENT_DEFAULT) {
  return {
    type: 17,
    accent_color: typeof accent === 'number' ? accent : ACCENT_DEFAULT,
    components: (children || []).filter(Boolean),
  };
}

function payload(topLevel, { accent } = {}) {
  const comps = (topLevel || []).filter(Boolean);
  const looksNested = comps.some((c) => c && (c.type === 17 || c.type === 1));
  const components = looksNested ? comps : [container(comps, accent)];
  return {
    flags: IS_COMPONENTS_V2,
    components,
    embeds: [],
    content: undefined,
  };
}

/**
 * Ticket panel — matches the reference layout:
 * Title → separator → description → separator → topic dropdown
 */
function buildTicketPanelV2({
  title = 'OPEN A TICKET',
  description = 'A private channel with staff. Just you and us.',
  placeholder = 'Select a topic to open a ticket',
  topics = null,
  accent = ACCENT_DEFAULT,
} = {}) {
  const defaults = [
    { value: 'billing', label: 'Billing', description: 'Plans, payments, Whop', emoji: '💳' },
    { value: 'access', label: 'Access', description: "Roles, channels you can't see", emoji: '🔑' },
    { value: 'tech', label: 'Tech issue', description: 'Something broken', emoji: '🛠️' },
    { value: 'other', label: 'Other', description: 'Anything else', emoji: '📁' },
  ];
  const opts = Array.isArray(topics) && topics.length ? topics : defaults;

  const kids = [];
  const t = String(title || '').trim();
  kids.push(text(t.startsWith('#') ? t : `# ${t || 'OPEN A TICKET'}`));
  kids.push(separator({ divider: true, spacing: 1 }));
  if (description) kids.push(text(String(description)));
  kids.push(separator({ divider: true, spacing: 1 }));
  kids.push(row(stringSelect({
    customId: 'ticket_topic_select',
    placeholder: placeholder || 'Select a topic to open a ticket',
    options: opts,
  })));

  return payload([container(kids, accent)]);
}

module.exports = {
  IS_COMPONENTS_V2,
  ACCENT_DEFAULT,
  text,
  separator,
  button,
  row,
  stringSelect,
  media,
  sectionWithThumb,
  container,
  payload,
  buildTicketPanelV2,
};
