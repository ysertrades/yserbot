'use strict';

/**
 * web/cards.js
 *
 * Trading cards, from the panel.
 *
 * The whole feature was three numbers in a generic settings group, two of
 * which the drop code never read — picking a drop channel or a drop chance
 * changed nothing at all. This is the real surface: the drop rules, the odds
 * and payout per tier, which cards a server actually drops, and who is
 * winning.
 *
 * Everything it writes goes through utils/cardsManager.js, which is what the
 * bot itself reads, so there is one definition of what a card is worth rather
 * than the panel's idea and the drop handler's idea.
 */

const { readJson } = require('../utils/jsonStorage');
const {
  CARDS, RARITY, RARITY_ORDER, CONFIG_DEFAULTS,
  getCardConfig, setCardConfig,
} = require('../utils/cardsManager');

/* ─── reading ────────────────────────────────────────────────────────────── */

/** The drop rules, shaped for a form. */
const DROP_FIELDS = [
  { key: 'interval', label: 'Messages between drops', type: 'int', min: 1, max: 1000,
    hint: 'Counted per channel, so a busy server drops more often than a quiet one.' },
  { key: 'chance', label: 'Chance a due drop lands (%)', type: 'int', min: 1, max: 100,
    hint: 'Below 100 the counter still resets on a miss, so drops get rarer rather than delayed.' },
  { key: 'claimSeconds', label: 'Seconds to grab it', type: 'int', min: 3, max: 120,
    hint: 'How long the Grab button stays live before the card vanishes.' },
];

function read(guildId, guild) {
  const cfg = getCardConfig(guildId);
  const owned = readJson('cards.json', {});

  // How many of each card exist across every collection. Counted once here
  // rather than per card, which would be a full pass of the file each time.
  const held = new Map();
  const perMember = new Map();
  for (const [userId, list] of Object.entries(owned)) {
    if (!Array.isArray(list)) continue;
    perMember.set(userId, list.length);
    for (const c of list) held.set(c.id, (held.get(c.id) || 0) + 1);
  }

  const rarities = RARITY_ORDER.map(key => ({
    key,
    label: RARITY[key].label,
    emoji: RARITY[key].emoji,
    weight: cfg.rarity[key].weight,
    price: cfg.rarity[key].price,
    defaultWeight: RARITY[key].weight,
    // What this tier's weight actually works out as, so the numbers mean
    // something without anyone having to add them up by hand.
    odds: 0,
    cards: CARDS.filter(c => c.rarity === key).length,
  }));
  const totalWeight = rarities.reduce((s, r) => s + r.weight, 0) || 1;
  for (const r of rarities) r.odds = Math.round((r.weight / totalWeight) * 10000) / 100;

  const cards = CARDS.map(c => ({
    id: c.id,
    name: c.name,
    rarity: c.rarity,
    emoji: c.emoji,
    art: c.art,
    desc: c.desc,
    enabled: cfg.disabled[c.id] !== true,
    held: held.get(c.id) || 0,
  }));

  const top = [...perMember.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([userId, count]) => ({
      userId,
      count,
      name: guild?.members?.cache?.get(userId)?.displayName || null,
    }));

  return {
    fields: DROP_FIELDS,
    values: {
      interval: cfg.interval,
      chance: cfg.chance,
      claimSeconds: cfg.claimSeconds,
      channelId: cfg.channelId,
    },
    defaults: CONFIG_DEFAULTS,
    rarities,
    cards,
    totals: {
      catalogue: CARDS.length,
      enabled: cards.filter(c => c.enabled).length,
      collected: [...held.values()].reduce((s, n) => s + n, 0),
      collectors: perMember.size,
    },
    top,
  };
}

/* ─── writing ────────────────────────────────────────────────────────────── */

function coerceInt(field, value) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n < field.min || n > field.max) return null;
  return n;
}

/** The drop rules. */
function saveDrops(guildId, body, guild) {
  const current = getCardConfig(guildId);
  const patch = {};
  const changed = [];

  for (const f of DROP_FIELDS) {
    if (!(f.key in body)) continue;
    const v = coerceInt(f, body[f.key]);
    if (v === null) return { error: 'bad_number', field: f.key };
    if (v === current[f.key]) continue;
    patch[f.key] = v;
    changed.push(`${f.label.toLowerCase()} ${v}`);
  }

  if ('channelId' in body) {
    const raw = body.channelId;
    // Empty means "anywhere", which is the shipped behaviour and has to stay
    // reachable — otherwise picking a channel once would be irreversible.
    if (raw === null || raw === '' || raw === undefined) {
      if (current.channelId !== null) { patch.channelId = null; changed.push('drops anywhere'); }
    } else {
      const ch = guild?.channels?.cache?.get(String(raw));
      if (!ch?.isTextBased?.()) return { error: 'bad_channel', field: 'channelId' };
      if (current.channelId !== ch.id) { patch.channelId = ch.id; changed.push(`drops in #${ch.name}`); }
    }
  }

  if (!changed.length) return { unchanged: true };
  setCardConfig(guildId, patch);
  return { ok: true, changed };
}

/** The odds and the payout for each tier. */
function saveRarities(guildId, body) {
  if (!body.rarity || typeof body.rarity !== 'object' || Array.isArray(body.rarity)) {
    return { error: 'bad_rarity' };
  }
  const current = getCardConfig(guildId).rarity;
  const patch = {};
  const changed = [];

  for (const key of RARITY_ORDER) {
    const incoming = body.rarity[key];
    if (!incoming || typeof incoming !== 'object') continue;
    const next = { ...current[key] };

    if ('weight' in incoming) {
      const w = Number(incoming.weight);
      // Two decimals: mythic ships at 0.5 and a server wanting it rarer still
      // needs room under that, but nobody needs six figures of precision.
      if (!Number.isFinite(w) || w < 0 || w > 1000) return { error: 'bad_weight', field: key };
      next.weight = Math.round(w * 100) / 100;
    }
    if ('price' in incoming) {
      const p = Math.trunc(Number(incoming.price));
      if (!Number.isFinite(p) || p < 0 || p > 10_000_000) return { error: 'bad_price', field: key };
      next.price = p;
    }

    if (next.weight !== current[key].weight || next.price !== current[key].price) {
      patch[key] = next;
      changed.push(RARITY[key].label);
    }
  }

  // Every tier at zero would leave nothing to roll. pickRandomCard already
  // falls back rather than crashing, but silently ignoring the whole table is
  // not something to let somebody do by accident.
  const merged = { ...current, ...patch };
  if (RARITY_ORDER.every(k => (merged[k]?.weight || 0) <= 0)) return { error: 'no_weight' };

  if (!changed.length) return { unchanged: true };
  setCardConfig(guildId, { rarity: patch });
  return { ok: true, changed };
}

/** Which cards this server drops. */
function saveCards(guildId, body) {
  if (!body.cards || typeof body.cards !== 'object' || Array.isArray(body.cards)) {
    return { error: 'bad_cards' };
  }
  const current = getCardConfig(guildId).disabled;
  const disabled = { ...current };
  const changed = [];

  for (const card of CARDS) {
    const want = body.cards[card.id];
    if (typeof want !== 'boolean') continue;
    const isOn = disabled[card.id] !== true;
    if (want === isOn) continue;
    // Stored as the exceptions only, so the file names what is off rather
    // than carrying a line for all sixty-odd cards.
    if (want) delete disabled[card.id];
    else disabled[card.id] = true;
    changed.push(`${card.name} ${want ? 'on' : 'off'}`);
  }

  if (!changed.length) return { unchanged: true };
  if (CARDS.every(c => disabled[c.id] === true)) return { error: 'no_cards' };

  setCardConfig(guildId, { disabled });
  return { ok: true, changed };
}

module.exports = { read, saveDrops, saveRarities, saveCards, DROP_FIELDS };
