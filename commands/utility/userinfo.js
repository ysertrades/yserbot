const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('userinfo').setDescription('Show user information')
        .addUserOption(opt => opt.setName('user').setDescription('User to inspect').setRequired(false)),
    async execute(interaction) {
        const rawUser = interaction.options.getUser('user') || interaction.user;
        const user = await rawUser.fetch();
        const member = interaction.guild.members.cache.get(user.id);

        const createdAt = Math.floor(user.createdTimestamp / 1000);
        const joinedAt = member ? Math.floor(member.joinedTimestamp / 1000) : null;

        const roles = member ? member.roles.cache
            .filter(r => r.id !== interaction.guild.id)
            .sort((a, b) => b.position - a.position)
            .map(r => `<@&${r.id}>`)
            .slice(0, 15) : [];

        const badges = [];
        const flags = user.flags?.toArray() || [];
        const badgeMap = {
            Staff: '👷', Partner: '♾️', HypeSquad: '💠', BugHunterLevel1: '🐛',
            HypeSquadOnlineHouse1: '🏠', HypeSquadOnlineHouse2: '🏠', HypeSquadOnlineHouse3: '🏠',
            PremiumEarlySupporter: '⭐', BugHunterLevel2: '🐛', VerifiedBot: '🤖',
            VerifiedDeveloper: '✅', CertifiedModerator: '🛡️', ActiveDeveloper: '🔧',
        };
        flags.forEach(f => { if (badgeMap[f]) badges.push(badgeMap[f]); });

        const embed = new EmbedBuilder()
            .setColor(member?.displayColor || 0x9B59B6)
            .setAuthor({ name: `${user.tag}`, iconURL: user.displayAvatarURL({ dynamic: true }) })
            .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 512 }))
            .addFields(
                { name: '🆔 User ID', value: `\`\`\`${user.id}\`\`\``, inline: true },
                { name: '📛 Nickname', value: member?.nickname || '*None*', inline: true },
                { name: '🏷️ Badges', value: badges.length ? badges.join(' ') : '*None*', inline: true },
                { name: '📅 Account Created', value: `<t:${createdAt}:F>
(<t:${createdAt}:R>)`, inline: false },
                { name: '📥 Joined Server', value: joinedAt ? `<t:${joinedAt}:F>
(<t:${joinedAt}:R>)` : '*Unknown*', inline: false },
                { name: `🎭 Roles [${roles.length}]`, value: roles.length ? roles.join(' ') : '*None*', inline: false },
            )
            .setFooter({ text: `${interaction.guild.name} • YSER Flow`, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();

        if (member?.premiumSince) {
            const boostSince = Math.floor(member.premiumSinceTimestamp / 1000);
            embed.addFields({ name: '💎 Boosting Since', value: `<t:${boostSince}:F>`, inline: false });
        }

        await interaction.reply({ embeds: [embed] });
    },
};
