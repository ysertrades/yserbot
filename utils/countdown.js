'use strict';

/**
 * Live countdowns: a dark Components V2 card holding only the countdown image
 * (utils/countdownVisual.js), posted to a channel and redrawn once a minute
 * until the event starts, then switched to its "live" card.
 *
 * Two pings, set apart: one when the card is posted (a line above the card)
 * and one when it ends (a short reply to the card, so people are notified —
 * an edit alone notifies nobody). Each can be off, @everyone, @here or a role,
 * with its own words. The card itself never has buttons or text.
 *
 * The runner ticks every 10 s, but a card is only re-rendered when the minute it
 * shows changes, so a countdown costs one edit a minute. State lives in
 * countdowns.json, so a restart picks every running countdown back up.
 */

const crypto = require('crypto');
const { readJson, writeJson } = require('./jsonStorage');
const v2 = require('./componentsV2');
const { renderCountdown, remaining } = require('./countdownVisual');

const FILE = 'countdowns.json';
const MAX_RUNNING = 5;
const KEEP_ENDED = 10;               // ended countdowns kept for the panel's list
const DARK = 0x0b0c0f;               // the card's accent bar: the card's own ink, so the frame stays dark
const TICK_MS = 10000;
const IMG = 'countdown.png';
const TARGETS = ['none', 'everyone', 'here', 'role'];
const TZS = ['America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Dubai', 'Asia/Tokyo', 'Australia/Sydney', 'UTC'];

function all() { return readJson(FILE, {}); }
function listOf(guildId) { return (all()[guildId]?.items || []).filter(Boolean); }
function save(guildId, items) { const a = all(); a[guildId] = { items }; writeJson(FILE, a); }
function patch(guildId, id, p) { const items = listOf(guildId); const i = items.findIndex((x) => x.id === id); if (i < 0) return null; items[i] = { ...items[i], ...p }; save(guildId, items); return items[i]; }

/** a ping setting, cleaned: { target, roleId, text } */
function readPing(p) {
  const target = TARGETS.includes(p?.target) ? p.target : 'none';
  const roleId = target === 'role' && /^\d{5,25}$/.test(String(p?.roleId || '')) ? String(p.roleId) : null;
  return { target: target === 'role' && !roleId ? 'none' : target, roleId, text: String(p?.text || '').trim().slice(0, 300) };
}
function pingLine(p, fallback) {
  if (!p || p.target === 'none') return null;
  const who = p.target === 'everyone' ? '@everyone' : p.target === 'here' ? '@here' : `<@&${p.roleId}>`;
  return `${who} ${p.text || fallback}`.trim();
}
function pingAllow(p) {
  if (!p || p.target === 'none') return { parse: [] };
  if (p.target === 'role') return { parse: [], roles: [p.roleId] };
  return { parse: ['everyone'] };
}

/** "2026-10-26T09:30" read as wall-clock time in `tz`, to a UTC instant (DST-safe) */
function zonedToUtc(local, tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(local || ''));
  if (!m) return NaN;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const offset = (ts) => {
    try {
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
        .formatToParts(ts).map((x) => [x.type, x.value]));
      return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - ts;
    } catch { return 0; }
  };
  let t = wall - offset(wall);
  t = wall - offset(t);   // a second pass lands on the right side of a DST change
  return t;
}

async function cardPayload(cd, now, ping) {
  const png = await renderCountdown(cd, now);
  const kids = [];
  if (ping) kids.push(v2.text(ping));
  if (png) kids.push(v2.container([v2.media(`attachment://${IMG}`)], DARK));
  else kids.push(v2.container([v2.text(`## ${cd.title}\n<t:${Math.floor(cd.endsAt / 1000)}:R>`)], DARK));   // no canvas on this host
  return { flags: v2.IS_COMPONENTS_V2, components: kids, files: png ? [{ attachment: png, name: IMG }] : [] };
}

const friendly = (e) => (/Missing (Permissions|Access)/i.test(e?.message || '') ? "The bot can't post there. Give it View Channel, Send Messages and Attach Files." : (e?.message || 'Discord refused the message.'));

async function create(client, guildId, body, session) {
  const guild = client.guilds.cache.get(guildId);
  const channel = guild?.channels?.cache?.get(String(body?.channelId || ''));
  if (!channel || !channel.isTextBased?.() || channel.isThread?.()) return { error: 'bad_channel', detail: 'Pick a text channel for the countdown.' };
  const title = String(body?.title || '').trim().slice(0, 80);
  if (!title) return { error: 'bad_title', detail: 'Give the countdown a title.' };
  const tz = TZS.includes(body?.tz) ? body.tz : 'America/New_York';
  const endsAt = Number.isFinite(+body?.endsAt) && +body.endsAt > 0 ? +body.endsAt : zonedToUtc(body?.when, tz);
  const now = Date.now();
  if (!Number.isFinite(endsAt) || endsAt < now + 60000) return { error: 'bad_time', detail: 'Pick a time at least a minute from now.' };
  if (endsAt > now + 366 * 86400000) return { error: 'bad_time', detail: 'Countdowns run for up to a year.' };
  const items = listOf(guildId);
  if (items.filter((x) => x.status === 'running').length >= MAX_RUNNING) return { error: 'too_many', detail: `Up to ${MAX_RUNNING} countdowns can run at once. End one first.` };

  const cd = {
    id: crypto.randomBytes(6).toString('base64url'), channelId: channel.id, messageId: null, title,
    kicker: String(body?.kicker || '').trim().slice(0, 28) || null,
    note: String(body?.note || '').trim().slice(0, 26) || null,
    endTitle: String(body?.endTitle || '').trim().slice(0, 40) || null,
    tz, endsAt, createdAt: now, status: 'running', lastMin: null, endedAt: null, error: null,
    pingStart: readPing(body?.pingStart), pingEnd: readPing(body?.pingEnd), by: session?.name || null,
  };
  const ping = pingLine(cd.pingStart, `${title} countdown is on.`);
  let msg;
  try { const p = await cardPayload(cd, now, ping); msg = await channel.send({ ...p, allowedMentions: pingAllow(cd.pingStart) }); }
  catch (e) { return { error: 'send_failed', detail: friendly(e) }; }
  cd.messageId = msg.id; cd.lastMin = remaining(endsAt, now).totalMin; cd.hasPing = !!ping;
  save(guildId, [cd, ...items].slice(0, MAX_RUNNING + KEEP_ENDED));
  return { ok: true, id: cd.id, channel: channel.name };
}

async function fetchMessage(client, cd) {
  const ch = client.channels.cache.get(cd.channelId) || await client.channels.fetch(cd.channelId).catch(() => null);
  if (!ch) return null;
  return ch.messages.fetch(cd.messageId).catch((e) => (e?.code === 10008 ? 'gone' : null));
}

async function redraw(client, guildId, cd, now) {
  const msg = await fetchMessage(client, cd);
  if (msg === 'gone') { patch(guildId, cd.id, { status: 'gone', error: 'The card was deleted in Discord.' }); return; }
  if (!msg) return;   // channel not reachable right now: try again next minute
  // the post ping line stays on the message as it was sent; edits never re-ping
  const p = await cardPayload(cd, now, cd.hasPing ? pingLine(cd.pingStart, `${cd.title} countdown is on.`) : null);
  await msg.edit({ components: p.components, files: p.files, attachments: [], allowedMentions: { parse: [] } });
}

async function finish(client, guildId, cd, now = Date.now()) {
  const done = { ...cd, endsAt: Math.min(cd.endsAt, now) };   // "End now" lands the card at this moment
  try { await redraw(client, guildId, done, Math.max(now, done.endsAt)); } catch (e) { patch(guildId, cd.id, { error: friendly(e) }); }
  const line = pingLine(cd.pingEnd, `${cd.title} is live now.`);
  if (line) {
    try {
      const ch = client.channels.cache.get(cd.channelId) || await client.channels.fetch(cd.channelId).catch(() => null);
      await ch?.send({ content: line, allowedMentions: pingAllow(cd.pingEnd), reply: cd.messageId ? { messageReference: cd.messageId, failIfNotExists: false } : undefined });
    } catch (e) { patch(guildId, cd.id, { error: `End ping: ${friendly(e)}` }); }
  }
  const items = listOf(guildId).map((x) => (x.id === cd.id ? { ...x, endsAt: done.endsAt, status: x.status === 'gone' ? 'gone' : 'ended', endedAt: now } : x));
  save(guildId, items);
}

async function remove(client, guildId, id) {
  const cd = listOf(guildId).find((x) => x.id === id);
  if (!cd) return { error: 'no_countdown', detail: 'That countdown no longer exists.' };
  if (cd.messageId) { const msg = await fetchMessage(client, cd); if (msg && msg !== 'gone') await msg.delete().catch(() => {}); }
  save(guildId, listOf(guildId).filter((x) => x.id !== id));
  return { ok: true };
}

/** the panel's view: no ping role ids beyond what the form needs, no internals */
function view(guildId) {
  const now = Date.now();
  return listOf(guildId).map((cd) => ({
    id: cd.id, title: cd.title, kicker: cd.kicker, note: cd.note, endTitle: cd.endTitle, tz: cd.tz, channelId: cd.channelId, messageId: cd.messageId,
    endsAt: cd.endsAt, createdAt: cd.createdAt, status: cd.status, endedAt: cd.endedAt, error: cd.error,
    left: cd.status === 'running' ? remaining(cd.endsAt, now) : null, pingStart: cd.pingStart, pingEnd: cd.pingEnd,
  }));
}

let timer = null; const busy = new Set();
function startCountdownRunner(client) {
  if (timer) return;
  const tick = async () => {
    const now = Date.now();
    for (const [guildId, g] of Object.entries(all())) {
      for (const cd of (g?.items || [])) {
        if (!cd || cd.status !== 'running' || busy.has(cd.id)) continue;
        if (!client.guilds.cache.has(guildId)) continue;
        busy.add(cd.id);
        try {
          if (now >= cd.endsAt) await finish(client, guildId, cd, cd.endsAt);
          else {
            const min = remaining(cd.endsAt, now).totalMin;
            if (min !== cd.lastMin) { await redraw(client, guildId, cd, now); patch(guildId, cd.id, { lastMin: min, error: null }); }
          }
        } catch (e) { patch(guildId, cd.id, { error: friendly(e) }); }
        finally { busy.delete(cd.id); }
      }
    }
  };
  timer = setInterval(() => { tick().catch((e) => console.error('[countdown] tick failed:', e.message)); }, TICK_MS);
  tick().catch(() => {});
}

module.exports = {
  create, finish, remove, view, listOf, startCountdownRunner, zonedToUtc, readPing, pingLine, pingAllow, cardPayload,
  MAX_RUNNING, TZS, TARGETS,
};
