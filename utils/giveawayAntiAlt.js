'use strict';

/**
 * Giveaway multi-account heuristics.
 * Discord does not expose member IPs to bots — we use account age + join timing.
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { readJson } = require('./jsonStorage');

const NEW_ACCOUNT_DAYS = 14;
const JOIN_CLUSTER_MS = 6 * 60 * 60 * 1000;
const MIN_CLUSTER = 2;

function accountAgeDays(user) {
  if (!user?.createdTimestamp) return 999;
  return (Date.now() - user.createdTimestamp) / 86400000;
}

function joinAgeMs(member) {
  if (!member?.joinedTimestamp) return Number.POSITIVE_INFINITY;
  return Date.now() - member.joinedTimestamp;
}

function evaluateEntrant(guild, entrantIds, newUserId) {
  const reasons = [];
  const cohort = [];
  const member = guild.members.cache.get(newUserId);
  const user = member?.user || guild.client.users.cache.get(newUserId);
  const age = accountAgeDays(user);

  if (age < NEW_ACCOUNT_DAYS) {
    reasons.push(`Account age ${age.toFixed(1)}d (under ${NEW_ACCOUNT_DAYS}d)`);
  }

  const myJoin = member?.joinedTimestamp || 0;
  for (const id of entrantIds) {
    if (id === newUserId) continue;
    const m = guild.members.cache.get(id);
    const u = m?.user;
    if (!u) continue;
    const otherAge = accountAgeDays(u);
    if (otherAge >= NEW_ACCOUNT_DAYS) continue;
    const otherJoin = m?.joinedTimestamp || 0;
    if (myJoin && otherJoin && Math.abs(myJoin - otherJoin) <= JOIN_CLUSTER_MS) {
      cohort.push(id);
    } else if (age < NEW_ACCOUNT_DAYS && otherAge < NEW_ACCOUNT_DAYS) {
      cohort.push(id);
    }
  }

  if (cohort.length >= MIN_CLUSTER - 1) {
    reasons.push(`${cohort.length + 1} young accounts in this giveaway (join-time cluster)`);
  }

  if (member && joinAgeMs(member) < 60 * 60 * 1000 && age < NEW_ACCOUNT_DAYS) {
    reasons.push('Joined this server under 1h ago on a young account');
  }

  return {
    suspicious: reasons.length > 0 && (age < NEW_ACCOUNT_DAYS || cohort.length > 0),
    reasons,
    cohort: [...new Set(cohort)],
  };
}

function errorLogChannelId(guildId) {
  const conf = readJson('config.json', {})[guildId] || {};
  return conf.errorLogChannelId || conf.modLogChannelId || conf.logChannelId || null;
}

async function reportSuspicious(guild, { messageId, dropId, prize, userId, analysis }) {
  const chId = errorLogChannelId(guild.id);
  if (!chId) return;
  const ch = guild.channels.cache.get(chId);
  if (!ch?.isTextBased?.()) return;

  const user = await guild.client.users.fetch(userId).catch(() => null);
  const cohortMentions = analysis.cohort.map(id => `<@${id}>`).join(', ') || '—';

  const embed = new EmbedBuilder()
    .setColor(0xE74C3C)
    .setTitle('Giveaway multi-account signal')
    .setDescription(
      `**User:** <@${userId}> (\`${userId}\`)\n` +
      `**Giveaway:** ${prize || '—'}\n` +
      `**Drop ID:** QL-${dropId || '—'}\n\n` +
      analysis.reasons.map(r => `• ${r}`).join('\n') +
      `\n\n**Related young accounts in this drop:** ${cohortMentions}\n\n` +
      `_Discord does not expose IPs to bots. Signals use account age + server join timing._`,
    )
    .setFooter({ text: `Msg ${messageId}` })
    .setTimestamp(new Date());

  if (user) embed.setThumbnail(user.displayAvatarURL({ size: 128 }));

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`gaw_alt_remove:${messageId}:${userId}`)
      .setLabel('Remove entry')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`gaw_alt_remove_cohort:${messageId}:${userId}`)
      .setLabel('Remove cluster')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`gaw_alt_dismiss:${messageId}:${userId}`)
      .setLabel('Dismiss')
      .setStyle(ButtonStyle.Secondary),
  );

  await ch.send({ embeds: [embed], components: [row] }).catch(err => {
    console.warn('[GIVEAWAY ANTI-ALT] log failed:', err.message);
  });
}

module.exports = { evaluateEntrant, reportSuspicious, NEW_ACCOUNT_DAYS };
