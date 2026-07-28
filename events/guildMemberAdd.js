const { Events, EmbedBuilder } = require('discord.js');
const { readJson, writeJson } = require('../utils/jsonStorage');
const { createServerEmbed } = require('../utils/embedBuilder');
const { addCoins } = require('../utils/economyManager');
const { getModLogSettings } = require('../utils/modConfig');
const { postCustomLog } = require('../utils/modLog');

const WELCOME_BONUS = 500;
const MEMBER_HISTORY_FILE = 'member_history.json';

// Has this (non-bot) user ever joined this guild before? Tracked separately
// from live membership so a leave + rejoin is recognised even though
// Discord itself doesn't retain that history for us.
function hasJoinedBefore(guildId, userId) {
    const history = readJson(MEMBER_HISTORY_FILE, {});
    return Boolean(history[guildId]?.[userId]);
}

function recordJoin(guildId, userId) {
    const history = readJson(MEMBER_HISTORY_FILE, {});
    if (!history[guildId]) history[guildId] = {};
    if (history[guildId][userId]) return; // already recorded, avoid a needless write
    history[guildId][userId] = true;
    writeJson(MEMBER_HISTORY_FILE, history);
}

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
        const isBot = member.user.bot;
        const config = readJson('config.json', {});
        const guildConfig = config[member.guild.id] || {};

        if (guildConfig.autoRole) {
            const role = member.guild.roles.cache.get(guildConfig.autoRole);
            if (role) {
                try { await member.roles.add(role); } catch {}
            }
        }

        if (getModLogSettings(member.guild.id).members) {
            const ageDays = Math.floor((Date.now() - member.user.createdTimestamp) / 86400000);
            await postCustomLog(member.guild, new EmbedBuilder()
                .setColor(0x2ECC71)
                .setTitle('📥 Member Joined')
                .addFields(
                    { name: 'Member',       value: `${member} \`${member.user.tag}\``, inline: true },
                    { name: 'Account Age',  value: `${ageDays} day${ageDays !== 1 ? 's' : ''}${ageDays < 7 ? ' ⚠️' : ''}`, inline: true },
                    { name: 'Member Count', value: `${member.guild.memberCount}`, inline: true },
                )
                .setTimestamp());
        }

        // Bots joining (app installs) don't take part in the coin economy or
        // the welcome flow at all.
        if (isBot) return;

        const isReturning = hasJoinedBefore(member.guild.id, member.id);
        recordJoin(member.guild.id, member.id);
        const eligibleForBonus = !isReturning;
        if (eligibleForBonus) addCoins(member.id, WELCOME_BONUS);

        if (guildConfig.welcomeChannel) {
            const channel = member.guild.channels.cache.get(guildConfig.welcomeChannel);
            if (channel) {
                const description = guildConfig.welcomeMessage
                    ? guildConfig.welcomeMessage.replace('{user}', `<@${member.id}>`).replace('{server}', member.guild.name)
                    : isReturning
                        ? `**<@${member.id}>** is back in **${member.guild.name}** — welcome home! 👋`
                        : `**<@${member.id}>** just landed in **${member.guild.name}** — grab a seat, the fun's already started! 🎈`;

                const fields = [{ name: '🎫 Member No.', value: ordinal(member.guild.memberCount), inline: true }];
                fields.push(eligibleForBonus
                    ? { name: '🪙 Welcome Bonus', value: `**${WELCOME_BONUS.toLocaleString()}** coins`, inline: true }
                    : { name: '👋 Welcome Back', value: 'Bonus already claimed on a previous join', inline: true });

                const embed = createServerEmbed('welcome', {
                    title: isReturning ? '🌿 A Familiar Face Returns!' : '🌱 A New Member Has Sprouted!',
                    description,
                    thumbnail: member.user.displayAvatarURL({ size: 256, dynamic: true }),
                    fields,
                    footer: `Welcome to ${member.guild.name} 🌿`,
                }, member.guild);
                try { await channel.send({ embeds: [embed] }); } catch {}
            }
        }
    },
};
