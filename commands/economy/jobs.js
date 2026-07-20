'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
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

module.exports = {
  data: new SlashCommandBuilder()
    .setName('jobs')
    .setDescription('Work multiple jobs with separate cooldowns to maximize earnings')
    .addSubcommand(sub => sub.setName('list').setDescription('View all jobs, pay rates, and your cooldown status'))
    .addSubcommand(sub => sub.setName('work').setDescription('Clock into a specific job')
      .addStringOption(o => o.setName('job').setDescription('Which job to work').setRequired(true)
        .addChoices(...JOBS.map(j => ({ name: `${j.emoji} ${j.name}`, value: j.id }))))),

  async execute(interaction) {
    const sub    = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    if (sub === 'list') {
      const fields = JOBS.map(j => {
        const cd    = checkCooldown(userId, `job_${j.id}`, j.cooldownMs);
        const ready = cd <= 0;
        const ts    = Math.floor((Date.now() + cd) / 1000);
        return {
          name:   `${j.emoji} ${j.name}`,
          value:  `💸 \`${fmt(j.min)}–${fmt(j.max)}\`${j.variance ? ' ⚡' : ''}\n⏱️ \`${j.cooldownLabel}\`\n${ready ? '✅ **Ready**' : `⏳ <t:${ts}:R>`}`,
          inline: true,
        };
      });

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(0xF59E0B)
        .setTitle('💼  Available Jobs')
        .setDescription('Each job has its own cooldown — stack them all for maximum income.\n⚡ = high-variance pay (luck-based)\n\u200b')
        .addFields(fields)
        .setFooter({ text: 'Use /jobs work <job> to clock in  •  Coin Boost items increase earnings by 1.5×' })
        .setTimestamp()] });
    }

    if (sub === 'work') {
      const jobId = interaction.options.getString('job');
      const job   = JOBS.find(j => j.id === jobId);
      if (!job) return interaction.reply({ content: '❌ Unknown job.', ephemeral: true });

      const cd = checkCooldown(userId, `job_${job.id}`, job.cooldownMs);
      if (cd > 0) {
        const ts = Math.floor((Date.now() + cd) / 1000);
        return interaction.reply({ embeds: [new EmbedBuilder()
          .setColor(0xFF4757)
          .setTitle('⏳  Still on Shift')
          .setDescription(`You're recovering from your last **${job.emoji} ${job.name}** shift.\nAvailable again <t:${ts}:R>.`)], ephemeral: true });
      }

      // Calculate earnings (variance jobs spike on 15% chance)
      let earnings;
      if (job.variance) {
        const spike = Math.random() < 0.15;
        earnings    = spike
          ? Math.floor(job.max * (0.80 + Math.random() * 0.20))
          : Math.floor(job.min + Math.random() * (job.max - job.min) * 0.4);
      } else {
        earnings = Math.floor(job.min + Math.random() * (job.max - job.min));
      }

      // Apply coin boost effect
      const boost = getEffect(userId, interaction.guild?.id, 'coin_boost');
      if (boost) earnings = Math.floor(earnings * 1.5);

      addCoins(userId, earnings);
      setCooldown(userId, `job_${job.id}`);

      const task        = job.tasks[Math.floor(Math.random() * job.tasks.length)];
      const isHighPay   = earnings >= job.max * 0.8;
      const nextTs      = Math.floor((Date.now() + job.cooldownMs) / 1000);

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(isHighPay ? 0xFFD700 : 0x2ECC71)
        .setTitle(`${isHighPay ? '🤑' : '✅'}  Shift Complete — ${job.emoji} ${job.name}`)
        .setDescription(`> You ${task}.\n\u200b`)
        .addFields(
          { name: '💸 Earned',      value: `**${fmt(earnings)}** coins${boost ? ' 💰' : ''}`, inline: true },
          { name: '💰 Balance',     value: `**${fmt(getBalance(userId))}** coins`, inline: true },
          { name: '⏱️ Next Shift',  value: `<t:${nextTs}:R>`,                    inline: true },
        )
        .setFooter({ text: `${job.emoji} ${job.name}  •  Check /jobs list for all cooldowns${boost ? '  •  💰 Coin Boost active' : ''}` })
        .setTimestamp()] });
    }
  },
};
