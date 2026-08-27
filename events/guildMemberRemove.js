const { Events, EmbedBuilder } = require('discord.js');
const { readJson } = require('../utils/jsonStorage');
const messageStyle = require('../utils/messageStyle');
const { getModLogSettings } = require('../utils/modConfig');
const { postCustomLog } = require('../utils/modLog');
const { isFeatureEnabled } = require('../utils/featureToggles');

module.exports = {
    name: Events.GuildMemberRemove,
    async execute(member) {
        const config = readJson('config.json', {});
        const guildConfig = config[member.guild.id] || {};

        if (getModLogSettings(member.guild.id).members) {
            await postCustomLog(member.guild, new EmbedBuilder()
                .setColor(0xE67E22)
                .setTitle('📤 Member Left')
                .addFields(
                    { name: 'Member',       value: `\`${member.user.tag}\` (${member.id})`, inline: true },
                    { name: 'Roles',        value: member.roles?.cache?.filter(r => r.id !== member.guild.id).map(r => `${r}`).join(', ') || '*(none)*', inline: false },
                    { name: 'Member Count', value: `${member.guild.memberCount}`, inline: true },
                )
                .setTimestamp());
        }

        if (isFeatureEnabled(member.guild.id, 'welcome_leave') && guildConfig.leaveChannel) {
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

                // The colour, heading and footer come from the panel; the
                // sentence in the middle stays the Leave message on the
                // Settings screen so there is only one place to write it.
                const embed = messageStyle.build(member.guild.id, 'member.leave', {
                    fields,
                    thumbnailURL: member.user.displayAvatarURL({ size: 256, dynamic: true }),
                    tokens: {
                        user: member.user.tag,
                        server: member.guild.name,
                        members: member.guild.memberCount,
                    },
                });
                if (embed) {
                    try { embed.setDescription(description); } catch {}
                    try { await channel.send({ embeds: [embed] }); } catch {}
                }
            }
        }
    },
};
