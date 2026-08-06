'use strict';

const {
  SlashCommandBuilder, PermissionFlagsBits,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags,
} = require('discord.js');
const polls = require('../../utils/pollManager');

const LETTERS = 'ABCDE';

/**
 * The poll message.
 *
 * Built from the stored poll rather than from whatever the previous message
 * said, so a vote is a redraw from the record instead of an edit of a body of
 * text — which is what let a lost tally silently rewrite the visible numbers.
 */
function buildPoll(poll) {
  const counts = polls.tally(poll);
  const total = polls.totalVotes(poll);
  const closed = !!poll.closedAt;

  const embed = new EmbedBuilder()
    .setColor(closed ? 0x5A6472 : 0x5865F2)
    .setTitle(closed ? '📊 Poll — closed' : '📊 Poll')
    .setDescription(`**${poll.question}**`)
    .addFields(poll.options.map((o, i) => ({
      name: `${LETTERS[i]}. ${o}`,
      // The share as well as the count: ten votes means nothing until you know
      // whether it was out of twelve or out of four hundred.
      value: total > 0
        ? `${bar(counts[i], total)}  **${counts[i]}** · ${Math.round((counts[i] / total) * 100)}%`
        : '**0** votes',
      inline: false,
    })))
    .setFooter({
      text: closed
        ? `Closed · ${total} vote${total === 1 ? '' : 's'}`
        : `${poll.createdByName ? `Created by ${poll.createdByName} • ` : ''}${total} vote${total === 1 ? '' : 's'} • Click a button to vote`,
    })
    .setTimestamp(new Date(poll.createdAt));

  if (closed) return { embeds: [embed], components: [] };

  const buttons = poll.options.map((o, i) => new ButtonBuilder()
    .setCustomId(`poll_vote_${i}`)
    .setLabel(LETTERS[i])
    .setStyle(ButtonStyle.Primary));

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(buttons)] };
}

const BAR_WIDTH = 12;
function bar(count, total) {
  const filled = total > 0 ? Math.round((count / total) * BAR_WIDTH) : 0;
  return '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
}

/** The options printed on a message, for a poll this store has never seen. */
function optionsFromEmbed(embed) {
  const fields = Array.isArray(embed?.fields) ? embed.fields : [];
  return fields.map(f => String(f.name).replace(/^[A-E]\.\s*/, ''));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('poll').setDescription('Create a poll')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption(opt => opt.setName('question').setDescription('Question').setRequired(true))
    .addStringOption(opt => opt.setName('option1').setDescription('Option 1').setRequired(true))
    .addStringOption(opt => opt.setName('option2').setDescription('Option 2').setRequired(true))
    .addStringOption(opt => opt.setName('option3').setDescription('Option 3').setRequired(false))
    .addStringOption(opt => opt.setName('option4').setDescription('Option 4').setRequired(false))
    .addStringOption(opt => opt.setName('option5').setDescription('Option 5').setRequired(false)),

  async execute(interaction) {
    const question = interaction.options.getString('question');
    const options = [];
    for (let i = 1; i <= polls.MAX_OPTIONS; i++) {
      const opt = interaction.options.getString(`option${i}`);
      if (opt) options.push(opt);
    }

    // Posted before it is stored, because the message id is the poll's id —
    // there is nothing to key the record on until Discord has given us one.
    const draft = {
      messageId: 'pending', channelId: interaction.channelId, question, options,
      votes: {}, createdAt: Date.now(),
      createdBy: interaction.user.id, createdByName: interaction.user.tag, closedAt: null,
    };
    const msg = await interaction.reply({ ...buildPoll(draft), fetchReply: true });

    polls.create(interaction.guild.id, {
      channelId: interaction.channelId,
      messageId: msg.id,
      question,
      options,
      createdBy: interaction.user.id,
      createdByName: interaction.user.tag,
    });
  },

  buildPoll,

  // Handle vote button clicks: customId is `poll_vote_<optionIndex>`, and the
  // older `poll_vote_<optionIndex>_<timestamp>` from messages posted before
  // the id stopped carrying one.
  async handleButton(interaction) {
    if (!interaction.customId.startsWith('poll_vote_')) return;

    const optionIndex = parseInt(interaction.customId.split('_')[2], 10);
    const guildId = interaction.guild.id;
    const messageId = interaction.message.id;

    let result = polls.vote(guildId, messageId, interaction.user.id, optionIndex);

    if (result === null) {
      // A poll from before any of this was stored. Its options are still
      // printed on its own message, so it can be adopted and carry on — with
      // an empty tally, because there is genuinely nothing to recover.
      const source = interaction.message.embeds?.[0];
      const options = optionsFromEmbed(source);
      if (options.length === 0) {
        return interaction.reply({
          content: '⚠️ This poll has lost its options, so votes cannot be counted. Start a new one with `/poll`.',
          flags: MessageFlags.Ephemeral,
        });
      }
      polls.adopt(guildId, {
        channelId: interaction.channelId,
        messageId,
        question: String(source.description || 'Poll').replace(/\*\*/g, ''),
        options,
      });
      result = polls.vote(guildId, messageId, interaction.user.id, optionIndex);
    }

    if (!result || result.invalid) {
      return interaction.reply({ content: '⚠️ That option is no longer on this poll.', flags: MessageFlags.Ephemeral });
    }
    if (result.closed) {
      return interaction.reply({ content: '🔒 This poll is closed.', flags: MessageFlags.Ephemeral });
    }

    return interaction.update(buildPoll(result.poll));
  },
};
