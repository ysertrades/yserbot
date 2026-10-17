'use strict';

/**
 * entryVerifyCard.js — the private cards a member sees around a giveaway
 * entry check. Components V2, ephemeral, in the server's brand.
 *
 *   checkCard   — "one quick check": Verify me (link) + Finish verification
 *   enteredCard — in, with their entry number
 *   heldCard    — matched another account; staff will look at it
 *   noteCard    — any other one-line answer (ended, already in, …)
 */

const v2 = require('./componentsV2');
const ev = require('./entryVerify');
const brand = require('./brand');

const EPHEMERAL = 64;
const IS_V2 = 1 << 15;

function baseUrl() {
  let raw = process.env.PUBLIC_BASE_URL || '';
  if (!raw) { try { raw = require('../web/auth').config().baseUrl || ''; } catch { /* none */ } }
  return raw.replace(/\/+$/, '');
}

/** An edit of the card already on screen: it stays ephemeral by itself. */
function forUpdate(payload) {
  return { ...payload, flags: IS_V2 };
}

function accentFor(guildId, fallback) {
  const b = brand.getBrand(guildId);
  return b.accent ? parseInt(b.accent.slice(1), 16) : fallback;
}

function wrap(guildId, kids, accent) {
  return {
    flags: EPHEMERAL | IS_V2,
    components: [v2.container(kids.filter(Boolean), accentFor(guildId, accent))],
  };
}

function checkCard(interaction, messageId, channelId, meta, { notYet = false } = {}) {
  const g = interaction.guildId;
  const b = brand.getBrand(g);
  const token = ev.makeToken(g, interaction.user.id, messageId, channelId || meta?.channelId || interaction.channelId);
  const url = `${baseUrl()}/verify?t=${encodeURIComponent(token)}`;
  const prize = meta?.prize ? `**${meta.prize}**` : 'this drop';
  const minutes = Math.round(ev.TOKEN_TTL_MS / 60000);

  const kids = [
    v2.text([
      notYet ? '### ⏳ Not verified yet' : '### 🛡️ One quick human check',
      notYet
        ? 'The check is not finished yet. Open the page, hold the button until it fills, then come back here.'
        : `Before you're counted in for ${prize}, we make sure it's **one person, one entry** — so real members get a fair shot.`,
    ].join('\n')),
    v2.separator(),
    v2.text([
      '`1` **Verify me** — opens a page. Press and hold the shield.',
      '`2` **Finish verification** — back here, and you\'re in.',
      '-# 5 seconds · no sign-in · nothing to install',
    ].join('\n')),
    v2.separator(),
    v2.row(
      v2.button({ label: 'Verify me', emoji: '🛡️', url }),
      v2.button({ customId: `gaw_vdone:${messageId}`, label: 'Finish verification', emoji: '✅', style: 3 }),
    ),
    v2.text(`-# Link works once and expires in ${minutes} minutes · Protected by ${b.name}`),
  ];
  return wrap(g, kids, notYet ? 0xF59E0B : 0x2233F5);
}

function enteredCard(interaction, meta, messageId) {
  const g = interaction.guildId;
  let number = null;
  try {
    const set = global.giveawayEntrants?.get(messageId);
    if (set) number = [...set].indexOf(interaction.user.id) + 1;
  } catch { /* no number, still in */ }
  const prize = meta?.prize ? ` for **${meta.prize}**` : '';
  return wrap(g, [
    v2.text([
      '### 🎟️ You\'re in!',
      `Verified and entered${prize}. Good luck${interaction.member?.displayName ? `, ${interaction.member.displayName}` : ''}.`,
      number ? `-# Entry #${number} · use Check entry on the drop any time` : '-# Use Check entry on the drop any time',
    ].join('\n')),
  ], 0x22C55E);
}

function heldCard(interaction, meta) {
  const prize = meta?.prize ? ` for **${meta.prize}**` : '';
  return wrap(interaction.guildId, [
    v2.text([
      '### 🔒 Entry on hold',
      `This device was already used to verify another account here, so your entry${prize} can't go through automatically.`,
      '-# If that\'s a mistake — a shared family computer, say — ask a moderator. They can approve you in one tap.',
    ].join('\n')),
  ], 0xF23F43);
}

function noteCard(text) {
  return {
    flags: EPHEMERAL | IS_V2,
    components: [v2.container([v2.text(String(text || 'Done.'))])],
  };
}

module.exports = { checkCard, enteredCard, heldCard, noteCard, forUpdate };
