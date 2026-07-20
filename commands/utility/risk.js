const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { calculateRisk, formatUsd, FUTURES_SPECS } = require('../../utils/riskCalculator.js');

const symbolChoices = Object.keys(FUTURES_SPECS).map((sym) => ({
  name: sym,
  value: sym,
}));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('risk')
    .setDescription('Calculate futures position size based on your risk and stop distance')
    .addStringOption((option) =>
      option
        .setName('symbol')
        .setDescription('Futures contract symbol (e.g. ES, NQ, GC)')
        .setRequired(true)
        .addChoices(...symbolChoices)
    )
    .addNumberOption((option) =>
      option
        .setName('risk')
        .setDescription('Total risk amount in USD (e.g. 100)')
        .setRequired(true)
        .setMinValue(1)
    )
    .addNumberOption((option) =>
      option
        .setName('stop')
        .setDescription('Stop distance in POINTS (e.g. 2.5)')
        .setRequired(true)
        .setMinValue(0.01)
    ),

  async execute(interaction) {
    const symbol = interaction.options.getString('symbol');
    const riskUsd = interaction.options.getNumber('risk');
    const stopPoints = interaction.options.getNumber('stop');

    const result = calculateRisk(symbol, riskUsd, stopPoints);

    if (result.error) {
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x474747)
            .setTitle('⚠️ Invalid Input')
            .setDescription(result.error)
            .setTimestamp(),
        ],
        ephemeral: true,
      });
    }

    const embed = buildRiskEmbed(result);
    return interaction.reply({ embeds: [embed] });
  },
};

/**
 * Build the risk calculator embed with beautiful formatting
 * @param {object} result - Output from calculateRisk()
 * @returns {EmbedBuilder}
 */
function buildRiskEmbed(result) {
  const { standard, micro, needsMicro, riskUsd, stopPoints, symbol, name, color } = result;

  // Strip trailing " Futures" so the header stays clean and short
  const displayName      = name.replace(/ Futures$/i, '');
  const microDisplayName = micro ? micro.name.replace(/ Futures$/i, '') : '';

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle('⚖️ Risk Calculator')
    .setDescription(
      [
        '```',
        `  Symbol  │  ${symbol}`,
        `  Risk    │  ${formatUsd(riskUsd)}`,
        `  Stop    │  ${stopPoints} pts`,
        '```',
      ].join('\n')
    )
    .setTimestamp()
    .setFooter({ text: 'Always trade within your plan.' });

  // ── Standard contract block ────────────────────────────────────────────────
  if (standard.contracts >= 1) {
    embed.addFields({
      name: '🏛️ Standard Contract',
      value: [
        `> 📦 **Contracts:** \`${standard.contracts}\``,
        `> 💸 **Risk / contract:** \`${formatUsd(standard.riskPerContract)}\``,
        `> 💵 **Total risk used:** \`${formatUsd(standard.totalRisk)}\``,
        `> 🪙 **Leftover:** \`${formatUsd(riskUsd - standard.totalRisk)}\``,
      ].join('\n'),
      inline: false,
    });
  } else {
    embed.addFields({
      name: '🏛️ Standard Contract',
      value: [
        `> 🚫 \`0 contracts\` — stop too wide for ${formatUsd(riskUsd)} risk.`,
        `> 📏 **Minimum needed:** \`${formatUsd(standard.riskPerContract)}\``,
      ].join('\n'),
      inline: false,
    });
  }

  // ── Micro contract block ───────────────────────────────────────────────────
  if (micro) {
    embed.addFields({ name: '\u200b', value: '\u200b', inline: false });

    const microLabel = needsMicro
      ? '🔬 Micro Contract *(fallback)*'
      : '🔬 Micro Contract *(alternative)*';

    if (micro.contracts >= 1) {
      embed.addFields({
        name: microLabel,
        value: [
          `> 🏷️ **Symbol:** \`${micro.symbol}\` — ${microDisplayName}`,
          `> 📦 **Contracts:** \`${micro.contracts}\``,
          `> 💵 **Total risk used:** \`${formatUsd(micro.totalRisk)}\``,
          `> 🪙 **Leftover:** \`${formatUsd(riskUsd - micro.totalRisk)}\``,
        ].join('\n'),
        inline: false,
      });
    } else {
      embed.addFields({
        name: microLabel,
        value: [
          `> 🚫 \`0 contracts\` — even micro too wide for ${formatUsd(riskUsd)}.`,
          `> 📉 Lower your stop or increase risk budget.`,
        ].join('\n'),
        inline: false,
      });
    }
  }

  // ── Recommendation ─────────────────────────────────────────────────────────
  embed.addFields({ name: '\u200b', value: '\u200b', inline: false });

  let recValue;
  if (standard.contracts >= 1 && micro?.contracts >= 1) {
    recValue = `✅ **${standard.contracts}× ${standard.symbol}** or **${micro.contracts}× ${micro.symbol}** — both fit your risk.`;
  } else if (standard.contracts >= 1) {
    recValue = `✅ Trade **${standard.contracts}× ${standard.symbol}** — within budget.`;
  } else if (micro?.contracts >= 1) {
    recValue = `⚡ Standard too large. Trade **${micro.contracts}× ${micro.symbol}** instead.`;
  } else {
    recValue = `❌ Risk budget too small for any contract. Widen budget or tighten stop.`;
  }

  embed.addFields({
    name: '🎯 Recommendation',
    value: recValue,
    inline: false,
  });

  return embed;
}
