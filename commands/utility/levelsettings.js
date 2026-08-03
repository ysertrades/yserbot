const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { createServerEmbed } = require('../../utils/embedBuilder');
const { readJson, writeJson } = require('../../utils/jsonStorage');
const { parseDuration, formatDuration } = require('../../utils/duration');

// What the two anti-farming levers were fixed at before they could be set.
const DEFAULT_COOLDOWN_MS = 20000;
const DEFAULT_MIN_LENGTH  = 0;

/**
 * A span, for reading rather than for typing back in.
 *
 * formatDuration is the input format — it returns the shortest *exact* unit,
 * so five and a half minutes comes back as "330s". Fine for a field you will
 * retype; useless in a sentence.
 */
function readableSpan(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), rest = s % 60;
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  return rest ? `${m}m ${rest}s` : `${m}m`;
}

/**
 * What a set of level settings actually means for a member.
 *
 * Four numbers that each make sense on their own tell you nothing together —
 * whether 25 XP on a 20-second cooldown is generous or stingy depends on the
 * base XP and the growth curve, and nobody works that out in their head. So
 * both surfaces say it plainly: the ceiling per hour, and what it takes to
 * get off level 1.
 */
function describeRate(settings) {
  const [minXp, maxXp] = settings.xpPerMessage || [15, 25];
  const cooldownMs = Number.isFinite(settings.cooldownMs) ? settings.cooldownMs : DEFAULT_COOLDOWN_MS;
  const baseXp = settings.baseXp || 100;
  const avgXp = (minXp + maxXp) / 2;

  // A zero cooldown means every message pays, so there is no ceiling to quote.
  const perHour = cooldownMs > 0 ? Math.floor(3600000 / cooldownMs) * maxXp : null;
  const msgs = Math.max(1, Math.ceil(baseXp / Math.max(1, avgXp)));
  const fastest = cooldownMs > 0 ? readableSpan(msgs * cooldownMs) : 'no wait';

  return {
    perHour,
    line: `${perHour === null ? 'No cap — every message pays' : `At most **${perHour.toLocaleString()} XP/hour**`}`
      + `\nAbout **${msgs}** earning message${msgs === 1 ? '' : 's'} to reach level 2 (**${fastest}** at full speed)`,
  };
}

async function sendTempReply(interaction, embed) {
    const msg = await interaction.reply({ embeds: [embed], fetchReply: true });
    setTimeout(() => {
        interaction.deleteReply().catch(() => {});
    }, 5000);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('levelsettings').setDescription('Configure leveling system')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub => sub.setName('xprange').setDescription('Set XP per message range')
            .addIntegerOption(opt => opt.setName('min').setDescription('Minimum XP').setMinValue(1).setMaxValue(100).setRequired(true))
            .addIntegerOption(opt => opt.setName('max').setDescription('Maximum XP').setMinValue(1).setMaxValue(100).setRequired(true)))
        .addSubcommand(sub => sub.setName('basexp').setDescription('Set base XP for level 1')
            .addIntegerOption(opt => opt.setName('amount').setDescription('Base XP').setMinValue(10).setMaxValue(1000).setRequired(true)))
        .addSubcommand(sub => sub.setName('multiplier').setDescription('Set level multiplier')
            .addNumberOption(opt => opt.setName('value').setDescription('Multiplier (e.g. 1.5)').setMinValue(1.0).setMaxValue(5.0).setRequired(true)))
        .addSubcommand(sub => sub.setName('cooldown').setDescription('How long between messages that earn XP')
            .addStringOption(opt => opt.setName('every').setDescription('e.g. 20s, 1m, 5m — or 0 for no cooldown').setRequired(true)))
        .addSubcommand(sub => sub.setName('minlength').setDescription('Shortest message that can earn XP')
            .addIntegerOption(opt => opt.setName('characters').setDescription('0 turns it off').setMinValue(0).setMaxValue(500).setRequired(true)))
        .addSubcommand(sub => sub.setName('addrole').setDescription('Add level role reward')
            .addIntegerOption(opt => opt.setName('level').setDescription('Level required').setMinValue(1).setMaxValue(1000).setRequired(true))
            .addRoleOption(opt => opt.setName('role').setDescription('Role to give').setRequired(true)))
        .addSubcommand(sub => sub.setName('removerole').setDescription('Remove level role reward')
            .addIntegerOption(opt => opt.setName('level').setDescription('Level').setMinValue(1).setMaxValue(1000).setRequired(true)))
        .addSubcommand(sub => sub.setName('view').setDescription('View current leveling settings')),
    async execute(interaction) {
        const levels = readJson('levels.json', {});
        const guildId = interaction.guild.id;
        if (!levels[guildId]) levels[guildId] = { users: {}, roles: {}, settings: { xpPerMessage: [15, 25], baseXp: 100, multiplier: 1.5 } };
        const sub = interaction.options.getSubcommand();

        if (sub === 'xprange') {
            const min = interaction.options.getInteger('min');
            const max = interaction.options.getInteger('max');
            levels[guildId].settings.xpPerMessage = [min, max];
            writeJson('levels.json', levels);
            const embed = createServerEmbed('success', { title: 'XP Range Set', description: `XP per message: **${min}** - **${max}**` }, interaction.guild);
            await sendTempReply(interaction, embed);
        } else if (sub === 'basexp') {
            const amount = interaction.options.getInteger('amount');
            levels[guildId].settings.baseXp = amount;
            writeJson('levels.json', levels);
            const embed = createServerEmbed('success', { title: 'Base XP Set', description: `Base XP for Level 1: **${amount}**` }, interaction.guild);
            await sendTempReply(interaction, embed);
        } else if (sub === 'multiplier') {
            const value = interaction.options.getNumber('value');
            levels[guildId].settings.multiplier = value;
            writeJson('levels.json', levels);
            const embed = createServerEmbed('success', { title: 'Multiplier Set', description: `Level multiplier: **${value}x**` }, interaction.guild);
            await sendTempReply(interaction, embed);
        } else if (sub === 'cooldown') {
            const raw = interaction.options.getString('every').trim();
            // Zero is a real answer here — "every message earns" — and
            // parseDuration deliberately refuses it, so it is handled first.
            const ms = /^0[smhd]?$/i.test(raw) ? 0 : parseDuration(raw);
            if (ms === null || ms > 6 * 60 * 60 * 1000) {
                return sendTempReply(interaction, createServerEmbed('error', {
                    title: 'Invalid Cooldown',
                    description: 'Use `20s`, `1m`, `5m` — up to `6h` — or `0` for no cooldown at all.',
                }, interaction.guild));
            }
            levels[guildId].settings.cooldownMs = ms;
            writeJson('levels.json', levels);
            const rate = describeRate(levels[guildId].settings);
            const embed = createServerEmbed('success', {
                title: 'XP Cooldown Set',
                description: `Members can earn XP ${ms === 0 ? '**on every message**' : `once every **${formatDuration(ms)}**`}.\n\n${rate.line}`,
            }, interaction.guild);
            await sendTempReply(interaction, embed);
        } else if (sub === 'minlength') {
            const chars = interaction.options.getInteger('characters');
            levels[guildId].settings.minLength = chars;
            writeJson('levels.json', levels);
            const embed = createServerEmbed('success', {
                title: 'Minimum Length Set',
                description: chars === 0
                    ? 'Any message can earn XP, however short.'
                    : `A message needs **${chars} characters** to earn XP. Shorter ones do not pay and do not start the cooldown, so a one-word reply costs a member nothing.`,
            }, interaction.guild);
            await sendTempReply(interaction, embed);
        } else if (sub === 'addrole') {
            const level = interaction.options.getInteger('level');
            const role = interaction.options.getRole('role');
            levels[guildId].roles[level] = role.id;
            writeJson('levels.json', levels);
            const embed = createServerEmbed('success', { title: 'Level Role Added', description: `At Level **${level}**, users get **${role.name}**.` }, interaction.guild);
            await sendTempReply(interaction, embed);
        } else if (sub === 'removerole') {
            const level = interaction.options.getInteger('level');
            if (levels[guildId].roles[level]) {
                delete levels[guildId].roles[level];
                writeJson('levels.json', levels);
            }
            const embed = createServerEmbed('success', { title: 'Level Role Removed', description: `Removed role reward for Level **${level}**.` }, interaction.guild);
            await sendTempReply(interaction, embed);
        } else if (sub === 'view') {
            const settings = levels[guildId].settings || { xpPerMessage: [15, 25], baseXp: 100, multiplier: 1.5 };
            const roles = levels[guildId].roles || {};
            const cooldownMs = Number.isFinite(settings.cooldownMs) ? settings.cooldownMs : DEFAULT_COOLDOWN_MS;
            const minLength  = Number.isFinite(settings.minLength) ? settings.minLength : DEFAULT_MIN_LENGTH;
            const embed = createServerEmbed('info', {
                title: 'Leveling Settings',
                fields: [
                    { name: 'XP Range', value: `${settings.xpPerMessage[0]} - ${settings.xpPerMessage[1]} per message`, inline: true },
                    { name: 'Base XP', value: `${settings.baseXp}`, inline: true },
                    { name: 'Multiplier', value: `${settings.multiplier}x`, inline: true },
                    { name: 'XP Cooldown', value: cooldownMs === 0 ? 'None — every message' : `Once every ${formatDuration(cooldownMs)}`, inline: true },
                    { name: 'Minimum Length', value: minLength === 0 ? 'Off' : `${minLength} characters`, inline: true },
                    // The numbers above are settings; this is what they add up
                    // to, which is the only part anyone can act on.
                    { name: 'In practice', value: describeRate(settings).line, inline: false },
                    { name: 'Level Roles', value: Object.entries(roles).length ? Object.entries(roles).map(([l, r]) => `Level ${l}: <@&${r}>`).join('\n') : 'None set', inline: false },
                ],
            }, interaction.guild);
            await interaction.reply({ embeds: [embed] });
        }
    },
};
