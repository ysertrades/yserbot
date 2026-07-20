const { Events } = require('discord.js');
const { readJson } = require('../utils/jsonStorage');
const { createServerEmbed } = require('../utils/embedBuilder');
const { addCoins } = require('../utils/economyManager');

const WELCOME_BONUS = 500;

// "1" -> "1st", "2" -> "2nd", "3" -> "3rd", "11"-"13" -> "th", etc.
function ordinal(n) {
    const rem100 = n % 100;
    if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
    switch (n % 10) {
        case 1: return `${n}st`;
        case 2: return `${n}nd`;
        case 3: return `${n}rd`;
        default: return `${n}th`;
    }
}

module.exports = {
    name: Events.GuildMemberAdd,
    async execute(member) {
        const config = readJson('config.json', {});
        const guildConfig = config[member.guild.id] || {};

        if (guildConfig.autoRole) {
            const role = member.guild.roles.cache.get(guildConfig.autoRole);
            if (role) {
                try { await member.roles.add(role); } catch {}
            }
        }

        if (guildConfig.welcomeChannel) {
            const channel = member.guild.channels.cache.get(guildConfig.welcomeChannel);
            if (channel) {
                addCoins(member.id, WELCOME_BONUS);

                const description = guildConfig.welcomeMessage
                    ? guildConfig.welcomeMessage.replace('{user}', `<@${member.id}>`).replace('{server}', member.guild.name)
                    : `**<@${member.id}>** just landed in **${member.guild.name}** — grab a seat, the fun's already started! 🎈`;

                const embed = createServerEmbed('welcome', {
                    title: '🌱 A New Member Has Sprouted!',
                    description,
                    thumbnail: member.user.displayAvatarURL({ size: 256, dynamic: true }),
                    fields: [
                        { name: '🎫 Member No.',     value: ordinal(member.guild.memberCount),        inline: true },
                        { name: '🪙 Welcome Bonus',  value: `**${WELCOME_BONUS.toLocaleString()}** coins`, inline: true },
                    ],
                    footer: `Welcome to ${member.guild.name} 🌿`,
                }, member.guild);
                try { await channel.send({ embeds: [embed] }); } catch {}
            }
        }
    },
};
