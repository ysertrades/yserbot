'use strict';

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { readJson } = require('../../utils/jsonStorage');

const REASON_LABELS = {
  spam:          '📨 Spam',
  insult:        '🗣️ Insult / Harassment',
  advertisement: '📢 Advertisement',
  nsfw:          '🔞 NSFW Content',
  raiding:       '⚔️ Raiding',
  scam:          '💸 Scam / Phishing',
  other:         '❓ Other',
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('report').setDescription('Report a user to the moderation team')
    .addUserOption(o => o.setName('user').setDescription('User to report').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for report').setRequired(true)
      .addChoices(
        { name: '📨 Spam',                value: 'spam'          },
        { name: '🗣️ Insult / Harassment',  value: 'insult'        },
        { name: '📢 Advertisement',        value: 'advertisement' },
        { name: '🔞 NSFW Content',         value: 'nsfw'          },
        { name: '⚔️ Raiding',              value: 'raiding'       },
        { name: '💸 Scam / Phishing',      value: 'scam'          },
        { name: '❓ Other',                value: 'other'         },
      ))
    .addStringOption(o => o.setName('link').setDescription('Link to the message (optional)').setRequired(false)),

  async execute(interaction) {
    const target     = interaction.options.getUser('user');
    const reasonKey  = interaction.options.getString('reason');
    const link       = interaction.options.getString('link');

    if (target.id === interaction.user.id)
      return interaction.reply({ content: '❌ You cannot report yourself.', ephemeral: true });
    if (target.bot)
      return interaction.reply({ content: '❌ You cannot report bots.', ephemeral: true });

    const config     = readJson('config.json', {});
    const gCfg       = config[interaction.guild.id] || {};
    const reportChId = gCfg.reportChannel;
    const reportRole = gCfg.reportRole;

    if (!reportChId) {
      return interaction.reply({ content: '❌ No report channel configured. Ask an admin to run `/config report-channel`.', ephemeral: true });
    }

    const reportCh = interaction.guild.channels.cache.get(reportChId);
    if (!reportCh) return interaction.reply({ content: '❌ Configured report channel not found.', ephemeral: true });

    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('🚨 New User Report')
      .setThumbnail(target.displayAvatarURL({ dynamic: true }))
      .addFields(
        { name: '👤 Reported User', value: `<@${target.id}> \`${target.tag}\``,         inline: true  },
        { name: '📝 Reporter',      value: `<@${interaction.user.id}>`,                  inline: true  },
        { name: '\u200b',           value: '\u200b',                                     inline: true  },
        { name: '🏷️ Reason',        value: REASON_LABELS[reasonKey] || reasonKey,        inline: false },
      )
      .setTimestamp()
      .setFooter({ text: `Report from ${interaction.guild.name}` });

    if (link) embed.addFields({ name: '🔗 Message Link', value: link, inline: false });

    const actionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`rpt_action:${target.id}:${reportChId}`)
        .setLabel('⚡ Take Action')
        .setStyle(ButtonStyle.Danger),
    );

    const content = reportRole ? `<@&${reportRole}>` : undefined;
    const msg = await reportCh.send({ content, embeds: [embed], components: [actionRow] });

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle('✅ Report Submitted')
          .setDescription(`Your report against <@${target.id}> has been sent to the moderation team.\n\nThank you for helping keep the server safe.`)
          .setTimestamp(),
      ],
      ephemeral: true,
    });
  },
};
