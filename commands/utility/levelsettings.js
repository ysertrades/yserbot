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
        .setName('levelsettings').setDescription('Configure leveling system')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub => sub.setName('xprange').setDescription('Set XP per message range')
            .addIntegerOption(opt => opt.setName('min').setDescription('Minimum XP').setMinValue(1).setMaxValue(100).setRequired(true))
            .addIntegerOption(opt => opt.setName('max').setDescription('Maximum XP').setMinValue(1).setMaxValue(100).setRequired(true)))
        .addSubcommand(sub => sub.setName('basexp').setDescription('Set base XP for level 1')
            .addIntegerOption(opt => opt.setName('amount').setDescription('Base XP').setMinValue(10).setMaxValue(1000).setRequired(true)))
        .addSubcommand(sub => sub.setName('multiplier').setDescription('Set level multiplier')
            .addNumberOption(opt => opt.setName('value').setDescription('Multiplier (e.g. 1.5)').setMinValue(1.0).setMaxValue(5.0).setRequired(true)))
        .addSubcommand(sub => sub.setName('addrole').setDescription('Add level role reward')
            .addIntegerOption(opt => opt.setName('level').setDescription('Level required').setMinValue(1).setMaxValue(1000).setRequired(true))
            .addRoleOption(opt => opt.setName('role').setDescription('Role to give').setRequired(true)))
        .addSubcommand(sub => sub.setName('removerole').setDescription('Remove level role reward')
            .addIntegerOption(opt => opt.setName('level').setDescription('Level').setMinValue(1).setMaxValue(1000).setRequired(true)))
        .addSubcommand(sub => sub.setName('view').setDescription('View current leveling settings')),
    async execute(interaction) {
        const levels = readJson('levels.json', {});
        const guildId = interaction.guild.id;
        if (!levels[guildId]) levels[guildId] = { users: {}, roles: {}, settings: { xpPerMessage: [15, 25], baseXp: 100, multiplier: 1.5 } };
        const sub = interaction.options.getSubcommand();

        if (sub === 'xprange') {
            const min = interaction.options.getInteger('min');
            const max = interaction.options.getInteger('max');
            levels[guildId].settings.xpPerMessage = [min, max];
            writeJson('levels.json', levels);
            const embed = createServerEmbed('success', { title: 'XP Range Set', description: `XP per message: **${min}** - **${max}**` }, interaction.guild);
            await sendTempReply(interaction, embed);
        } else if (sub === 'basexp') {
            const amount = interaction.options.getInteger('amount');
            levels[guildId].settings.baseXp = amount;
            writeJson('levels.json', levels);
            const embed = createServerEmbed('success', { title: 'Base XP Set', description: `Base XP for Level 1: **${amount}**` }, interaction.guild);
            await sendTempReply(interaction, embed);
        } else if (sub === 'multiplier') {
            const value = interaction.options.getNumber('value');
            levels[guildId].settings.multiplier = value;
            writeJson('levels.json', levels);
            const embed = createServerEmbed('success', { title: 'Multiplier Set', description: `Level multiplier: **${value}x**` }, interaction.guild);
            await sendTempReply(interaction, embed);
        } else if (sub === 'addrole') {
            const level = interaction.options.getInteger('level');
            const role = interaction.options.getRole('role');
            levels[guildId].roles[level] = role.id;
            writeJson('levels.json', levels);
            const embed = createServerEmbed('success', { title: 'Level Role Added', description: `At Level **${level}**, users get **${role.name}**.` }, interaction.guild);
            await sendTempReply(interaction, embed);
        } else if (sub === 'removerole') {
            const level = interaction.options.getInteger('level');
            if (levels[guildId].roles[level]) {
                delete levels[guildId].roles[level];
                writeJson('levels.json', levels);
            }
            const embed = createServerEmbed('success', { title: 'Level Role Removed', description: `Removed role reward for Level **${level}**.` }, interaction.guild);
            await sendTempReply(interaction, embed);
        } else if (sub === 'view') {
            const settings = levels[guildId].settings || { xpPerMessage: [15, 25], baseXp: 100, multiplier: 1.5 };
            const roles = levels[guildId].roles || {};
            const embed = createServerEmbed('info', {
                title: 'Leveling Settings',
                fields: [
                    { name: 'XP Range', value: `${settings.xpPerMessage[0]} - ${settings.xpPerMessage[1]} per message`, inline: true },
                    { name: 'Base XP', value: `${settings.baseXp}`, inline: true },
                    { name: 'Multiplier', value: `${settings.multiplier}x`, inline: true },
                    { name: 'Level Roles', value: Object.entries(roles).length ? Object.entries(roles).map(([l, r]) => `Level ${l}: <@&${r}>`).join('\n') : 'None set', inline: false },
                ],
            }, interaction.guild);
            await interaction.reply({ embeds: [embed] });
        }
    },
};
