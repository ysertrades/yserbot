'use strict';

const {
  SlashCommandBuilder, PermissionFlagsBits, ChannelType,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  MessageFlags,
} = require('discord.js');
const { createServerEmbed, sendTempReply } = require('../../utils/embedBuilder');
const { readJson, writeJson } = require('../../utils/jsonStorage');
const {
  generateScheduleId, parseScheduleTime, parseUtcOffset,
  nextWeekdayTimestamp, nextDayOfWeekTimestamp, onDateTimestamp,
  formatDate, dayOfWeek, DAY_NAMES,
} = require('../../utils/scheduler');

const TEMP_MS = 5000;
function tempDelete(interaction) { setTimeout(() => interaction.deleteReply().catch(() => {}), TEMP_MS); }

// Default when no timezone is given, shared by create and by the date list so
// the days offered are the days the schedule would actually land on.
const DEFAULT_OFFSET_MINUTES = -240;

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The date list behind the `date` option — a calendar, in the only shape a
 * slash command has for one.
 *
 * Discord has no date input, so the alternative was typing 2026-08-20 by hand
 * and finding out it was wrong after the schedule existed. Autocomplete turns
 * the same option into a list you pick from: every entry is a real, valid,
 * future day, already written the way the parser reads it, and labelled the way
 * a person checks a date — by its weekday, with today and tomorrow named
 * outright rather than left to be counted out.
 *
 * Filtering matches the label as well as the value, so "sat", "aug" and "20"
 * all narrow it. Ninety days scanned for twenty-five shown is what lets a
 * search like "monday" reach past the first few weeks.
 *
 * @param query          whatever has been typed into the option so far
 * @param offsetMinutes  the schedule's zone, so "today" is today where it posts
 */
function dateSuggestions(query, offsetMinutes = 0) {
  const q = String(query ?? '').trim().toLowerCase();
  const startOfList = Date.now() + offsetMinutes * 60000;
  const out = [];

  for (let i = 0; i < 90 && out.length < 25; i++) {
    const shifted = startOfList + i * 86400000;
    const d = new Date(shifted);
    // Already shifted into the zone, so it is formatted as-is.
    const value = formatDate(shifted, 0);
    const named = `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    const label = i === 0 ? `Today · ${named}` : i === 1 ? `Tomorrow · ${named}` : named;
    if (!q || value.includes(q) || label.toLowerCase().includes(q)) out.push({ name: label, value });
  }
  return out;
}

const frequencyLabels = { once: 'Once', weekdays: 'Every Weekday (Mon–Fri)', everyday: 'Every Day', weekly: 'Every Week' };
const frequencyIcons  = { once: '📌', weekdays: '📅', everyday: '🔁', weekly: '🗓️' };

/**
 * How a schedule's cadence reads.
 *
 * A weekly one names its day rather than saying "Every Week", because the day
 * is the whole point of picking weekly and it is not otherwise visible
 * anywhere — it lives in the run time, not in a field of its own.
 */
function cadenceLabel(frequency, time, offsetMinutes = 0) {
  if (frequency === 'weekly' && time) return `Every ${DAY_NAMES[dayOfWeek(time, offsetMinutes)]}`;
  return frequencyLabels[frequency] || frequency;
}

// ── Cancel selector (select menu) ──────────────────────────────────────────────

function buildCancelSelector(guildId, interaction) {
  const schedules = readJson('schedules.json', {});
  const list      = Object.values(schedules[guildId] || {});

  if (list.length === 0) {
    return interaction.reply({
      embeds: [createServerEmbed('schedule', { title: '📅 No Schedules', description: 'No schedules are active.' }, interaction.guild)],
      flags: MessageFlags.Ephemeral,
    });
  }

  const options = list.slice(0, 25).map(s =>
    new StringSelectMenuOptionBuilder()
      .setLabel(`${s.id} — ${s.embedName}`.slice(0, 100))
      .setDescription(`${frequencyIcons[s.frequency]} ${cadenceLabel(s.frequency, s.time, s.offsetMinutes)}`)
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
      .addStringOption(opt => opt.setName('embed').setDescription('Embed template name').setRequired(true).setAutocomplete(true))
      .addChannelOption(opt => opt.setName('channel').setDescription('Channel to send to').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
      .addStringOption(opt => opt.setName('time').setDescription('Time of day — HH:mm, or relative like 30m/2h/1d. Pair it with date').setRequired(true))
      .addStringOption(opt => opt.setName('frequency').setDescription('How often to repeat').setRequired(true)
        .addChoices(
          { name: 'Once (pick a date below)', value: 'once' },
          { name: 'Every Weekday (Mon–Fri)', value: 'weekdays' },
          { name: 'Every Day', value: 'everyday' },
          { name: 'Every Week (pick a day below)', value: 'weekly' },
        ))
      .addStringOption(opt => opt.setName('date').setDescription('The day it posts — or the day it starts, if it repeats').setRequired(false).setAutocomplete(true))
      .addIntegerOption(opt => opt.setName('day').setDescription('Which day, for a weekly schedule').setRequired(false)
        .addChoices(...DAY_NAMES.map((name, value) => ({ name, value }))))
      .addStringOption(opt => opt.setName('mention').setDescription('Mention @everyone, @here, or a role ID').setRequired(false))
      .addStringOption(opt => opt.setName('timezone').setDescription('UTC offset, e.g. -4 or +5:30 (default: UTC)').setRequired(false)))
    .addSubcommand(sub => sub.setName('list').setDescription('List all scheduled embeds'))
    .addSubcommand(sub => sub.setName('cancel').setDescription('Cancel a schedule — choose from a dropdown')),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);

    if (focused.name === 'date') {
      // The timezone option is readable mid-typing, so the days offered are
      // the days as the schedule's own zone sees them — otherwise "Today"
      // could name a date that has already ended where the post is going.
      const typedZone = interaction.options.getString('timezone');
      const offset = typedZone ? parseUtcOffset(typedZone) : DEFAULT_OFFSET_MINUTES;
      return interaction.respond(dateSuggestions(focused.value, offset ?? DEFAULT_OFFSET_MINUTES)).catch(() => {});
    }

    if (focused.name !== 'embed') return interaction.respond([]).catch(() => {});
    const guildId  = interaction.guild.id;
    const q        = String(focused.value || '').toLowerCase();
    const all      = readJson('embeds.json', {});
    const choices  = Object.keys(all[guildId] || {}).filter(n => n.includes(q)).slice(0, 25).map(n => ({ name: n, value: n }));
    await interaction.respond(choices).catch(() => {});
  },

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
      const dateInput     = interaction.options.getString('date');
      const day           = interaction.options.getInteger('day');
      const mention       = interaction.options.getString('mention') || null;
      const timezoneInput = interaction.options.getString('timezone');

      const embeds = readJson('embeds.json', {});
      if (!embeds[guildId]?.[embedName])
        return sendTempReply(interaction, { embeds: [createServerEmbed('error', { title: 'Template Not Found', description: `No embed template **${embedName}** exists.` }, interaction.guild)] });

      // Default to UTC-4 when no timezone is provided
      const offsetMinutes = timezoneInput ? parseUtcOffset(timezoneInput) : DEFAULT_OFFSET_MINUTES;
      if (offsetMinutes === null)
        return sendTempReply(interaction, { embeds: [createServerEmbed('error', { title: 'Invalid Timezone', description: 'Use a UTC offset like `-4`, `+5:30`, or `0`.' }, interaction.guild)] });

      let time = parseScheduleTime(timeInput, offsetMinutes);
      if (!time)
        return sendTempReply(interaction, { embeds: [createServerEmbed('error', { title: 'Invalid Time', description: 'Use `HH:mm`, `YYYY-MM-DD HH:mm`, or relative like `30m`, `2h`, `1d`.' }, interaction.guild)] });

      // The date is applied before anything else moves the run time, because
      // it is the most specific thing anyone can say about when to post: the
      // time option gives the hour, the date gives the day, and together they
      // are one moment. Without it a bare "09:30" could only ever mean today
      // or tomorrow — a post meant for next Friday had to be written out in
      // full as `2026-08-14 09:30` and got no checking beyond parsing.
      if (dateInput) {
        const onDate = onDateTimestamp(time, dateInput, offsetMinutes);
        if (onDate === null)
          return sendTempReply(interaction, { embeds: [createServerEmbed('error', { title: 'Invalid Date', description: 'Pick a day from the list, or type it as `YYYY-MM-DD` — for example `2026-08-20`.' }, interaction.guild)] });

        // A time of day that has already gone by rolls to tomorrow on its own,
        // so pinning it to today lands it in the past — and a schedule in the
        // past fires the moment the runner next ticks. Saying so is the whole
        // value of having asked for a date.
        if (onDate <= Date.now())
          return sendTempReply(interaction, { embeds: [createServerEmbed('error', {
            title: 'That Moment Has Passed',
            description: `<t:${Math.floor(onDate / 1000)}:F> was <t:${Math.floor(onDate / 1000)}:R>. Pick a later time, or a later date.`,
          }, interaction.guild)] });

        time = onDate;
      }

      if (frequency === 'weekdays') time = nextWeekdayTimestamp(time, offsetMinutes);
      // A weekly schedule keeps whatever weekday its first run lands on, so
      // the day is applied here rather than stored — picking Sunday moves the
      // first run onto Sunday and every 7-day step after it stays there.
      // A date already names its weekday, so it wins: the two options are two
      // ways of saying the same thing, and letting both apply would move a run
      // off the very date that was just picked.
      if (frequency === 'weekly' && day !== null && !dateInput) time = nextDayOfWeekTimestamp(time, day, offsetMinutes);

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
            { name: `${frequencyIcons[frequency]} Frequency`, value: cadenceLabel(frequency, time, offsetMinutes), inline: true  },
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
          name:  `\`${s.id}\`  •  ${frequencyIcons[s.frequency]} ${cadenceLabel(s.frequency, s.time, s.offsetMinutes)}`,
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
