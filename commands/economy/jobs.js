'use strict';

const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { checkCooldown } = require('../../utils/economyManager');
const { getEffect } = require('../../utils/effectsManager');
const { generateJobsHubImage } = require('../../utils/jobsVisual');
const { activity } = require('../../utils/economySettings');
const { refuseIfOff } = require('../../utils/economyGate');

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

/**
 * The jobs on offer in one server, with its scales already applied.
 *
 * Everything downstream — the hub image, the buttons, the shift itself —
 * reads jobs through here, so a pay scale of 2× cannot lift the payout
 * without also lifting the figure printed on the card.
 */
function jobsFor(guildId) {
  const cfg = activity(guildId, 'jobs');
  const pay = Number(cfg.payScale) || 1;
  const cool = Number(cfg.cooldownScale) || 1;
  return JOBS
    .filter(j => cfg.closed[j.id] !== true)
    .map(j => ({
      ...j,
      min: Math.max(1, Math.round(j.min * pay)),
      max: Math.max(1, Math.round(j.max * pay)),
      // A shift can be scaled to nothing, which is a server saying "no
      // cooldown" — floored at zero rather than going negative.
      cooldownMs: Math.max(0, Math.round(j.cooldownMs * cool)),
    }));
}

// ── Shared embed/row builders (used by slash command + button handler) ────────

// The Jobs Hub visual — bold enough to read every job's pay/cooldown/ready
// status without opening the image full-size. Regenerated fresh each call
// so it reflects whoever's viewing it (their own live cooldowns).
function buildJobsPayload(userId, guildId) {
  const boost = getEffect(userId, guildId, 'coin_boost');
  const statusFor = (job) => {
    const cd = checkCooldown(userId, `job_${job.id}`, job.cooldownMs, guildId);
    return { ready: cd <= 0 };
  };

  const imageName  = `jobs_hub_${Date.now()}.png`;
  const attachment = new AttachmentBuilder(generateJobsHubImage(jobsFor(guildId), statusFor, boost), { name: imageName });
  const embed = new EmbedBuilder().setColor(boost ? 0xFFD700 : 0xF59E0B).setImage(`attachment://${imageName}`);

  return { embeds: [embed], files: [attachment] };
}

// Every button carries the id of the member who opened the hub. The handler
// rejects anyone else, so a bystander can't work a job into someone else's
// panel or delete it out from under them.
function buildJobsRows(userId, guildId) {
  const open = jobsFor(guildId);
  const row1Ids = open.slice(0, 5);
  const row2Ids = open.slice(5, 8);

  function makeBtn(j) {
    const ready = checkCooldown(userId, `job_${j.id}`, j.cooldownMs, guildId) <= 0;
    return new ButtonBuilder()
      .setCustomId(`job:work:${j.id}:${userId}`)
      .setLabel(`${j.emoji} ${j.name}`)
      .setStyle(ready ? ButtonStyle.Success : ButtonStyle.Secondary);
  }

  const closeBtn = new ButtonBuilder().setCustomId(`job:close:${userId}`).setLabel('🔒 Close').setStyle(ButtonStyle.Danger);

  // With enough jobs closed the second row can end up empty, and Discord
  // rejects a row with no components — so Close moves up to whichever row is
  // the last one that actually has something in it.
  const rows = [];
  if (row1Ids.length) rows.push(new ActionRowBuilder().addComponents(...row1Ids.map(makeBtn)));
  if (row2Ids.length) rows.push(new ActionRowBuilder().addComponents(...row2Ids.map(makeBtn)));
  if (!rows.length) return [new ActionRowBuilder().addComponents(closeBtn)];
  const last = rows[rows.length - 1];
  if (last.components.length < 5) last.addComponents(closeBtn);
  else rows.push(new ActionRowBuilder().addComponents(closeBtn));
  return rows;
}

// ── Slash command ─────────────────────────────────────────────────────────────

module.exports = {
  JOBS,
  jobsFor,
  buildJobsPayload,
  buildJobsRows,

  data: new SlashCommandBuilder()
    .setName('jobs')
    .setDescription('Open the Jobs Hub — clock into any job from a single interactive visual'),

  async execute(interaction) {
    if (await refuseIfOff(interaction, 'jobs')) return;

    const userId  = interaction.user.id;
    const guildId = interaction.guild?.id;

    await interaction.reply({
      ...buildJobsPayload(userId, guildId),
      components: buildJobsRows(userId, guildId),
    });
  },
};
