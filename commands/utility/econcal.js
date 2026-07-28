'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, RoleSelectMenuBuilder, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const { createServerEmbed } = require('../../utils/embedBuilder');
const { getEconCalSettings, setEconCalSettings } = require('../../utils/modConfig');
const { IMPACT_LEVELS, CURRENCIES, getWeekEvents, filterEvents } = require('../../utils/economicCalendar');
const { buildWeeklySummaryEmbeds } = require('../../utils/econCalRunner');
const { parseUtcOffset } = require('../../utils/scheduler');

const IMPACT_EMOJI = { High: '🔴', Medium: '🟠', Low: '⚪', Holiday: '🎌' };
const WEEKDAY_CHOICES = [
  { name: 'Sunday', value: '0' }, { name: 'Monday', value: '1' }, { name: 'Tuesday', value: '2' },
  { name: 'Wednesday', value: '3' }, { name: 'Thursday', value: '4' }, { name: 'Friday', value: '5' }, { name: 'Saturday', value: '6' },
];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function buildImpactPanel(guild, settings) {
  const selected = new Set(settings.impactFilter);
  const embed = createServerEmbed('info', {
    title: '📅 Economic Calendar — Impact Levels',
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
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
}

function buildCurrencyPanel(guild, settings) {
  const selected = new Set(settings.currencyFilter);
  const embed = createServerEmbed('info', {
    title: '📅 Economic Calendar — Currencies',
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
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('econcal').setDescription('Post the weekly economic calendar with release reminders (ForexFactory data)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(s => s.setName('setup').setDescription('Set the channel (and optional role to ping on reminders)')
      .addChannelOption(o => o.setName('channel').setDescription('Channel for reminders, releases & the weekly summary').setRequired(true).addChannelTypes(ChannelType.GuildText)))
    .addSubcommand(s => s.setName('role').setDescription('Set (or clear) the role pinged on release reminders'))
    .addSubcommand(s => s.setName('enable').setDescription('Turn the economic calendar on'))
    .addSubcommand(s => s.setName('disable').setDescription('Turn the economic calendar off'))
    .addSubcommand(s => s.setName('impact').setDescription('Pick which impact levels get sent — only picked levels are posted'))
    .addSubcommand(s => s.setName('currency').setDescription('Pick which currencies get sent — only picked currencies are posted'))
    .addSubcommand(s => s.setName('weekly-post').setDescription('Configure the automatic weekly calendar summary')
      .addBooleanOption(o => o.setName('enabled').setDescription('Turn the automatic weekly post on or off').setRequired(true))
      .addStringOption(o => o.setName('weekday').setDescription('Day of week to post').addChoices(...WEEKDAY_CHOICES))
      .addStringOption(o => o.setName('time').setDescription('24h time to post, e.g. 09:00'))
      .addStringOption(o => o.setName('utc-offset').setDescription('UTC offset for that time, e.g. -4, +5:30 (default 0)')))
    .addSubcommand(s => s.setName('post-week').setDescription('Post this week\'s calendar summary right now'))
    .addSubcommand(s => s.setName('status').setDescription('Show the current economic calendar configuration')),

  async execute(interaction) {
    const sub     = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'setup') {
      const channel = interaction.options.getChannel('channel');
      const perms = channel.permissionsFor(interaction.guild.members.me);
      if (!perms?.has(PermissionFlagsBits.SendMessages) || !perms?.has(PermissionFlagsBits.EmbedLinks)) {
        return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Missing Permissions', description: `I need **Send Messages** and **Embed Links** in ${channel}.` }, interaction.guild)], ephemeral: true });
      }
      setEconCalSettings(guildId, { channelId: channel.id });
      return interaction.reply({ embeds: [createServerEmbed('success', {
        title: '📅 Channel Set',
        description: `Reminders, releases, and the weekly summary will post in ${channel}. Use \`/econcal enable\` to turn it on, and \`/econcal role\` to set a reminder ping role.`,
      }, interaction.guild)], ephemeral: true });
    }

    if (sub === 'role') {
      const menu = new RoleSelectMenuBuilder().setCustomId('econcal_role_select').setPlaceholder('Select a role to ping on reminders…').setMinValues(0).setMaxValues(1);
      return interaction.reply({
        embeds: [createServerEmbed('info', { title: '📅 Reminder Ping Role', description: 'Pick a role to ping on release reminders (not on the release itself). Select nothing and confirm to clear it.' }, interaction.guild)],
        components: [new ActionRowBuilder().addComponents(menu)],
        ephemeral: true,
      });
    }

    if (sub === 'enable') {
      const settings = getEconCalSettings(guildId);
      if (!settings.channelId) {
        return interaction.reply({ embeds: [createServerEmbed('error', { title: 'No Channel Set', description: 'Run `/econcal setup` first to pick a channel.' }, interaction.guild)], ephemeral: true });
      }
      setEconCalSettings(guildId, { enabled: true });
      return interaction.reply({ embeds: [createServerEmbed('success', { title: '📅 Economic Calendar Enabled', description: `Release reminders (15/10/5 min before) and exact-time release posts will go to <#${settings.channelId}>.` }, interaction.guild)], ephemeral: true });
    }

    if (sub === 'disable') {
      setEconCalSettings(guildId, { enabled: false });
      return interaction.reply({ embeds: [createServerEmbed('success', { title: '📅 Economic Calendar Disabled', description: 'Reminders, releases, and the weekly summary have been turned off.' }, interaction.guild)], ephemeral: true });
    }

    if (sub === 'impact') {
      const settings = getEconCalSettings(guildId);
      return interaction.reply({ ...buildImpactPanel(interaction.guild, settings), ephemeral: true });
    }

    if (sub === 'currency') {
      const settings = getEconCalSettings(guildId);
      return interaction.reply({ ...buildCurrencyPanel(interaction.guild, settings), ephemeral: true });
    }

    if (sub === 'weekly-post') {
      const enabled     = interaction.options.getBoolean('enabled');
      const weekdayOpt   = interaction.options.getString('weekday');
      const timeOpt      = interaction.options.getString('time');
      const offsetOpt    = interaction.options.getString('utc-offset');
      const current      = getEconCalSettings(guildId);

      const patch = { enabled };
      if (weekdayOpt !== null) patch.weekday = parseInt(weekdayOpt, 10);
      if (offsetOpt !== null) {
        const offsetMinutes = parseUtcOffset(offsetOpt);
        if (offsetMinutes === null) {
          return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Invalid UTC Offset', description: 'Use something like `-4`, `+5:30`, or `0`.' }, interaction.guild)], ephemeral: true });
        }
        patch.offsetMinutes = offsetMinutes;
      }
      if (timeOpt !== null) {
        const m = timeOpt.trim().match(/^(\d{1,2}):(\d{2})$/);
        if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) {
          return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Invalid Time', description: 'Use 24h `HH:MM`, e.g. `09:00`.' }, interaction.guild)], ephemeral: true });
        }
        patch.hour = Number(m[1]);
        patch.minute = Number(m[2]);
      }

      if (!current.channelId) {
        return interaction.reply({ embeds: [createServerEmbed('error', { title: 'No Channel Set', description: 'Run `/econcal setup` first.' }, interaction.guild)], ephemeral: true });
      }

      const updated = setEconCalSettings(guildId, { weeklyPost: patch });
      const wp = updated.weeklyPost;
      return interaction.reply({ embeds: [createServerEmbed('success', {
        title: '📅 Weekly Post Updated',
        description: enabled
          ? `Will auto-post this week's calendar every **${WEEKDAY_NAMES[wp.weekday]}** at **${String(wp.hour).padStart(2, '0')}:${String(wp.minute).padStart(2, '0')}** (UTC offset ${wp.offsetMinutes >= 0 ? '+' : ''}${wp.offsetMinutes / 60}).`
          : 'Automatic weekly posting is now off.',
      }, interaction.guild)], ephemeral: true });
    }

    if (sub === 'post-week') {
      const settings = getEconCalSettings(guildId);
      if (!settings.channelId) {
        return interaction.reply({ embeds: [createServerEmbed('error', { title: 'No Channel Set', description: 'Run `/econcal setup` first.' }, interaction.guild)], ephemeral: true });
      }
      const channel = interaction.guild.channels.cache.get(settings.channelId);
      if (!channel) {
        return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Channel Not Found', description: 'The configured channel no longer exists — run `/econcal setup` again.' }, interaction.guild)], ephemeral: true });
      }
      await interaction.deferReply({ ephemeral: true });
      try {
        const events = await getWeekEvents();
        const filtered = filterEvents(events, { impactFilter: settings.impactFilter, currencyFilter: settings.currencyFilter });
        const embeds = buildWeeklySummaryEmbeds(filtered, interaction.guild);
        await channel.send({ embeds });
        return interaction.editReply({ embeds: [createServerEmbed('success', { title: '📅 Posted', description: `This week's calendar summary was posted to ${channel}.` }, interaction.guild)] });
      } catch (err) {
        console.error('[ECONCAL] post-week failed:', err);
        return interaction.editReply({ embeds: [createServerEmbed('error', { title: 'Failed', description: 'Could not fetch or post the calendar right now — try again shortly.' }, interaction.guild)] });
      }
    }

    // status
    const settings = getEconCalSettings(guildId);
    const channel   = settings.channelId ? interaction.guild.channels.cache.get(settings.channelId) : null;
    const role      = settings.roleId ? interaction.guild.roles.cache.get(settings.roleId) : null;
    const wp        = settings.weeklyPost;
    return interaction.reply({ embeds: [createServerEmbed('info', {
      title: '📅 Economic Calendar Status',
      description:
        `**State:** ${settings.enabled ? '🟢 Enabled' : '🔴 Disabled'}\n` +
        `**Channel:** ${channel ? `${channel}` : '— Not set —'}\n` +
        `**Reminder ping role:** ${role ? `${role}` : '— None —'}\n` +
        `**Impact levels:** ${settings.impactFilter.length ? settings.impactFilter.join(', ') : 'All'}\n` +
        `**Currencies:** ${settings.currencyFilter.length ? settings.currencyFilter.join(', ') : 'All'}\n` +
        `**Weekly auto-post:** ${wp.enabled ? `🟢 ${WEEKDAY_NAMES[wp.weekday]} at ${String(wp.hour).padStart(2, '0')}:${String(wp.minute).padStart(2, '0')} (UTC${wp.offsetMinutes >= 0 ? '+' : ''}${wp.offsetMinutes / 60})` : '🔴 Off'}\n` +
        `**Reminders:** 15, 10 & 5 minutes before release (role pinged) • release posted at the exact time (no ping)\n` +
        `**Source:** ForexFactory (free mirror, refreshed every ~3h)`,
    }, interaction.guild)], ephemeral: true });
  },

  // ── Select menus ─────────────────────────────────────────────────────────
  async handleImpactSelect(interaction) {
    setEconCalSettings(interaction.guild.id, { impactFilter: interaction.values });
    const settings = getEconCalSettings(interaction.guild.id);
    return interaction.update(buildImpactPanel(interaction.guild, settings));
  },

  async handleCurrencySelect(interaction) {
    setEconCalSettings(interaction.guild.id, { currencyFilter: interaction.values });
    const settings = getEconCalSettings(interaction.guild.id);
    return interaction.update(buildCurrencyPanel(interaction.guild, settings));
  },

  async handleRoleSelect(interaction) {
    const roleId = interaction.values[0] || null;
    setEconCalSettings(interaction.guild.id, { roleId });
    const role = roleId ? interaction.guild.roles.cache.get(roleId) : null;
    return interaction.update({
      embeds: [createServerEmbed('success', { title: '📅 Reminder Ping Role Updated', description: role ? `${role} will be pinged on release reminders.` : 'Reminder ping role cleared — reminders will no longer ping anyone.' }, interaction.guild)],
      components: [],
    });
  },
};
