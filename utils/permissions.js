const { PermissionFlagsBits } = require('discord.js');

const permissionMap = {
    admin: PermissionFlagsBits.Administrator,
    moderator: PermissionFlagsBits.ModerateMembers,
    manageMessages: PermissionFlagsBits.ManageMessages,
    manageRoles: PermissionFlagsBits.ManageRoles,
    kick: PermissionFlagsBits.KickMembers,
    ban: PermissionFlagsBits.BanMembers,
};

function hasPermission(member, permissionKey) {
    if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
    const perm = permissionMap[permissionKey];
    if (!perm) return true;
    return member.permissions.has(perm);
}

module.exports = { hasPermission, permissionMap };
