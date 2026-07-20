'use strict';

const { EmbedBuilder } = require('discord.js');

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
const CARDS = [
  // ── COMMON ──────────────────────────────────────────────────────────────────
  { id: 'the_grinder',     name: 'The Grinder',      rarity: 'common',    emoji: '⚙️',  desc: 'Works 9 to 5, never stops.',           flavor: '"Slow and steady wins the race."' },
  { id: 'the_hodler',      name: 'The Hodler',        rarity: 'common',    emoji: '🧊',  desc: 'Bought at ATH, still holding.',         flavor: '"Never sell. Never surrender."' },
  { id: 'the_lurker',      name: 'The Lurker',        rarity: 'common',    emoji: '👁️', desc: 'Reads everything, says nothing.',       flavor: '"Knowledge is power."' },
  { id: 'weekend_warrior', name: 'Weekend Warrior',   rarity: 'common',    emoji: '⏱️', desc: 'Only trades on weekends.',              flavor: '"Work hard, trade harder."' },
  { id: 'the_newbie',      name: 'The Newbie',        rarity: 'common',    emoji: '🔌',  desc: 'Fresh to the markets.',                 flavor: '"Everyone starts somewhere."' },
  // ── UNCOMMON ────────────────────────────────────────────────────────────────
  { id: 'the_analyst',     name: 'The Analyst',       rarity: 'uncommon',  emoji: '📡',  desc: 'Charts all day, eats charts.',          flavor: '"The chart never lies."' },
  { id: 'the_scalper',     name: 'The Scalper',       rarity: 'uncommon',  emoji: '⚡',  desc: 'In and out in seconds.',                flavor: '"Quick hands, quick gains."' },
  { id: 'early_bird',      name: 'Early Bird',        rarity: 'uncommon',  emoji: '🌄',  desc: 'Online before market open.',            flavor: '"The early bird gets the pip."' },
  { id: 'night_owl',       name: 'Night Owl',         rarity: 'uncommon',  emoji: '🌙',  desc: 'Trades the Asian session.',             flavor: '"While you sleep, I execute."' },
  { id: 'risk_manager',    name: 'Risk Manager',      rarity: 'uncommon',  emoji: '🔐',  desc: 'Always sets a stop loss.',              flavor: '"Protect the downside."' },
  // ── RARE ────────────────────────────────────────────────────────────────────
  { id: 'bull_run',        name: 'Bull Run',          rarity: 'rare',      emoji: '📈',  desc: 'Profits in any bull market.',           flavor: '"Buy the dip, ride the wave."' },
  { id: 'bear_cave',       name: 'Bear Cave',         rarity: 'rare',      emoji: '📉',  desc: 'Knows when to go short.',               flavor: '"Bears make money too."' },
  { id: 'the_sniper',      name: 'The Sniper',        rarity: 'rare',      emoji: '🎯',  desc: 'Waits for the perfect entry.',          flavor: '"Patience is a weapon."' },
  { id: 'diamond_hands',   name: 'Diamond Hands',     rarity: 'rare',      emoji: '💎',  desc: 'Holds through any storm.',              flavor: '"Paper hands lose, diamond hands win."' },
  { id: 'momentum_rider',  name: 'Momentum Rider',    rarity: 'rare',      emoji: '🌊',  desc: 'Surfs the trend to the top.',           flavor: '"The trend is your friend."' },
  // ── EPIC ────────────────────────────────────────────────────────────────────
  { id: 'the_whale',       name: 'The Whale',         rarity: 'epic',      emoji: '🔱',  desc: 'Moves markets with a single trade.',    flavor: '"When I enter, the market knows."' },
  { id: 'black_swan',      name: 'Black Swan',        rarity: 'epic',      emoji: '🖤',  desc: 'Profits from chaos.',                   flavor: '"Expect the unexpected."' },
  { id: 'the_oracle',      name: 'The Oracle',        rarity: 'epic',      emoji: '🔭',  desc: 'Called the top. Called the bottom.',    flavor: '"The future is already written."' },
  { id: 'market_maker',    name: 'Market Maker',      rarity: 'epic',      emoji: '♟️', desc: 'Sets the price. Is the price.',         flavor: '"I don\'t follow the market. I am the market."' },
  { id: 'golden_cross',    name: 'Golden Cross',      rarity: 'epic',      emoji: '✴️', desc: 'When the MAs align perfectly.',         flavor: '"A sign from the charts above."' },
  // ── LEGENDARY ───────────────────────────────────────────────────────────────
  { id: 'the_wolf',        name: 'The Wolf',          rarity: 'legendary', emoji: '🐺',  desc: 'Hunts in all market conditions.',       flavor: '"The wolf does not concern itself with the opinion of sheep."' },
  { id: 'moon_shot',       name: 'Moon Shot',         rarity: 'legendary', emoji: '🛸',  desc: '10x on a single trade.',                flavor: '"Destination: the moon."' },
  { id: 'the_insider',     name: 'The Insider',       rarity: 'legendary', emoji: '🕶️', desc: 'Always knows what\'s coming.',          flavor: '"Information is the ultimate edge."' },
  { id: 'crystal_ball',    name: 'Crystal Ball',      rarity: 'legendary', emoji: '🌐',  desc: 'Predicted every major move.',           flavor: '"Others see a chart. I see the future."' },
  { id: 'ten_x_bagger',    name: '10X Bagger',        rarity: 'legendary', emoji: '💸',  desc: 'Found the trade of a lifetime.',        flavor: '"Risk defined. Reward unlimited."' },
  // ── MYTHIC ──────────────────────────────────────────────────────────────────
  { id: 'yser_legend',     name: 'YSER Legend',       rarity: 'mythic',    emoji: '👑',  desc: 'The rarest drop in existence.',         flavor: '"Only true legends carry this card."' },
  { id: 'the_architect',   name: 'The Architect',     rarity: 'mythic',    emoji: '🧬',  desc: 'Built an empire from zero.',            flavor: '"From nothing, everything."' },
  { id: 'alpha_master',    name: 'Alpha Master',      rarity: 'mythic',    emoji: '🌌',  desc: 'The ultimate edge in every market.',    flavor: '"Pure alpha. Pure dominance."' },
];

const TOTAL_WEIGHT = Object.values(RARITY).reduce((s, r) => s + r.weight, 0);

function pickRandomCard(bonusChancePct = 0) {
  // Rarity selection (weighted)
  let r = Math.random() * TOTAL_WEIGHT;
  let selectedRarity = 'common';
  for (const [key, cfg] of Object.entries(RARITY)) {
    r -= cfg.weight;
    if (r <= 0) { selectedRarity = key; break; }
  }
  // Extra bonus: slight upward rarity nudge if card_magnet active
  if (bonusChancePct > 0 && Math.random() * 100 < bonusChancePct) {
    const rarityOrder = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
    const idx = rarityOrder.indexOf(selectedRarity);
    if (idx < rarityOrder.length - 1) selectedRarity = rarityOrder[idx + 1];
  }
  const pool = CARDS.filter(c => c.rarity === selectedRarity);
  return pool[Math.floor(Math.random() * pool.length)];
}

function buildDropEmbed(card, expired = false) {
  const cfg = RARITY[card.rarity];
  if (expired) {
    return new EmbedBuilder()
      .setColor(0x424242)
      .setTitle('💨  Card Disappeared...')
      .setDescription('> No one was fast enough.\n> The card vanished into thin air.')
      .addFields({ name: 'What it was', value: `${cfg.emoji} **${cfg.label}** card`, inline: true })
      .setFooter({ text: 'Better luck next drop!' });
  }
  return new EmbedBuilder()
    .setColor(cfg.color)
    .setTitle(`${cfg.emoji}  A Card Has Appeared!`)
    .setDescription(
      `> **${cfg.stars}  ${cfg.label.toUpperCase()}**\n` +
      `> ✨ *A rare opportunity has surfaced in the server...*\n\u200b`,
    )
    .addFields(
      { name: '🃏 Mystery Card', value: '**???** — Can you grab it in time?', inline: true },
      { name: '⏱️ Time Left',    value: '**8 seconds**',                        inline: true },
    )
    .setFooter({ text: 'First to click wins the card!' });
}

function buildClaimedEmbed(card, user) {
  const cfg = RARITY[card.rarity];
  return new EmbedBuilder()
    .setColor(cfg.color)
    .setTitle(`${card.emoji}  ${card.name}`)
    .setDescription(
      `> ${cfg.emoji} **${cfg.stars}  ${cfg.label.toUpperCase()}**\n` +
      `> *${card.desc}*\n\n` +
      `> *${card.flavor}*\n\u200b`,
    )
    .addFields({ name: '🎉 Claimed By', value: `<@${user.id}>`, inline: true })
    .setFooter({ text: `Card ID: ${card.id}  •  ${cfg.label} • YSER Flow Cards` })
    .setTimestamp();
}

function buildCardDisplay(card) {
  const cfg = RARITY[card.rarity];
  return new EmbedBuilder()
    .setColor(cfg.color)
    .setTitle(`${card.emoji}  ${card.name}`)
    .setDescription(`${cfg.emoji} **${cfg.stars}  ${cfg.label.toUpperCase()}**\n\n*${card.desc}*\n\n*${card.flavor}*`)
    .setFooter({ text: `Card ID: ${card.id}` });
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

module.exports = { CARDS, RARITY, SELL_PRICE, pickRandomCard, buildDropEmbed, buildClaimedEmbed, buildCardDisplay };
