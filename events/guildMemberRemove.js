const { Events } = require('discord.js');
const { readJson } = require('../utils/jsonStorage');
const { createServerEmbed } = require('../utils/embedBuilder');

module.exports = {
    name: Events.GuildMemberRemove,
    async execute(member) {
        const config = readJson('config.json', {});
        const guildConfig = config[member.guild.id] || {};

        if (guildConfig.leaveChannel) {
            const channel = member.guild.channels.cache.get(guildConfig.leaveChannel);
            if (channel) {
                const description = guildConfig.leaveMessage
                    ? guildConfig.leaveMessage.replace('{user}', `**${member.user.tag}**`).replace('{server}', member.guild.name)
                    : `**${member.user.tag}** has drifted away from **${member.guild.name}**. Safe travels! 🌬️`;

                const fields = [
                    { name: '👥 Members Left', value: `${member.guild.memberCount}`, inline: true },
                ];
                if (member.joinedTimestamp) {
                    fields.push({ name: '⏳ Time in Server', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, inline: true });
                }

                const embed = createServerEmbed('leave', {
                    title: '🍂 A Leaf Has Fallen',
                    description,
                    thumbnail: member.user.displayAvatarURL({ size: 256, dynamic: true }),
                    fields,
                    footer: `Farewell from ${member.guild.name} 🍂`,
                }, member.guild);
                try { await channel.send({ embeds: [embed] }); } catch {}
            }
        }
    },
};
