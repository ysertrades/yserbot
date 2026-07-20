'use strict';

const {
  SlashCommandBuilder, PermissionFlagsBits, ChannelType,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
} = require('discord.js');
const { createServerEmbed } = require('../../utils/embedBuilder');
const { readJson, writeJson } = require('../../utils/jsonStorage');
const { generateScheduleId, parseScheduleTime, parseUtcOffset, nextWeekdayTimestamp } = require('../../utils/scheduler');

const TEMP_MS = 5000;
function tempDelete(interaction) { setTimeout(() => interaction.deleteReply().catch(() => {}), TEMP_MS); }

const frequencyLabels = { once: 'Once', weekdays: 'Every Weekday (Mon–Fri)', everyday: 'Every Day' };
const frequencyIcons  = { once: '📌', weekdays: '📅', everyday: '🔁' };

// ── Cancel selector (select menu) ──────────────────────────────────────────────

function buildCancelSelector(guildId, interaction) {
  const schedules = readJson('schedules.json', {});
  const list      = Object.values(schedules[guildId] || {});

  if (list.length === 0) {
    return interaction.reply({
      embeds: [createServerEmbed('schedule', { title: '📅 No Schedules', description: 'No schedules are active.' }, interaction.guild)],
      flags: 64,
    });
  }

  const options = list.slice(0, 25).map(s =>
    new StringSelectMenuOptionBuilder()
      .setLabel(`${s.id} — ${s.embedName}`.slice(0, 100))
      .setDescription(`${frequencyIcons[s.frequency]} ${frequencyLabels[s.frequency]}`)
      .setValue(s.id),
  );

  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle('🗑️ Cancel Schedule')
    .setDescription('Pick a schedule from the menu below. This **cannot be undone**.');

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('sch_delselect')
      .setPlaceholder('Choose a schedule to cancel…')
      .addOptions(options),
  );

  return interaction.reply({ embeds: [embed], components: [row] });
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  data: new SlashCommandBuilder()
    .setName('schedule').setDescription('Schedule an embed template to be sent automatically')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub => sub.setName('create').setDescription('Schedule an embed to be sent')
      .addStringOption(opt => opt.setName('embed').setDescription('Embed template name').setRequired(true))
      .addChannelOption(opt => opt.setName('channel').setDescription('Channel to send to').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
      .addStringOption(opt => opt.setName('time').setDescription('HH:mm, YYYY-MM-DD HH:mm, or relative like 30m/2h/1d').setRequired(true))
      .addStringOption(opt => opt.setName('frequency').setDescription('How often to repeat').setRequired(true)
        .addChoices({ name: 'Once', value: 'once' }, { name: 'Every Weekday (Mon–Fri)', value: 'weekdays' }, { name: 'Every Day', value: 'everyday' }))
      .addStringOption(opt => opt.setName('mention').setDescription('Mention @everyone, @here, or a role ID').setRequired(false))
      .addStringOption(opt => opt.setName('timezone').setDescription('UTC offset, e.g. -4 or +5:30 (default: UTC)').setRequired(false)))
    .addSubcommand(sub => sub.setName('list').setDescription('List all scheduled embeds'))
    .addSubcommand(sub => sub.setName('cancel').setDescription('Cancel a schedule — choose from a dropdown')),

  async execute(interaction) {
    const sub       = interaction.options.getSubcommand();
    const guildId   = interaction.guild.id;
    const schedules = readJson('schedules.json', {});
    if (!schedules[guildId]) schedules[guildId] = {};

    if (sub === 'create') {
      const embedName     = interaction.options.getString('embed').toLowerCase();
      const channel       = interaction.options.getChannel('channel');
      const timeInput     = interaction.options.getString('time');
      const frequency     = interaction.options.getString('frequency');
      const mention       = interaction.options.getString('mention') || null;
      const timezoneInput = interaction.options.getString('timezone');

      const embeds = readJson('embeds.json', {});
      if (!embeds[guildId]?.[embedName])
        return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Template Not Found', description: `No embed template **${embedName}** exists.` }, interaction.guild)], flags: 64 });

      // Default to UTC-4 when no timezone is provided
      const offsetMinutes = timezoneInput ? parseUtcOffset(timezoneInput) : -240;
      if (offsetMinutes === null)
        return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Invalid Timezone', description: 'Use a UTC offset like `-4`, `+5:30`, or `0`.' }, interaction.guild)], flags: 64 });

      let time = parseScheduleTime(timeInput, offsetMinutes);
      if (!time)
        return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Invalid Time', description: 'Use `HH:mm`, `YYYY-MM-DD HH:mm`, or relative like `30m`, `2h`, `1d`.' }, interaction.guild)], flags: 64 });

      if (frequency === 'weekdays') time = nextWeekdayTimestamp(time, offsetMinutes);

      const id = generateScheduleId(Object.keys(schedules[guildId]));
      schedules[guildId][id] = {
        id, embedName, channelId: channel.id, time, frequency, mention,
        offsetMinutes, createdBy: interaction.user.id, createdAt: Date.now(),
      };
      writeJson('schedules.json', schedules);

      const tzLabel = offsetMinutes === 0 ? 'UTC' :
        `UTC${offsetMinutes > 0 ? '+' : '-'}${Math.floor(Math.abs(offsetMinutes) / 60)}` +
        (Math.abs(offsetMinutes) % 60 ? ':' + String(Math.abs(offsetMinutes) % 60).padStart(2, '0') : '');

      await interaction.reply({
        embeds: [createServerEmbed('schedule', {
          title: 'Schedule Created',
          description: `Embed **${embedName}** is on autopilot. 🚀`,
          fields: [
            { name: '🆔 ID',        value: `\`${id}\``,                                                    inline: true  },
            { name: '📍 Channel',   value: `${channel}`,                                                    inline: true  },
            { name: `${frequencyIcons[frequency]} Frequency`, value: frequencyLabels[frequency],            inline: true  },
            { name: '🌐 Timezone',  value: tzLabel,                                                         inline: true  },
            { name: '⏰ Next Send', value: `<t:${Math.floor(time / 1000)}:F> (<t:${Math.floor(time / 1000)}:R>)`, inline: false },
          ],
        }, interaction.guild)],
      });
      tempDelete(interaction);

    } else if (sub === 'list') {
      const list = Object.values(schedules[guildId] || {}).sort((a, b) => a.time - b.time);
      if (list.length === 0)
        return interaction.reply({ embeds: [createServerEmbed('schedule', { title: 'Scheduled Embeds', description: 'No embeds scheduled.\nCreate one with `/schedule create`.' }, interaction.guild)] });

      const shown = list.slice(0, 20);
      const embed = createServerEmbed('schedule', {
        title: 'Scheduled Embeds',
        description: `**${list.length}** schedule${list.length !== 1 ? 's' : ''} active.`,
        fields: shown.map(s => ({
          name:  `\`${s.id}\`  •  ${frequencyIcons[s.frequency]} ${frequencyLabels[s.frequency]}`,
          value: `📋 **${s.embedName}**\n📍 <#${s.channelId}>\n⏰ <t:${Math.floor(s.time / 1000)}:R>\n👤 <@${s.createdBy}>`,
          inline: false,
        })),
      }, interaction.guild);
      if (list.length > 20) embed.setFooter({ text: `Showing 20 of ${list.length}` });
      await interaction.reply({ embeds: [embed] });

    } else if (sub === 'cancel') {
      return buildCancelSelector(guildId, interaction);
    }
  },

  // ── Select menu handler (cancel pick) ─────────────────────────────────────
  handleScheduleSelect: async function(interaction) {
    const schId     = interaction.values[0];
    const schedules = readJson('schedules.json', {});
    const sch       = (schedules[interaction.guild.id] || {})[schId];

    if (!sch)
      return interaction.update({ embeds: [createServerEmbed('error', { title: 'Not Found', description: 'Schedule not found.' }, interaction.guild)], components: [] });

    const confirmEmbed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('⚠️ Confirm Cancellation')
      .setDescription(`Cancel schedule \`${schId}\` for embed **${sch.embedName}**?\n**This cannot be undone.**`);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`sch_delyes:${schId}`).setLabel('🗑️ Yes, Cancel').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('sch_delno').setLabel('← Back').setStyle(ButtonStyle.Secondary),
    );
    return interaction.update({ embeds: [confirmEmbed], components: [row] });
  },

  // ── Button handler (confirm / back) ───────────────────────────────────────
  handleScheduleButton: async function(interaction) {
    const id = interaction.customId;

    if (id.startsWith('sch_delyes:')) {
      const schId     = id.slice('sch_delyes:'.length);
      const schedules = readJson('schedules.json', {});
      const guildId   = interaction.guild.id;
      const removed   = (schedules[guildId] || {})[schId];
      if (removed) { delete schedules[guildId][schId]; writeJson('schedules.json', schedules); }
      const success = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('🗑️ Schedule Cancelled')
        .setDescription(removed ? `Schedule \`${schId}\` for **${removed.embedName}** cancelled.` : 'Already removed.');
      await interaction.update({ embeds: [success], components: [] });
      setTimeout(() => interaction.message.delete().catch(() => {}), TEMP_MS);
    }

    if (id === 'sch_delno') {
      return buildCancelSelector(interaction.guild.id, { reply: (...a) => interaction.update(...a), guild: interaction.guild });
    }
  },
};
