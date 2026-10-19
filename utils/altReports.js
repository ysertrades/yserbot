'use strict';

/**
 * altReports.js — what staff see when the giveaway entry check catches an alt.
 *
 * Not an embed: a plain message, so every account is a real mention staff can
 * tap to open the profile, and the staff roles chosen in Settings ("Staff
 * pinged for alerts") actually get pinged. Under it, one dropdown with what a
 * moderator can do about it. The same case is on the panel's Moderation tab,
 * and acting in either place updates the message, so the channel always
 * shows where each case stands.
 *
 *   @Staff
 *   ### 🛡️ Alt caught · entry held
 *   @alt looks like a second account of @main
 *   **Match** 🟥 device · ⬜ browser · ⬜ connection — near-certain
 *   > 🆕 @alt — created 3 days ago · joined 2 hours ago
 *   > 👤 @main — created 2 years ago · joined 8 months ago
 *   **Giveaway** 🎁 Nitro · QL-12 · jump
 *   -# Case AC-7F3K · just now · pick an action below or on the Moderation tab
 *   [ Choose an action… ▾ ]
 */

const { ActionRowBuilder, StringSelectMenuBuilder, PermissionFlagsBits } = require('discord.js');
const { readJson } = require('./jsonStorage');
const ev = require('./entryVerify');

const TIMEOUT_MS = 24 * 60 * 60 * 1000;

/** What each action does, who may do it, and what the message says after. */
const ACTIONS = {
  approve: { emoji: '✅', label: 'Not an alt: approve', desc: 'They can enter this and future giveaways', perm: PermissionFlagsBits.ModerateMembers, done: 'Approved' },
  hold:    { emoji: '⏸️', label: 'Keep on hold', desc: 'Stays blocked from giveaways until changed', perm: PermissionFlagsBits.ModerateMembers, done: 'Kept on hold' },
  reset:   { emoji: '🔄', label: 'Reset the check', desc: 'Forget the match; they verify again next time', perm: PermissionFlagsBits.ModerateMembers, done: 'Reset' },
  timeout: { emoji: '⏳', label: 'Time out the alt · 24h', desc: 'Mutes the flagged account for a day', perm: PermissionFlagsBits.ModerateMembers, done: 'Timed out for 24h' },
  kick:    { emoji: '👢', label: 'Kick the alt', desc: 'Removes the flagged account from the server', perm: PermissionFlagsBits.KickMembers, done: 'Kicked' },
  ban:     { emoji: '🔨', label: 'Ban the alt', desc: 'Bans the flagged account', perm: PermissionFlagsBits.BanMembers, done: 'Banned' },
};
const FINAL = new Set(['kick', 'ban']);
const STATUS_OF = { approve: 'approved', hold: 'held', reset: 'reset', timeout: 'timed out', kick: 'kicked', ban: 'banned' };

function alertRoles(guild) {
  const ids = readJson('config.json', {})[guild.id]?.alertRoles;
  return (Array.isArray(ids) ? ids : []).filter(id => guild.roles.cache.has(id)).slice(0, 5);
}

const ts = (ms, style = 'R') => (ms ? `<t:${Math.floor(ms / 1000)}:${style}>` : '—');

function strength(sig) {
  if (!sig) return '';
  if (sig.device) return 'near-certain';
  if (sig.browser && sig.connection) return 'strong';
  return 'possible';
}

function signalLine(sig) {
  if (!sig) return null;
  const s = (on, name) => `${on ? '🟥' : '⬜'} ${name}`;
  return `**Match** ${s(sig.device, 'device')} · ${s(sig.browser, 'browser')} · ${s(sig.connection, 'connection')} — *${strength(sig)}*`;
}

function accountLine(guild, userId, icon) {
  const m = guild.members.cache.get(userId);
  const u = m?.user || guild.client.users.cache.get(userId);
  const created = u?.createdTimestamp;
  const young = created && Date.now() - created < 14 * 86400000;
  const bits = [`created ${ts(created)}${young ? ' ⚠️' : ''}`];
  bits.push(m ? `joined ${ts(m.joinedTimestamp)}` : 'not in the server');
  return `> ${young ? '🆕' : icon} <@${userId}> — ${bits.join(' · ')}`;
}

/** The whole report message for a case, in its current state. */
function buildMessage(guild, c) {
  const roles = c.status === 'open' ? alertRoles(guild) : [];
  const matched = (c.matchedWith || []).slice(0, 3);
  const lines = [];
  if (roles.length) lines.push(roles.map(r => `<@&${r}>`).join(' '));
  const closed = c.status !== 'open';
  lines.push(`### 🛡️ Alt caught · ${closed ? STATUS_OF[c.last?.action] || c.status : 'entry held'}`);
  lines.push(`<@${c.userId}> looks like a second account of ${matched.map(id => `<@${id}>`).join(', ') || 'another member'}`);
  const sig = signalLine(c.signals);
  if (sig) lines.push(sig);
  lines.push(accountLine(guild, c.userId, '👤'));
  for (const id of matched) lines.push(accountLine(guild, id, '👤'));
  if (c.giveaway?.prize || c.giveaway?.dropId) {
    const g = c.giveaway;
    const jump = g.channelId && g.messageId ? ` · [jump](https://discord.com/channels/${guild.id}/${g.channelId}/${g.messageId})` : '';
    lines.push(`**Giveaway** 🎁 ${g.prize || 'giveaway'}${g.dropId ? ` · \`${g.dropId}\`` : ''}${jump}`);
  }
  if (c.last) {
    const a = ACTIONS[c.last.action];
    lines.push(`**Status** ${a?.emoji || '•'} ${a?.done || c.last.action} by ${c.last.byId ? `<@${c.last.byId}>` : c.last.by || 'staff'} ${ts(c.last.at)}${c.last.via === 'panel' ? ' · from the panel' : ''}`);
  }
  lines.push(`-# Case \`${c.id}\` · ${ts(c.at)} · ${FINAL.has(c.last?.action) ? 'closed' : 'pick an action below, or on the panel\'s Moderation tab'}`);

  const components = [];
  if (!FINAL.has(c.last?.action)) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`altcase:${c.id}`)
      .setPlaceholder(c.last ? `${ACTIONS[c.last.action]?.done || 'Updated'} · change it…` : 'Choose an action…')
      .addOptions(Object.entries(ACTIONS).map(([value, a]) => ({ value, label: a.label, description: a.desc, emoji: a.emoji })));
    components.push(new ActionRowBuilder().addComponents(menu));
  }
  return {
    content: lines.join('\n').slice(0, 2000),
    components,
    // Ping the alert roles once, on the first post; the accounts are shown as
    // mentions (tap for the profile) but never pinged.
    allowedMentions: { parse: [], roles: roles, users: [] },
  };
}

/** Posts the report for a fresh catch and remembers where it went. */
async function send(guild, { userId, matchedWith, reason, signals, giveaway }) {
  const c = ev.openCase(guild.id, { userId: String(userId), matchedWith: (matchedWith || []).map(String).slice(0, 5), reason, signals, giveaway: giveaway || null });
  const { getModLogChannel } = require('./modConfig');
  const ch = getModLogChannel(guild);
  if (!ch) return c;
  // Fetch the members so "joined" reads right even if they aren't cached.
  await Promise.all([c.userId, ...c.matchedWith].map(id => guild.members.fetch(id).catch(() => null)));
  const msg = await ch.send(buildMessage(guild, c)).catch(err => { console.error('[altReports] could not post:', err.message); return null; });
  if (msg) ev.updateCase(guild.id, c.id, { report: { channelId: ch.id, messageId: msg.id } });
  return c;
}

/** Re-renders the report after a change (either from Discord or the panel). */
async function refresh(guild, c) {
  if (!c?.report) return;
  const ch = guild.channels.cache.get(c.report.channelId);
  const msg = ch && await ch.messages.fetch(c.report.messageId).catch(() => null);
  if (!msg) return;
  const view = buildMessage(guild, c);
  await msg.edit({ content: view.content, components: view.components, allowedMentions: { parse: [] } }).catch(() => {});
}

/**
 * Applies an action to a case. actor: { id, name, member? , via: 'discord'|'panel' }.
 * Returns { ok, text } or { error, text }.
 */
async function act(guild, caseId, action, actor) {
  const a = ACTIONS[action];
  const c = ev.getCase(guild.id, caseId);
  if (!a) return { error: 'bad_action', text: 'Unknown action.' };
  if (!c) return { error: 'no_case', text: 'That case is gone (older cases are cleared over time).' };
  if (FINAL.has(c.last?.action)) return { error: 'closed', text: `This case is closed: the alt was ${STATUS_OF[c.last.action]}.` };

  if (actor.member && !canAct(actor.member, action)) return { error: 'forbidden', text: `You need the **${permName(a.perm)}** permission (or a moderator role) for that.` };
  const me = guild.members.me;
  const target = await guild.members.fetch(c.userId).catch(() => null);
  const why = `Alt of ${(c.matchedWith || []).join(', ') || 'another member'} · case ${c.id} · by ${actor.name || 'staff'}`.slice(0, 500);

  try {
    if (action === 'approve') ev.setOverride(guild.id, c.userId, 'verified');
    else if (action === 'hold') ev.setOverride(guild.id, c.userId, 'flagged');
    else if (action === 'reset') ev.setOverride(guild.id, c.userId, null);
    else {
      if (!target) return { error: 'gone', text: 'That account is no longer in the server.' };
      if (action === 'timeout') {
        if (!target.moderatable) return { error: 'bot_perms', text: 'I can\'t time out that member (my role is below theirs, or I lack Moderate Members).' };
        await target.timeout(TIMEOUT_MS, why);
      } else if (action === 'kick') {
        if (!target.kickable) return { error: 'bot_perms', text: 'I can\'t kick that member (my role is below theirs, or I lack Kick Members).' };
        await target.kick(why);
      } else if (action === 'ban') {
        if (!me?.permissions.has(PermissionFlagsBits.BanMembers) || !target.bannable) return { error: 'bot_perms', text: 'I can\'t ban that member (my role is below theirs, or I lack Ban Members).' };
        await guild.members.ban(c.userId, { reason: why });
      }
    }
  } catch (err) {
    return { error: 'failed', text: `That didn't go through: ${String(err.message || err).slice(0, 150)}` };
  }

  const entry = { action, at: Date.now(), byId: actor.id || null, by: actor.name || null, via: actor.via || 'discord' };
  const next = ev.updateCase(guild.id, c.id, prev => ({ status: STATUS_OF[action], last: entry, history: [...(prev.history || []), entry].slice(-10) }));
  await refresh(guild, next);
  return { ok: true, text: `${a.emoji} ${a.done} · case \`${c.id}\``, case: next };
}

function canAct(member, action) {
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const setup = readJson('config.json', {})[member.guild.id]?.cmdSetup || {};
  const staff = [...(setup.modRoles || []), ...(setup.adminRoles || [])];
  const isStaff = staff.some(id => member.roles.cache.has(id));
  // Staff roles cover the gentle actions; removing someone needs the matching
  // Discord permission as well, the same as doing it by hand.
  if (FINAL.has(action)) return member.permissions.has(ACTIONS[action].perm);
  return isStaff || member.permissions.has(ACTIONS[action].perm);
}

function permName(bit) {
  if (bit === PermissionFlagsBits.BanMembers) return 'Ban Members';
  if (bit === PermissionFlagsBits.KickMembers) return 'Kick Members';
  return 'Moderate Members';
}

/** The dropdown under a report: interaction.customId is altcase:<caseId>. */
async function handleSelect(interaction) {
  const caseId = interaction.customId.split(':')[1];
  const action = interaction.values?.[0];
  await interaction.deferReply({ flags: 64 });
  const out = await act(interaction.guild, caseId, action, {
    id: interaction.user.id, name: interaction.member?.displayName || interaction.user.username, member: interaction.member, via: 'discord',
  });
  return interaction.editReply({ content: out.text });
}

module.exports = { ACTIONS, send, act, refresh, buildMessage, handleSelect, canAct };
