'use strict';

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { getSettings, setSettings, DEFAULTS } = require('../../casino/settings');

function fmt(n) { return Number(n).toLocaleString(); }

module.exports = {
  data: new SlashCommandBuilder()
    .setName('casino-settings')
    .setDescription('Configure casino settings (admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub => sub.setName('view').setDescription('View current casino settings'))
    .addSubcommand(sub => sub.setName('min-bet').setDescription('Set minimum bet')
      .addIntegerOption(o => o.setName('amount').setDescription('Minimum bet amount').setMinValue(1).setRequired(true)))
    .addSubcommand(sub => sub.setName('max-bet').setDescription('Set maximum bet')
      .addIntegerOption(o => o.setName('amount').setDescription('Maximum bet amount').setMinValue(1).setRequired(true)))
    .addSubcommand(sub => sub.setName('cooldown').setDescription('Set cooldown between games in seconds')
      .addIntegerOption(o => o.setName('seconds').setDescription('Seconds (0 = disabled)').setMinValue(0).setRequired(true)))
    .addSubcommand(sub => sub.setName('reset').setDescription('Reset all casino settings to defaults')),

  async execute(interaction) {
    const guildId = interaction.guildId;
    const sub     = interaction.options.getSubcommand();

    if (sub === 'view') {
      const s = getSettings(guildId);
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0x1a1a2e)
          .setTitle('⚙️  Casino Settings')
          .setDescription('All games use purely random outcomes.')
          .addFields(
            { name: '📉 Min Bet',  value: `**${fmt(s.minBet)}** coins`,                       inline: true },
            { name: '📈 Max Bet',  value: `**${fmt(s.maxBet)}** coins`,                       inline: true },
            { name: '⏱️ Cooldown', value: s.cooldownMs > 0 ? `**${s.cooldownMs / 1000}s**` : '**Disabled**', inline: true },
          )
          .setFooter({ text: 'YSER Flow Casino' })],
        flags: 64,
      });
    }

    if (sub === 'min-bet') {
      const amount = interaction.options.getInteger('amount');
      const s = getSettings(guildId);
      if (amount >= s.maxBet) return interaction.reply({ content: '❌ Min bet must be less than max bet.', flags: 64 });
      setSettings(guildId, { minBet: amount });
      return interaction.reply({ content: `✅ Minimum bet set to **${fmt(amount)}** coins.`, flags: 64 });
    }

    if (sub === 'max-bet') {
      const amount = interaction.options.getInteger('amount');
      const s = getSettings(guildId);
      if (amount <= s.minBet) return interaction.reply({ content: '❌ Max bet must be greater than min bet.', flags: 64 });
      setSettings(guildId, { maxBet: amount });
      return interaction.reply({ content: `✅ Maximum bet set to **${fmt(amount)}** coins.`, flags: 64 });
    }

    if (sub === 'cooldown') {
      const sec = interaction.options.getInteger('seconds');
      setSettings(guildId, { cooldownMs: sec * 1000 });
      return interaction.reply({ content: sec > 0 ? `✅ Cooldown set to **${sec}s**.` : '✅ Cooldown disabled.', flags: 64 });
    }

    if (sub === 'reset') {
      setSettings(guildId, { ...DEFAULTS });
      return interaction.reply({ content: '✅ Casino settings reset to defaults.', flags: 64 });
    }
  },
};
