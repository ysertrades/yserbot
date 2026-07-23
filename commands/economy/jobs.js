'use strict';

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { addCoins, getBalance, checkCooldown, setCooldown } = require('../../utils/economyManager');
const { getEffect } = require('../../utils/effectsManager');

const fmt = n => Number(n).toLocaleString();

const JOBS = [
  {
    id: 'software_dev', name: 'Software Developer', emoji: '💻',
    min: 150, max: 300, cooldownMs: 45 * 60 * 1000, cooldownLabel: '45m',
    tasks: [
      'debugged a critical production bug at 3am',
      'shipped a new feature ahead of schedule',
      'refactored 2,000 lines of legacy code',
      'reviewed 30 pull requests',
      'deployed a hotfix before the client noticed',
    ],
  },
  {
    id: 'day_trader', name: 'Day Trader', emoji: '📊',
    min: 50, max: 500, cooldownMs: 30 * 60 * 1000, cooldownLabel: '30m', variance: true,
    tasks: [
      'nailed a textbook breakout setup',
      'caught a perfect market reversal',
      'scalped the first hour of trading',
      'held through volatility and exited clean',
      'shorted the top with precision',
    ],
  },
  {
    id: 'banker', name: 'Investment Banker', emoji: '🏦',
    min: 100, max: 220, cooldownMs: 30 * 60 * 1000, cooldownLabel: '30m',
    tasks: [
      'processed a multi-million loan application',
      'balanced the quarterly books to the cent',
      'advised high-net-worth clients all afternoon',
      'closed a major acquisition deal',
      'passed a surprise compliance audit',
    ],
  },
  {
    id: 'casino_dealer', name: 'Casino Dealer', emoji: '🎰',
    min: 75, max: 175, cooldownMs: 20 * 60 * 1000, cooldownLabel: '20m',
    tasks: [
      'dealt blackjack to a packed table all night',
      'ran the VIP roulette room',
      'managed the poker tournament finals',
      'kept a high roller happy for six hours',
      'spotted a card counter and quietly escorted them out',
    ],
  },
  {
    id: 'farmer', name: 'Farmer', emoji: '🌾',
    min: 80, max: 160, cooldownMs: 60 * 60 * 1000, cooldownLabel: '1h',
    tasks: [
      'harvested the fields before the rain hit',
      'tended the livestock at sunrise',
      'planted the new season crop',
      'repaired the irrigation system',
      'sold fresh produce at the market for top price',
    ],
  },
  {
    id: 'uber_driver', name: 'Rideshare Driver', emoji: '🚗',
    min: 60, max: 120, cooldownMs: 15 * 60 * 1000, cooldownLabel: '15m',
    tasks: [
      'completed 8 trips across the city',
      'earned a 5-star rating from every passenger',
      'navigated rush hour traffic flawlessly',
      'picked up a lost tourist and saved their evening',
      'made record tips on a late-night surge',
    ],
  },
  {
    id: 'chef', name: 'Executive Chef', emoji: '🧑‍🍳',
    min: 90, max: 180, cooldownMs: 25 * 60 * 1000, cooldownLabel: '25m',
    tasks: [
      'cooked for a fully-booked restaurant',
      'perfected a new signature dish',
      'survived the Friday dinner rush',
      'catered a high-profile corporate event',
      'trained two new line cooks from scratch',
    ],
  },
  {
    id: 'content_creator', name: 'Content Creator', emoji: '📱',
    min: 100, max: 400, cooldownMs: 2 * 60 * 60 * 1000, cooldownLabel: '2h', variance: true,
    tasks: [
      'went viral with a single post',
      'dropped a video that blew up overnight',
      'hit a personal record for engagement',
      'landed a lucrative brand sponsorship',
      'ran a live stream that broke your record',
    ],
  },
];

// ── Shared embed/row builders (used by slash command + button handler) ────────

function buildJobsEmbed(userId, guildId) {
  const boost    = getEffect(userId, guildId, 'coin_boost');
  const boostLine = boost ? '\n💰 **Coin Boost active** — all earnings are **1.5×** this session!\n' : '';

  const lines = JOBS.map(j => {
    const cd    = checkCooldown(userId, `job_${j.id}`, j.cooldownMs);
    const ready = cd <= 0;
    const ts    = Math.floor((Date.now() + cd) / 1000);
    const status = ready ? '✅' : `⏳ <t:${ts}:R>`;
    return `${j.emoji} **${j.name}**${j.variance ? ' ⚡' : ''} · \`${fmt(j.min)}–${fmt(j.max)}\` · \`${j.cooldownLabel}\` · ${status}`;
  });

  const readyCount = JOBS.filter(j => checkCooldown(userId, `job_${j.id}`, j.cooldownMs) <= 0).length;

  return new EmbedBuilder()
    .setColor(boost ? 0xFFD700 : 0xF59E0B)
    .setTitle('💼  Jobs Hub')
    .setDescription(
      `Clock in at any available job for instant pay. Stack them all for maximum income.${boostLine}\n` +
      lines.join('\n') +
      `\n\u200b`
    )
    .addFields(
      { name: '✅ Jobs Ready', value: `**${readyCount}** / ${JOBS.length}`, inline: true },
      { name: '💰 Boost',      value: boost ? '**Active 1.5×**' : 'None', inline: true },
    )
    .setFooter({ text: 'YSER Jobs  •  Click a job button to clock in  •  ⚡ = high-variance pay' })
    .setTimestamp();
}

function buildJobsRows(userId) {
  const row1Ids = JOBS.slice(0, 5);
  const row2Ids = JOBS.slice(5, 8);

  function makeBtn(j) {
    const ready = checkCooldown(userId, `job_${j.id}`, j.cooldownMs) <= 0;
    return new ButtonBuilder()
      .setCustomId(`job:work:${j.id}`)
      .setLabel(`${j.emoji} ${j.name}`)
      .setStyle(ready ? ButtonStyle.Success : ButtonStyle.Secondary);
  }

  const row1 = new ActionRowBuilder().addComponents(...row1Ids.map(makeBtn));
  const row2 = new ActionRowBuilder().addComponents(
    ...row2Ids.map(makeBtn),
    new ButtonBuilder().setCustomId('job:close').setLabel('🔒 Close').setStyle(ButtonStyle.Danger),
  );

  return [row1, row2];
}

// ── Slash command ─────────────────────────────────────────────────────────────

module.exports = {
  JOBS,
  buildJobsEmbed,
  buildJobsRows,

  data: new SlashCommandBuilder()
    .setName('jobs')
    .setDescription('Open the Jobs Hub — clock into any job from a single interactive embed'),

  async execute(interaction) {
    const userId  = interaction.user.id;
    const guildId = interaction.guild?.id;

    await interaction.reply({
      embeds:     [buildJobsEmbed(userId, guildId)],
      components: buildJobsRows(userId),
    });
  },
};
