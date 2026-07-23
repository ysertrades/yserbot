'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Handles all interactions whose customId starts with "job:"
// Button IDs:
//   job:work:<job_id>   — clock into a job
//   job:list            — return to jobs hub
//   job:close           — delete the message
// ─────────────────────────────────────────────────────────────────────────────

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { addCoins, getBalance, checkCooldown, setCooldown } = require('../utils/economyManager');
const { getEffect } = require('../utils/effectsManager');

const fmt = n => Number(n).toLocaleString();

module.exports = {
  name: 'interactionCreate',
  async execute(interaction) {
    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith('job:')) return;

    const parts = interaction.customId.split(':');
    const type  = parts[1]; // 'work' | 'list' | 'close'

    // ── Close ────────────────────────────────────────────────────────────────
    if (type === 'close') {
      try { await interaction.message.delete(); } catch {}
      return;
    }

    // ── Back to list ──────────────────────────────────────────────────────────
    if (type === 'list') {
      const { buildJobsEmbed, buildJobsRows } = require('../commands/economy/jobs');
      return interaction.update({
        embeds:     [buildJobsEmbed(interaction.user.id, interaction.guild?.id)],
        components: buildJobsRows(interaction.user.id),
      });
    }

    // ── Work a job ────────────────────────────────────────────────────────────
    if (type === 'work') {
      const { JOBS, buildJobsEmbed, buildJobsRows } = require('../commands/economy/jobs');
      const jobId  = parts[2];
      const job    = JOBS.find(j => j.id === jobId);
      if (!job) return interaction.reply({ content: '❌ Unknown job.', flags: 64 });

      const userId  = interaction.user.id;
      const guildId = interaction.guild?.id;

      // ── On cooldown → show "still on shift" embed (styled like wheel daily limit) ──
      const cd = checkCooldown(userId, `job_${job.id}`, job.cooldownMs);
      if (cd > 0) {
        const ts = Math.floor((Date.now() + cd) / 1000);
        const cooldownEmbed = new EmbedBuilder()
          .setColor(0xFF4757)
          .setTitle(`⏳  ${job.emoji} ${job.name} — Still on Shift`)
          .setDescription(
            `You're still recovering from your last **${job.emoji} ${job.name}** shift.\n` +
            `You'll be clocked back in **<t:${ts}:R>**.\n\u200b`
          )
          .addFields(
            { name: '⏱️ Shift Cooldown',  value: `**${job.cooldownLabel}** between shifts`,     inline: true },
            { name: '📅 Available Again', value: `<t:${ts}:R>`,                                  inline: true },
            { name: '💡 Tip',             value: 'Check other jobs — some may still be ready!',  inline: false },
          )
          .setFooter({ text: `YSER Jobs  •  ${job.emoji} ${job.name}  •  Come back later` })
          .setTimestamp();

        const backRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('job:list').setLabel('← Jobs').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('job:close').setLabel('🔒 Close').setStyle(ButtonStyle.Danger),
        );
        return interaction.update({ embeds: [cooldownEmbed], components: [backRow] });
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
      if (boost) earnings = Math.floor(earnings * 1.5);

      addCoins(userId, earnings);
      setCooldown(userId, `job_${job.id}`);

      const task      = job.tasks[Math.floor(Math.random() * job.tasks.length)];
      const isHighPay = earnings >= job.max * 0.8;
      const nextTs    = Math.floor((Date.now() + job.cooldownMs) / 1000);
      const newBal    = getBalance(userId);

      const resultEmbed = new EmbedBuilder()
        .setColor(isHighPay ? 0xFFD700 : boost ? 0x27AE60 : 0x2ECC71)
        .setTitle(`${isHighPay ? '🤑' : '✅'}  Shift Complete — ${job.emoji} ${job.name}`)
        .setDescription(`> You ${task}.\n\u200b`)
        .addFields(
          { name: '💸 Earned',      value: `**${fmt(earnings)}** coins${boost ? ' 💰' : ''}`, inline: true },
          { name: '💰 Balance',     value: `**${fmt(newBal)}** coins`,                         inline: true },
          { name: '⏱️ Next Shift',  value: `<t:${nextTs}:R>`,                                  inline: true },
        )
        .setFooter({
          text: `${job.emoji} ${job.name}  •  YSER Jobs${boost ? '  •  💰 Coin Boost active (1.5×)' : ''}`,
        })
        .setTimestamp();

      if (boost) {
        resultEmbed.addFields({
          name: '💰 Coin Boost',
          value: 'Active this session — your earnings were **1.5×**!',
          inline: false,
        });
      }

      const afterRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('job:list').setLabel('💼 Back to Jobs').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('job:close').setLabel('🔒 Close').setStyle(ButtonStyle.Danger),
      );

      return interaction.update({ embeds: [resultEmbed], components: [afterRow] });
    }
  },
};
