'use strict';

const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { randomInt } = require('node:crypto');
const { generateCardImage } = require('./cardVisual');
const { readJson, writeJson } = require('./jsonStorage');

// Secure randomness — card rarity odds are a "chance to win" mechanic just
// like the casino games, so they shouldn't be derivable from a predictable PRNG.
const _rand = () => randomInt(0, 1_000_000_000) / 1_000_000_000;

// ── Rarity config ─────────────────────────────────────────────────────────────
const RARITY = {
  common:    { label: 'Common',    emoji: '⚫', color: 0x9E9E9E, weight: 50, stars: '★☆☆☆☆☆' },
  uncommon:  { label: 'Uncommon',  emoji: '🟢', color: 0x43A047, weight: 25, stars: '★★☆☆☆☆' },
  rare:      { label: 'Rare',      emoji: '🔵', color: 0x1E88E5, weight: 15, stars: '★★★☆☆☆' },
  epic:      { label: 'Epic',      emoji: '🟣', color: 0x8E24AA, weight: 7,  stars: '★★★★☆☆' },
  legendary: { label: 'Legendary', emoji: '🌟', color: 0xFFD700, weight: 2.5,stars: '★★★★★☆' },
  mythic:    { label: 'Mythic',    emoji: '🔴', color: 0xFF1744, weight: 0.5,stars: '★★★★★★' },
};

// ── Card catalogue ────────────────────────────────────────────────────────────
//
// `art` names a drawing in utils/cardArt.js. Every card has its own, which is
// the difference between a collection and a colour chart — the picture used to
// come from the rarity, so all the commons were the same grey ring.
//
// Ids are permanent. They are what a member's collection stores, so renaming a
// card is fine and re-keying one silently deletes it from every collection
// that had it.
const CARDS = [
  // ── COMMON ──────────────────────────────────────────────────────────────────
  { id: 'the_grinder',     name: 'The Grinder',       rarity: 'common',    emoji: '⚙️',  art: 'gear',        desc: 'Works 9 to 5, never stops.',            flavor: '"Slow and steady wins the race."' },
  { id: 'the_hodler',      name: 'The Hodler',        rarity: 'common',    emoji: '🧊',  art: 'iceCube',     desc: 'Bought at ATH, still holding.',         flavor: '"Never sell. Never surrender."' },
  { id: 'the_lurker',      name: 'The Lurker',        rarity: 'common',    emoji: '👁️', art: 'eye',         desc: 'Reads everything, says nothing.',       flavor: '"Knowledge is power."' },
  { id: 'weekend_warrior', name: 'Weekend Warrior',   rarity: 'common',    emoji: '⏱️', art: 'stopwatch',   desc: 'Only trades on weekends.',              flavor: '"Work hard, trade harder."' },
  { id: 'the_newbie',      name: 'The Newbie',        rarity: 'common',    emoji: '🌱',  art: 'sprout',      desc: 'Fresh to the markets.',                 flavor: '"Everyone starts somewhere."' },
  { id: 'caffeine_addict', name: 'Caffeine Addict',   rarity: 'common',    emoji: '☕',  art: 'coffee',      desc: 'Runs on espresso and hope.',            flavor: '"Sleep is a position I closed."' },
  { id: 'demo_trader',     name: 'Demo Trader',       rarity: 'common',    emoji: '🖥️', art: 'monitor',     desc: 'Undefeated — on paper.',                flavor: '"Live account coming soon. Probably."' },
  { id: 'the_screenshotter', name: 'The Screenshotter', rarity: 'common',  emoji: '📸',  art: 'camera',      desc: 'Posts wins, crops losses.',             flavor: '"Trust me, the entry was there."' },
  { id: 'fomo_buyer',      name: 'FOMO Buyer',        rarity: 'common',    emoji: '🔥',  art: 'flame',       desc: 'Buys the top, every time.',             flavor: '"It only goes up from here. Surely."' },
  { id: 'green_candle',    name: 'Green Candle',      rarity: 'common',    emoji: '🟩',  art: 'candleUp',    desc: 'One good bar and a plan.',              flavor: '"Small wins compound."' },
  { id: 'red_candle',      name: 'Red Candle',        rarity: 'common',    emoji: '🟥',  art: 'candleDown',  desc: 'It happens. Move on.',                  flavor: '"Every chart has both colours."' },
  { id: 'the_typo',        name: 'The Typo',          rarity: 'common',    emoji: '⌨️', art: 'keyboard',    desc: 'Meant to buy 1. Bought 100.',           flavor: '"Fat finger, thin margin."' },
  { id: 'ping_addict',     name: 'Ping Addict',       rarity: 'common',    emoji: '🔔',  art: 'bell',        desc: 'Every alert, all of them, always.',     flavor: '"What was that? What was that?"' },
  { id: 'paper_hands',     name: 'Paper Hands',       rarity: 'common',    emoji: '📄',  art: 'paperTorn',   desc: 'Sold the bottom. Twice.',               flavor: '"I panicked, but early."' },
  // ── UNCOMMON ────────────────────────────────────────────────────────────────
  { id: 'the_analyst',     name: 'The Analyst',       rarity: 'uncommon',  emoji: '📡',  art: 'radar',       desc: 'Charts all day, eats charts.',          flavor: '"The chart never lies."' },
  { id: 'the_scalper',     name: 'The Scalper',       rarity: 'uncommon',  emoji: '⚡',  art: 'bolt',        desc: 'In and out in seconds.',                flavor: '"Quick hands, quick gains."' },
  { id: 'early_bird',      name: 'Early Bird',        rarity: 'uncommon',  emoji: '🌄',  art: 'sunrise',     desc: 'Online before market open.',            flavor: '"The early bird gets the pip."' },
  { id: 'night_owl',       name: 'Night Owl',         rarity: 'uncommon',  emoji: '🌙',  art: 'moon',        desc: 'Trades the Asian session.',             flavor: '"While you sleep, I execute."' },
  { id: 'risk_manager',    name: 'Risk Manager',      rarity: 'uncommon',  emoji: '🔐',  art: 'padlock',     desc: 'Always sets a stop loss.',              flavor: '"Protect the downside."' },
  { id: 'journal_keeper',  name: 'Journal Keeper',    rarity: 'uncommon',  emoji: '📓',  art: 'bookmark',    desc: 'Every trade, written down.',            flavor: '"You cannot fix what you never recorded."' },
  { id: 'the_hedger',      name: 'The Hedger',        rarity: 'uncommon',  emoji: '☂️', art: 'umbrella',    desc: 'Covered before the rain started.',      flavor: '"Insurance is boring until it is not."' },
  { id: 'spread_watcher',  name: 'Spread Watcher',    rarity: 'uncommon',  emoji: '📏',  art: 'ruler',       desc: 'Counts every point of cost.',           flavor: '"The broker eats first. Watch the plate."' },
  { id: 'volume_hunter',   name: 'Volume Hunter',     rarity: 'uncommon',  emoji: '📊',  art: 'volumeBars',  desc: 'Follows where the size goes.',          flavor: '"Price lies. Volume confesses."' },
  { id: 'swing_trader',    name: 'Swing Trader',      rarity: 'uncommon',  emoji: '🕰️', art: 'pendulum',    desc: 'Days, not seconds.',                    flavor: '"Let it breathe."' },
  { id: 'trendline_artist', name: 'Trendline Artist', rarity: 'uncommon',  emoji: '✏️', art: 'trendLine',   desc: 'Draws until one of them works.',        flavor: '"Third time is support."' },
  { id: 'the_balancer',    name: 'The Balancer',      rarity: 'uncommon',  emoji: '⚖️', art: 'scales',      desc: 'Never risks what cannot be lost.',      flavor: '"Position size is the whole strategy."' },
  { id: 'backtester',      name: 'The Backtester',    rarity: 'uncommon',  emoji: '⏮️', art: 'hourglass',   desc: 'Ten years of data, one more run.',      flavor: '"It worked in 2013."' },
  // ── RARE ────────────────────────────────────────────────────────────────────
  { id: 'bull_run',        name: 'Bull Run',          rarity: 'rare',      emoji: '📈',  art: 'bullHorns',   desc: 'Profits in any bull market.',           flavor: '"Buy the dip, ride the wave."' },
  { id: 'bear_cave',       name: 'Bear Cave',         rarity: 'rare',      emoji: '📉',  art: 'bearClaw',    desc: 'Knows when to go short.',               flavor: '"Bears make money too."' },
  { id: 'the_sniper',      name: 'The Sniper',        rarity: 'rare',      emoji: '🎯',  art: 'crosshair',   desc: 'Waits for the perfect entry.',          flavor: '"Patience is a weapon."' },
  { id: 'diamond_hands',   name: 'Diamond Hands',     rarity: 'rare',      emoji: '💎',  art: 'diamond',     desc: 'Holds through any storm.',              flavor: '"Paper hands lose, diamond hands win."' },
  { id: 'momentum_rider',  name: 'Momentum Rider',    rarity: 'rare',      emoji: '🌊',  art: 'wave',        desc: 'Surfs the trend to the top.',           flavor: '"The trend is your friend."' },
  { id: 'breakout_king',   name: 'Breakout King',     rarity: 'rare',      emoji: '🧱',  art: 'brokenWall',  desc: 'Through the level, not around it.',     flavor: '"Resistance was a suggestion."' },
  { id: 'fib_master',      name: 'Fibonacci Master',  rarity: 'rare',      emoji: '🌀',  art: 'spiral',      desc: 'The golden ratio, every time.',         flavor: '"Point six one eight. Always."' },
  { id: 'the_contrarian',  name: 'The Contrarian',    rarity: 'rare',      emoji: '🔃',  art: 'contrarian',  desc: 'Buys what everyone is selling.',        flavor: '"When they cheer, I check the exit."' },
  { id: 'liquidity_pool',  name: 'Liquidity Pool',    rarity: 'rare',      emoji: '💧',  art: 'droplets',    desc: 'Knows where the orders rest.',          flavor: '"Follow the water."' },
  { id: 'stop_hunter',     name: 'Stop Hunter',       rarity: 'rare',      emoji: '🧲',  art: 'magnet',      desc: 'Sees the wick before it prints.',       flavor: '"Your stop was the target."' },
  { id: 'gap_filler',      name: 'Gap Filler',        rarity: 'rare',      emoji: '🕳️', art: 'gap',         desc: 'It always comes back. Mostly.',         flavor: '"The chart hates a hole."' },
  { id: 'compound_king',   name: 'Compound King',     rarity: 'rare',      emoji: '🪙',  art: 'coinStack',   desc: 'Small edge, repeated forever.',         flavor: '"Boring is the strategy."' },
  // ── EPIC ────────────────────────────────────────────────────────────────────
  { id: 'the_whale',       name: 'The Whale',         rarity: 'epic',      emoji: '🔱',  art: 'trident',     desc: 'Moves markets with a single trade.',    flavor: '"When I enter, the market knows."' },
  { id: 'black_swan',      name: 'Black Swan',        rarity: 'epic',      emoji: '🖤',  art: 'swan',        desc: 'Profits from chaos.',                   flavor: '"Expect the unexpected."' },
  { id: 'the_oracle',      name: 'The Oracle',        rarity: 'epic',      emoji: '🔭',  art: 'telescope',   desc: 'Called the top. Called the bottom.',    flavor: '"The future is already written."' },
  { id: 'market_maker',    name: 'Market Maker',      rarity: 'epic',      emoji: '♟️', art: 'chessKnight', desc: 'Sets the price. Is the price.',         flavor: '"I don\'t follow the market. I am the market."' },
  { id: 'golden_cross',    name: 'Golden Cross',      rarity: 'epic',      emoji: '✴️', art: 'cross',       desc: 'When the MAs align perfectly.',         flavor: '"A sign from the charts above."' },
  { id: 'flash_crash',     name: 'Flash Crash',       rarity: 'epic',      emoji: '⚡',  art: 'lightningDown', desc: 'Nine percent in ninety seconds.',     flavor: '"Blink and the level is gone."' },
  { id: 'short_squeeze',   name: 'Short Squeeze',     rarity: 'epic',      emoji: '🗜️', art: 'squeeze',     desc: 'Up because they had to buy.',           flavor: '"The exit is narrower than the door."' },
  { id: 'the_algorithm',   name: 'The Algorithm',     rarity: 'epic',      emoji: '🤖',  art: 'circuit',     desc: 'Never sleeps, never hesitates.',        flavor: '"No fear. No greed. No mercy."' },
  { id: 'dark_pool',       name: 'Dark Pool',         rarity: 'epic',      emoji: '🌑',  art: 'eclipse',     desc: 'Size that never hit the tape.',         flavor: '"You saw the print. Not the trade."' },
  { id: 'iron_condor',     name: 'Iron Condor',       rarity: 'epic',      emoji: '🦅',  art: 'wings',       desc: 'Paid for the market going nowhere.',    flavor: '"Both wings, no drama."' },
  // ── LEGENDARY ───────────────────────────────────────────────────────────────
  { id: 'the_wolf',        name: 'The Wolf',          rarity: 'legendary', emoji: '🐺',  art: 'wolf',        desc: 'Hunts in all market conditions.',       flavor: '"The wolf does not concern itself with the opinion of sheep."' },
  { id: 'moon_shot',       name: 'Moon Shot',         rarity: 'legendary', emoji: '🛸',  art: 'rocket',      desc: '10x on a single trade.',                flavor: '"Destination: the moon."' },
  { id: 'the_insider',     name: 'The Insider',       rarity: 'legendary', emoji: '🕶️', art: 'shades',      desc: 'Always knows what\'s coming.',          flavor: '"Information is the ultimate edge."' },
  { id: 'crystal_ball',    name: 'Crystal Ball',      rarity: 'legendary', emoji: '🌐',  art: 'globe',       desc: 'Predicted every major move.',           flavor: '"Others see a chart. I see the future."' },
  { id: 'ten_x_bagger',    name: '10X Bagger',        rarity: 'legendary', emoji: '💸',  art: 'moneyBag',    desc: 'Found the trade of a lifetime.',        flavor: '"Risk defined. Reward unlimited."' },
  { id: 'the_phoenix',     name: 'The Phoenix',       rarity: 'legendary', emoji: '🔥',  art: 'phoenix',     desc: 'Blew the account. Came back bigger.',   flavor: '"Ashes are just a starting balance."' },
  { id: 'the_kingmaker',   name: 'The Kingmaker',     rarity: 'legendary', emoji: '👑',  art: 'scepter',     desc: 'Made other traders rich.',              flavor: '"I do not need the throne to choose who sits."' },
  { id: 'infinite_edge',   name: 'Infinite Edge',     rarity: 'legendary', emoji: '♾️', art: 'infinity',    desc: 'The system that never stopped working.', flavor: '"Repeatable is rarer than profitable."' },
  { id: 'iron_discipline', name: 'Iron Discipline',   rarity: 'legendary', emoji: '🛡️', art: 'shieldCheck', desc: 'Never broke the rules. Not once.',      flavor: '"The plan was never the hard part."' },
  // ── MYTHIC ──────────────────────────────────────────────────────────────────
  { id: 'yser_legend',     name: 'QuantLab Legend',       rarity: 'mythic',    emoji: '👑',  art: 'crown',       desc: 'The rarest drop in existence.',         flavor: '"Only true legends carry this card."' },
  { id: 'the_architect',   name: 'The Architect',     rarity: 'mythic',    emoji: '🧬',  art: 'helix',       desc: 'Built an empire from zero.',            flavor: '"From nothing, everything."' },
  { id: 'alpha_master',    name: 'Alpha Master',      rarity: 'mythic',    emoji: '🌌',  art: 'galaxy',      desc: 'The ultimate edge in every market.',    flavor: '"Pure alpha. Pure dominance."' },
  { id: 'the_singularity', name: 'The Singularity',   rarity: 'mythic',    emoji: '🕳️', art: 'blackHole',   desc: 'Every order flows to one place.',       flavor: '"Past this point, nothing gets back out."' },
  { id: 'genesis_block',   name: 'Genesis Block',     rarity: 'mythic',    emoji: '🧊',  art: 'genesisCube', desc: 'The first one. There is only one.',     flavor: '"Everything after this was a copy."' },
];

const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];

/* ─── per-guild settings ─────────────────────────────────────────────────── */

/**
 * Everything about drops a server can change, in the file /cardsettings and
 * the panel already share.
 *
 * The odds and the sell prices lived as constants in this file, which meant a
 * server could not make mythics rarer, make commons worth more, or keep a card
 * it disliked out of its own drops. `disabled` is a map of card id → true, so
 * the stored shape only ever names the exceptions.
 */
const CONFIG_FILE = 'cards_config.json';

const CONFIG_DEFAULTS = {
  interval: 50,       // messages in a channel before a drop is due
  chance: 100,        // % of due drops that actually land, for a rarer feel
  channelId: null,    // restrict drops to one channel; null means anywhere
  claimSeconds: 8,    // how long the grab button stays live
};

const clampInt = (v, lo, hi, fallback) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

/** A guild's drop settings, merged over the defaults. Never throws. */
function getCardConfig(guildId) {
  const stored = (guildId && readJson(CONFIG_FILE, {})[guildId]) || {};
  const rarity = {};
  for (const key of RARITY_ORDER) {
    const own = stored.rarity?.[key] || {};
    const w = Number(own.weight);
    const p = Number(own.price);
    rarity[key] = {
      weight: Number.isFinite(w) && w >= 0 ? w : RARITY[key].weight,
      price:  Number.isFinite(p) && p >= 0 ? Math.trunc(p) : SELL_PRICE[key],
    };
  }
  return {
    interval:     clampInt(stored.interval, 1, 1000, CONFIG_DEFAULTS.interval),
    chance:       clampInt(stored.chance, 1, 100, CONFIG_DEFAULTS.chance),
    claimSeconds: clampInt(stored.claimSeconds, 3, 120, CONFIG_DEFAULTS.claimSeconds),
    channelId:    typeof stored.channelId === 'string' && stored.channelId ? stored.channelId : null,
    disabled:     (stored.disabled && typeof stored.disabled === 'object') ? { ...stored.disabled } : {},
    rarity,
  };
}

/** Merges a patch in. The caller is responsible for having validated it. */
function setCardConfig(guildId, patch) {
  const all = readJson(CONFIG_FILE, {});
  const current = all[guildId] || {};
  all[guildId] = {
    ...current, ...patch,
    ...(patch.rarity ? { rarity: { ...(current.rarity || {}), ...patch.rarity } } : {}),
    ...(patch.disabled ? { disabled: patch.disabled } : {}),
  };
  writeJson(CONFIG_FILE, all);
  return getCardConfig(guildId);
}

/** The cards this guild actually drops. */
function activeCards(guildId) {
  const { disabled } = getCardConfig(guildId);
  const on = CARDS.filter(c => disabled[c.id] !== true);
  // Never leave the pool empty — a server that switched every card off would
  // otherwise turn every drop into a crash rather than into "no drops".
  return on.length ? on : CARDS;
}

/** What one card sells for in this guild. */
function sellPrice(guildId, rarity) {
  return getCardConfig(guildId).rarity[rarity]?.price ?? SELL_PRICE[rarity] ?? 0;
}

/**
 * Rolls a card for one guild.
 *
 * Rarity is picked from the guild's weights, then a card from that tier's
 * *enabled* pool. A tier whose cards are all switched off is skipped rather
 * than returning nothing, which is why the pool is checked before the tier is
 * committed to.
 */
function pickRandomCard(guildId = null, bonusChancePct = 0) {
  const cfg = getCardConfig(guildId);
  const pool = activeCards(guildId);

  // Only tiers that still have a card in them can be rolled.
  const tiers = RARITY_ORDER.filter(k => pool.some(c => c.rarity === k) && cfg.rarity[k].weight > 0);
  if (!tiers.length) return pool[randomInt(pool.length)];

  const total = tiers.reduce((s, k) => s + cfg.rarity[k].weight, 0);
  let r = _rand() * total;
  let selected = tiers[0];
  for (const k of tiers) {
    r -= cfg.rarity[k].weight;
    if (r <= 0) { selected = k; break; }
  }

  // Extra bonus: slight upward rarity nudge if card_magnet active
  if (bonusChancePct > 0 && _rand() * 100 < bonusChancePct) {
    const up = tiers[tiers.indexOf(selected) + 1];
    if (up) selected = up;
  }

  const tierPool = pool.filter(c => c.rarity === selected);
  return tierPool[randomInt(tierPool.length)];
}

function starsFilled(cfg) {
  return (cfg.stars.match(/★/g) || []).length;
}

function cardAttachment(imageBuf, tag) {
  return new AttachmentBuilder(imageBuf, { name: `card_${tag}_${Date.now()}.png` });
}

function buildDropEmbed(card, expired = false, claimSeconds = 8) {
  const cfg = RARITY[card.rarity];
  const attachment = cardAttachment(
    generateCardImage({ rarity: card.rarity, starsFilled: starsFilled(cfg), mystery: !expired, expired }),
    expired ? 'expired' : 'mystery',
  );

  if (expired) {
    const embed = new EmbedBuilder()
      .setColor(0x424242)
      .setDescription(`${cfg.stars}  **${cfg.label.toUpperCase()}**   💨 Nobody grabbed it in time`)
      .setFooter({ text: 'Better luck next drop!' })
      .setImage(`attachment://${attachment.name}`);
    return { embed, files: [attachment] };
  }

  const embed = new EmbedBuilder()
    .setColor(cfg.color)
    .setDescription(`${cfg.stars}  **${cfg.label.toUpperCase()}**   ⏱️ Time Left: \`${claimSeconds} seconds\``)
    .setFooter({ text: 'First to click wins the card!' })
    .setImage(`attachment://${attachment.name}`);
  return { embed, files: [attachment] };
}

function buildClaimedEmbed(card, user) {
  const cfg = RARITY[card.rarity];
  const attachment = cardAttachment(
    generateCardImage({ rarity: card.rarity, starsFilled: starsFilled(cfg), name: card.name, desc: card.desc, flavor: card.flavor, art: card.art }),
    card.id,
  );
  const embed = new EmbedBuilder()
    .setColor(cfg.color)
    .setTitle(`${card.emoji}  ${card.name}`)
    .addFields({ name: '🎉 Claimed By', value: `<@${user.id}>`, inline: true })
    .setFooter({ text: `Card ID: ${card.id}  •  ${cfg.label} • QuantLab Cards` })
    .setImage(`attachment://${attachment.name}`)
    .setTimestamp();
  return { embed, files: [attachment] };
}

function buildCardDisplay(card) {
  const cfg = RARITY[card.rarity];
  const attachment = cardAttachment(
    generateCardImage({ rarity: card.rarity, starsFilled: starsFilled(cfg), name: card.name, desc: card.desc, flavor: card.flavor, art: card.art }),
    card.id,
  );
  const embed = new EmbedBuilder()
    .setColor(cfg.color)
    .setTitle(`${card.emoji}  ${card.name}`)
    .setFooter({ text: `Card ID: ${card.id}` })
    .setImage(`attachment://${attachment.name}`);
  return { embed, files: [attachment] };
}

// ── Sell prices by rarity ─────────────────────────────────────────────────────
const SELL_PRICE = {
  common:    25,
  uncommon:  100,
  rare:      350,
  epic:      1000,
  legendary: 3500,
  mythic:    12000,
};

module.exports = {
  CARDS, RARITY, SELL_PRICE, RARITY_ORDER, CONFIG_FILE, CONFIG_DEFAULTS,
  pickRandomCard, buildDropEmbed, buildClaimedEmbed, buildCardDisplay,
  getCardConfig, setCardConfig, activeCards, sellPrice,
};
