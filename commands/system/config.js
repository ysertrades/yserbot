'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { createServerEmbed } = require('../../utils/embedBuilder');
const { readJson, writeJson } = require('../../utils/jsonStorage');

async function sendTempReply(interaction, embed) {
  await interaction.reply({ embeds: [embed], fetchReply: true });
  setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Configure server settings')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(s => s.setName('welcome').setDescription('Set welcome channel')
      .addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true).addChannelTypes(ChannelType.GuildText))
      .addStringOption(o => o.setName('message').setDescription('Message ({user}, {server})').setRequired(false)))
    .addSubcommand(s => s.setName('leave').setDescription('Set leave channel')
      .addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true).addChannelTypes(ChannelType.GuildText))
      .addStringOption(o => o.setName('message').setDescription('Message').setRequired(false)))
    .addSubcommand(s => s.setName('autorole').setDescription('Auto-role on join')
      .addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)))
    .addSubcommand(s => s.setName('logs').setDescription('Set mod-log channel')
      .addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true).addChannelTypes(ChannelType.GuildText)))
    .addSubcommand(s => s.setName('report-channel').setDescription('Set channel where reports are sent')
      .addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true).addChannelTypes(ChannelType.GuildText)))
    .addSubcommand(s => s.setName('report-role').setDescription('Role mentioned in report alerts')
      .addRoleOption(o => o.setName('role').setDescription('Role to ping').setRequired(true)))
    .addSubcommand(s => s.setName('view').setDescription('View configuration')),

  async execute(interaction) {
    const config  = readJson('config.json', {});
    const guildId = interaction.guild.id;
    if (!config[guildId]) config[guildId] = {};
    const sub = interaction.options.getSubcommand();

    if (sub === 'welcome') {
      config[guildId].welcomeChannel = interaction.options.getChannel('channel').id;
      const msg = interaction.options.getString('message');
      if (msg) config[guildId].welcomeMessage = msg;
      writeJson('config.json', config);
      await sendTempReply(interaction, createServerEmbed('success', { title: 'Welcome Configured', description: 'Welcome channel set.' }, interaction.guild));

    } else if (sub === 'leave') {
      config[guildId].leaveChannel = interaction.options.getChannel('channel').id;
      const msg = interaction.options.getString('message');
      if (msg) config[guildId].leaveMessage = msg;
      writeJson('config.json', config);
      await sendTempReply(interaction, createServerEmbed('success', { title: 'Leave Configured', description: 'Leave channel set.' }, interaction.guild));

    } else if (sub === 'autorole') {
      config[guildId].autoRole = interaction.options.getRole('role').id;
      writeJson('config.json', config);
      await sendTempReply(interaction, createServerEmbed('success', { title: 'Auto-Role Set', description: 'Auto-role configured.' }, interaction.guild));

    } else if (sub === 'logs') {
      config[guildId].logsChannel = interaction.options.getChannel('channel').id;
      writeJson('config.json', config);
      await sendTempReply(interaction, createServerEmbed('success', { title: 'Logs Configured', description: 'Mod-log channel set.' }, interaction.guild));

    } else if (sub === 'report-channel') {
      config[guildId].reportChannel = interaction.options.getChannel('channel').id;
      writeJson('config.json', config);
      await sendTempReply(interaction, createServerEmbed('success', { title: 'Report Channel Set', description: `Reports will be sent to ${interaction.options.getChannel('channel')}.` }, interaction.guild));

    } else if (sub === 'report-role') {
      config[guildId].reportRole = interaction.options.getRole('role').id;
      writeJson('config.json', config);
      await sendTempReply(interaction, createServerEmbed('success', { title: 'Report Role Set', description: `<@&${interaction.options.getRole('role').id}> will be mentioned in reports.` }, interaction.guild));

    } else if (sub === 'view') {
      const cfg = config[guildId] || {};
      const embed = createServerEmbed('info', {
        title: '⚙️ Server Configuration',
        fields: [
          { name: 'Welcome',        value: cfg.welcomeChannel  ? `<#${cfg.welcomeChannel}>` : 'Not set',  inline: true },
          { name: 'Leave',          value: cfg.leaveChannel    ? `<#${cfg.leaveChannel}>`   : 'Not set',  inline: true },
          { name: 'Auto Role',      value: cfg.autoRole        ? `<@&${cfg.autoRole}>`      : 'Not set',  inline: true },
          { name: 'Mod Logs',       value: cfg.logsChannel     ? `<#${cfg.logsChannel}>`    : 'Not set',  inline: true },
          { name: 'Report Channel', value: cfg.reportChannel   ? `<#${cfg.reportChannel}>`  : 'Not set',  inline: true },
          { name: 'Report Role',    value: cfg.reportRole      ? `<@&${cfg.reportRole}>`    : 'Not set',  inline: true },
          { name: 'Support Role',   value: cfg.supportRole     ? `<@&${cfg.supportRole}>`   : 'Not set',  inline: true },
        ],
      }, interaction.guild);
      await interaction.reply({ embeds: [embed] });

    }
  },
};
