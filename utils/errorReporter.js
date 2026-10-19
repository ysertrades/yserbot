'use strict';

/**
 * errorReporter.js — the bot's error watch.
 *
 * Everything that goes wrong lands here: crashes and unhandled rejections,
 * Discord client and shard errors, slash commands, buttons and menus, the
 * web panel's server, the panel page itself in the browser (it posts its own
 * errors to /api/panel-error), anything logged with console.error, and a
 * health check that runs on its own (lag, memory, the gateway, and channels
 * the bot is set up to post in but can't).
 *
 * Each incident is read, not just forwarded: it is classified (a missing
 * permission, a deleted channel, a bug in the code, a network blip…), given a
 * severity, the file and line it came from, what it means in plain words and
 * what to do about it. Then it is posted as a report:
 *
 *   ### 🔴 Bug in the bot · /giveaway
 *   **What happened** TypeError: Cannot read properties of undefined…
 *   **Where** `commands/utility/giveaway.js:212` · /giveaway · #drops · @user
 *   **What it means** A bug in the bot's code, not something set up wrong.
 *   **What to do** Nothing on your side; the owner has the trace.
 *   ```trace```
 *   -# Incident E-7F3K2A · HIGH · first seen 2m ago · 3× · last 10s ago
 *   [ ✅ Mark fixed ] [ 🔕 Mute 24h ]
 *
 * Where it goes: the owner's error channel gets every incident; a server's
 * mod log gets the ones that happened in that server (medium and up), with
 * the "Staff pinged for alerts" roles pinged for high and critical ones.
 * Repeats don't spam: the same incident within the window bumps a live
 * counter on the message already posted. The panel's Moderation tab lists a
 * server's recent incidents.
 *
 * Nothing secret is posted: tokens, keys and passwords are redacted, and
 * file paths are trimmed to the project.
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const crypto = require('node:crypto');
const path = require('node:path');
const v8 = require('node:v8');
const { readJson, writeJson } = require('./jsonStorage');

const FILE = 'errorwatch.json';
const MAX_DETAIL = 900;
const DEDUPE_MS = 10 * 60 * 1000;
const EDIT_EVERY_MS = 30 * 1000;
const MAX_INCIDENTS = 80;
const ROOT = path.resolve(__dirname, '..');

let client = null;
const recent = new Map();   // key -> { id, at, count, last, messages: [{channelId, messageId}], lastEdit }
let reporting = false;      // guards console.error capture against our own logging

/* ── text helpers ───────────────────────────────────────────────────────── */

function redact(value, max = MAX_DETAIL) {
  return String(value ?? '')
    .replace(/(token|secret|password|api[_-]?key|authorization|mongodb(?:_uri)?|client_secret)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/mongodb(\+srv)?:\/\/\S+/gi, 'mongodb://[redacted]')
    .replace(/https?:\/\/[^/\s]+:[^/\s]+@/gi, 'https://[redacted]@')
    .replace(/[MN][A-Za-z\d]{23,25}\.[\w-]{6}\.[\w-]{27,38}/g, '[bot-token]')
    .split(ROOT + path.sep).join('')
    .split(ROOT.replace(/\\/g, '/') + '/').join('')
    .slice(0, max);
}

function errorText(error) {
  if (!error) return 'Unknown error';
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === 'string') return error;
  try { return JSON.stringify(error); } catch { return String(error); }
}

/** The first stack frame inside this project: where to look. */
function whereOf(error) {
  const frames = [];
  for (const line of String(error?.stack || '').split('\n').slice(1)) {
    if (/node_modules|node:internal|\(node:/.test(line)) continue;
    // "at fn (file:line:col)" or "at file:line:col"; paths may contain spaces.
    const m = /\((.+):(\d+):\d+\)\s*$/.exec(line) || /at (.+):(\d+):\d+\s*$/.exec(line);
    if (m) frames.push(m);
  }
  // Only the bot's own files: a path from anywhere else says nothing useful
  // and could show where the host keeps things.
  const m = frames.find(f => f[1].startsWith(ROOT));
  return m ? `${redact(m[1], 120).replace(/\\/g, '/')}:${m[2]}` : null;
}

function traceOf(error) {
  const lines = String(error?.stack || '').split('\n').slice(1)
    .filter(l => !/node_modules|node:internal|\(node:/.test(l) && (l.includes(ROOT) || !/[\\/]/.test(l))).slice(0, 4).map(l => l.trim());
  return lines.length ? redact(lines.join('\n'), 500) : null;
}

/* ── reading an error ───────────────────────────────────────────────────── */

const SEV = {
  critical: { icon: '🚨', word: 'CRITICAL', rank: 4 },
  high:     { icon: '🔴', word: 'HIGH', rank: 3 },
  medium:   { icon: '🟠', word: 'MEDIUM', rank: 2 },
  low:      { icon: '🟡', word: 'LOW', rank: 1 },
};

function channelFromUrl(error) {
  const m = /\/channels\/(\d{5,25})/.exec(String(error?.url || error?.requestBody?.url || ''));
  return m ? m[1] : null;
}

/**
 * What kind of failure this is, and what it means for a person reading it.
 * @returns {{ kind, title, severity, means, todo }}
 */
function classify(error, context = {}) {
  if (context.health) return { kind: 'health', title: context.title || 'Health check', severity: context.severity || 'medium', means: context.means || '', todo: context.todo || '' };
  const code = Number(error?.code);
  const name = String(error?.name || '');
  const msg = String(error?.message || error || '');
  const ch = channelFromUrl(error) || context.channelId;
  const inCh = ch ? ` in <#${ch}>` : '';

  if (code === 50013) return { kind: 'permission', title: 'Missing permission', severity: 'medium',
    means: `Discord refused: I don't have a permission I need${inCh}.`,
    todo: `Check my role${inCh}: usually **Send Messages**, **Embed Links**, **Attach Files**, **Manage Roles** or **Moderate Members**, and that my role sits above the roles I manage.` };
  if (code === 50001) return { kind: 'access', title: 'Can\'t see a channel', severity: 'medium',
    means: `I can't open the channel I was asked to use${inCh}.`, todo: `Give my role **View Channel**${inCh}, or pick another channel in Settings.` };
  if (code === 10003) return { kind: 'gone', title: 'A saved channel was deleted', severity: 'medium',
    means: 'A channel the bot is set up to use no longer exists.', todo: 'Pick a new one in the panel (Settings, or the feature that uses it).' };
  if (code === 10011) return { kind: 'gone', title: 'A saved role was deleted', severity: 'medium',
    means: 'A role the bot is set up to give or ping no longer exists.', todo: 'Pick a new role in the panel.' };
  if (code === 10008) return { kind: 'gone', title: 'Message was deleted', severity: 'low',
    means: 'I tried to edit or reply to a message that is gone.', todo: 'Nothing needed unless it keeps happening.' };
  if (code === 10062 || code === 40060) return { kind: 'interaction', title: code === 10062 ? 'A button answered too late' : 'A button answered twice', severity: code === 40060 ? 'medium' : 'low',
    means: code === 10062 ? 'Discord gives a bot 3 seconds to answer a click; this one took longer (often a slow moment).' : 'The bot tried to answer the same click twice: a bug in the code.',
    todo: code === 10062 ? 'Nothing unless it repeats; then the owner should look at that button.' : 'Nothing on your side; the owner has the trace.' };
  if (code === 50035) return { kind: 'invalid', title: 'Discord rejected a message', severity: 'medium',
    means: `Something the bot tried to send broke Discord's limits (too long, an empty field, a bad link or emoji).${detailOf(error)}`,
    todo: 'If it came from text you set in the panel, shorten or fix it there.' };
  if (code === 30007 || code === 30005 || code === 30013) return { kind: 'limit', title: 'Hit a Discord limit', severity: 'medium',
    means: 'The server is at one of Discord\'s maximums (webhooks, roles or similar).', todo: 'Remove some unused ones and try again.' };
  if (error?.status === 429 || /rate ?limit/i.test(msg)) return { kind: 'ratelimit', title: 'Slowed down by Discord', severity: 'low',
    means: 'Discord asked the bot to slow down for a moment.', todo: 'Nothing; it retries by itself.' };
  if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|socket hang up|fetch failed|UND_ERR|AbortError|other side closed/i.test(`${name} ${msg} ${error?.code || ''}`)) return { kind: 'network', title: 'Network hiccup', severity: 'low',
    means: 'A connection dropped or timed out (Discord, a feed, or another service).', todo: 'Usually clears on its own. If it keeps coming back, check that service.' };
  if (/Mongo|ENOSPC|EACCES|EROFS/i.test(`${name} ${msg} ${error?.code || ''}`)) return { kind: 'storage', title: 'Saving data failed', severity: 'high',
    means: 'The bot could not read or write its saved data.', todo: 'The owner should check the database / disk on the host.' };
  if (/^(TypeError|ReferenceError|SyntaxError|RangeError)$/.test(name)) return { kind: 'bug', title: 'Bug in the bot', severity: /uncaught/i.test(context.area || '') ? 'critical' : 'high',
    means: 'A mistake in the bot\'s code, not something set up wrong.', todo: 'Nothing on your side; the owner has the trace below.' };
  if (context.source === 'panel') return { kind: 'panel', title: 'The panel hit an error', severity: 'medium',
    means: 'The control panel page ran into a problem in someone\'s browser.', todo: 'If a screen looked broken, reload it; the owner has the details.' };
  const sev = /uncaught/i.test(context.area || '') ? 'critical' : /unhandled/i.test(context.area || '') ? 'high' : context.severity || 'medium';
  return { kind: 'error', title: 'Something failed', severity: sev, means: '', todo: '' };
}

function detailOf(error) {
  try {
    const errs = error?.rawError?.errors;
    if (!errs) return '';
    const flat = [];
    (function walk(o, at) {
      if (!o || typeof o !== 'object' || flat.length > 2) return;
      if (Array.isArray(o._errors)) for (const e of o._errors) flat.push(`${at}: ${e.message}`);
      for (const [k, v] of Object.entries(o)) if (k !== '_errors') walk(v, at ? `${at}.${k}` : k);
    })(errs, '');
    return flat.length ? ` (${redact(flat.slice(0, 2).join('; '), 160)})` : '';
  } catch { return ''; }
}

/* ── storage: incidents for the panel, mutes ─────────────────────────────── */

function store() {
  const s = readJson(FILE, {});
  if (!Array.isArray(s.incidents)) s.incidents = [];
  if (!s.mutes) s.mutes = {};
  return s;
}

function isMuted(key) {
  const until = store().mutes[key];
  return !!until && until > Date.now();
}

function remember(inc) {
  try {
    const s = store();
    const i = s.incidents.findIndex(x => x.id === inc.id);
    if (i >= 0) s.incidents[i] = { ...s.incidents[i], ...inc };
    else s.incidents.unshift(inc);
    s.incidents = s.incidents.slice(0, MAX_INCIDENTS);
    writeJson(FILE, s);
  } catch { /* the report matters more than the record */ }
}

/** For the panel: this server's recent incidents. */
function incidentsFor(guildId, limit = 12) {
  // The panel shows plain text: Discord's **bold** and <#channel> become words.
  const plain = s => String(s || '').replace(/\*\*/g, '')
    .replace(/<#(\d+)>/g, (_, id) => `#${client?.channels.cache.get(id)?.name || 'channel'}`)
    .replace(/<@&?(\d+)>/g, '@someone');
  return store().incidents.filter(x => x.guildId === guildId).slice(0, limit)
    .map(({ id, at, last, count, severity, title, area, where, message, status, by }) => ({ id, at, last, count, severity, title: plain(title), area, where, message: plain(message), status: status || 'open', by: by || null }));
}

/* ── where reports go ───────────────────────────────────────────────────── */

function ownerChannel() {
  if (!client) return null;
  const id = readJson('owner.json', {}).errorLogChannel;
  const ch = id && client.channels.cache.get(id);
  return ch?.isTextBased?.() ? ch : null;
}

function modLogFor(guildId) {
  const guild = guildId && client?.guilds.cache.get(guildId);
  if (!guild) return null;
  try { return require('./modConfig').getModLogChannel(guild); } catch { return null; }
}

function alertRoles(guildId) {
  const guild = client?.guilds.cache.get(guildId);
  const ids = readJson('config.json', {})[guildId]?.alertRoles;
  return guild && Array.isArray(ids) ? ids.filter(id => guild.roles.cache.has(id)).slice(0, 5) : [];
}

/* ── the report ─────────────────────────────────────────────────────────── */

const ts = ms => `<t:${Math.floor(ms / 1000)}:R>`;

function contextBits(context) {
  const bits = [];
  if (context.command) bits.push(`/${context.command}`);
  if (context.customId) bits.push(`\`${redact(context.customId, 40)}\``);
  if (context.view) bits.push(`panel · ${redact(context.view, 30)}`);
  if (context.path) bits.push(`\`${redact(context.path, 60)}\``);
  if (context.channelId) bits.push(`<#${context.channelId}>`);
  if (context.userId) bits.push(`<@${context.userId}>`);
  if (context.shardId != null) bits.push(`shard ${context.shardId}`);
  return bits;
}

function buildReport(inc, { forGuild, ping }) {
  const s = SEV[inc.severity] || SEV.medium;
  const lines = [];
  if (ping.length) lines.push(ping.map(r => `<@&${r}>`).join(' '));
  const done = inc.status === 'fixed' ? ' · ✅ fixed' : inc.status === 'muted' ? ' · 🔕 muted' : '';
  lines.push(`### ${s.icon} ${inc.title}${inc.area ? ` · ${inc.area}` : ''}${done}`);
  lines.push(`**What happened** ${inc.message}`);
  const where = [inc.where ? `\`${inc.where}\`` : null, ...(inc.bits || [])].filter(Boolean);
  if (where.length) lines.push(`**Where** ${where.join(' · ')}`);
  if (inc.means) lines.push(`**What it means** ${inc.means}`);
  if (inc.todo) lines.push(`**What to do** ${inc.todo}`);
  // The trace is for whoever fixes it; the server's own log gets it only for bugs.
  if (inc.trace && (!forGuild || inc.kind === 'bug')) lines.push('```js\n' + inc.trace + '\n```');
  const seen = inc.count > 1 ? ` · ${inc.count}× · last ${ts(inc.last)}` : '';
  const server = !forGuild && inc.guildName ? ` · ${redact(inc.guildName, 40)}` : '';
  lines.push(`-# Incident \`${inc.id}\` · ${s.word} · ${ts(inc.at)}${seen}${server}${inc.by ? ` · ${inc.status} by ${inc.by}` : ''}`);

  const components = [];
  if (inc.status !== 'fixed') {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`errinc:fix:${inc.id}`).setLabel('Mark fixed').setEmoji('✅').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`errinc:mute:${inc.id}`).setLabel(inc.status === 'muted' ? 'Muted 24h' : 'Mute 24h').setEmoji('🔕').setStyle(ButtonStyle.Secondary).setDisabled(inc.status === 'muted'),
    ));
  }
  return { content: lines.join('\n').slice(0, 2000), components, allowedMentions: { parse: [], roles: ping, users: [] } };
}

async function postTo(channel, view) {
  try { return await channel.send(view); }
  catch (err) { reporting = true; try { console.error('[ERROR REPORTER] could not post incident:', err.message || err); } finally { reporting = false; } return null; }
}

async function report(error, context = {}) {
  const c = classify(error, context);
  const message = redact(errorText(error), 400);
  const where = context.where || whereOf(error);
  const key = `${context.guildId || 'global'}|${c.kind}|${context.area || ''}|${context.command || ''}|${context.customId || ''}|${where || ''}|${message.slice(0, 160)}`;
  if (isMuted(key)) return false;

  const now = Date.now();
  const prev = recent.get(key);
  const windowMs = context.dedupeMs || DEDUPE_MS;
  if (prev && now - prev.at < windowMs) {
    // Same incident again: bump the live counter on what's already posted.
    prev.count += 1; prev.last = now;
    if (now - (prev.lastEdit || 0) > EDIT_EVERY_MS) {
      prev.lastEdit = now;
      remember({ id: prev.id, count: prev.count, last: now });
      const inc = { ...prev.inc, count: prev.count, last: now };
      for (const ref of prev.messages) {
        const ch = client?.channels.cache.get(ref.channelId);
        const msg = ch && await ch.messages.fetch(ref.messageId).catch(() => null);
        if (msg) msg.edit({ content: buildReport(inc, { forGuild: ref.forGuild, ping: [] }).content, allowedMentions: { parse: [] } }).catch(() => {});
      }
    }
    return false;
  }

  const id = `E-${crypto.createHash('sha256').update(key).digest('hex').slice(0, 6).toUpperCase()}`;
  const guild = context.guildId ? client?.guilds.cache.get(context.guildId) : null;
  const inc = {
    id, key, at: now, last: now, count: 1, kind: c.kind, severity: c.severity, title: c.title,
    // A health check has no exception: what it found is the message.
    area: context.area || null, message: c.kind === 'health' ? redact(c.means, 400) : message, where, means: c.kind === 'health' ? '' : c.means, todo: c.todo,
    trace: c.kind === 'health' ? null : traceOf(error), bits: contextBits(context),
    guildId: context.guildId || null, guildName: guild?.name || null, status: 'open',
  };
  const entry = { id, inc, at: now, count: 1, last: now, messages: [], lastEdit: now };
  recent.set(key, entry);
  if (recent.size > 500) for (const [k, v] of recent) if (now - v.at > DEDUPE_MS) recent.delete(k);
  remember({ id, at: now, last: now, count: 1, severity: c.severity, title: c.title, area: inc.area, where, message, guildId: inc.guildId, status: 'open', by: null, key });

  const sent = [];
  const owner = ownerChannel();
  if (owner) {
    const m = await postTo(owner, buildReport(inc, { forGuild: false, ping: [] }));
    if (m) sent.push({ channelId: owner.id, messageId: m.id, forGuild: false });
  }
  // The server's own mod log: what happened there, medium and up.
  const modLog = SEV[c.severity].rank >= 2 ? modLogFor(context.guildId) : null;
  if (modLog && modLog.id !== owner?.id) {
    const ping = SEV[c.severity].rank >= 3 ? alertRoles(context.guildId) : [];
    const m = await postTo(modLog, buildReport(inc, { forGuild: true, ping }));
    if (m) sent.push({ channelId: modLog.id, messageId: m.id, forGuild: true });
  }
  entry.messages = sent;
  return sent.length > 0;
}

function reportAndLog(error, context = {}) {
  reporting = true;
  try { console.error(`[${context.area || 'BOT ERROR'}]`, error); } finally { reporting = false; }
  report(error, context).catch(reportError => {
    reporting = true;
    try { console.error('[ERROR REPORTER] failed:', reportError.message || reportError); } finally { reporting = false; }
  });
}

/* ── the buttons under a report ─────────────────────────────────────────── */

async function handleButton(interaction) {
  const [, action, id] = interaction.customId.split(':');
  const member = interaction.member;
  const isOwner = (() => { try { return require('../web/auth').isOwner(interaction.user.id); } catch { return false; } })();
  if (!isOwner && !member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ content: '❌ You need **Manage Server** for that.', flags: 64 });
  }
  const s = store();
  const inc = s.incidents.find(x => x.id === id);
  if (!inc) return interaction.reply({ content: 'That incident is no longer on record.', flags: 64 });
  const by = member?.displayName || interaction.user.username;
  if (action === 'mute' && inc.key) s.mutes[inc.key] = Date.now() + 24 * 60 * 60 * 1000;
  inc.status = action === 'fix' ? 'fixed' : 'muted';
  inc.by = by;
  for (const [k, until] of Object.entries(s.mutes)) if (until < Date.now()) delete s.mutes[k];
  writeJson(FILE, s);
  // A fix starts the counter fresh: if it happens again, it's news.
  if (action === 'fix' && inc.key) recent.delete(inc.key);

  // Rebuild this message from what it says now: swap the footer and buttons.
  const content = String(interaction.message.content || '')
    .replace(/^(### .*?)( · ✅ fixed| · 🔕 muted)?$/m, `$1${action === 'fix' ? ' · ✅ fixed' : ' · 🔕 muted'}`)
    .replace(/(-# Incident .*?)( · (fixed|muted) by .*)?$/m, `$1 · ${inc.status} by ${by}`);
  const components = action === 'fix' ? [] : [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`errinc:fix:${id}`).setLabel('Mark fixed').setEmoji('✅').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`errinc:mute:${id}`).setLabel('Muted 24h').setEmoji('🔕').setStyle(ButtonStyle.Secondary).setDisabled(true),
  )];
  return interaction.update({ content, components, allowedMentions: { parse: [] } });
}

/* ── health: problems nobody threw ──────────────────────────────────────── */

let healthTimer = null;
let configTimer = null;
let slowPings = 0;

function health(title, severity, means, todo, extra = {}) {
  report(title, { health: true, title, severity, means, todo, area: 'Health check', dedupeMs: extra.dedupeMs || 6 * 60 * 60 * 1000, ...extra }).catch(() => {});
}

function startHealth() {
  let loop = null;
  try { loop = require('node:perf_hooks').monitorEventLoopDelay({ resolution: 20 }); loop.enable(); } catch { /* older node */ }
  healthTimer = setInterval(() => {
    try {
      if (loop) {
        const p99 = loop.percentile(99) / 1e6;
        if (p99 > 1500) health('The bot is lagging', 'medium', `For a moment it took up to ${Math.round(p99)} ms to respond to anything (buttons can time out).`, 'If it keeps happening, the host may be overloaded; the owner should look.', { dedupeMs: 60 * 60 * 1000 });
        loop.reset();
      }
      const heap = process.memoryUsage().heapUsed / v8.getHeapStatistics().heap_size_limit;
      if (heap > 0.85) health('Memory is nearly full', 'high', `The bot is using ${Math.round(heap * 100)}% of its memory; at 100% it restarts.`, 'The owner should restart it and look for a leak.', { dedupeMs: 60 * 60 * 1000 });
      const ping = client?.ws?.ping;
      slowPings = ping > 2000 ? slowPings + 1 : 0;
      if (slowPings === 3) health('Discord connection is slow', 'medium', `The gateway ping has been over 2 s for a few minutes (${Math.round(ping)} ms).`, 'Usually Discord or the host network; it recovers on its own.', { dedupeMs: 60 * 60 * 1000 });
    } catch { /* a health check must never become an incident itself */ }
  }, 60 * 1000);
  healthTimer.unref?.();

  // Every few hours: channels each server set up that the bot can't post in.
  const auditAll = () => { try { for (const g of client.guilds.cache.values()) auditGuild(g); } catch { /* ignore */ } };
  setTimeout(auditAll, 5 * 60 * 1000).unref?.();
  configTimer = setInterval(auditAll, 6 * 60 * 60 * 1000);
  configTimer.unref?.();
}

function auditGuild(guild) {
  const conf = readJson('config.json', {})[guild.id] || {};
  const me = guild.members.me;
  if (!me) return;
  const want = [
    ['logsChannel', 'Moderation log'], ['welcomeChannel', 'Welcome messages'], ['leaveChannel', 'Leave messages'], ['reportChannel', 'Reports'],
  ];
  const nf = conf.newsFeedSettings; if (nf?.channelId && nf.enabled !== false) want.push([null, 'News feed', nf.channelId]);
  const ec = conf.econCalSettings; if (ec?.enabled && ec.channelId) want.push([null, 'Economic calendar', ec.channelId]);
  for (const [k, label, direct] of want) {
    const id = direct || conf[k];
    if (!id) continue;
    const ch = guild.channels.cache.get(id);
    const ctx = { guildId: guild.id, area: label, dedupeMs: 24 * 60 * 60 * 1000 };
    if (!ch) { health(`${label} channel was deleted`, 'medium', `**${label}** is set to a channel that no longer exists, so nothing posts there.`, 'Pick a new channel in the panel.', ctx); continue; }
    const perms = ch.permissionsFor(me);
    const missing = [['ViewChannel', 'View Channel'], ['SendMessages', 'Send Messages'], ['EmbedLinks', 'Embed Links']]
      .filter(([bit]) => !perms?.has(PermissionFlagsBits[bit])).map(([, n]) => n);
    if (missing.length) health(`Can't post in #${ch.name}`, 'medium', `**${label}** goes to <#${ch.id}>, but I'm missing ${missing.map(m => `**${m}**`).join(', ')} there.`, `Give my role those permissions in <#${ch.id}>.`, { ...ctx, channelId: ch.id });
  }
}

/* ── catching what nobody reported ──────────────────────────────────────── */

function watchConsole() {
  const original = console.error.bind(console);
  console.error = (...args) => {
    original(...args);
    if (reporting) return;
    try {
      const err = args.find(a => a instanceof Error);
      const tag = typeof args[0] === 'string' ? (/^\[([^\]]{1,40})\]/.exec(args[0]) || [])[1] : null;
      if (tag === 'ERROR REPORTER') return;
      if (err) report(err, { area: tag ? `Logged · ${tag}` : 'Logged error' }).catch(() => {});
      else if (typeof args[0] === 'string' && /fail|error|could not|cannot|crash/i.test(args.join(' ')))
        report(args.map(a => (typeof a === 'string' ? a : a?.message || '')).join(' ').slice(0, 300), { area: tag ? `Logged · ${tag}` : 'Logged error', severity: 'low' }).catch(() => {});
    } catch { /* never let logging throw */ }
  };
}

function configure(nextClient) {
  client = nextClient;
  if (configure.done) return;
  configure.done = true;
  watchConsole();
  client.once?.('clientReady', () => { if (!healthTimer) startHealth(); });
  client.once?.('ready', () => { if (!healthTimer) startHealth(); });
  client.on?.('invalidated', () => reportAndLog('The Discord session was invalidated', { area: 'Discord session', severity: 'critical' }));
  try {
    client.rest?.on?.('rateLimited', info => {
      if (info?.timeToReset > 10000 || info?.global) report(`Rate limited on ${info.route || info.url || 'a route'} for ${Math.round((info.timeToReset || 0) / 1000)} s${info.global ? ' (global)' : ''}`, { area: 'Discord REST', severity: 'low', dedupeMs: 60 * 60 * 1000 }).catch(() => {});
    });
  } catch { /* older discord.js */ }
}

module.exports = { configure, report, reportAndLog, handleButton, incidentsFor, classify, redact };
