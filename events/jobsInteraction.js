'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Handles all interactions whose customId starts with "job:"
// Button IDs:
//   job:work:<job_id>:<owner_id>  — clock into a job
//   job:list:<owner_id>           — return to jobs hub
//   job:close:<owner_id>          — delete the message
// The owner id is checked on every one of them: a Jobs Hub is one member's
// panel, not a shared one.
// ─────────────────────────────────────────────────────────────────────────────

const { EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { addCoins, getBalance, checkCooldown, setCooldown } = require('../utils/economyManager');
const { getEffect } = require('../utils/effectsManager');
const { JOB_ICONS, JOB_COLORS, generateJobCardImage } = require('../utils/jobsVisual');

module.exports = {
  name: 'interactionCreate',
  async execute(interaction) {
    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith('job:')) return;

    const parts = interaction.customId.split(':');
    const type  = parts[1]; // 'work' | 'list' | 'close'

    // The hub belongs to whoever opened it — its id is baked into every
    // button. Without this, anyone could clock into a job on someone else's
    // panel (overwriting their view with their own result) or close it.
    const ownerId = type === 'work' ? parts[3] : parts[2];
    if (ownerId && interaction.user.id !== ownerId) {
      return interaction.reply({
        content: `🔒 This Jobs Hub belongs to <@${ownerId}> — run \`/jobs\` to open your own.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── Close ────────────────────────────────────────────────────────────────
    if (type === 'close') {
      try { await interaction.message.delete(); } catch {}
      return;
    }

    // ── Back to list ──────────────────────────────────────────────────────────
    if (type === 'list') {
      const { buildJobsPayload, buildJobsRows } = require('../commands/economy/jobs');
      return interaction.update({
        ...buildJobsPayload(interaction.user.id, interaction.guild?.id),
        components: buildJobsRows(interaction.user.id, interaction.guild?.id),
      });
    }

    // ── Work a job ────────────────────────────────────────────────────────────
    if (type === 'work') {
      const { JOBS } = require('../commands/economy/jobs');
      const jobId  = parts[2];
      const job    = JOBS.find(j => j.id === jobId);
      if (!job) return interaction.reply({ content: '❌ Unknown job.', flags: MessageFlags.Ephemeral });

      const userId  = interaction.user.id;
      const guildId = interaction.guild?.id;
      const icon    = JOB_ICONS[job.id];
      const jobColor = JOB_COLORS[job.id];

      // ── On cooldown → "still on shift" visual ───────────────────────────────
      const cd = checkCooldown(userId, `job_${job.id}`, job.cooldownMs, guildId);
      if (cd > 0) {
        const ts = Math.floor((Date.now() + cd) / 1000);
        const imageName  = `job_cooldown_${Date.now()}.png`;
        const attachment = new AttachmentBuilder(generateJobCardImage({
          icon, accent: [255, 80, 80, 255],
          kicker: job.name, banner: 'Still On Shift',
          task: 'Check other jobs — some may still be ready!',
        }), { name: imageName });
        const embed = new EmbedBuilder().setImage(`attachment://${imageName}`).setDescription(`Back on shift <t:${ts}:R>.`);

        const backRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`job:list:${userId}`).setLabel('← Jobs').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`job:close:${userId}`).setLabel('🔒 Close').setStyle(ButtonStyle.Secondary),
        );
        return interaction.update({ embeds: [embed], files: [attachment], components: [backRow] });
      }

      // ── Ready — calculate earnings ────────────────────────────────────────
      let earnings;
      if (job.variance) {
        const spike = Math.random() < 0.15;
        earnings    = spike
          ? Math.floor(job.max * (0.80 + Math.random() * 0.20))
          : Math.floor(job.min + Math.random() * (job.max - job.min) * 0.4);
      } else {
        earnings = Math.floor(job.min + Math.random() * (job.max - job.min));
      }

      const boost = getEffect(userId, guildId, 'coin_boost');
      if (boost) earnings = Math.floor(earnings * (boost.multiplier || 1.5));

      addCoins(userId, earnings);
      setCooldown(userId, `job_${job.id}`);

      const task      = job.tasks[Math.floor(Math.random() * job.tasks.length)];
      const isHighPay = earnings >= job.max * 0.8;
      const nextTs    = Math.floor((Date.now() + job.cooldownMs) / 1000);
      const newBal    = getBalance(userId);

      const accent = isHighPay ? [255, 215, 0, 255] : boost ? [46, 204, 113, 255] : jobColor;
      const banner = isHighPay ? 'Huge Payout!' : 'Shift Complete';
      const taskLine = `You ${task}${boost ? ` (coin boost active — ${boost.multiplier || 1.5}x!)` : ''}.`;

      const imageName  = `job_result_${Date.now()}.png`;
      const attachment = new AttachmentBuilder(generateJobCardImage({
        icon, accent, kicker: job.name, banner, task: taskLine,
        amountLabel: `+${earnings.toLocaleString()} COINS`,
      }), { name: imageName });
      const embed = new EmbedBuilder()
        .setImage(`attachment://${imageName}`)
        .setDescription(`💰 Balance: **${newBal.toLocaleString()}** coins · Next shift <t:${nextTs}:R>`);

      const afterRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`job:list:${userId}`).setLabel('💼 Back to Jobs').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`job:close:${userId}`).setLabel('🔒 Close').setStyle(ButtonStyle.Secondary),
      );

      return interaction.update({ embeds: [embed], files: [attachment], components: [afterRow] });
    }
  },
};
