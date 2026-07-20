'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { createServerEmbed } = require('../../utils/embedBuilder');
const { readJson, writeJson } = require('../../utils/jsonStorage');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warn-settings').setDescription('Configure auto-punish warn settings')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(s => s.setName('view').setDescription('View current warn settings'))
    .addSubcommand(s => s
      .setName('threshold')
      .setDescription('Auto-punish after this many warnings (0 = disabled)')
      .addIntegerOption(o => o.setName('count').setDescription('Warning count (0 = disabled)').setMinValue(0).setRequired(true)))
    .addSubcommand(s => s
      .setName('action')
      .setDescription('Auto-punish action')
      .addStringOption(o => o.setName('type').setDescription('Action').setRequired(true)
        .addChoices({ name: 'Kick', value: 'kick' }, { name: 'Ban', value: 'ban' }, { name: 'Mute', value: 'mute' })))
    .addSubcommand(s => s
      .setName('mute-duration')
      .setDescription('Mute duration for auto-mute (e.g. 1h, 30m)')
      .addStringOption(o => o.setName('duration').setDescription('e.g. 30m, 1h, 1d').setRequired(true))),

  async execute(interaction) {
    const sub    = interaction.options.getSubcommand();
    const config = readJson('config.json', {});
    const gId    = interaction.guild.id;
    if (!config[gId]) config[gId] = {};
    if (!config[gId].warnSettings) config[gId].warnSettings = { threshold: 0, action: 'kick', muteDuration: 3600000 };
    const ws = config[gId].warnSettings;

    if (sub === 'view') {
      const msToReadable = ms => {
        if (!ms) return '1h';
        const h = Math.floor(ms / 3600000); const m = Math.floor((ms % 3600000) / 60000);
        return h ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`;
      };
      return interaction.reply({
        embeds: [createServerEmbed('info', {
          title: '⚠️ Warn Settings',
          fields: [
            { name: 'Auto-Punish',    value: ws.threshold ? `After **${ws.threshold}** warns` : '❌ Disabled', inline: true },
            { name: 'Action',         value: ws.action?.toUpperCase() || 'KICK',                              inline: true },
            { name: 'Mute Duration',  value: msToReadable(ws.muteDuration),                                  inline: true },
          ],
        }, interaction.guild)],
        ephemeral: true,
      });
    }

    if (sub === 'threshold') {
      ws.threshold = interaction.options.getInteger('count');
      writeJson('config.json', config);
      return interaction.reply({
        embeds: [createServerEmbed('success', {
          title: 'Threshold Updated',
          description: ws.threshold === 0 ? 'Auto-punish **disabled**.' : `Auto-punish after **${ws.threshold}** warnings.`,
        }, interaction.guild)],
        ephemeral: true,
      });
    }

    if (sub === 'action') {
      ws.action = interaction.options.getString('type');
      writeJson('config.json', config);
      return interaction.reply({
        embeds: [createServerEmbed('success', { title: 'Action Updated', description: `Auto-punish action set to **${ws.action.toUpperCase()}**.` }, interaction.guild)],
        ephemeral: true,
      });
    }

    if (sub === 'mute-duration') {
      const str   = interaction.options.getString('duration');
      const match = str.match(/^(\d+)([smhd])$/i);
      if (!match) return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Invalid', description: 'Use format like `30m`, `1h`, `1d`.' }, interaction.guild)], ephemeral: true });
      const ms = parseInt(match[1]) * { s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2].toLowerCase()];
      ws.muteDuration = ms;
      writeJson('config.json', config);
      return interaction.reply({
        embeds: [createServerEmbed('success', { title: 'Mute Duration Updated', description: `Auto-mute duration set to **${str}**.` }, interaction.guild)],
        ephemeral: true,
      });
    }
  },
};
