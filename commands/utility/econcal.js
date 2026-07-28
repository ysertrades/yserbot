'use strict';

const {
  SlashCommandBuilder, PermissionFlagsBits, ChannelType,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  RoleSelectMenuBuilder, ChannelSelectMenuBuilder,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const { createServerEmbed, sendTempReply, sendTempFollowUp } = require('../../utils/embedBuilder');
const { getEconCalSettings, setEconCalSettings } = require('../../utils/modConfig');
const { IMPACT_LEVELS, CURRENCIES, getWeekEvents, filterEvents, filterEventsByDay } = require('../../utils/economicCalendar');
const { buildWeeklySummaryEmbeds } = require('../../utils/econCalRunner');
const { parseUtcOffset } = require('../../utils/scheduler');

const IMPACT_EMOJI = { High: '🔴', Medium: '🟠', Low: '⚪', Holiday: '🎌' };
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const BACK_ROW = new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('econcal_panel:back').setLabel('← Back').setStyle(ButtonStyle.Secondary),
);

function fmtWeeklyPost(wp) {
  if (!wp.enabled) return '🔴 Off';
  return `🟢 ${WEEKDAY_NAMES[wp.weekday]} at ${String(wp.hour).padStart(2, '0')}:${String(wp.minute).padStart(2, '0')} (UTC${wp.offsetMinutes >= 0 ? '+' : ''}${wp.offsetMinutes / 60})`;
}

// ── Main panel ────────────────────────────────────────────────────────────
function buildMainPanel(guild, settings) {
  const channel = settings.channelId ? guild.channels.cache.get(settings.channelId) : null;
  const role    = settings.roleId ? guild.roles.cache.get(settings.roleId) : null;

  const embed = createServerEmbed('info', {
    title: '📅 Economic Calendar',
    description:
      `**State:** ${settings.enabled ? '🟢 Enabled' : '🔴 Disabled'}\n` +
      `**Channel:** ${channel ? `${channel}` : '— Not set —'}\n` +
      `**Reminder ping role:** ${role ? `${role}` : '— None —'}\n` +
      `**Impact levels:** ${settings.impactFilter.length ? settings.impactFilter.join(', ') : 'All'}\n` +
      `**Currencies:** ${settings.currencyFilter.length ? settings.currencyFilter.join(', ') : 'All'}\n` +
      `**Weekly auto-post:** ${fmtWeeklyPost(settings.weeklyPost)}\n\n` +
      `Reminders fire 15, 10 & 5 minutes before each release (role pinged); the release itself posts at the exact time with no ping. Data from ForexFactory (free mirror, refreshed every ~3h).\n\n` +
      `Click a button below to configure that part.`,
  }, guild);

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('econcal_panel:channel').setLabel('Channel').setEmoji('📍').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('econcal_panel:role').setLabel('Ping Role').setEmoji('🎭').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('econcal_panel:toggle').setLabel(settings.enabled ? 'Disable' : 'Enable').setEmoji(settings.enabled ? '🔴' : '🟢').setStyle(settings.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('econcal_panel:impact').setLabel('Impact Levels').setEmoji('📊').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('econcal_panel:currency').setLabel('Currencies').setEmoji('💱').setStyle(ButtonStyle.Secondary),
  );
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('econcal_panel:weekly').setLabel('Weekly Post').setEmoji('🗓️').setStyle(ButtonStyle.Secondary),
  );
  const row4 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('econcal_panel:postday').setLabel('Post Today Now').setEmoji('📨').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('econcal_panel:posttomorrow').setLabel('Post Tomorrow Now').setEmoji('📨').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('econcal_panel:postweek').setLabel('Post This Week Now').setEmoji('📨').setStyle(ButtonStyle.Primary),
  );

  return { embeds: [embed], components: [row1, row2, row3, row4] };
}

// ── Channel sub-view ─────────────────────────────────────────────────────
function buildChannelView(guild) {
  const embed = createServerEmbed('info', { title: '📅 Set Channel', description: 'Pick the channel reminders, releases, and the weekly summary will post in.' }, guild);
  const menu = new ChannelSelectMenuBuilder().setCustomId('econcal_channel_select').setPlaceholder('Select a channel…').addChannelTypes(ChannelType.GuildText).setMinValues(1).setMaxValues(1);
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu), BACK_ROW] };
}

// ── Role sub-view ────────────────────────────────────────────────────────
function buildRoleView(guild) {
  const embed = createServerEmbed('info', { title: '📅 Reminder Ping Role', description: 'Pick a role to ping on release reminders (never on the release itself). Confirm with nothing selected to clear it.' }, guild);
  const menu = new RoleSelectMenuBuilder().setCustomId('econcal_role_select').setPlaceholder('Select a role to ping on reminders…').setMinValues(0).setMaxValues(1);
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu), BACK_ROW] };
}

// ── Impact sub-view ──────────────────────────────────────────────────────
function buildImpactPanel(guild, settings) {
  const selected = new Set(settings.impactFilter);
  const embed = createServerEmbed('info', {
    title: '📅 Impact Levels',
    description:
      IMPACT_LEVELS.map(l => `${IMPACT_EMOJI[l]} **${l}**${selected.has(l) ? ' ✅' : ''}`).join('\n') +
      `\n\n${selected.size ? '**Only picked impact levels will be sent.**' : 'Nothing picked yet — every impact level is sent.'}`,
  }, guild);
  const menu = new StringSelectMenuBuilder()
    .setCustomId('econcal_impact_select')
    .setPlaceholder('Select impact levels…')
    .setMinValues(0)
    .setMaxValues(IMPACT_LEVELS.length)
    .addOptions(IMPACT_LEVELS.map(l => new StringSelectMenuOptionBuilder()
      .setLabel(`${IMPACT_EMOJI[l]} ${l}`).setValue(l).setDefault(selected.has(l))));
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu), BACK_ROW] };
}

// ── Currency sub-view ────────────────────────────────────────────────────
function buildCurrencyPanel(guild, settings) {
  const selected = new Set(settings.currencyFilter);
  const embed = createServerEmbed('info', {
    title: '📅 Currencies',
    description:
      CURRENCIES.map(c => `**${c}**${selected.has(c) ? ' ✅' : ''}`).join(', ') +
      `\n\n${selected.size ? '**Only picked currencies will be sent.**' : 'Nothing picked yet — every currency is sent.'}`,
  }, guild);
  const menu = new StringSelectMenuBuilder()
    .setCustomId('econcal_currency_select')
    .setPlaceholder('Select currencies…')
    .setMinValues(0)
    .setMaxValues(CURRENCIES.length)
    .addOptions(CURRENCIES.map(c => new StringSelectMenuOptionBuilder().setLabel(c).setValue(c).setDefault(selected.has(c))));
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu), BACK_ROW] };
}

// ── Weekly-post sub-view ─────────────────────────────────────────────────
function buildWeeklyView(guild, settings) {
  const wp = settings.weeklyPost;
  const embed = createServerEmbed('info', {
    title: '📅 Weekly Post Schedule',
    description:
      `**Status:** ${fmtWeeklyPost(wp)}\n\n` +
      `Pick a weekday below, use **Set Time & Offset** for the exact time, then **Turn On/Off** to toggle it.`,
  }, guild);
  const weekdayMenu = new StringSelectMenuBuilder()
    .setCustomId('econcal_weekly_weekday_select')
    .setPlaceholder('Select a weekday…')
    .addOptions(WEEKDAY_NAMES.map((name, i) => new StringSelectMenuOptionBuilder().setLabel(name).setValue(String(i)).setDefault(wp.weekday === i)));
  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('econcal_panel:weeklytime').setLabel('Set Time & Offset').setEmoji('⏰').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('econcal_panel:weeklytoggle').setLabel(wp.enabled ? 'Turn Off' : 'Turn On').setStyle(wp.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
  );
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(weekdayMenu), buttonRow, BACK_ROW] };
}

// ── Post-now channel-select sub-view ─────────────────────────────────────
const POST_SCOPE_LABEL = { today: "Today's", tomorrow: "Tomorrow's", week: "This Week's" };

function buildPostChannelView(guild, scope) {
  const embed = createServerEmbed('info', {
    title: `📅 Post ${POST_SCOPE_LABEL[scope]} Calendar`,
    description: `Pick a channel to post ${POST_SCOPE_LABEL[scope].toLowerCase()} calendar summary to right now (uses the current impact/currency filters). This is separate from the configured reminder channel — pick any channel.`,
  }, guild);
  const menu = new ChannelSelectMenuBuilder().setCustomId(`econcal_postchannel_select:${scope}`).setPlaceholder('Select a channel…').addChannelTypes(ChannelType.GuildText).setMinValues(1).setMaxValues(1);
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu), BACK_ROW] };
}

function buildWeeklyTimeModal(settings) {
  const wp = settings.weeklyPost;
  return new ModalBuilder().setCustomId('econcal_weekly_time_modal').setTitle('Weekly Post Time').addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('time').setLabel('Time (24h HH:MM)').setStyle(TextInputStyle.Short)
        .setRequired(true).setMaxLength(5).setValue(`${String(wp.hour).padStart(2, '0')}:${String(wp.minute).padStart(2, '0')}`),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('offset').setLabel('UTC Offset (e.g. -4, +5:30, 0)').setStyle(TextInputStyle.Short)
        .setRequired(true).setMaxLength(6).setValue(String(wp.offsetMinutes / 60)),
    ),
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('econcal').setDescription('Weekly economic calendar with release reminders (ForexFactory data)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const settings = getEconCalSettings(interaction.guild.id);
    return interaction.reply({ ...buildMainPanel(interaction.guild, settings), ephemeral: true });
  },

  // ── Panel buttons ────────────────────────────────────────────────────────
  async handlePanelButton(interaction, action) {
    const guildId = interaction.guild.id;

    if (action === 'back') {
      return interaction.update(buildMainPanel(interaction.guild, getEconCalSettings(guildId)));
    }

    if (action === 'channel') {
      return interaction.update(buildChannelView(interaction.guild));
    }

    if (action === 'role') {
      return interaction.update(buildRoleView(interaction.guild));
    }

    if (action === 'toggle') {
      const settings = getEconCalSettings(guildId);
      if (!settings.enabled && !settings.channelId) {
        return sendTempReply(interaction, { embeds: [createServerEmbed('error', { title: 'No Channel Set', description: 'Set a channel first before enabling.' }, interaction.guild)] });
      }
      const updated = setEconCalSettings(guildId, { enabled: !settings.enabled });
      return interaction.update(buildMainPanel(interaction.guild, updated));
    }

    if (action === 'impact') {
      return interaction.update(buildImpactPanel(interaction.guild, getEconCalSettings(guildId)));
    }

    if (action === 'currency') {
      return interaction.update(buildCurrencyPanel(interaction.guild, getEconCalSettings(guildId)));
    }

    if (action === 'weekly') {
      return interaction.update(buildWeeklyView(interaction.guild, getEconCalSettings(guildId)));
    }

    if (action === 'weeklytoggle') {
      const settings = getEconCalSettings(guildId);
      if (!settings.weeklyPost.enabled && !settings.channelId) {
        return sendTempReply(interaction, { embeds: [createServerEmbed('error', { title: 'No Channel Set', description: 'Set a channel first before enabling the weekly post.' }, interaction.guild)] });
      }
      const updated = setEconCalSettings(guildId, { weeklyPost: { enabled: !settings.weeklyPost.enabled } });
      return interaction.update(buildWeeklyView(interaction.guild, updated));
    }

    if (action === 'weeklytime') {
      return interaction.showModal(buildWeeklyTimeModal(getEconCalSettings(guildId)));
    }

    if (action === 'postday') return interaction.update(buildPostChannelView(interaction.guild, 'today'));
    if (action === 'posttomorrow') return interaction.update(buildPostChannelView(interaction.guild, 'tomorrow'));
    if (action === 'postweek') return interaction.update(buildPostChannelView(interaction.guild, 'week'));
  },

  // ── Select menus ─────────────────────────────────────────────────────────
  async handleImpactSelect(interaction) {
    setEconCalSettings(interaction.guild.id, { impactFilter: interaction.values });
    return interaction.update(buildImpactPanel(interaction.guild, getEconCalSettings(interaction.guild.id)));
  },

  async handleCurrencySelect(interaction) {
    setEconCalSettings(interaction.guild.id, { currencyFilter: interaction.values });
    return interaction.update(buildCurrencyPanel(interaction.guild, getEconCalSettings(interaction.guild.id)));
  },

  async handleRoleSelect(interaction) {
    const roleId = interaction.values[0] || null;
    setEconCalSettings(interaction.guild.id, { roleId });
    return interaction.update(buildMainPanel(interaction.guild, getEconCalSettings(interaction.guild.id)));
  },

  async handleChannelSelect(interaction) {
    const channel = interaction.channels.first();
    const perms = channel.permissionsFor(interaction.guild.members.me);
    if (!perms?.has(PermissionFlagsBits.SendMessages) || !perms?.has(PermissionFlagsBits.EmbedLinks)) {
      return interaction.update({
        embeds: [createServerEmbed('error', { title: 'Missing Permissions', description: `I need **Send Messages** and **Embed Links** in ${channel}.` }, interaction.guild)],
        components: [BACK_ROW],
      });
    }
    setEconCalSettings(interaction.guild.id, { channelId: channel.id });
    return interaction.update(buildMainPanel(interaction.guild, getEconCalSettings(interaction.guild.id)));
  },

  async handlePostChannelSelect(interaction) {
    const scope   = interaction.customId.split(':')[1]; // 'today' | 'tomorrow' | 'week'
    const channel = interaction.channels.first();
    const perms   = channel.permissionsFor(interaction.guild.members.me);
    if (!perms?.has(PermissionFlagsBits.SendMessages) || !perms?.has(PermissionFlagsBits.EmbedLinks)) {
      return interaction.update({
        embeds: [createServerEmbed('error', { title: 'Missing Permissions', description: `I need **Send Messages** and **Embed Links** in ${channel}.` }, interaction.guild)],
        components: [BACK_ROW],
      });
    }

    const settings = getEconCalSettings(interaction.guild.id);
    await interaction.deferUpdate();
    try {
      const events = await getWeekEvents();
      let scoped = events;
      if (scope === 'today') scoped = filterEventsByDay(events, 0, settings.weeklyPost.offsetMinutes || 0);
      else if (scope === 'tomorrow') scoped = filterEventsByDay(events, 1, settings.weeklyPost.offsetMinutes || 0);
      const filtered = filterEvents(scoped, { impactFilter: settings.impactFilter, currencyFilter: settings.currencyFilter });

      const title = { today: "📅 Today's Economic Calendar", tomorrow: "📅 Tomorrow's Economic Calendar", week: "📅 This Week's Economic Calendar" }[scope];
      const emptyText = { today: 'No matching events today.', tomorrow: 'No matching events tomorrow.', week: 'No matching events this week.' }[scope];
      const embeds = buildWeeklySummaryEmbeds(filtered, interaction.guild, title, emptyText);
      await channel.send({ embeds });
      await sendTempFollowUp(interaction, { embeds: [createServerEmbed('success', { title: '📅 Posted', description: `${POST_SCOPE_LABEL[scope]} calendar summary was posted to ${channel}.` }, interaction.guild)] });
    } catch (err) {
      console.error('[ECONCAL] post-now failed:', err);
      await sendTempFollowUp(interaction, { embeds: [createServerEmbed('error', { title: 'Failed', description: 'Could not fetch or post the calendar right now — try again shortly.' }, interaction.guild)] });
    }
    return interaction.editReply(buildMainPanel(interaction.guild, settings));
  },

  async handleWeekdaySelect(interaction) {
    setEconCalSettings(interaction.guild.id, { weeklyPost: { weekday: parseInt(interaction.values[0], 10) } });
    return interaction.update(buildWeeklyView(interaction.guild, getEconCalSettings(interaction.guild.id)));
  },

  // ── Modals ───────────────────────────────────────────────────────────────
  async handleWeeklyTimeModalSubmit(interaction) {
    const timeRaw   = interaction.fields.getTextInputValue('time').trim();
    const offsetRaw = interaction.fields.getTextInputValue('offset').trim();

    const m = timeRaw.match(/^(\d{1,2}):(\d{2})$/);
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) {
      return sendTempReply(interaction, { embeds: [createServerEmbed('error', { title: 'Invalid Time', description: 'Use 24h `HH:MM`, e.g. `09:00`.' }, interaction.guild)] });
    }
    const offsetMinutes = parseUtcOffset(offsetRaw);
    if (offsetMinutes === null) {
      return sendTempReply(interaction, { embeds: [createServerEmbed('error', { title: 'Invalid UTC Offset', description: 'Use something like `-4`, `+5:30`, or `0`.' }, interaction.guild)] });
    }

    setEconCalSettings(interaction.guild.id, { weeklyPost: { hour: Number(m[1]), minute: Number(m[2]), offsetMinutes } });
    return interaction.update(buildWeeklyView(interaction.guild, getEconCalSettings(interaction.guild.id)));
  },
};
