'use strict';

/**
 * linkDecisions.js
 *
 * Approving and denying a link request, in one place.
 *
 * Two things can now decide a request — the buttons on the mod-log card and
 * the control panel — and a decision is not a single write. It grants a
 * permit, reposts the link the member was not allowed to post, tells them what
 * happened, and stamps the record. A second copy of that sequence would drift,
 * and the failure mode is a request that reads as approved while the member
 * still cannot post anything.
 *
 * Everything here is best-effort about Discord and strict about storage: the
 * status is written first, so a decision is never lost because a channel had
 * been deleted or the bot had lost permission to talk in it.
 */

const { EmbedBuilder } = require('discord.js');
const { getRequest, updateRequest } = require('./linkRequests');
const { grantPermit, clearRecord } = require('./linkPermits');
const { parseDuration, formatDuration } = require('./duration');

/** A decision that has already been made cannot be made again. */
function decidable(request) {
  if (!request) return { ok: false, error: 'unknown_request' };
  if (request.status === 'approved' || request.status === 'denied') {
    return { ok: false, error: 'already_decided', status: request.status };
  }
  return { ok: true };
}

async function notify(client, request, embed) {
  try {
    const guild = client.guilds.cache.get(request.guildId);
    const channel = guild?.channels?.cache?.get(request.channelId);
    if (!channel?.isTextBased?.()) return;
    const user = await client.users.fetch(request.userId).catch(() => null);
    if (!user) return;
    embed.setFooter({ text: `👁️ Only relevant to ${user.username}` });
    const notice = await channel.send({
      content: `${user}`,
      embeds: [embed],
      // The notice names the member; it must never ping a role or everyone
      // through anything they wrote.
      allowedMentions: { users: [user.id] },
    }).catch(() => null);
    if (notice) setTimeout(() => notice.delete().catch(() => {}), 20_000);
  } catch { /* the decision itself already stands */ }
}

/**
 * @param {object} opts
 *   client, requestId, cooldown (a duration string like "24h"), by (display name)
 * @returns {Promise<{ok: true, request: object, cooldownLabel: string} | {ok: false, error: string}>}
 */
async function approve({ client, requestId, cooldown, by }) {
  const request = getRequest(requestId);
  const can = decidable(request);
  if (!can.ok) return can;

  const cooldownMs = parseDuration(cooldown);
  if (!cooldownMs) return { ok: false, error: 'bad_cooldown' };
  const cooldownLabel = formatDuration(cooldownMs);

  const updated = updateRequest(requestId, {
    status: 'approved', cooldownLabel, decidedAt: Date.now(), decidedBy: by,
  });
  grantPermit(request.guildId, request.userId, cooldownMs);

  // The repost is the approval — without it the member's link is still gone
  // and nothing they asked for has actually happened.
  try {
    const guild = client.guilds.cache.get(request.guildId);
    const channel = guild?.channels?.cache?.get(request.channelId);
    if (channel?.isTextBased?.()) {
      await channel.send({
        content: `🔗 **${request.userTag}** (link approved by ${by}):\n${request.originalContent || request.link}`,
        // The member's own text is being reposted verbatim, so any mention in
        // it would fire from the bot. Nothing in here pings anyone.
        allowedMentions: { parse: [] },
      }).catch(() => {});
    }
  } catch { /* best effort */ }

  await notify(client, request, new EmbedBuilder()
    .setColor(0x2ECC71)
    .setTitle('✅ Link Request Approved')
    .setDescription(`You can post **one more link every ${cooldownLabel}**. Post another before that is up and the permission is revoked — you would need to ask again.`));

  return { ok: true, request: updated, cooldownLabel };
}

async function deny({ client, requestId, by, reason = '' }) {
  const request = getRequest(requestId);
  const can = decidable(request);
  if (!can.ok) return can;

  const updated = updateRequest(requestId, {
    status: 'denied', decidedAt: Date.now(), decidedBy: by, denyReason: reason.slice(0, 300),
  });

  await notify(client, request, new EmbedBuilder()
    .setColor(0xE74C3C)
    .setTitle('❌ Link Request Denied')
    .setDescription(reason
      ? `Your link request was denied by ${by}.\n\n**Reason:** ${reason.slice(0, 300)}`
      : `Your link request was denied by ${by}.`));

  return { ok: true, request: updated };
}

/**
 * Revokes an approval that has already been granted.
 *
 * Separate from denying: the request stays approved in the history, because it
 * was — this only takes back the standing permission it created.
 */
function revokePermit(guildId, userId) {
  clearRecord(guildId, userId);
  return { ok: true };
}

module.exports = { approve, deny, revokePermit, decidable };
