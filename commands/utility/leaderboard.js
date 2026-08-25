const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { readJson } = require('../../utils/jsonStorage');
const { filterNonBotIds } = require('../../utils/discordHelpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leaderboard').setDescription('View XP leaderboard'),
    async execute(interaction) {
        // filterNonBotIds below fetches up to thirty users from Discord to
        // keep bots out of the ranking — network work before the first reply,
        // which is what runs out the three-second interaction budget.
        await interaction.deferReply();

        const levels = readJson('levels.json', {});
        const guildData = levels[interaction.guild.id] || { users: {} };
        const ranked = Object.entries(guildData.users)
            .sort((a, b) => b[1].level - a[1].level || b[1].totalXp - a[1].totalXp)
            .slice(0, 30);
        const humanIds = new Set(await filterNonBotIds(interaction.client, ranked.map(([id]) => id)));
        const sorted = ranked.filter(([id]) => humanIds.has(id)).slice(0, 10);

        const embed = new EmbedBuilder()
            .setColor(0xF39C12)
            .setTitle('Leaderboard')
            .setDescription(sorted.length ? sorted.map(([id, d], i) => {
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '•';
                return `${medal} <@${id}> — Level ${d.level} (${d.totalXp || 0} XP)`;
            }).join('\n') : 'No data yet.')
            .setFooter({ text: `${interaction.guild.name} • QuantLab`, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    },
};
