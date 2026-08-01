const { Events, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { readJson, writeJson } = require('../utils/jsonStorage');
const { createEmbed } = require('../utils/embedBuilder');
const messageStyle = require('../utils/messageStyle');
const { addCoins } = require('../utils/economyManager');
const { getModLogSettings } = require('../utils/modConfig');
const { postCustomLog } = require('../utils/modLog');
const { generateWelcomeCardImage } = require('../utils/welcomeVisual');
const { fetchAvatarPng } = require('../utils/avatarUtil');

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

        const welcomeStyle = messageStyle.styleFor(member.guild.id, 'member.welcome');
        if (guildConfig.welcomeChannel && welcomeStyle.enabled) {
            const channel = member.guild.channels.cache.get(guildConfig.welcomeChannel);
            if (channel) {
                const avatarPng = await fetchAvatarPng(member.displayAvatarURL({ extension: 'png', size: 256, forceStatic: true }));
                const image = generateWelcomeCardImage({
                    avatarPng,
                    username: member.displayName,
                    serverName: member.guild.name,
                    memberLabel: `${ordinal(member.guild.memberCount)} Member`,
                    bonusText: eligibleForBonus ? `+${WELCOME_BONUS.toLocaleString()} Coins` : null,
                    isReturning,
                });
                const embed = createEmbed('welcome', {
                    image: 'attachment://welcome.png',
                    color: welcomeStyle.color,
                    timestamp: false,
                });
                const file = new AttachmentBuilder(image, { name: 'welcome.png' });
                // The line above the card, usually just their mention. Cleared
                // in the panel means the card is posted on its own, with no
                // ping — some servers want the welcome without the noise.
                const content = messageStyle.fill(welcomeStyle.body, {
                    user: `<@${member.id}>`,
                    server: member.guild.name,
                    members: member.guild.memberCount,
                }) || undefined;
                try {
                    await channel.send({
                        content, embeds: [embed], files: [file],
                        allowedMentions: { users: content ? [member.id] : [] },
                    });
                } catch {}
            }
        }
    },
};
