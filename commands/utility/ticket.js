'use strict';

function roleIdList(cfg, multiKey, singleKey) {
  const multi = cfg?.[multiKey];
  if (Array.isArray(multi) && multi.length) return multi.filter(Boolean);
  if (cfg?.[singleKey]) return [cfg[singleKey]];
  return [];
}
function rolePing(ids) {
  return ids.map(id => `<@&${id}>`).join(' ');
}


const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, MessageFlags } = require('discord.js');
const { createServerEmbed, sendTempReply: sendTempEphemeralReply } = require('../../utils/embedBuilder');
const messageStyle = require('../../utils/messageStyle');
const { readJson, writeJson } = require('../../utils/jsonStorage');

// ── Default settings ──────────────────────────────────────────────────────
const DEFAULT = {};

async function sendTempReply(interaction, embed) {
  await interaction.reply({ embeds: [embed], fetchReply: true });
  setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
}

// ── Main command ──────────────────────────────────────────────────────────
/**
 * The "open a ticket" panel, card and button together.
 *
 * Exported because the web panel posts this too, and it used to do it from
 * its own copy of the wording — so restyling it on the Appearance screen
 * changed what /ticket setup sent and not what the panel's own Post button
 * sent. Two builders for one message is a bug waiting for somebody to edit
 * one of them, which is exactly what happened. There is one now.
 */
function buildTicketPanel(guild) {
  // Components V2: title/body from Appearance; topic dropdown opens tickets.
  const { buildTicketPanelV2 } = require('../../utils/componentsV2');
  const { readJson } = require('../../utils/jsonStorage');
  let title = 'OPEN A TICKET';
  let description = 'A private channel with staff. Just you and us.';
  let accent = 0x5865F2;
  try {
    const emb = messageStyle.build(guild.id, 'ticket.panel', {
      tokens: { server: guild.name },
    });
    if (emb?.data?.title) title = emb.data.title;
    else if (emb?.title) title = emb.title;
    if (emb?.data?.description) description = emb.data.description;
    else if (emb?.description) description = emb.description;
    const color = emb?.data?.color ?? emb?.color;
    if (typeof color === 'number') accent = color;
  } catch (_) {}
  let topics = null;
  try {
    const conf = readJson('config.json', {})[guild.id] || {};
    const ts = conf.ticketSettings || {};
    if (Array.isArray(ts.panelTopics) && ts.panelTopics.length) topics = ts.panelTopics;
  } catch (_) {}
  const v2 = buildTicketPanelV2({ title, description, topics, accent });
  return { ...v2, allowedMentions: { parse: [] } };
}

module.exports = {
  // Exported so web/tickets.js can present the same defaults rather than
  // keeping a second copy of them.
  DEFAULT,
  buildTicketPanel,

  data: new SlashCommandBuilder()
    .setName('ticket').setDescription('Ticket system')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s.setName('setup').setDescription('Set up the ticket panel')
      .addChannelOption(o => o.setName('channel').setDescription('Channel for the panel').setRequired(true).addChannelTypes(ChannelType.GuildText)))
    .addSubcommand(s => s.setName('supportrole').setDescription('Add a support role (can add several)')
      .addRoleOption(o => o.setName('role').setDescription('Support role').setRequired(true)))
    .addSubcommand(s => s.setName('close').setDescription('Close the current ticket channel')),

  async execute(interaction) {
    const config  = readJson('config.json', {});
    const guildId = interaction.guild.id;
    if (!config[guildId]) config[guildId] = {};
    if (!config[guildId].ticketSettings) config[guildId].ticketSettings = { ...DEFAULT };
    const sub = interaction.options.getSubcommand();

    if (sub === 'setup') {
      const channel = interaction.options.getChannel('channel');
      await channel.send(buildTicketPanel(interaction.guild));
      await sendTempReply(interaction, createServerEmbed('success', { title: 'Ticket Panel Created', description: `Panel sent to ${channel}.` }, interaction.guild));

    } else if (sub === 'supportrole') {
      const role = interaction.options.getRole('role');
      const list = roleIdList(config[guildId], 'supportRoles', 'supportRole');
      if (!list.includes(role.id)) list.push(role.id);
      config[guildId].supportRoles = list;
      config[guildId].supportRole = list[0];
      writeJson('config.json', config);
      const names = list.map(id => interaction.guild.roles.cache.get(id)?.name || id).join(', ');
      await sendTempReply(interaction, createServerEmbed('success', {
        title: 'Support Roles',
        description: `Added **${role.name}**.\nCurrent: ${names}`,
      }, interaction.guild));

    } else if (sub === 'close') {
      const channel = interaction.channel;
      if (!channel.topic?.startsWith('ticket-owner:') && !channel.name.startsWith('ticket-')) {
        return sendTempEphemeralReply(interaction, { embeds: [createServerEmbed('error', { title: 'Error', description: 'This is not a ticket channel.' }, interaction.guild)] });
      }
      await interaction.reply({ embeds: [createServerEmbed('info', { title: 'Closing Ticket', description: 'This ticket will be closed in **5 seconds**.' }, interaction.guild)] });
      setTimeout(async () => { try { await channel.delete('Ticket closed'); } catch {} }, 5000);

    } else if (sub === 'settings') {
      const setting  = interaction.options.getString('setting');
      const rawValue = interaction.options.getString('value');
      const settings = config[guildId].ticketSettings;
      let parsed, display;

      if (setting === 'transcriptEnabled') {
        const low = rawValue.toLowerCase();
        if (['true','yes','1','on'].includes(low))       { parsed = true;  display = 'Enabled'; }
        else if (['false','no','0','off'].includes(low)) { parsed = false; display = 'Disabled'; }
        else return sendTempEphemeralReply(interaction, { embeds: [createServerEmbed('error', { title: 'Invalid', description: 'Use `true` or `false`.' }, interaction.guild)] });
      } else {
        return sendTempEphemeralReply(interaction, { embeds: [createServerEmbed('error', { title: 'Unknown setting', description: 'Only `transcriptEnabled` is available.' }, interaction.guild)] });
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
            { name: 'Support Role', value: config[guildId].supportRole ? `<@&${config[guildId].supportRole}>` : 'Not set', inline: false },
            { name: 'Transcript', value: s.transcriptEnabled ? '✅ Enabled' : '❌ Disabled', inline: true },
          ],
        }, interaction.guild)],
        flags: MessageFlags.Ephemeral,
      });
    }
  },

  // ── Button handlers ───────────────────────────────────────────────────────
  handleButton: async function(interaction) {
    if (interaction.customId === 'close_ticket') {
      const channel = interaction.channel;
      if (!channel.topic?.startsWith('ticket-owner:') && !channel.name.startsWith('ticket-')) {
        return sendTempEphemeralReply(interaction, { embeds: [createServerEmbed('error', { title: 'Error', description: 'This is not a ticket channel.' }, interaction.guild)] });
      }
      await interaction.reply({ embeds: [createServerEmbed('info', { title: 'Closing Ticket', description: 'This ticket will be closed in **5 seconds**.' }, interaction.guild)] });
      setTimeout(async () => { try { await channel.delete('Ticket closed'); } catch {} }, 5000);
      return;
    }

    // Topic dropdown (Components V2 panel)
    if (interaction.isStringSelectMenu?.() && interaction.customId === 'ticket_topic_select') {
      const topic = (interaction.values && interaction.values[0]) || 'other';
      return module.exports.openTicket(interaction, { topic });
    }
    // Legacy button panels already posted in channels
    if (interaction.customId === 'create_ticket') {
      return module.exports.openTicket(interaction);
    }
    return;
  },

  /**
   * Opens a ticket for whoever clicked.
   *
   * Split out from handleButton because it used to be welded to one custom id.
   * A ticket button built in the panel or with /button carries its own id, so
   * it reached the stored-button dispatcher instead, which had no idea what a
   * ticket was and told the clicker the button was misconfigured. It was not —
   * nothing could open a ticket except the one panel button.
   */
  openTicket: async function(interaction, opts = {}) {
    // ── Create ticket ───────────────────────────────────────────────────
    const guild   = interaction.guild;
    const config  = readJson('config.json', {});
    const guildId = guild.id;
    const gCfg    = config[guildId] || {};
    const supportRoleIds = roleIdList(gCfg, 'supportRoles', 'supportRole');
    const supportRoleId = supportRoleIds[0];

    const existing = guild.channels.cache.find(c =>
      (c.topic === `ticket-owner:${interaction.user.id}` || (c.topic && c.topic.startsWith(`ticket-owner:${interaction.user.id}|`)))
    ) || guild.channels.cache.find(c =>
      c.name === `ticket-${interaction.user.username.toLowerCase().replace(/[^a-z0-9-]/g, '')}` && c.parentId
    );

    if (existing) {
      return sendTempEphemeralReply(interaction, {
        embeds: [createServerEmbed('error', { title: 'Ticket Already Open', description: `You already have a ticket: ${existing}` }, guild)],
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const overwrites = [
      { id: guild.roles.everyone.id,  deny:  [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id,      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      { id: guild.members.me.id,      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] },
    ];
    for (const rid of supportRoleIds) {
      overwrites.push({ id: rid, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
    }

    const channelName = `ticket-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 90) || `ticket-${interaction.user.id}`;

    const channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      topic: `ticket-owner:${interaction.user.id}${(opts && opts.topic) ? '|' + String(opts.topic).slice(0, 32) : ''}`,
      permissionOverwrites: overwrites,
    });

    const closeRow = messageStyle.buildButtons(guild.id, 'ticket.opened',
      { ButtonBuilder, ActionRowBuilder, ButtonStyle });

    await channel.send({
      content: supportRoleIds.length ? rolePing(supportRoleIds) : undefined,
      embeds: [messageStyle.build(guild.id, 'ticket.opened', {
        fields: supportRoleIds.length ? [{ name: 'Support Team', value: rolePing(supportRoleIds), inline: false }] : [],
        tokens: {
          user: `${interaction.user}`,
          server: guild.name,
          support: supportRoleIds.length ? rolePing(supportRoleIds) : '',
          channel: `${channel}`,
        },
      })],
      // Null when every button has been removed, and Discord rejects an
      // empty row rather than ignoring it.
      components: closeRow ? [closeRow] : [],
    });

    await interaction.editReply({
      embeds: [createServerEmbed('success', { title: 'Ticket Created', description: `Your ticket: ${channel}` }, guild)],
    });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
  },

};
