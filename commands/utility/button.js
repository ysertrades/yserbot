'use strict';

const {
  SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder,
  ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
} = require('discord.js');
const { createServerEmbed } = require('../../utils/embedBuilder');
const { readJson, writeJson } = require('../../utils/jsonStorage');

const STYLE_COLORS = {
  Primary:   { label: 'Primary   [Blurple]', hex: '#5865F2' },
  Secondary: { label: 'Secondary [Grey]',    hex: '#4E5058' },
  Success:   { label: 'Success   [Green]',   hex: '#57F287' },
  Danger:    { label: 'Danger    [Red]',     hex: '#ED4245' },
  Link:      { label: 'Link      [Grey]',    hex: '#4E5058' },
};

const activeEdits = new Map();
const TEMP_MS = 5 * 60 * 1000; // 5 minutes

// ── Delete selector (select menu) ──────────────────────────────────────────────

function buildDeleteSelector(guildId, interaction) {
  const buttons = readJson('buttons.json', {});
  const ids     = Object.keys(buttons[guildId] || {});

  if (ids.length === 0) {
    return interaction.reply({
      embeds: [createServerEmbed('info', { title: '🔘 No Buttons', description: 'No buttons configured yet.' }, interaction.guild)],
      flags: 64,
    });
  }

  const options = ids.slice(0, 25).map(id => {
    const btn = buttons[guildId][id];
    return new StringSelectMenuOptionBuilder()
      .setLabel(id.slice(0, 100))
      .setDescription(`embed: ${btn.embedName} · ${btn.style}`)
      .setValue(id.slice(0, 100));
  });

  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle('🗑️ Delete Button')
    .setDescription('Pick a button from the menu below. This **cannot be undone**.');

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('btn_delselect')
      .setPlaceholder('Choose a button to delete…')
      .addOptions(options),
  );

  return interaction.reply({ embeds: [embed], components: [row] });
}

function editorEmbed(btn) {
  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`🔘 Editing Button: ${btn.id}`)
    .setDescription('Click a field below to edit it, then **Save**.')
    .addFields(
      { name: 'Label',   value: btn.label   || '*(none)*',  inline: true },
      { name: 'Style',   value: btn.style   || 'Primary',   inline: true },
      { name: 'Emoji',   value: btn.emoji   || '*(none)*',  inline: true },
      { name: 'Type',    value: btn.type    || '—',         inline: true },
      { name: 'Message', value: btn.message || '*(none)*',  inline: true },
      { name: 'URL',     value: btn.url     || '*(none)*',  inline: true },
      { name: 'Embed',   value: btn.embedName || '—',       inline: true },
    );
}

function editorRows(sessionId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`be_label_${sessionId}`).setLabel('📝 Label').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`be_emoji_${sessionId}`).setLabel('😀 Emoji').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`be_color_${sessionId}`).setLabel('🎨 Color').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`be_message_${sessionId}`).setLabel('💬 Message').setStyle(ButtonStyle.Primary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`be_url_${sessionId}`).setLabel('🔗 URL').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`be_style_select_${sessionId}`).setLabel('🔄 Cycle Style').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`be_save_${sessionId}`).setLabel('💾 Save').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`be_cancel_${sessionId}`).setLabel('❌ Cancel').setStyle(ButtonStyle.Danger),
    ),
  ];
}

// ── Main command ───────────────────────────────────────────────────────────────

module.exports = {
  data: new SlashCommandBuilder()
    .setName('button').setDescription('Manage buttons')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s.setName('add').setDescription('Add a button to an embed')
      .addStringOption(o => o.setName('embed').setDescription('Embed template name').setRequired(true))
      .addStringOption(o => o.setName('id').setDescription('Button ID').setRequired(true))
      .addStringOption(o => o.setName('type').setDescription('Type').setRequired(true).addChoices(
        { name: 'Link', value: 'link' }, { name: 'Role', value: 'role' }, { name: 'Custom', value: 'custom' }, { name: 'Embed', value: 'embed' },
      ))
      .addStringOption(o => o.setName('style').setDescription('Button style').setRequired(true).addChoices(
        { name: 'Primary   [Blurple]', value: 'Primary'   },
        { name: 'Secondary [Grey]',    value: 'Secondary' },
        { name: 'Success   [Green]',   value: 'Success'   },
        { name: 'Danger    [Red]',     value: 'Danger'    },
        { name: 'Link      [Grey]',    value: 'Link'      },
      ))
      .addStringOption(o => o.setName('label').setDescription('Button label (optional if emoji is set)').setRequired(false))
      .addStringOption(o => o.setName('color').setDescription('Custom accent color hex').setRequired(false))
      .addStringOption(o => o.setName('url').setDescription('URL (Link type only)').setRequired(false))
      .addRoleOption(o => o.setName('role').setDescription('Role (Role type only)').setRequired(false))
      .addStringOption(o => o.setName('message').setDescription('Reply message (Custom type only)').setRequired(false))
      .addStringOption(o => o.setName('emoji').setDescription('Button emoji').setRequired(false))
      .addStringOption(o => o.setName('response-embed').setDescription('Embed to show privately (Embed type only — pick from saved templates)').setRequired(false).setAutocomplete(true)))
    .addSubcommand(s => s.setName('edit').setDescription('Edit an existing button interactively')
      .addStringOption(o => o.setName('id').setDescription('Button ID to edit').setRequired(true)))
    .addSubcommand(s => s.setName('remove').setDescription('Delete a button — choose from a dropdown'))
    .addSubcommand(s => s.setName('list').setDescription('List all buttons')),

  async execute(interaction) {
    const buttons = readJson('buttons.json', {});
    const guildId = interaction.guild.id;
    if (!buttons[guildId]) buttons[guildId] = {};
    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
      const id        = interaction.options.getString('id');
      const type      = interaction.options.getString('type');
      const style     = interaction.options.getString('style');
      const label     = interaction.options.getString('label') || null;
      const emoji     = interaction.options.getString('emoji') || null;
      const embedName = interaction.options.getString('embed').toLowerCase();
      const colorHex  = interaction.options.getString('color') || null;

      if (!label && !emoji)
        return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Label or Emoji Required', description: 'A button needs at least a **label** or an **emoji**.' }, interaction.guild)], flags: 64 });
      if (buttons[guildId][id])
        return interaction.reply({ embeds: [createServerEmbed('error', { title: 'ID Taken', description: `Button **${id}** already exists.` }, interaction.guild)], flags: 64 });
      if (type === 'link') {
        const url = interaction.options.getString('url');
        if (!url)             return interaction.reply({ embeds: [createServerEmbed('error', { title: 'URL Required' }, interaction.guild)], flags: 64 });
        if (style !== 'Link') return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Use Link Style', description: 'Link buttons must use the **Link** style.' }, interaction.guild)], flags: 64 });
      }

      const responseEmbedName = interaction.options.getString('response-embed')?.toLowerCase() || null;
      if (type === 'embed' && !responseEmbedName)
        return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Embed Required', description: 'Choose a saved embed template in the **response-embed** option.' }, interaction.guild)], flags: 64 });

      buttons[guildId][id] = {
        id, embedName, label, type, style, color: colorHex,
        url:              interaction.options.getString('url')    || null,
        roleId:           interaction.options.getRole('role')?.id || null,
        message:          interaction.options.getString('message') || null,
        responseEmbedName,
        emoji,
      };
      writeJson('buttons.json', buttons);

      await interaction.reply({ embeds: [createServerEmbed('success', { title: '✅ Button Added', description: `Button **${id}** added to embed **${embedName}**.` }, interaction.guild)] });
      setTimeout(() => interaction.deleteReply().catch(() => {}), TEMP_MS);
    }

    else if (sub === 'edit') {
      const id  = interaction.options.getString('id');
      const btn = buttons[guildId][id];
      if (!btn)
        return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Not Found', description: `Button **${id}** not found.` }, interaction.guild)], flags: 64 });
      const sessionId = `${interaction.user.id}-${Date.now()}`;
      activeEdits.set(sessionId, { guildId, id, userId: interaction.user.id });
      return interaction.reply({ content: `Editing button **${id}** — click a field, then **Save**.`, embeds: [editorEmbed(btn)], components: editorRows(sessionId), flags: 64 });
    }

    else if (sub === 'remove') {
      return buildDeleteSelector(guildId, interaction);
    }

    else if (sub === 'list') {
      const list = Object.values(buttons[guildId] || {});
      return interaction.reply({
        embeds: [createServerEmbed('info', {
          title: '🔘 Buttons',
          description: list.length
            ? list.map(b => `• **${b.id}** → \`${b.embedName}\` · ${b.style}${b.label ? ` · "${b.label}"` : ''}${b.roleId ? ` <@&${b.roleId}>` : ''}`).join('\n')
            : 'No buttons configured.',
        }, interaction.guild)],
      });
    }
  },

  // ── Autocomplete (response-embed option) ─────────────────────────────────
  autocomplete: async function(interaction) {
    const focused  = interaction.options.getFocused().toLowerCase();
    const guildId  = interaction.guild.id;
    const all      = readJson('embeds.json', {});
    const names    = Object.keys(all[guildId] || {});
    const filtered = names.filter(n => n.includes(focused)).slice(0, 25);
    await interaction.respond(filtered.map(n => ({ name: n, value: n })));
  },

  // ── Select menu handler (delete pick) ─────────────────────────────────────
  handleButtonSelect: async function(interaction) {
    const btnId = interaction.values[0];
    const confirmEmbed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('⚠️ Confirm Deletion')
      .setDescription(`Delete button **${btnId}**? This **cannot be undone**.`);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`btn_delyes:${btnId}`).setLabel('🗑️ Yes, Delete').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('btn_delno').setLabel('← Back').setStyle(ButtonStyle.Secondary),
    );
    return interaction.update({ embeds: [confirmEmbed], components: [row] });
  },

  // ── Button handler (confirm / back / edit session) ────────────────────────
  handleButtonEdit: async function(interaction) {
    const id = interaction.customId;

    // 'be_style_select_<sessKey>' has an underscore in the prefix, so the
    // generic split would produce 'select_<sessKey>' instead of '<sessKey>'.
    // Detect and handle it before the generic parser runs.
    let action, sessKey;
    if (id.startsWith('be_style_select_')) {
      action  = 'style_select';
      sessKey = id.slice('be_style_select_'.length);
    } else {
      const parts = id.replace(/^be_/, '').split('_');
      action  = parts[0];
      sessKey = parts.slice(1).join('_');
    }

    const session = activeEdits.get(sessKey);

    // Delete confirm / back
    if (id.startsWith('btn_delyes:')) {
      const btnId   = id.slice('btn_delyes:'.length);
      const buttons = readJson('buttons.json', {});
      const guildId = interaction.guild.id;
      if (buttons[guildId]?.[btnId]) { delete buttons[guildId][btnId]; writeJson('buttons.json', buttons); }
      const success = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('🗑️ Button Deleted')
        .setDescription(`Button **${btnId}** has been permanently deleted.`);
      await interaction.update({ embeds: [success], components: [] });
      setTimeout(() => interaction.message.delete().catch(() => {}), TEMP_MS);
      return;
    }

    if (id === 'btn_delno') {
      return buildDeleteSelector(interaction.guild.id, { reply: (...a) => interaction.update(...a), guild: interaction.guild });
    }

    // Edit session flow
    if (!session)
      return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Session Expired', description: 'Run `/button edit` again.' }, interaction.guild)], flags: 64 });
    if (session.userId !== interaction.user.id)
      return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Not Your Session' }, interaction.guild)], flags: 64 });

    const buttons = readJson('buttons.json', {});
    const btn     = buttons[session.guildId]?.[session.id];
    if (!btn) { activeEdits.delete(sessKey); return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Button Gone' }, interaction.guild)], flags: 64 }); }

    if (action === 'save') {
      activeEdits.delete(sessKey);
      return interaction.update({ content: null, embeds: [createServerEmbed('success', { title: '💾 Saved', description: `Button **${session.id}** updated.` }, interaction.guild)], components: [] });
    }
    if (action === 'cancel') {
      activeEdits.delete(sessKey);
      return interaction.update({ content: null, embeds: [createServerEmbed('info', { title: '❌ Cancelled', description: 'No changes saved.' }, interaction.guild)], components: [] });
    }
    if (id.startsWith('be_style_select_')) {
      const order = ['Primary', 'Secondary', 'Success', 'Danger'];
      const currentStyle = order.includes(btn.style) ? btn.style : 'Primary';
      btn.style = order[(order.indexOf(currentStyle) + 1) % order.length];
      buttons[session.guildId][session.id] = btn;
      writeJson('buttons.json', buttons);
      return interaction.update({ embeds: [editorEmbed(btn)], components: editorRows(sessKey) });
    }

    const fieldMeta = {
      label:   { label: 'Label',        style: TextInputStyle.Short,     max: 80   },
      emoji:   { label: 'Emoji',        style: TextInputStyle.Short,     max: 50   },
      color:   { label: 'Color (hex)',  style: TextInputStyle.Short,     max: 7    },
      message: { label: 'Custom Reply', style: TextInputStyle.Paragraph, max: 2000 },
      url:     { label: 'URL',          style: TextInputStyle.Short,     max: 512  },
    };
    const meta = fieldMeta[action];
    if (!meta) return;

    const modal = new ModalBuilder()
      .setCustomId(`be_modal_${action}_${sessKey}`)
      .setTitle(`Edit Button — ${meta.label}`)
      .addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('value').setLabel(meta.label).setStyle(meta.style)
          .setValue(btn[action] || '').setMaxLength(meta.max).setRequired(false),
      ));
    return interaction.showModal(modal);
  },

  handleButtonEditModal: async function(interaction) {
    if (!interaction.customId.startsWith('be_modal_')) return false;
    const parts   = interaction.customId.replace('be_modal_', '').split('_');
    const sessKey = parts.slice(1).join('_');
    const action  = parts[0];
    const session = activeEdits.get(sessKey);
    if (!session)
      return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Session Expired' }, interaction.guild)], flags: 64 });

    const value   = interaction.fields.getTextInputValue('value');
    const buttons = readJson('buttons.json', {});
    const btn     = buttons[session.guildId]?.[session.id];
    if (!btn) return;
    const map = { label: 'label', emoji: 'emoji', color: 'color', message: 'message', url: 'url' };
    if (map[action]) btn[map[action]] = value || null;
    buttons[session.guildId][session.id] = btn;
    writeJson('buttons.json', buttons);
    return interaction.update({
      content: `Editing button **${session.id}** — keep editing or **Save**.`,
      embeds: [editorEmbed(btn)],
      components: editorRows(sessKey),
    });
  },
};
