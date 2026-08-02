'use strict';

/**
 * web/composer.js
 *
 * Embeds and their buttons, treated as one object.
 *
 * In Discord they are two commands and two files — /embed writes embeds.json,
 * /button writes buttons.json and links a button to a template by name. That
 * split makes sense at a command prompt, where you can only do one thing at a
 * time, and makes none at all on a screen: a message is its embeds *and* its
 * buttons, and you want to see them together before it goes out.
 *
 * So the panel presents one composer per template. The storage underneath is
 * unchanged — same two files, same shapes, same records the commands read —
 * because anything else would mean the panel and the commands disagreeing
 * about what a template is.
 *
 * Sending and updating both go through embed.js's own buildEmbedPayload, so a
 * message posted from here is byte-identical to one posted by /embed send.
 */

const { readJson, writeJson } = require('../utils/jsonStorage');
const { DYNAMIC_IMAGES } = require('../utils/dynamicEmbedImages');

// Required lazily: commands/utility/embed.js pulls in a good deal of the bot,
// and web/ is loaded from index.js before the command files have all settled.
const embedCommand = () => require('../commands/utility/embed.js');

const POSTS_FILE = 'panel_posts.json';

const BUTTON_STYLES = ['Primary', 'Secondary', 'Success', 'Danger', 'Link'];
const BUTTON_TYPES  = ['role', 'link', 'ticket', 'custom'];

// Discord's own ceilings. Exceeding any of them makes the send fail with an
// unhelpful 400, so they are enforced here where a message can be attached.
const LIMITS = {
  title: 256, description: 4096, footer: 2048, authorName: 256,
  fieldName: 256, fieldValue: 1024, fields: 25, embeds: 10,
  label: 80, buttonsPerTemplate: 25, content: 2000,
};

/* ─── reading ────────────────────────────────────────────────────────────── */

// Mirrors normalizeTemplate() in embed.js: older templates are a bare embed
// object, newer ones are { embeds: [...] }.
function normalize(raw) {
  if (raw && Array.isArray(raw.embeds)) return { around: null, ...raw };
  return {
    around: null,
    embeds: [{
      title: raw?.title ?? null, description: raw?.description ?? null,
      color: raw?.color ?? '#5865F2', footer: raw?.footer ?? null,
      footerIcon: raw?.footerIcon ?? null, thumbnail: raw?.thumbnail ?? null,
      image: raw?.image ?? null, fields: raw?.fields ?? [],
      titleUrl: raw?.titleUrl ?? null, authorName: raw?.authorName ?? null,
      authorIcon: raw?.authorIcon ?? null, authorUrl: raw?.authorUrl ?? null,
      timestamp: raw?.timestamp ?? false,
    }],
  };
}

function buttonsFor(guildId, name) {
  const all = readJson('buttons.json', {})[guildId] || {};
  return Object.values(all).filter(b => b.embedName === name);
}

/** Every template in a guild, each with its buttons and its live posts. */
function list(guildId) {
  const templates = readJson('embeds.json', {})[guildId] || {};
  const posts = readJson(POSTS_FILE, {})[guildId] || {};

  return Object.entries(templates).map(([name, raw]) => {
    const t = normalize(raw);
    return {
      name,
      embeds: t.embeds,
      around: t.around || null,
      buttons: buttonsFor(guildId, name).map(b => ({
        id: b.id, label: b.label ?? '', style: b.style || 'Primary', type: b.type || 'custom',
        emoji: b.emoji ?? '', url: b.url ?? '', roleId: b.roleId ?? '',
        cooldown: b.cooldown ?? 0, uses: b.uses ?? 0,
      })),
      // Messages this panel has posted from the template, so they can be
      // updated in place later rather than reposted.
      posts: Object.entries(posts)
        .filter(([, p]) => p.templateName === name)
        .map(([messageId, p]) => ({ messageId, channelId: p.channelId, sentAt: p.sentAt })),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/** Reference data the composer UI needs. */
function meta() {
  return {
    styles: BUTTON_STYLES,
    types: BUTTON_TYPES,
    limits: LIMITS,
    dynamicImages: Object.keys(DYNAMIC_IMAGES).map(k => `dynamic:${k}`),
  };
}

/* ─── validation ─────────────────────────────────────────────────────────── */

const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : null);
const orNull = v => (v ? v : null);

function isHttpUrl(v) {
  try { const u = new URL(v); return u.protocol === 'http:' || u.protocol === 'https:'; }
  catch { return false; }
}

/**
 * The plain text and the picture that go around a template's embeds.
 *
 * An embed is a boxed, coloured thing with a spine down its side, and there
 * are messages that want a sentence in ordinary type next to one — a line of
 * context over the top, a note or a picture under it. Until now a template was
 * its embeds and nothing else, and the only way to get a word outside the box
 * was to type it into the send form, once, for that one send.
 *
 * ── Above and below are not symmetrical, and cannot be ───────────────────
 *
 * Discord draws a message as its text, then its embeds, then its buttons, in
 * that order and no other. So "above" is simply the message's own text and
 * costs nothing. "Below" cannot exist in the same message at all — there is
 * no slot after the embed for words — so it is sent as a second message,
 * immediately after, which is what it looks like in every channel where
 * somebody has done this by hand.
 *
 * That is a real cost and worth being plain about: the pair is two messages,
 * so updating rewrites both, and deleting the first leaves the second. The
 * alternative was to offer only "above", which is not what a message needs
 * half the time.
 *
 * The picture rides with the below text — one message, text then picture —
 * because a picture on its own above an embed just looks like a mistake.
 */
function sanitizeAround(input) {
  if (input === null || input === undefined) return { around: null };
  if (typeof input !== 'object') return { error: 'bad_around' };

  const above = clean(input.above, LIMITS.content) || null;
  const below = clean(input.below, LIMITS.content) || null;
  const picture = clean(input.picture, 500) || null;
  if (picture && !isHttpUrl(picture)) return { error: 'bad_picture' };

  // Nothing set is stored as nothing, not as three nulls — a template that
  // has never used this should read exactly as it did before it existed.
  if (!above && !below && !picture) return { around: null };
  return { around: { above, below, picture } };
}

// An image field is either a real URL or one of our generated-image markers.
function validImageRef(v) {
  if (!v) return true;
  if (v.startsWith('dynamic:')) return Object.prototype.hasOwnProperty.call(DYNAMIC_IMAGES, v.slice(8));
  return isHttpUrl(v);
}

function sanitizeEmbed(input) {
  if (!input || typeof input !== 'object') return { error: 'bad_embed' };

  const color = String(input.color ?? '#5865F2').trim();
  if (!/^#?[0-9a-fA-F]{6}$/.test(color)) return { error: 'bad_color' };

  // Only the main image can be a generated banner. A thumbnail is drawn as a
  // small square and the banners are 1000×400, and nothing ever attached one
  // for a thumbnail anyway — so `dynamic:` there produced an embed pointing at
  // a file that was never sent.
  if (input.image && !validImageRef(String(input.image).trim())) return { error: 'bad_image' };

  // Every remaining URL field, including the two icons — those were checked
  // nowhere, went straight into setFooter/setAuthor, and those validate and
  // throw. A template saved with a mistyped icon could not be sent at all.
  for (const [field, value] of [
    ['thumbnail', input.thumbnail],
    ['titleUrl', input.titleUrl],
    ['authorUrl', input.authorUrl],
    ['footerIcon', input.footerIcon],
    ['authorIcon', input.authorIcon],
  ]) {
    if (value && !isHttpUrl(String(value).trim())) return { error: `bad_${field}` };
  }

  const fields = Array.isArray(input.fields) ? input.fields.slice(0, LIMITS.fields) : [];
  const cleanFields = [];
  for (const f of fields) {
    const name = clean(f?.name, LIMITS.fieldName);
    const value = clean(f?.value, LIMITS.fieldValue);
    // Discord rejects a field with an empty name or value outright, so an
    // half-filled row is dropped rather than sent and refused.
    if (!name || !value) continue;
    cleanFields.push({ name, value, inline: !!f.inline });
  }

  return {
    embed: {
      title: orNull(clean(input.title, LIMITS.title)),
      description: orNull(clean(input.description, LIMITS.description)),
      color: color.startsWith('#') ? color.toUpperCase() : `#${color.toUpperCase()}`,
      footer: orNull(clean(input.footer, LIMITS.footer)),
      footerIcon: orNull(clean(input.footerIcon, 500)),
      thumbnail: orNull(clean(input.thumbnail, 500)),
      image: orNull(clean(input.image, 500)),
      fields: cleanFields,
      titleUrl: orNull(clean(input.titleUrl, 500)),
      authorName: orNull(clean(input.authorName, LIMITS.authorName)),
      authorIcon: orNull(clean(input.authorIcon, 500)),
      authorUrl: orNull(clean(input.authorUrl, 500)),
      timestamp: !!input.timestamp,
    },
  };
}

/* ─── operations ─────────────────────────────────────────────────────────── */

/** Create or replace a template's embeds. Buttons are untouched. */
function saveTemplate(guildId, body) {
  const name = clean(body.name, 80);
  if (!name) return { error: 'bad_template' };
  if (!Array.isArray(body.embeds) || body.embeds.length === 0) return { error: 'no_embeds' };
  if (body.embeds.length > LIMITS.embeds) return { error: 'too_many_embeds' };

  const embeds = [];
  for (const raw of body.embeds) {
    const result = sanitizeEmbed(raw);
    if (result.error) return result;
    embeds.push(result.embed);
  }

  const around = sanitizeAround(body.around);
  if (around.error) return around;

  const all = readJson('embeds.json', {});
  if (!all[guildId]) all[guildId] = {};
  const isNew = !all[guildId][name];
  all[guildId][name] = { embeds, ...(around.around ? { around: around.around } : {}) };
  writeJson('embeds.json', all);
  return { ok: true, isNew, name };
}

function deleteTemplate(guildId, body) {
  const name = clean(body.name, 80);
  const all = readJson('embeds.json', {});
  if (!name || !all[guildId]?.[name]) return { error: 'unknown_template' };
  delete all[guildId][name];
  writeJson('embeds.json', all);

  // Same cascade /embed does: a button pointing at a template that no longer
  // exists would render but do nothing.
  const buttons = readJson('buttons.json', {});
  let removed = 0;
  for (const [id, b] of Object.entries(buttons[guildId] || {})) {
    if (b.embedName === name) { delete buttons[guildId][id]; removed++; }
  }
  if (removed) writeJson('buttons.json', buttons);
  return { ok: true, name, removedButtons: removed };
}

/** Create or update one button on a template. */
function saveButton(guildId, body, { guild } = {}) {
  const embedName = clean(body.embedName, 80);
  const id = clean(body.id, 60);
  if (!embedName || !id) return { error: 'bad_button' };
  if (!/^[\w-]+$/.test(id)) return { error: 'bad_button_id' };

  const templates = readJson('embeds.json', {})[guildId] || {};
  if (!templates[embedName]) return { error: 'unknown_template' };

  const style = BUTTON_STYLES.includes(body.style) ? body.style : 'Primary';
  const type = BUTTON_TYPES.includes(body.type) ? body.type : 'custom';
  const label = clean(body.label, LIMITS.label) || '';
  const url = clean(body.url, 500) || '';
  const roleId = clean(body.roleId, 25) || '';

  // Link buttons are the one combination Discord refuses outright: they carry
  // a URL instead of a custom id, so the style and the type have to agree.
  if (type === 'link' && style !== 'Link') return { error: 'link_needs_link_style' };
  if (style === 'Link' && type !== 'link') return { error: 'link_style_needs_link_type' };
  if (type === 'link' && !isHttpUrl(url)) return { error: 'bad_url' };
  // Checked against the guild rather than against a regex: a well-formed id
  // for a role that was deleted would produce a button that silently does
  // nothing, which is worse than refusing it here.
  if (type === 'role' && !guild?.roles?.cache?.has(roleId)) return { error: 'bad_role' };
  if (!label && !body.emoji) return { error: 'need_label_or_emoji' };

  const all = readJson('buttons.json', {});
  if (!all[guildId]) all[guildId] = {};

  const existing = all[guildId][id];
  if (existing && existing.embedName !== embedName) return { error: 'button_id_taken' };
  if (!existing && buttonsFor(guildId, embedName).length >= LIMITS.buttonsPerTemplate) {
    return { error: 'too_many_buttons' };
  }

  all[guildId][id] = {
    ...(existing || {}),
    id, embedName, label, type, style,
    emoji: clean(body.emoji, 60) || '',
    url: type === 'link' ? url : '',
    roleId: type === 'role' ? roleId : '',
    cooldown: Number.isInteger(body.cooldown) && body.cooldown >= 0 ? Math.min(body.cooldown, 86400) : 0,
    uses: existing?.uses ?? 0,
  };
  writeJson('buttons.json', all);
  return { ok: true, id, isNew: !existing };
}

function deleteButton(guildId, body) {
  const id = clean(body.id, 60);
  const all = readJson('buttons.json', {});
  if (!id || !all[guildId]?.[id]) return { error: 'unknown_button' };
  delete all[guildId][id];
  writeJson('buttons.json', all);
  return { ok: true, id };
}

/* ─── sending ────────────────────────────────────────────────────────────── */

function rememberPost(guildId, messageId, record) {
  const all = readJson(POSTS_FILE, {});
  if (!all[guildId]) all[guildId] = {};
  all[guildId][messageId] = record;

  // Keep this from growing without bound — the oldest records are the least
  // likely to still point at a message anyone wants to edit.
  const entries = Object.entries(all[guildId]).sort((a, b) => (b[1].sentAt || 0) - (a[1].sentAt || 0));
  if (entries.length > 200) all[guildId] = Object.fromEntries(entries.slice(0, 200));

  writeJson(POSTS_FILE, all);
}

/**
 * Sends the second message, when a template has anything to put under its
 * embed. Returns its id, or null when there is nothing to send.
 *
 * A failure here is deliberately not a failure of the send: the embed is the
 * message, the note under it is not, and losing the whole post because a
 * picture URL had a typo would be the wrong trade. It is reported instead.
 */
async function sendBelow(channel, around) {
  if (!around?.below && !around?.picture) return { id: null };
  try {
    const msg = await channel.send({
      content: around.below || undefined,
      // discord.js fetches a URL and uploads it, so the picture is a real
      // attachment rather than a link Discord may or may not unfurl.
      files: around.picture ? [around.picture] : undefined,
      allowedMentions: { parse: [] },
    });
    return { id: msg.id };
  } catch (err) {
    console.error('[Panel] the note under the embed did not send:', err.message);
    return { id: null, failed: err.message.slice(0, 140) };
  }
}

async function send(guildId, body, { guild }) {
  const name = clean(body.name, 80);
  const channelId = clean(body.channelId, 25);
  if (!name) return { error: 'bad_template' };

  const channel = guild.channels.cache.get(channelId);
  if (!channel || !channel.isTextBased?.()) return { error: 'bad_channel' };

  const payload = embedCommand().buildEmbedPayload(guild, name, { channel });
  if (!payload) return { error: 'unknown_template' };

  // The template's own line above the embed, with the send form's text as an
  // override — someone posting a template into two channels with a different
  // opening line each time should not have to edit the template between them.
  const around = normalize(readJson('embeds.json', {})[guildId]?.[name]).around;
  const content = clean(body.content, LIMITS.content) || around?.above || null;

  let message;
  try {
    message = await channel.send({
      content,
      embeds: payload.embeds,
      files: payload.files,
      components: payload.components.length ? payload.components : undefined,
      // The panel must never be a way to mass-ping a server by accident.
      allowedMentions: { parse: [] },
    });
  } catch (err) {
    console.error('[Panel] send failed:', err.message);
    return { error: 'send_failed', detail: err.message.slice(0, 140) };
  }

  const below = await sendBelow(channel, around);

  rememberPost(guildId, message.id, {
    channelId: channel.id, templateName: name, sentAt: Date.now(), content,
    belowId: below.id,
  });
  return {
    ok: true, messageId: message.id, channelId: channel.id, channelName: channel.name,
    ...(below.failed ? { belowFailed: below.failed } : {}),
  };
}

/**
 * Re-renders a template into a message that is already posted.
 *
 * This is what makes the template editor worth using: change the copy once and
 * push it to the live message, rather than deleting and reposting and losing
 * the message's history and its position in the channel.
 */
async function updatePost(guildId, body, { guild, client }) {
  const channelId = clean(body.channelId, 25);
  const messageId = clean(body.messageId, 25);
  const name = clean(body.name, 80);
  if (!/^\d{5,25}$/.test(messageId || '')) return { error: 'bad_message' };

  const channel = guild.channels.cache.get(channelId);
  if (!channel || !channel.isTextBased?.()) return { error: 'bad_channel' };

  let message;
  try { message = await channel.messages.fetch(messageId); }
  catch { return { error: 'message_not_found' }; }

  // Discord only lets a bot edit its own messages, and trying anyway returns a
  // confusing 50005. Say what is actually wrong instead.
  if (message.author?.id !== client.user?.id) return { error: 'not_our_message' };

  const known = readJson(POSTS_FILE, {})[guildId]?.[messageId];
  const templateName = name || known?.templateName;
  if (!templateName) return { error: 'unknown_template' };

  const payload = embedCommand().buildEmbedPayload(guild, templateName, { channel });
  if (!payload) return { error: 'unknown_template' };

  const around = normalize(readJson('embeds.json', {})[guildId]?.[templateName]).around;
  // What this post was sent with wins over the template's own line: the send
  // form can override it per post, and an update must not quietly replace a
  // line somebody wrote for this one message.
  const content = known?.content ?? around?.above ?? null;

  try {
    await message.edit({
      content,
      embeds: payload.embeds,
      files: payload.files,
      components: payload.components.length ? payload.components : [],
      allowedMentions: { parse: [] },
    });
  } catch (err) {
    console.error('[Panel] update failed:', err.message);
    return { error: 'update_failed', detail: err.message.slice(0, 140) };
  }

  // And the note under it. Four cases, and all four have to work: it was
  // there and still is (edit), it was not and now is (send), it was and now
  // is not (delete), it was never there (nothing).
  const wantsBelow = !!(around?.below || around?.picture);

  // Whether the one we sent before is still there. Resolved first and on its
  // own, because "we remember an id" and "that message exists" are different
  // questions — somebody can delete it in Discord, and then the remembered id
  // is a fact about the past rather than something to edit.
  let old = null;
  if (known?.belowId) {
    try { old = await channel.messages.fetch(known.belowId); } catch { old = null; }
    if (old && old.author?.id !== client.user?.id) old = null;
  }

  let belowId = old ? old.id : null;
  if (old && !wantsBelow) {
    try { await old.delete(); } catch { /* already gone, which is the goal */ }
    belowId = null;
  } else if (old && around.picture) {
    // An edit cannot change an attachment, so a message carrying a picture is
    // replaced rather than edited — otherwise changing the picture would
    // silently keep the old one.
    try { await old.delete(); } catch { /* fall through and send anyway */ }
    belowId = (await sendBelow(channel, around)).id;
  } else if (old) {
    try {
      await old.edit({ content: around.below, files: [], allowedMentions: { parse: [] } });
    } catch (err) {
      console.error('[Panel] the note under the embed did not update:', err.message);
    }
  } else if (wantsBelow) {
    belowId = (await sendBelow(channel, around)).id;
  }

  rememberPost(guildId, messageId, {
    channelId, templateName, sentAt: known?.sentAt || Date.now(), content, belowId,
  });
  return { ok: true, messageId, templateName };
}

module.exports = {
  list, meta, saveTemplate, deleteTemplate, saveButton, deleteButton, send, updatePost,
  normalize, LIMITS, BUTTON_STYLES, BUTTON_TYPES, POSTS_FILE,
};
