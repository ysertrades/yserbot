'use strict';

const { EmbedBuilder } = require('discord.js');
const crypto = require('node:crypto');
const { readJson } = require('./jsonStorage');

const MAX_DETAIL = 900;
const DEDUPE_MS = 10 * 60 * 1000;

let client = null;
const recent = new Map();

function configure(nextClient) {
  client = nextClient;
}

function redact(value) {
  return String(value ?? '')
    .replace(/(token|secret|password|api[_-]?key|authorization|mongodb(?:_uri)?|client_secret)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/https?:\/\/[^/\s]+:[^/\s]+@/gi, 'https://[redacted]@')
    .slice(0, MAX_DETAIL);
}

function errorText(error) {
  if (!error) return 'Unknown error';
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return typeof error === 'string' ? error : JSON.stringify(error);
}

function channelsFor(guildId) {
  if (!client) return [];
  const channelId = readJson('owner.json', {}).errorLogChannel;
  const channel = channelId && client.channels.cache.get(channelId);
  return channel?.isTextBased?.() ? [{ guildId: channel.guildId || guildId, channel }] : [];
}

function contextText(context = {}) {
  const parts = [];
  if (context.area) parts.push(`Area: ${context.area}`);
  if (context.command) parts.push(`Command: /${context.command}`);
  if (context.customId) parts.push(`Component: ${context.customId}`);
  if (context.guildId) parts.push(`Guild: ${context.guildId}`);
  if (context.shardId != null) parts.push(`Shard: ${context.shardId}`);
  return parts.join('\n') || 'No additional context';
}

async function report(error, context = {}) {
  const targets = channelsFor(context.guildId);
  if (!targets.length) return false;

  const message = redact(errorText(error));
  const key = `${context.guildId || 'global'}|${context.area || 'unknown'}|${context.command || ''}|${context.customId || ''}|${message}`;
  const incidentId = crypto.createHash('sha256').update(key).digest('hex').slice(0, 10).toUpperCase();
  const severity = /uncaught|unhandled/i.test(context.area || '') ? 'HIGH' : 'MEDIUM';
  const now = Date.now();
  const previous = recent.get(key);
  if (previous && now - previous.at < DEDUPE_MS) {
    previous.count += 1;
    return false;
  }
  recent.set(key, { at: now, count: 1 });

  const embed = new EmbedBuilder()
    .setColor(0xB06CFF)
    .setTitle('⚠️ Bot incident detected')
    .setDescription('A runtime failure was captured for review. No automatic code change was made.')
    .addFields(
      { name: 'Incident', value: `\`${incidentId}\` • ${severity}`, inline: true },
      { name: 'Failure', value: `\`\`\`\n${message}\n\`\`\``, inline: false },
      { name: 'Context', value: contextText(context), inline: false },
      { name: 'Review path', value: 'Copy this incident into a GitHub issue and ask the Bot Incident Reviewer agent to investigate. Merge only after human review.', inline: false },
    )
    .setFooter({ text: 'QuantLab • private incident channel' })
    .setTimestamp();

  try {
    const results = await Promise.allSettled(targets.map(({ channel }) =>
      channel.send({ embeds: [embed], allowedMentions: { parse: [] } }),
    ));
    const sent = results.some(result => result.status === 'fulfilled');
    if (!sent) throw results[0]?.reason || new Error('No incident channel accepted the message');
    return true;
  } catch (sendError) {
    console.error('[ERROR REPORTER] could not send incident:', sendError.message || sendError);
    return false;
  }
}

function reportAndLog(error, context = {}) {
  console.error(`[${context.area || 'BOT ERROR'}]`, error);
  report(error, context).catch(reportError => {
    console.error('[ERROR REPORTER] failed:', reportError.message || reportError);
  });
}

module.exports = { configure, report, reportAndLog };
