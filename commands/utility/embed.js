'use strict';

const {
  SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
  EmbedBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
} = require('discord.js');
const { createServerEmbed, parseColor } = require('../../utils/embedBuilder');
const { readJson, writeJson }           = require('../../utils/jsonStorage');

// In-memory edit sessions { sessionId → { guildId, name, userId, isNew, embedIndex } }
const activeEdits = new Map();

const TEMP_MS = 5000;
function tempDelete(interaction) { setTimeout(() => interaction.deleteReply().catch(() => {}), TEMP_MS); }

const MAX_EMBEDS = 10;

// ── Data helpers ───────────────────────────────────────────────────────────────

function normalizeTemplate(raw) {
  if (raw && Array.isArray(raw.embeds)) return raw;
  return {
    embeds: [{
      title:       raw.title       ?? null,
      description: raw.description ?? null,
      color:       raw.color       ?? '#5865F2',
      footer:      raw.footer      ?? null,
      thumbnail:   raw.thumbnail   ?? null,
      image:       raw.image       ?? null,
      fields:      raw.fields      ?? [],
    }],
  };
}

function blankEmbed() {
  return { title: null, description: null, color: '#5865F2', footer: null, thumbnail: null, image: null, fields: [] };
}

function readTemplates(guildId) {
  const all = readJson('embeds.json', {});
  if (!all[guildId]) all[guildId] = {};
  return all;
}

function getTemplate(all, guildId, name) {
  const raw = all[guildId]?.[name];
  return raw ? normalizeTemplate(raw) : null;
}

// ── Embed builders ─────────────────────────────────────────────────────────────

function buildEmbedFromData(data, { placeholderOk = false } = {}) {
  const e = new EmbedBuilder().setColor(parseColor(data.color) || 0x5865F2);
  if (data.title)          e.setTitle(data.title);
  if (data.description)    e.setDescription(data.description);
  if (data.footer)         e.setFooter({ text: data.footer });
  if (data.thumbnail)      e.setThumbnail(data.thumbnail);
  if (data.image)          e.setImage(data.image);
  if (data.fields?.length) e.addFields(data.fields);
  // Discord requires at least one visible field — show placeholder in editor previews
  const hasContent = data.title || data.description || data.image || data.fields?.length;
  if (!hasContent && placeholderOk)
    e.setDescription('*(empty embed — use the buttons above to fill it in)*');
  return e;
}

function buildPreviewEmbeds(template) {
  return template.embeds.map(e => buildEmbedFromData(e, { placeholderOk: true }));
}

// ── Editor UI ──────────────────────────────────────────────────────────────────

function editorRows(sessionId, embedIndex, totalEmbeds) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`embed_edit_title_${sessionId}`).setLabel('📝 Title').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`embed_edit_desc_${sessionId}`).setLabel('📝 Description').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`embed_edit_color_${sessionId}`).setLabel('🎨 Color').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`embed_edit_footer_${sessionId}`).setLabel('📌 Footer').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`embed_edit_thumb_${sessionId}`).setLabel('🖼️ Thumbnail').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`embed_edit_image_${sessionId}`).setLabel('🖼️ Image').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`embed_edit_prev_${sessionId}`).setLabel('◄ Prev').setStyle(ButtonStyle.Secondary).setDisabled(embedIndex === 0),
      new ButtonBuilder().setCustomId(`embed_edit_next_${sessionId}`).setLabel('► Next').setStyle(ButtonStyle.Secondary).setDisabled(embedIndex >= totalEmbeds - 1),
      new ButtonBuilder().setCustomId(`embed_edit_add_${sessionId}`).setLabel('➕ Add Embed').setStyle(ButtonStyle.Success).setDisabled(totalEmbeds >= MAX_EMBEDS),
      new ButtonBuilder().setCustomId(`embed_edit_rem_${sessionId}`).setLabel('🗑️ Remove').setStyle(ButtonStyle.Danger).setDisabled(totalEmbeds <= 1),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`embed_edit_save_${sessionId}`).setLabel('💾 Save').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`embed_edit_cancel_${sessionId}`).setLabel('❌ Cancel').setStyle(ButtonStyle.Danger),
    ),
  ];
}

function editorContent(session, totalEmbeds) {
  const action = session.isNew ? 'Creating' : 'Editing';
  const idx    = (session.embedIndex ?? 0) + 1;
  return `${action} embed **${session.name}** — **Embed ${idx}/${totalEmbeds}** — edit fields below, use ◄► to switch embeds, then **Save**.`;
}

async function launchEditor(interaction, guildId, name, template, isNew) {
  const sessionId  = `${interaction.user.id}-${Date.now()}`;
  const embedIndex = 0;
  activeEdits.set(sessionId, { guildId, name, userId: interaction.user.id, isNew, embedIndex });
  await interaction.reply({
    content:    editorContent({ name, isNew, embedIndex }, template.embeds.length),
    embeds:     buildPreviewEmbeds(template),
    components: editorRows(sessionId, embedIndex, template.embeds.length),
    flags: 64,
  });
}

// ── Delete selector (select menu) ──────────────────────────────────────────────

function buildDeleteSelector(guildId, interaction) {
  const all       = readTemplates(guildId);
  const entries   = Object.entries(all[guildId] || {});

  if (entries.length === 0) {
    return interaction.reply({
      embeds: [createServerEmbed('info', { title: '📋 No Templates', description: 'No embed templates exist yet.' }, interaction.guild)],
      flags: 64,
    });
  }

  const options = entries.slice(0, 25).map(([name, t]) => {
    const count = normalizeTemplate(t).embeds.length;
    return new StringSelectMenuOptionBuilder()
      .setLabel(name.slice(0, 100))
      .setDescription(`${count} embed${count !== 1 ? 's' : ''}`)
      .setValue(name.slice(0, 100));
  });

  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle('🗑️ Delete Embed Template')
    .setDescription('Pick a template from the menu below. This **cannot be undone**.');

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('embed_delselect')
      .setPlaceholder('Choose a template to delete…')
      .addOptions(options),
  );

  return interaction.reply({ embeds: [embed], components: [row] });
}

// ── Main command ───────────────────────────────────────────────────────────────

module.exports = {
  data: new SlashCommandBuilder()
    .setName('embed').setDescription('Manage embed templates')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s.setName('create').setDescription('Create a new embed template')
      .addStringOption(o => o.setName('name').setDescription('Template name').setRequired(true)))
    .addSubcommand(s => s.setName('edit').setDescription('Edit an existing embed template')
      .addStringOption(o => o.setName('name').setDescription('Template name').setRequired(true)))
    .addSubcommand(s => s.setName('delete').setDescription('Delete a template — choose from a dropdown'))
    .addSubcommand(s => s.setName('list').setDescription('List all templates'))
    .addSubcommand(s => s.setName('send').setDescription('Send a template to a channel')
      .addStringOption(o => o.setName('name').setDescription('Template name').setRequired(true).setAutocomplete(true))
      .addChannelOption(o => o.setName('channel').setDescription('Channel (defaults to current)').setRequired(false))
      .addStringOption(o => o.setName('mention').setDescription('Mention @everyone, @here, or a role ID').setRequired(false))),

  async autocomplete(interaction) {
    const focused  = interaction.options.getFocused().toLowerCase();
    const all      = readTemplates(interaction.guild.id);
    const entries  = Object.keys(all[interaction.guild.id] || {});
    const filtered = entries
      .filter(n => n.includes(focused))
      .slice(0, 25)
      .map(n => ({ name: n, value: n }));
    await interaction.respond(filtered);
  },

  async execute(interaction) {
    const guildId = interaction.guild.id;
    const all     = readTemplates(guildId);
    const sub     = interaction.options.getSubcommand();
    const name    = interaction.options.getString('name')?.toLowerCase();

    if (sub === 'create') {
      if (all[guildId][name])
        return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Already Exists', description: `Template **${name}** already exists. Use \`/embed edit\`.` }, interaction.guild)], flags: 64 });
      const template = { embeds: [blankEmbed()] };
      all[guildId][name] = template;
      writeJson('embeds.json', all);
      return launchEditor(interaction, guildId, name, template, true);
    }

    if (sub === 'edit') {
      const template = getTemplate(all, guildId, name);
      if (!template)
        return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Not Found', description: `Template **${name}** not found.` }, interaction.guild)], flags: 64 });
      all[guildId][name] = template;
      writeJson('embeds.json', all);
      return launchEditor(interaction, guildId, name, template, false);
    }

    if (sub === 'delete') {
      return buildDeleteSelector(guildId, interaction);
    }

    if (sub === 'list') {
      const entries = Object.entries(all[guildId]);
      if (entries.length === 0)
        return interaction.reply({ embeds: [createServerEmbed('info', { title: '📋 Embed Templates', description: 'No templates yet. Create one with `/embed create`.' }, interaction.guild)] });
      const lines = entries.map(([n, t]) => {
        const count = normalizeTemplate(t).embeds.length;
        return `• **${n}** — ${count} embed${count !== 1 ? 's' : ''}`;
      });
      return interaction.reply({
        embeds: [createServerEmbed('info', { title: '📋 Embed Templates', description: lines.join('\n') }, interaction.guild)],
      });
    }

    if (sub === 'send') {
      const channel = interaction.options.getChannel('channel') || interaction.channel;
      const payload = buildEmbedPayload(interaction.guild, name);
      if (!payload)
        return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Not Found', description: `Template **${name}** not found.` }, interaction.guild)], flags: 64 });

      let content;
      let mentionOpts;
      const mention = interaction.options.getString('mention');
      if (mention === '@everyone') {
        content     = '@everyone';
        mentionOpts = { parse: ['everyone'] };
      } else if (mention === '@here') {
        content     = '@here';
        mentionOpts = { parse: ['here'] };
      } else if (mention) {
        // Accept raw snowflake, <@&roleId>, <@userId>, or @mention strings
        const roleMatch = mention.match(/^<@&(\d+)>$/);
        const userMatch = mention.match(/^<@!?(\d+)>$/);
        const rawId     = mention.match(/^\d+$/);
        if (roleMatch) {
          content     = `<@&${roleMatch[1]}>`;
          mentionOpts = { roles: [roleMatch[1]] };
        } else if (userMatch) {
          content     = `<@${userMatch[1]}>`;
          mentionOpts = { users: [userMatch[1]] };
        } else if (rawId) {
          content     = `<@&${mention}>`;
          mentionOpts = { roles: [mention] };
        } else {
          // Unrecognised format — send as plain text, no special ping
          content     = mention;
          mentionOpts = { parse: [] };
        }
      }

      await channel.send({ content, embeds: payload.embeds, components: payload.components.length > 0 ? payload.components : undefined, allowedMentions: mentionOpts });
      await interaction.reply({ embeds: [createServerEmbed('success', { title: '📤 Sent', description: `Embed **${name}** sent to ${channel}.` }, interaction.guild)] });
      tempDelete(interaction);
    }
  },
};

// ── Build payload for sending ──────────────────────────────────────────────────

function buildEmbedPayload(guild, name) {
  const all      = readTemplates(guild.id);
  const raw      = all[guild.id]?.[name];
  if (!raw) return null;
  const template = normalizeTemplate(raw);
  const builtEmbeds = template.embeds.map(buildEmbedFromData);

  const buttons         = readJson('buttons.json', {});
  const templateButtons = Object.values(buttons[guild.id] || {}).filter(b => b.embedName === name);
  const rows = [];
  let cur = new ActionRowBuilder();

  for (const btn of templateButtons) {
    if (cur.components.length >= 5) { rows.push(cur); cur = new ActionRowBuilder(); }
    const safeLabel = btn.label || null;
    if (btn.type === 'link' && btn.url) {
      const b = new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(btn.url);
      if (safeLabel) b.setLabel(safeLabel);
      if (btn.emoji)  b.setEmoji(btn.emoji);
      if (!safeLabel && !btn.emoji) b.setLabel(btn.id);
      cur.addComponents(b);
    } else {
      const b = new ButtonBuilder().setCustomId(btn.id).setStyle(ButtonStyle[btn.style] || ButtonStyle.Primary);
      if (safeLabel) b.setLabel(safeLabel);
      if (btn.emoji)  b.setEmoji(btn.emoji);
      if (!safeLabel && !btn.emoji) b.setLabel(btn.id);
      cur.addComponents(b);
    }
  }
  if (cur.components.length > 0) rows.push(cur);
  return { embeds: builtEmbeds, components: rows };
}

module.exports.buildEmbedPayload = buildEmbedPayload;

// ── Select menu handler (delete flow) ─────────────────────────────────────────

module.exports.handleEmbedSelect = async function(interaction) {
  const name = interaction.values[0];
  const confirmEmbed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle('⚠️ Confirm Deletion')
    .setDescription(`Are you sure you want to delete the **${name}** template?\n**This cannot be undone.**`);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`embed_delyes:${name}`).setLabel('🗑️ Yes, Delete').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('embed_delno').setLabel('← Back').setStyle(ButtonStyle.Secondary),
  );
  return interaction.update({ embeds: [confirmEmbed], components: [row] });
};

// ── Button handler (confirm / back flow) ──────────────────────────────────────

module.exports.handleEmbedButton = async function(interaction) {
  const id = interaction.customId;

  if (id.startsWith('embed_delyes:')) {
    const name    = id.slice('embed_delyes:'.length);
    const all     = readJson('embeds.json', {});
    const guildId = interaction.guild.id;
    if (all[guildId]?.[name]) { delete all[guildId][name]; writeJson('embeds.json', all); }
    const success = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('🗑️ Template Deleted')
      .setDescription(`**${name}** has been permanently deleted.`);
    await interaction.update({ embeds: [success], components: [] });
    setTimeout(() => interaction.message.delete().catch(() => {}), TEMP_MS);
    return;
  }

  if (id === 'embed_delno') {
    return buildDeleteSelector(interaction.guild.id, { reply: (...a) => interaction.update(...a), guild: interaction.guild });
  }

  // ── Field editor flow ───────────────────────────────────────────────────────
  if (!id.startsWith('embed_edit_')) return false;

  const parts     = id.replace('embed_edit_', '').split('_');
  const sessionId = parts.slice(1).join('_');
  const action    = parts[0];
  const session   = activeEdits.get(sessionId);

  if (!session)
    return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Session Expired', description: 'Run `/embed edit` again.' }, interaction.guild)], flags: 64 });
  if (session.userId !== interaction.user.id)
    return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Not Your Session' }, interaction.guild)], flags: 64 });

  const all = readJson('embeds.json', {});
  const raw = all[session.guildId]?.[session.name];
  if (!raw) {
    activeEdits.delete(sessionId);
    return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Template Gone' }, interaction.guild)], flags: 64 });
  }
  const template   = normalizeTemplate(raw);
  if (session.embedIndex >= template.embeds.length) session.embedIndex = template.embeds.length - 1;
  const embedIndex = session.embedIndex;

  if (action === 'save') {
    activeEdits.delete(sessionId);
    return interaction.update({ content: null, embeds: [createServerEmbed('success', { title: `💾 ${session.isNew ? 'Created' : 'Saved'}`, description: `Embed **${session.name}** ${session.isNew ? 'created' : 'saved'} with ${template.embeds.length} embed${template.embeds.length !== 1 ? 's' : ''}.` }, interaction.guild)], components: [] });
  }
  if (action === 'cancel') {
    if (session.isNew) { delete all[session.guildId][session.name]; writeJson('embeds.json', all); }
    activeEdits.delete(sessionId);
    return interaction.update({ content: null, embeds: [createServerEmbed('info', { title: '❌ Cancelled', description: session.isNew ? 'No template was created.' : 'No changes saved.' }, interaction.guild)], components: [] });
  }
  if (action === 'prev') {
    session.embedIndex = Math.max(0, embedIndex - 1);
    activeEdits.set(sessionId, session);
    return interaction.update({ content: editorContent(session, template.embeds.length), embeds: buildPreviewEmbeds(template), components: editorRows(sessionId, session.embedIndex, template.embeds.length) });
  }
  if (action === 'next') {
    session.embedIndex = Math.min(template.embeds.length - 1, embedIndex + 1);
    activeEdits.set(sessionId, session);
    return interaction.update({ content: editorContent(session, template.embeds.length), embeds: buildPreviewEmbeds(template), components: editorRows(sessionId, session.embedIndex, template.embeds.length) });
  }
  if (action === 'add') {
    if (template.embeds.length >= MAX_EMBEDS) return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Limit Reached', description: `Max ${MAX_EMBEDS} embeds per template.` }, interaction.guild)], flags: 64 });
    template.embeds.push(blankEmbed());
    session.embedIndex = template.embeds.length - 1;
    activeEdits.set(sessionId, session);
    all[session.guildId][session.name] = template;
    writeJson('embeds.json', all);
    return interaction.update({ content: editorContent(session, template.embeds.length), embeds: buildPreviewEmbeds(template), components: editorRows(sessionId, session.embedIndex, template.embeds.length) });
  }
  if (action === 'rem') {
    if (template.embeds.length <= 1) return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Cannot Remove', description: 'A template must have at least one embed.' }, interaction.guild)], flags: 64 });
    template.embeds.splice(embedIndex, 1);
    session.embedIndex = Math.min(embedIndex, template.embeds.length - 1);
    activeEdits.set(sessionId, session);
    all[session.guildId][session.name] = template;
    writeJson('embeds.json', all);
    return interaction.update({ content: editorContent(session, template.embeds.length), embeds: buildPreviewEmbeds(template), components: editorRows(sessionId, session.embedIndex, template.embeds.length) });
  }

  // Field modal triggers
  const fieldMeta = {
    title:  { label: 'Title',         style: TextInputStyle.Short,     max: 256  },
    desc:   { label: 'Description',   style: TextInputStyle.Paragraph, max: 4000 },
    color:  { label: 'Color (hex)',   style: TextInputStyle.Short,     max: 7    },
    footer: { label: 'Footer text',   style: TextInputStyle.Short,     max: 2048 },
    thumb:  { label: 'Thumbnail URL', style: TextInputStyle.Short,     max: 500  },
    image:  { label: 'Image URL',     style: TextInputStyle.Short,     max: 500  },
  };
  const meta = fieldMeta[action];
  if (!meta) return;

  const currentMap = { title: 'title', desc: 'description', color: 'color', footer: 'footer', thumb: 'thumbnail', image: 'image' };
  const curEmbed   = template.embeds[embedIndex];
  const modal = new ModalBuilder()
    .setCustomId(`embed_modal_${action}_${sessionId}`)
    .setTitle(`Embed ${embedIndex + 1} — ${meta.label}`)
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('value').setLabel(meta.label).setStyle(meta.style)
        .setValue(curEmbed[currentMap[action]] || '').setMaxLength(meta.max).setRequired(false),
    ));
  await interaction.showModal(modal);
  return true;
};

// ── Editor modal handler ───────────────────────────────────────────────────────

module.exports.handleEmbedModal = async function(interaction) {
  if (!interaction.customId.startsWith('embed_modal_')) return false;
  const parts     = interaction.customId.replace('embed_modal_', '').split('_');
  const sessionId = parts.slice(1).join('_');
  const action    = parts[0];
  const session   = activeEdits.get(sessionId);
  if (!session)
    return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Session Expired', description: 'Run `/embed edit` again.' }, interaction.guild)], flags: 64 });

  const value      = interaction.fields.getTextInputValue('value');
  const all        = readJson('embeds.json', {});
  const raw        = all[session.guildId][session.name];
  if (!raw) { activeEdits.delete(sessionId); return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Template Gone' }, interaction.guild)], flags: 64 }); }
  const template   = normalizeTemplate(raw);
  const embedIndex = Math.min(session.embedIndex ?? 0, template.embeds.length - 1);
  const curEmbed   = template.embeds[embedIndex];

  const map = { title: 'title', desc: 'description', color: 'color', footer: 'footer', thumb: 'thumbnail', image: 'image' };
  if (map[action] !== undefined) curEmbed[map[action]] = value || null;
  all[session.guildId][session.name] = template;
  writeJson('embeds.json', all);

  await interaction.update({
    content:    editorContent(session, template.embeds.length),
    embeds:     buildPreviewEmbeds(template),
    components: editorRows(sessionId, embedIndex, template.embeds.length),
  });
  return true;
};
