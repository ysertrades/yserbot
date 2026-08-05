const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, MessageFlags } = require('discord.js');
const { calculateRisk, FUTURES_SPECS } = require('../../utils/riskCalculator.js');
const { generateRiskImage } = require('../../utils/riskVisual.js');

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
    // An integer option, not a number: a tick is the smallest move the
    // contract makes, so "10.5 ticks" is not a distance that exists. Discord
    // rejects the fraction at the prompt rather than the bot rejecting it
    // after the fact.
    // Named `ticks`, not `stop`. Discord shows the option *name* as you type
    // the command — the description only appears once that option is
    // selected — so an option called "stop" reads as "stop distance" and
    // invites the points figure the calculator no longer takes.
    .addIntegerOption((option) =>
      option
        .setName('ticks')
        .setDescription('Stop distance in ticks — whole ticks only (e.g. 8)')
        .setRequired(true)
        .setMinValue(1)
    ),

  async execute(interaction) {
    const symbol = interaction.options.getString('symbol');
    const riskUsd = interaction.options.getNumber('risk');
    const stopTicks = interaction.options.getInteger('ticks');

    const result = calculateRisk(symbol, riskUsd, stopTicks);

    if (result.error) {
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x474747)
            .setTitle('⚠️ Invalid Input')
            .setDescription(result.error)
            .setTimestamp(),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    const imageName = `risk_${symbol}_${Date.now()}.png`;
    const attachment = new AttachmentBuilder(generateRiskImage(result), { name: imageName });

    const embed = buildRiskEmbed(result).setImage(`attachment://${imageName}`);
    return interaction.reply({ embeds: [embed], files: [attachment] });
  },
};

/**
 * Build the risk calculator embed. Nearly everything (symbol, risk, stop,
 * contract counts, per-contract cost, leftover budget, recommendation) now
 * lives in the generated image — the embed text is intentionally just a
 * title and a one-line name lookup for the contract(s) involved.
 * @param {object} result - Output from calculateRisk()
 * @returns {EmbedBuilder}
 */
function buildRiskEmbed(result) {
  const { standard, micro, name, color } = result;

  // Strip trailing " Futures" so the header stays clean and short
  const displayName      = name.replace(/ Futures$/i, '');
  const microDisplayName = micro ? micro.name.replace(/ Futures$/i, '') : '';

  const nameLine = micro
    ? `${displayName} (${standard.symbol}) · ${microDisplayName} (${micro.symbol})`
    : `${displayName} (${standard.symbol})`;

  return new EmbedBuilder()
    .setColor(color)
    .setTitle('⚖️ Risk Calculator')
    .setDescription(nameLine)
    .setTimestamp()
    .setFooter({ text: 'Always trade within your plan.' });
}
