'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
const { createServerEmbed } = require('../../utils/embedBuilder');
const { readJson, writeJson } = require('../../utils/jsonStorage');

// ── Inactivity timer store ────────────────────────────────────────────────
// channelId → { timerId, channel, guild, minutes, message }
const ticketTimers = new Map();

function startInactivityTimer(channel, guild, minutes, message) {
  clearInactivityTimer(channel.id);
  const ms    = minutes * 60 * 1000;
  const entry = { channel, guild, minutes, message };

  entry.timerId = setTimeout(async () => {
    ticketTimers.delete(channel.id);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket_still_here')
        .setLabel("I'm Still Here")
        .setStyle(ButtonStyle.Primary)
        .setEmoji('👋'),
    );
    const embed = createServerEmbed('warning', {
      title: '💤 Ticket Inactivity Warning',
      description: message.replace('{time}', `${minutes} minute${minutes !== 1 ? 's' : ''}`),
    }, guild);
    await channel.send({ embeds: [embed], components: [row] }).catch(() => {});
  }, ms);

  ticketTimers.set(channel.id, entry);
}

function clearInactivityTimer(channelId) {
  const entry = ticketTimers.get(channelId);
  if (entry) { clearTimeout(entry.timerId); ticketTimers.delete(channelId); }
}

function resetInactivityTimer(channelId) {
  const entry = ticketTimers.get(channelId);
  if (entry) startInactivityTimer(entry.channel, entry.guild, entry.minutes, entry.message);
}

// ── Default settings ──────────────────────────────────────────────────────
const DEFAULT = {
  inactivityEnabled: true,
  inactivityTime: 30,
  inactivityMessage: 'This ticket has been inactive for {time}. Click below if you still need help.',
  transcriptEnabled: false,
};

async function sendTempReply(interaction, embed) {
  await interaction.reply({ embeds: [embed], fetchReply: true });
  setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
}

// ── Main command ──────────────────────────────────────────────────────────
module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket').setDescription('Ticket system')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s.setName('setup').setDescription('Set up the ticket panel')
      .addChannelOption(o => o.setName('channel').setDescription('Channel for the panel').setRequired(true).addChannelTypes(ChannelType.GuildText)))
    .addSubcommand(s => s.setName('supportrole').setDescription('Set the support role')
      .addRoleOption(o => o.setName('role').setDescription('Support role').setRequired(true)))
    .addSubcommand(s => s.setName('close').setDescription('Close the current ticket channel'))
    .addSubcommand(s => s.setName('settings').setDescription('Change a ticket setting')
      .addStringOption(o => o.setName('setting').setDescription('Setting').setRequired(true).addChoices(
        { name: 'Inactivity Time (minutes)', value: 'inactivityTime'    },
        { name: 'Inactivity Enabled',        value: 'inactivityEnabled' },
        { name: 'Inactivity Message',        value: 'inactivityMessage' },
        { name: 'Transcript Enabled',        value: 'transcriptEnabled' },
      ))
      .addStringOption(o => o.setName('value').setDescription('New value').setRequired(true)))
    .addSubcommand(s => s.setName('viewsettings').setDescription('View current ticket settings')),

  async execute(interaction) {
    const config  = readJson('config.json', {});
    const guildId = interaction.guild.id;
    if (!config[guildId]) config[guildId] = {};
    if (!config[guildId].ticketSettings) config[guildId].ticketSettings = { ...DEFAULT };
    const sub = interaction.options.getSubcommand();

    if (sub === 'setup') {
      const channel = interaction.options.getChannel('channel');
      const embed   = createServerEmbed('ticket', {
        title: 'Support Tickets',
        description: 'Need help? Click the button below to open a private ticket and our team will assist you.',
        fields: [
          { name: 'Response Time',    value: 'Usually within a few hours', inline: true },
          { name: 'What to Include',  value: 'Describe your issue clearly', inline: true },
        ],
      }, interaction.guild);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('create_ticket').setLabel('Create Ticket').setStyle(ButtonStyle.Primary).setEmoji('🎫'),
      );
      await channel.send({ embeds: [embed], components: [row] });
      await sendTempReply(interaction, createServerEmbed('success', { title: 'Ticket Panel Created', description: `Panel sent to ${channel}.` }, interaction.guild));

    } else if (sub === 'supportrole') {
      config[guildId].supportRole = interaction.options.getRole('role').id;
      writeJson('config.json', config);
      await sendTempReply(interaction, createServerEmbed('success', { title: 'Support Role Set', description: `Support role set to **${interaction.options.getRole('role').name}**.` }, interaction.guild));

    } else if (sub === 'close') {
      const channel = interaction.channel;
      if (!channel.topic?.startsWith('ticket-owner:') && !channel.name.startsWith('ticket-')) {
        return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Error', description: 'This is not a ticket channel.' }, interaction.guild)], ephemeral: true });
      }
      clearInactivityTimer(channel.id);
      await interaction.reply({ embeds: [createServerEmbed('info', { title: 'Closing Ticket', description: 'This ticket will be closed in **5 seconds**.' }, interaction.guild)] });
      setTimeout(async () => { try { await channel.delete('Ticket closed'); } catch {} }, 5000);

    } else if (sub === 'settings') {
      const setting  = interaction.options.getString('setting');
      const rawValue = interaction.options.getString('value');
      const settings = config[guildId].ticketSettings;
      let parsed, display;

      if (setting === 'inactivityTime') {
        parsed = parseInt(rawValue);
        if (isNaN(parsed) || parsed < 1) return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Invalid', description: 'Minimum 1 minute.' }, interaction.guild)], ephemeral: true });
        display = `${parsed} minute${parsed !== 1 ? 's' : ''}`;
      } else if (setting === 'inactivityEnabled' || setting === 'transcriptEnabled') {
        const low = rawValue.toLowerCase();
        if (['true','yes','1','on'].includes(low))       { parsed = true;  display = 'Enabled'; }
        else if (['false','no','0','off'].includes(low)) { parsed = false; display = 'Disabled'; }
        else return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Invalid', description: 'Use `true` or `false`.' }, interaction.guild)], ephemeral: true });
      } else {
        parsed = rawValue; display = rawValue;
      }

      const old = settings[setting];
      settings[setting] = parsed;
      writeJson('config.json', config);
      await sendTempReply(interaction, createServerEmbed('success', {
        title: '⚙️ Setting Updated',
        description: `**${setting}** has been updated.`,
        fields: [{ name: 'Old', value: String(old ?? 'Not set'), inline: true }, { name: 'New', value: String(display), inline: true }],
      }, interaction.guild));

    } else if (sub === 'viewsettings') {
      const s = config[guildId].ticketSettings;
      await interaction.reply({
        embeds: [createServerEmbed('info', {
          title: '🎫 Ticket Settings',
          fields: [
            { name: 'Support Role',      value: config[guildId].supportRole ? `<@&${config[guildId].supportRole}>` : 'Not set', inline: false },
            { name: 'Inactivity',        value: s.inactivityEnabled ? '✅ Enabled' : '❌ Disabled', inline: true },
            { name: 'Inactivity Time',   value: `${s.inactivityTime} min`,  inline: true },
            { name: 'Transcript',        value: s.transcriptEnabled ? '✅' : '❌', inline: true },
            { name: 'Inactivity Message', value: s.inactivityMessage || DEFAULT.inactivityMessage, inline: false },
          ],
        }, interaction.guild)],
        ephemeral: true,
      });
    }
  },

  // ── Button handlers ───────────────────────────────────────────────────────
  handleButton: async function(interaction) {
    if (interaction.customId === 'ticket_still_here') {
      resetInactivityTimer(interaction.channel.id);
      // If no timer was running (already fired), restart one
      const config  = readJson('config.json', {});
      const gCfg    = config[interaction.guild.id] || {};
      const settings = gCfg.ticketSettings || DEFAULT;
      if (settings.inactivityEnabled !== false && !ticketTimers.has(interaction.channel.id)) {
        startInactivityTimer(interaction.channel, interaction.guild, settings.inactivityTime || DEFAULT.inactivityTime, settings.inactivityMessage || DEFAULT.inactivityMessage);
      }

      // Ping support role in the channel so staff are notified
      const supportRoleId = gCfg.supportRole;
      const pingContent   = supportRoleId
        ? `<@&${supportRoleId}> — ${interaction.user} is still here and needs help!`
        : `A support member is needed — ${interaction.user} is still here!`;
      await interaction.channel.send({ content: pingContent }).catch(() => {});

      return interaction.reply({ content: '✅ Done! Support has been notified and the inactivity timer has been reset.', ephemeral: true });
    }

    if (interaction.customId === 'close_ticket') {
      const channel = interaction.channel;
      if (!channel.topic?.startsWith('ticket-owner:') && !channel.name.startsWith('ticket-')) {
        return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Error', description: 'This is not a ticket channel.' }, interaction.guild)], ephemeral: true });
      }
      clearInactivityTimer(channel.id);
      await interaction.reply({ embeds: [createServerEmbed('info', { title: 'Closing Ticket', description: 'This ticket will be closed in **5 seconds**.' }, interaction.guild)] });
      setTimeout(async () => { try { await channel.delete('Ticket closed'); } catch {} }, 5000);
      return;
    }

    if (interaction.customId !== 'create_ticket') return;

    // ── Create ticket ───────────────────────────────────────────────────
    const guild   = interaction.guild;
    const config  = readJson('config.json', {});
    const guildId = guild.id;
    const gCfg    = config[guildId] || {};
    const supportRoleId = gCfg.supportRole;

    const existing = guild.channels.cache.find(c =>
      c.topic === `ticket-owner:${interaction.user.id}`
    ) || guild.channels.cache.find(c =>
      c.name === `ticket-${interaction.user.username.toLowerCase().replace(/[^a-z0-9-]/g, '')}` && c.parentId
    );

    if (existing) {
      return interaction.reply({
        embeds: [createServerEmbed('error', { title: 'Ticket Already Open', description: `You already have a ticket: ${existing}` }, guild)],
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const overwrites = [
      { id: guild.roles.everyone.id,  deny:  [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id,      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      { id: guild.members.me.id,      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] },
    ];
    if (supportRoleId) overwrites.push({ id: supportRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });

    const channelName = `ticket-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 90) || `ticket-${interaction.user.id}`;

    const channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      topic: `ticket-owner:${interaction.user.id}`,
      permissionOverwrites: overwrites,
    });

    const closeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
    );

    await channel.send({
      content: supportRoleId ? `<@&${supportRoleId}>` : undefined,
      embeds: [createServerEmbed('ticket', {
        title: '🎫 Ticket Opened',
        description: `Welcome ${interaction.user}! A support member will be with you shortly.\n\nDescribe your issue in detail below.`,
        fields: supportRoleId ? [{ name: 'Support Team', value: `<@&${supportRoleId}>`, inline: false }] : [],
      }, guild)],
      components: [closeRow],
    });

    // Start inactivity timer
    const settings = gCfg.ticketSettings || DEFAULT;
    if (settings.inactivityEnabled !== false) {
      startInactivityTimer(channel, guild, settings.inactivityTime || DEFAULT.inactivityTime, settings.inactivityMessage || DEFAULT.inactivityMessage);
    }

    await interaction.editReply({
      embeds: [createServerEmbed('success', { title: 'Ticket Created', description: `Your ticket: ${channel}` }, guild)],
    });
  },

  // Expose timer functions for messageCreate.js to call
  startInactivityTimer,
  clearInactivityTimer,
  resetInactivityTimer,
  ticketTimers,
};
