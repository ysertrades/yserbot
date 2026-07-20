'use strict';

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getBalance } = require('../../utils/economyManager');
const { getSettings } = require('../../casino/settings');

function fmt(n) { return Number(n).toLocaleString(); }

function mainEmbed(userId, guildId, lastResult) {
  const balance = getBalance(userId);
  const s       = getSettings(guildId);
  let resultLine = '—';
  if (lastResult) {
    const sign = lastResult.delta >= 0 ? '+' : '';
    resultLine = `${lastResult.label}  (${sign}${fmt(lastResult.delta)} coins)`;
  }
  return new EmbedBuilder()
    .setColor(0x1a1a2e)
    .setTitle('🎰  YSER Casino')
    .setDescription(
      '> *Select a game to begin. All games use purely random outcomes — no patterns, no predictions.*',
    )
    .addFields(
      { name: '💰 Balance',     value: `**${fmt(balance)}** coins`,            inline: true },
      { name: '📊 Last Result', value: resultLine,                             inline: true },
      { name: '📋 Bet Range',   value: `${fmt(s.minBet)} – ${fmt(s.maxBet)}`, inline: true },
    )
    .setFooter({ text: 'YSER Flow Casino  •  Bet responsibly' });
}

function mainRows() {
  const btn = (id, label, style) =>
    new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
  const S = ButtonStyle.Secondary, G = ButtonStyle.Success;
  return [
    new ActionRowBuilder().addComponents(
      btn('cs:game:blackjack', '🃏 Blackjack', S),
      btn('cs:game:slots',     '🎰 Slots',     S),
      btn('cs:game:coinflip',  '🎲 Coinflip',  S),
    ),
    new ActionRowBuilder().addComponents(
      btn('cs:game:dice',      '🎲 Dice',      S),
      btn('cs:game:trading',   '📈 Trade',     S),
      btn('cs:game:crash',     '🛩️ Crash',     S),
    ),
    new ActionRowBuilder().addComponents(
      btn('cs:game:horse',     '🐎 Horses',    G),
      btn('cs:game:turtle',    '🐢 Turtles',   G),
      btn('cs:game:roulette',  '🎡 Roulette',  S),
    ),
    new ActionRowBuilder().addComponents(
      btn('cs:game:wheel',     '🎰 Wheel',     S),
    ),
  ];
}

// Legacy single-row helper used by casinoInteraction for menu return
function mainRow() { return mainRows()[0]; }

module.exports = {
  data: new SlashCommandBuilder()
    .setName('casino').setDescription('Open the YSER Casino'),

  async execute(interaction) {
    const { createSession } = require('../../casino/sessions');
    const msg = await interaction.reply({
      embeds: [mainEmbed(interaction.user.id, interaction.guildId, null)],
      components: mainRows(),
      withResponse: true,
    });
    const messageId = msg.resource?.message?.id ?? msg.id ?? null;
    createSession(interaction.user.id, interaction.guildId, messageId);
  },

  mainEmbed, mainRows, mainRow, fmt,
};
