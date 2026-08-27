'use strict';

/**
 * web/links.js
 *
 * Link approval requests, from the panel.
 *
 * The queue only existed inside Discord: a card in the mod-log channel, and
 * `/automod requests` for anything that had scrolled past. Both mean being at
 * a keyboard in the right channel, which is not where most of these get
 * noticed — someone asks to post a link, and it sits until an admin next opens
 * Discord on a desktop.
 *
 * Deciding goes through utils/linkDecisions, the same path the mod-log buttons
 * use, so a request approved here grants the same permit, reposts the same
 * link and sends the same notice. Nothing about the outcome depends on where
 * the decision was made.
 */

const {
  getAllActiveRequests, getDecidedRequests, getRequest, deleteRequest, getUserHistory,
} = require('../utils/linkRequests');
const { getAllPermits, evaluate } = require('../utils/linkPermits');
const { analyse, humanAge, severity } = require('../utils/linkInsight');
const { approve, deny, revokePermit } = require('../utils/linkDecisions');
const { getAutoModSettings } = require('../utils/modConfig');

/** When a Discord id was minted — every snowflake carries its own timestamp. */
function snowflakeTime(id) {
  try { return Number((BigInt(id) >> 22n) + 1420070400000n); }
  catch { return NaN; }
}

function describe(request, guild) {
  const member = guild?.members?.cache?.get(request.userId) || null;
  const history = getUserHistory(request.guildId, request.userId);
  const insight = analyse(request.link || request.originalContent, {
    accountCreatedAt: snowflakeTime(request.userId),
    joinedAt: member?.joinedTimestamp,
    history,
  });

  return {
    id: request.id,
    userId: request.userId,
    userTag: request.userTag || request.userId,
    displayName: member?.displayName || request.userTag || request.userId,
    channelId: request.channelId,
    channel: guild?.channels?.cache?.get(request.channelId)?.name || null,
    link: request.link || '',
    domain: insight.domain,
    reason: request.reason || '',
    original: request.originalContent || '',
    status: request.status,
    createdAt: request.createdAt || null,
    decidedAt: request.decidedAt || null,
    decidedBy: request.decidedBy || null,
    cooldownLabel: request.cooldownLabel || null,
    accountAge: humanAge(snowflakeTime(request.userId)),
    memberAge: member?.joinedTimestamp ? humanAge(member.joinedTimestamp) : null,
    history,
    flags: insight.flags,
    severity: severity(insight.flags),
  };
}

/** Everything the link-requests panel shows. */
function read(guildId, guild) {
  const automod = getAutoModSettings(guildId);

  // 'pending' means they were told to click Request Approval and have not yet;
  // there is nothing to decide until they do, so only pending_review is
  // actionable. Both are surfaced, with the difference made explicit.
  const active = getAllActiveRequests(guildId).map(r => describe(r, guild));

  const permits = getAllPermits(guildId).map(p => {
    const state = evaluate(guildId, p.userId);
    const member = guild?.members?.cache?.get(p.userId) || null;
    return {
      userId: p.userId,
      displayName: member?.displayName || p.userId,
      state: state.state,
      secondsLeft: state.secondsLeft || 0,
      cooldownMs: p.cooldownMs || 0,
    };
  });

  return {
    filterOn: !!automod.linkFilter,
    waiting: active.filter(r => r.status === 'pending_review'),
    unfinished: active.filter(r => r.status === 'pending'),
    permits,
    recent: getDecidedRequests(guildId, 15).map(r => describe(r, guild)),
  };
}

/* ─── deciding ───────────────────────────────────────────────────────────── */

async function decide(guildId, body, { client, session, guild }) {
  const id = String(body.requestId || '');
  if (!/^[a-f0-9]{6,24}$/i.test(id)) return { error: 'bad_request_id' };

  // A request belonging to another server must not be decidable from this
  // one's panel, however the id was come by.
  const request = getRequest(id);
  if (!request || request.guildId !== guildId) return { error: 'unknown_request' };

  const by = `${session.name} (control panel)`;

  if (body.action === 'approve') {
    const result = await approve({ client, requestId: id, cooldown: String(body.cooldown || '24h'), by });
    if (!result.ok) return { error: result.error, status: result.status };
    return {
      ok: true, action: 'approve', id,
      userId: request.userId, userTag: request.userTag,
      link: request.link, cooldownLabel: result.cooldownLabel,
    };
  }

  if (body.action === 'deny') {
    const result = await deny({ client, requestId: id, by, reason: String(body.reason || '') });
    if (!result.ok) return { error: result.error, status: result.status };
    return { ok: true, action: 'deny', id, userId: request.userId, userTag: request.userTag, link: request.link };
  }

  if (body.action === 'discard') {
    // Removes the record without telling anyone. The reason this exists: a
    // request left in a live state blocks that member from ever opening
    // another one, so an abandoned one needs clearing somehow.
    deleteRequest(id);
    return { ok: true, action: 'discard', id, userId: request.userId, userTag: request.userTag };
  }

  return { error: 'bad_action' };
}

/** Takes back a standing permission without touching the request that granted it. */
function revoke(guildId, body, { guild }) {
  const userId = String(body.userId || '');
  if (!/^\d{5,25}$/.test(userId)) return { error: 'bad_user' };
  revokePermit(guildId, userId);
  const member = guild?.members?.cache?.get(userId) || null;
  return { ok: true, userId, displayName: member?.displayName || userId };
}

module.exports = { read, decide, revoke };
