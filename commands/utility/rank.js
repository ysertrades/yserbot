const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { readJson } = require('../../utils/jsonStorage');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rank').setDescription('Check your rank')
        .addUserOption(opt => opt.setName('user').setDescription('User').setRequired(false)),
    async execute(interaction) {
        const user = interaction.options.getUser('user') || interaction.user;
        const levels = readJson('levels.json', {});
        const guildData = levels[interaction.guild.id] || { users: {}, settings: { baseXp: 100, multiplier: 1.5 } };
        const userData = guildData.users[user.id] || { xp: 0, level: 1, messages: 0, totalXp: 0 };
        const settings = guildData.settings || { baseXp: 100, multiplier: 1.5 };

        const neededXp = Math.floor(settings.baseXp * Math.pow(userData.level, settings.multiplier));
        const progress = Math.floor((userData.xp / neededXp) * 100);
        const bar = '█'.repeat(Math.floor(progress / 10)) + '░'.repeat(10 - Math.floor(progress / 10));

        const embed = new EmbedBuilder()
            .setColor(interaction.guild.members.cache.get(user.id)?.displayColor || 0x5865F2)
            .setAuthor({ name: `${user.tag}'s Rank`, iconURL: user.displayAvatarURL({ dynamic: true }) })
            .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 512 }))
            .addFields(
                { name: 'Level', value: `**${userData.level}**`, inline: true },
                { name: 'XP', value: `${userData.xp} / ${neededXp}`, inline: true },
                { name: 'Progress', value: `[${bar}] ${progress}%`, inline: false },
                { name: 'Total XP', value: `${userData.totalXp || 0}`, inline: true },
                { name: 'Messages', value: `${userData.messages || 0}`, inline: true },
            )
            .setFooter({ text: `${interaction.guild.name} • YSER Flow`, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },
};
