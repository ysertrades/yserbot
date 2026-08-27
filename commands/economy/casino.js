'use strict';

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getBalance } = require('../../utils/economyManager');
const { getSettings, enabledGames } = require('../../casino/settings');
const { GAMES } = require('../../casino/games');
const { getEffectiveMaxBet } = require('../../utils/effectsManager');

function fmt(n) { return Number(n).toLocaleString(); }

function mainEmbed(userId, guildId, lastResult) {
  const balance = getBalance(userId);
  const s       = getSettings(guildId);
  const maxBet  = getEffectiveMaxBet(userId, guildId, s.maxBet);
  const isVip   = maxBet > s.maxBet;
  let resultLine = '—';
  if (lastResult) {
    const sign = lastResult.delta >= 0 ? '+' : '';
    resultLine = `${lastResult.label}  (${sign}${fmt(lastResult.delta)} coins)`;
  }
  // With every game switched off the menu has no buttons at all, which reads
  // as the bot being broken rather than as a deliberate setting.
  const anyGames = enabledGames(guildId).length > 0;
  return new EmbedBuilder()
    .setColor(0x1a1a2e)
    .setTitle('🎰  QuantLab Casino')
    .setDescription(anyGames
      ? '> *Select a game to begin. All games use purely random outcomes — no patterns, no predictions.*'
      : '> *The casino is closed — every game is switched off on this server.*')
    .addFields(
      { name: '💰 Balance',     value: `**${fmt(balance)}** coins`,            inline: true },
      { name: '📊 Last Result', value: resultLine,                             inline: true },
      { name: '📋 Bet Range',   value: `${fmt(s.minBet)} – ${fmt(maxBet)}${isVip ? ' 👑' : ''}`, inline: true },
    )
    .setFooter({ text: 'QuantLab Casino  •  Bet responsibly' });
}

/**
 * The game menu, built from the shared registry and filtered to whatever this
 * server has switched on in the control panel.
 *
 * Laid out three to a row and re-flowed, so switching a game off closes the
 * gap rather than leaving a hole where its button used to be.
 */
function mainRows(guildId) {
  const on = new Set(enabledGames(guildId));
  const buttons = GAMES.filter(g => on.has(g.key)).map(g =>
    new ButtonBuilder()
      .setCustomId(`cs:game:${g.key}`)
      .setLabel(`${g.emoji} ${g.label}`)
      .setStyle(g.style));

  const rows = [];
  for (let i = 0; i < buttons.length; i += 3) {
    rows.push(new ActionRowBuilder().addComponents(...buttons.slice(i, i + 3)));
  }
  return rows;
}

// Legacy single-row helper. Kept because it is exported; nothing in the repo
// calls it any more.
function mainRow(guildId) { return mainRows(guildId)[0]; }

module.exports = {
  data: new SlashCommandBuilder()
    .setName('casino').setDescription('Open the QuantLab Casino'),

  async execute(interaction) {
    const { createSession } = require('../../casino/sessions');

    // Acknowledge immediately to avoid Discord 10062 (Unknown interaction)
    await interaction.deferReply();

    await interaction.editReply({
      embeds: [mainEmbed(interaction.user.id, interaction.guildId, null)],
      components: mainRows(interaction.guildId),
    });

    const msg = await interaction.fetchReply();
    const messageId = msg?.id ?? null;
    createSession(interaction.user.id, interaction.guildId, messageId);
  },

  mainEmbed, mainRows, mainRow, fmt,
};
