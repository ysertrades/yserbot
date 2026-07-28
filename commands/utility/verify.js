'use strict';

const {
  SlashCommandBuilder, PermissionFlagsBits, ChannelType,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  EmbedBuilder,
} = require('discord.js');
const { createServerEmbed } = require('../../utils/embedBuilder');
const { readJson, writeJson } = require('../../utils/jsonStorage');

// ── Memory-sequence verification game ──────────────────────────────────────
// Not a static image captcha or "type these letters" — the member has to
// memorize a short emoji sequence, then reproduce it in order from a larger
// grid after it's hidden. It's a genuine short-term-memory + multi-step
// interaction task, which is meaningfully harder to script blindly than
// solving a fixed captcha image, while staying quick and friendly for a
// real person.

const EMOJI_POOL   = ['🍎', '🍋', '🍇', '🍊', '🍒', '🥝', '🍉', '🍑'];
const SEQUENCE_LEN = 4;
const SESSION_TTL  = 3 * 60 * 1000;

if (!global.verifySessions) global.verifySessions = new Map();

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function newChallengeSession(userId, guildId) {
  const shuffledPool = shuffle(EMOJI_POOL);
  const sequence = shuffledPool.slice(0, SEQUENCE_LEN);
  const grid     = shuffle(shuffledPool); // every pool emoji appears exactly once

  const sessionId = `${userId}-${Date.now()}`;
  const session = { userId, guildId, sequence, grid, progress: 0, clickedIdx: [], expiresAt: Date.now() + SESSION_TTL };
  global.verifySessions.set(sessionId, session);
  setTimeout(() => {
    const s = global.verifySessions.get(sessionId);
    if (s && Date.now() >= s.expiresAt) global.verifySessions.delete(sessionId);
  }, SESSION_TTL + 1000);
  return { sessionId, session };
}

function memorizeView(sessionId, session) {
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🧠 Memory Verification')
    .setDescription(
      `Memorize this order:\n\n# ${session.sequence.join('   ')}\n\n` +
      `Click **I'm Ready** once you've got it — the order will disappear and you'll pick the same emoji back out of a bigger grid, in the same order.`,
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`verify_ready:${sessionId}`).setLabel("I'm Ready").setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`verify_cancel:${sessionId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row] };
}

function answerView(sessionId, session) {
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🧠 Memory Verification')
    .setDescription(`Click the emoji in the **same order** you memorized.\nProgress: **${session.progress}/${session.sequence.length}**`);

  const rows = [];
  for (let i = 0; i < session.grid.length; i += 4) {
    const slice = session.grid.slice(i, i + 4);
    rows.push(new ActionRowBuilder().addComponents(
      slice.map((emoji, j) => {
        const idx = i + j;
        const done = session.clickedIdx.includes(idx);
        return new ButtonBuilder()
          .setCustomId(`verify_pick:${sessionId}:${idx}`)
          .setLabel(emoji)
          .setStyle(done ? ButtonStyle.Success : ButtonStyle.Secondary)
          .setDisabled(done);
      }),
    ));
  }
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`verify_cancel:${sessionId}`).setLabel('Cancel').setStyle(ButtonStyle.Danger),
  ));
  return { embeds: [embed], components: rows.slice(0, 5) };
}

function getVerifySettings(guildId) {
  const config = readJson('config.json', {});
  return config[guildId]?.verifySettings || {};
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('verify').setDescription('Member verification system')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s.setName('setup').setDescription('Post the verification panel in a channel')
      .addChannelOption(o => o.setName('channel').setDescription('Channel for the panel').setRequired(true).addChannelTypes(ChannelType.GuildText)))
    .addSubcommand(s => s.setName('role').setDescription('Set the role granted after verification')
      .addRoleOption(o => o.setName('role').setDescription('Role to grant').setRequired(true)))
    .addSubcommand(s => s.setName('rules').setDescription('Set the server rules shown on the verification panel'))
    .addSubcommand(s => s.setName('viewsettings').setDescription('View current verification settings')),

  async execute(interaction) {
    const sub     = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'setup') {
      const channel = interaction.options.getChannel('channel');
      const settings = getVerifySettings(guildId);
      const rulesText = settings.rulesText || 'Please follow the server rules and be respectful to all members.';

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🔐  Server Verification')
        .setDescription(
          `Welcome to **${interaction.guild.name}**! Complete a quick memory challenge below to verify you're a real person and unlock the rest of the server.\n\n` +
          `**📜 Server Rules**\n${rulesText}`,
        )
        .setFooter({ text: 'Click Start Verification to begin' });
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('verify_start').setLabel('Start Verification').setEmoji('🧠').setStyle(ButtonStyle.Success),
      );

      await channel.send({ embeds: [embed], components: [row] });
      return interaction.reply({ embeds: [createServerEmbed('success', { title: '✅ Verification Panel Posted', description: `Panel sent to ${channel}.` }, interaction.guild)], ephemeral: true });
    }

    if (sub === 'role') {
      const role = interaction.options.getRole('role');
      const config = readJson('config.json', {});
      if (!config[guildId]) config[guildId] = {};
      if (!config[guildId].verifySettings) config[guildId].verifySettings = {};
      config[guildId].verifySettings.role = role.id;
      writeJson('config.json', config);
      return interaction.reply({ embeds: [createServerEmbed('success', { title: '✅ Verification Role Set', description: `New verified members will receive ${role}.` }, interaction.guild)], ephemeral: true });
    }

    if (sub === 'rules') {
      const current = getVerifySettings(guildId).rulesText || '';
      const modal = new ModalBuilder().setCustomId('verify_rules_modal').setTitle('📜 Set Server Rules').addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('rules')
            .setLabel('Server Rules (shown to members)')
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(3500)
            .setRequired(true)
            .setValue(current)
            .setPlaceholder('1. Be respectful\n2. No spam\n3. ...'),
        ),
      );
      return interaction.showModal(modal);
    }

    if (sub === 'viewsettings') {
      const vs = getVerifySettings(guildId);
      return interaction.reply({
        embeds: [createServerEmbed('info', {
          title: '🔐 Verification Settings',
          fields: [
            { name: 'Role',      value: vs.role ? `<@&${vs.role}>` : 'Not set', inline: true },
            { name: 'Rules Set', value: vs.rulesText ? '✅ Yes' : '❌ Not set (using default)', inline: true },
          ],
        }, interaction.guild)],
        ephemeral: true,
      });
    }
  },

  async handleRulesModal(interaction) {
    const rulesText = interaction.fields.getTextInputValue('rules').trim();
    const config = readJson('config.json', {});
    const guildId = interaction.guild.id;
    if (!config[guildId]) config[guildId] = {};
    if (!config[guildId].verifySettings) config[guildId].verifySettings = {};
    config[guildId].verifySettings.rulesText = rulesText;
    writeJson('config.json', config);
    return interaction.reply({
      embeds: [createServerEmbed('success', {
        title: '📜 Rules Updated',
        description: 'Re-run `/verify setup` in the panel channel to refresh the posted panel with the new rules.',
      }, interaction.guild)],
      ephemeral: true,
    });
  },

  // ── Verification game handlers (wired from the posted panel button) ────────

  async handleStart(interaction) {
    const settings = getVerifySettings(interaction.guild.id);
    if (!settings.role) {
      return interaction.reply({ content: '⚠️ This server hasn\'t configured a verification role yet. Ask an admin to run `/verify role`.', ephemeral: true });
    }
    if (interaction.member.roles.cache.has(settings.role)) {
      return interaction.reply({ content: '✅ You\'re already verified!', ephemeral: true });
    }
    const { sessionId, session } = newChallengeSession(interaction.user.id, interaction.guild.id);
    return interaction.reply({ ...memorizeView(sessionId, session), ephemeral: true });
  },

  async handleReady(interaction, sessionId) {
    const session = global.verifySessions.get(sessionId);
    if (!session) return interaction.update({ content: '⌛ This attempt expired. Click **Start Verification** on the panel to try again.', embeds: [], components: [] });
    if (session.userId !== interaction.user.id) return interaction.reply({ content: '❌ This isn\'t your verification attempt.', ephemeral: true });
    return interaction.update(answerView(sessionId, session));
  },

  async handlePick(interaction, sessionId, idx) {
    const session = global.verifySessions.get(sessionId);
    if (!session) return interaction.update({ content: '⌛ This attempt expired. Click **Start Verification** on the panel to try again.', embeds: [], components: [] });
    if (session.userId !== interaction.user.id) return interaction.reply({ content: '❌ This isn\'t your verification attempt.', ephemeral: true });

    const picked   = session.grid[idx];
    const expected = session.sequence[session.progress];

    if (picked !== expected) {
      global.verifySessions.delete(sessionId);
      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('❌ Incorrect Order')
        .setDescription('That wasn\'t the right next emoji. No worries — you can try again with a fresh sequence.');
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('verify_start').setLabel('🔄 Try Again').setStyle(ButtonStyle.Primary),
      );
      return interaction.update({ embeds: [embed], components: [row] });
    }

    session.clickedIdx.push(idx);
    session.progress++;

    if (session.progress >= session.sequence.length) {
      global.verifySessions.delete(sessionId);
      const settings = getVerifySettings(session.guildId);
      let roleGranted = false;
      if (settings.role) {
        try {
          const member = await interaction.guild.members.fetch(interaction.user.id);
          const role   = interaction.guild.roles.cache.get(settings.role);
          if (role) { await member.roles.add(role); roleGranted = true; }
        } catch { /* missing permissions / role hierarchy — surface as unset below */ }
      }
      const embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('✅ Verified!')
        .setDescription(roleGranted
          ? `Nice memory! You've been verified and given <@&${settings.role}>. Welcome!`
          : 'Nice memory! You\'re verified, but the role couldn\'t be granted automatically — let staff know.');
      return interaction.update({ embeds: [embed], components: [] });
    }

    return interaction.update(answerView(sessionId, session));
  },

  async handleCancel(interaction, sessionId) {
    global.verifySessions.delete(sessionId);
    return interaction.update({ content: 'Verification cancelled. Click **Start Verification** on the panel to try again.', embeds: [], components: [] });
  },
};
