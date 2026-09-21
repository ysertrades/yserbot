'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { filterNonBotIds } = require('../../utils/discordHelpers');
const levelingEngine = require('../../utils/levelingEngine');
const { isFeatureEnabled } = require('../../utils/featureToggles');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Server rank leaderboard — top traders by XP')
    .addStringOption(opt =>
      opt.setName('scope')
        .setDescription('All-time or this season')
        .addChoices(
          { name: 'All-time', value: 'all' },
          { name: 'Season', value: 'season' },
        )
        .setRequired(false)),

  async execute(interaction) {
    if (!isFeatureEnabled(interaction.guild.id, 'leveling')) {
      return interaction.reply({ content: 'Leveling is turned off on this server.', ephemeral: true });
    }

    const scope = interaction.options.getString('scope') || 'all';
    const all = levelingEngine.loadAll();
    const g = levelingEngine.ensureGuild(all, interaction.guild.id);
    const settings = g.settings;

    let ranked = Object.entries(g.users || {}).map(([id, u]) => ({
      id,
      level: u.level || 1,
      totalXp: u.totalXp || 0,
      seasonXp: u.seasonXp || 0,
    }));

    if (scope === 'season' && settings.seasonEnabled) {
      ranked.sort((a, b) => b.seasonXp - a.seasonXp || b.totalXp - a.totalXp);
    } else {
      ranked.sort((a, b) => b.totalXp - a.totalXp || b.level - a.level);
    }

    ranked = ranked.slice(0, 40);
    const ids = await filterNonBotIds(interaction.guild, ranked.map(r => r.id));
    ranked = ranked.filter(r => ids.has(r.id)).slice(0, 15);

    if (!ranked.length) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0xE879F9)
          .setTitle(settings.mode === 'trading' ? 'Trading leaderboard' : 'XP leaderboard')
          .setDescription('No ranks yet — post charts, journal entries, or trade shares to climb.')],
      });
    }

    const lines = ranked.map((u, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**${i + 1}.**`;
      const xp = scope === 'season' && settings.seasonEnabled ? u.seasonXp : u.totalXp;
      return `${medal} <@${u.id}> — Lv **${u.level}** · **${xp.toLocaleString()}** XP`;
    });

    const title = settings.mode === 'trading' ? 'Trading leaderboard' : 'XP leaderboard';
    const sub = scope === 'season' && settings.seasonEnabled
      ? `Season ${settings.seasonKey || ''} · top activity this cycle`
      : 'All-time · permanent rank';

    const embed = new EmbedBuilder()
      .setColor(0xE879F9)
      .setTitle(title)
      .setDescription(`${sub}\n\n${lines.join('\n')}`)
      .setFooter({ text: settings.mode === 'trading'
        ? 'XP from charts, setups, journal & shares — not chat spam'
        : 'XP from messages (legacy mode)' });

    await interaction.reply({ embeds: [embed] });
  },
};
