const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

const pollVotes = new Map(); // messageId -> Map(optionIndex -> Set(userIds))

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
        for (let i = 1; i <= 5; i++) {
            const opt = interaction.options.getString(`option${i}`);
            if (opt) options.push(opt);
        }

        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('📊 Poll')
            .setDescription(`**${question}**`)
            .addFields(options.map((o, i) => ({ name: `${String.fromCharCode(65 + i)}. ${o}`, value: '**0** votes', inline: false })))
            .setFooter({ text: `Created by ${interaction.user.tag} • Click a button to vote` })
            .setTimestamp();

        const buttons = options.map((o, i) => 
            new ButtonBuilder()
                .setCustomId(`poll_vote_${i}_${Date.now()}`)
                .setLabel(`${String.fromCharCode(65 + i)}`)
                .setStyle(ButtonStyle.Primary)
        );

        const rows = [];
        for (let i = 0; i < buttons.length; i += 5) {
            rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
        }

        const msg = await interaction.reply({ embeds: [embed], components: rows, fetchReply: true });

        pollVotes.set(msg.id, new Map());
        for (let i = 0; i < options.length; i++) {
            pollVotes.get(msg.id).set(i, new Set());
        }
    },
};

module.exports.pollVotes = pollVotes;

// Handle vote button clicks: customId format is `poll_vote_<optionIndex>_<timestamp>`
module.exports.handleButton = async function(interaction) {
    if (!interaction.customId.startsWith('poll_vote_')) return;

    const parts = interaction.customId.split('_');
    const optionIndex = parseInt(parts[2]);
    const messageId = interaction.message.id;

    let votes = pollVotes.get(messageId);
    if (!votes) {
        // Rebuild vote tracking from the embed if the bot restarted after the poll was created
        votes = new Map();
        const embed = interaction.message.embeds[0];
        embed.fields.forEach((_, i) => votes.set(i, new Set()));
        pollVotes.set(messageId, votes);
    }

    // Remove the user's vote from any other option, then apply the new one
    for (const [, voters] of votes) {
        voters.delete(interaction.user.id);
    }
    votes.get(optionIndex)?.add(interaction.user.id);

    const embed = EmbedBuilder.from(interaction.message.embeds[0]);
    const fields = embed.data.fields.map((field, i) => ({
        name: field.name,
        value: `**${votes.get(i)?.size || 0}** votes`,
        inline: false,
    }));
    embed.setFields(fields);

    await interaction.update({ embeds: [embed] });
};
