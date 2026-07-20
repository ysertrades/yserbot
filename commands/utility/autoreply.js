const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { createServerEmbed } = require('../../utils/embedBuilder');
const { readJson, writeJson } = require('../../utils/jsonStorage');

async function sendTempReply(interaction, embed) {
    const msg = await interaction.reply({ embeds: [embed], fetchReply: true });
    setTimeout(() => {
        interaction.deleteReply().catch(() => {});
    }, 5000);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('autoreply').setDescription('Manage auto-replies')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub => sub.setName('add').setDescription('Add auto-reply')
            .addStringOption(opt => opt.setName('name').setDescription('Name').setRequired(true))
            .addStringOption(opt => opt.setName('trigger').setDescription('Trigger text').setRequired(true))
            .addStringOption(opt => opt.setName('embed').setDescription('Embed template name').setRequired(true))
            .addBooleanOption(opt => opt.setName('exact').setDescription('Exact match?').setRequired(false))
            .addIntegerOption(opt => opt.setName('cooldown').setDescription('Cooldown in seconds').setMinValue(1).setMaxValue(3600).setRequired(false)))
        .addSubcommand(sub => sub.setName('remove').setDescription('Remove auto-reply')
            .addStringOption(opt => opt.setName('name').setDescription('Name').setRequired(true)))
        .addSubcommand(sub => sub.setName('list').setDescription('List auto-replies'))
        .addSubcommand(sub => sub.setName('toggle').setDescription('Toggle auto-reply')
            .addStringOption(opt => opt.setName('name').setDescription('Name').setRequired(true))),
    async execute(interaction) {
        const autoreplies = readJson('autoreplies.json', {});
        const guildId = interaction.guild.id;
        if (!autoreplies[guildId]) autoreplies[guildId] = {};
        const sub = interaction.options.getSubcommand();

        if (sub === 'add') {
            const name = interaction.options.getString('name').toLowerCase();
            if (autoreplies[guildId][name]) return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Error', description: 'Auto-reply exists.' }, interaction.guild)], ephemeral: true });
            autoreplies[guildId][name] = {
                trigger: interaction.options.getString('trigger'),
                embedName: interaction.options.getString('embed').toLowerCase(),
                exact: interaction.options.getBoolean('exact') || false,
                cooldown: interaction.options.getInteger('cooldown') || 5,
                enabled: true,
            };
            writeJson('autoreplies.json', autoreplies);
            const embed = createServerEmbed('success', { title: 'Added', description: `Auto-reply **${name}** added.` }, interaction.guild);
            await sendTempReply(interaction, embed);
        } else if (sub === 'remove') {
            const name = interaction.options.getString('name').toLowerCase();
            if (!autoreplies[guildId][name]) return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Error', description: 'Not found.' }, interaction.guild)], ephemeral: true });
            delete autoreplies[guildId][name];
            writeJson('autoreplies.json', autoreplies);
            const embed = createServerEmbed('success', { title: 'Removed', description: `Auto-reply **${name}** removed.` }, interaction.guild);
            await sendTempReply(interaction, embed);
        } else if (sub === 'list') {
            const list = Object.entries(autoreplies[guildId] || {});
            const embed = createServerEmbed('info', { title: 'Auto-Replies', description: list.length ? list.map(([n, d]) => `• **${n}**: "${d.trigger}" → ${d.embedName} (${d.enabled ? 'On' : 'Off'})`).join('\n') : 'None.' }, interaction.guild);
            await interaction.reply({ embeds: [embed] });
        } else if (sub === 'toggle') {
            const name = interaction.options.getString('name').toLowerCase();
            if (!autoreplies[guildId][name]) return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Error', description: 'Not found.' }, interaction.guild)], ephemeral: true });
            autoreplies[guildId][name].enabled = !autoreplies[guildId][name].enabled;
            writeJson('autoreplies.json', autoreplies);
            const embed = createServerEmbed('success', { title: 'Toggled', description: `Auto-reply **${name}** is now ${autoreplies[guildId][name].enabled ? 'enabled' : 'disabled'}.` }, interaction.guild);
            await sendTempReply(interaction, embed);
        }
    },
};
