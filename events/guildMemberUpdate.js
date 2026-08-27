'use strict';

const { Events, EmbedBuilder } = require('discord.js');
const { getModLogSettings } = require('../utils/modConfig');
const { postCustomLog } = require('../utils/modLog');

module.exports = {
  name: Events.GuildMemberUpdate,
  async execute(oldMember, newMember) {
    const settings = getModLogSettings(newMember.guild.id);
    if (!settings.roles) return;

    const nickChanged = oldMember.nickname !== newMember.nickname;
    const addedRoles   = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
    const removedRoles = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id));
    if (!nickChanged && addedRoles.size === 0 && removedRoles.size === 0) return;

    const embed = new EmbedBuilder()
      .setColor(0x3498DB)
      .setTitle('🎭 Member Updated')
      .addFields({ name: 'Member', value: `${newMember} \`${newMember.user.tag}\``, inline: false })
      .setTimestamp();

    if (nickChanged) {
      embed.addFields({ name: 'Nickname', value: `${oldMember.nickname || '*(none)*'} → ${newMember.nickname || '*(none)*'}`, inline: false });
    }
    if (addedRoles.size)   embed.addFields({ name: '➕ Roles Added',   value: addedRoles.map(r => `${r}`).join(', '),   inline: false });
    if (removedRoles.size) embed.addFields({ name: '➖ Roles Removed', value: removedRoles.map(r => `${r}`).join(', '), inline: false });

    await postCustomLog(newMember.guild, embed);
  },
};
