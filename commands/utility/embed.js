'use strict';

const {
  SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
  EmbedBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
} = require('discord.js');
const { createServerEmbed, parseColor, isValidHexColor, isValidUrl } = require('../../utils/embedBuilder');
const { readJson, writeJson }           = require('../../utils/jsonStorage');

// In-memory edit sessions { sessionId → { guildId, name, userId, isNew, embedIndex } }
const activeEdits = new Map();

const TEMP_MS = 5000;
function tempDelete(interaction) { setTimeout(() => interaction.deleteReply().catch(() => {}), TEMP_MS); }

const MAX_EMBEDS       = 10;   // Discord's max embeds per message
const MAX_FIELDS       = 25;   // Discord's max fields per embed
const MAX_TOTAL_CHARS  = 6000; // Discord's max combined character count across all embeds in a message
const LIST_PAGE_SIZE   = 10;

// Typing "#channel-name" the way you would in normal chat doesn't become a
// real mention in an embed the way it does in a message box — there's no
// live autocomplete inside a modal text field. So on resolve, turn any
// "#name" that matches a real channel in the guild into an actual `<#id>`
// mention (which Discord then renders as a clickable, always-up-to-date
// pill). Left untouched if preceded by a word character or "/" (so URL
// fragments like "example.com/page#section" aren't touched) or if no
// channel with that name exists.
function resolveChannelMentions(text, guild) {
  if (!text || !guild) return text;
  return text.replace(/(^|[^\w#/])#([a-zA-Z0-9_-]{1,100})/g, (match, pre, name) => {
    const channel = guild.channels.cache.find(c => c.name?.toLowerCase() === name.toLowerCase());
    return channel ? `${pre}<#${channel.id}>` : match;
  });
}

// ── Placeholder variables ───────────────────────────────────────────────────────
// Resolved at send/preview time so templates stay generic and reusable.
function resolvePlaceholders(text, ctx) {
  if (!text || !ctx) return text;
  const resolved = text
    .replace(/\{user\}/gi, ctx.user ? `<@${ctx.user.id}>` : '')
    .replace(/\{username\}/gi, ctx.user?.username || '')
    .replace(/\{server\}/gi, ctx.guild?.name || '')
    .replace(/\{membercount\}/gi, ctx.guild?.memberCount != null ? String(ctx.guild.memberCount) : '')
    .replace(/\{channel\}/gi, ctx.channel ? `<#${ctx.channel.id}>` : '');
  return resolveChannelMentions(resolved, ctx.guild);
}

// ── Data helpers ───────────────────────────────────────────────────────────────

function normalizeTemplate(raw) {
  if (raw && Array.isArray(raw.embeds)) return raw;
  return {
    embeds: [{
      title:       raw.title       ?? null,
      description: raw.description ?? null,
      color:       raw.color       ?? '#5865F2',
      footer:      raw.footer      ?? null,
      footerIcon:  raw.footerIcon  ?? null,
      thumbnail:   raw.thumbnail   ?? null,
      image:       raw.image       ?? null,
      fields:      raw.fields      ?? [],
      titleUrl:    raw.titleUrl    ?? null,
      authorName:  raw.authorName  ?? null,
      authorIcon:  raw.authorIcon  ?? null,
      authorUrl:   raw.authorUrl   ?? null,
      timestamp:   raw.timestamp   ?? false,
    }],
  };
}

function blankEmbed() {
  return {
    title: null, description: null, color: '#5865F2', footer: null, footerIcon: null,
    thumbnail: null, image: null, fields: [], titleUrl: null,
    authorName: null, authorIcon: null, authorUrl: null, timestamp: false,
  };
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

function embedCharCount(e) {
  let n = 0;
  if (e.title)      n += e.title.length;
  if (e.description) n += e.description.length;
  if (e.footer)     n += e.footer.length;
  if (e.authorName) n += e.authorName.length;
  if (e.fields)     for (const f of e.fields) n += (f.name?.length || 0) + (f.value?.length || 0);
  return n;
}

function templateCharCount(template) {
  return template.embeds.reduce((sum, e) => sum + embedCharCount(e), 0);
}

// ── Embed builders ─────────────────────────────────────────────────────────────

function buildEmbedFromData(data, { placeholderOk = false, ctx = null } = {}) {
  const rp = (s) => (ctx ? resolvePlaceholders(s, ctx) : s);
  const e = new EmbedBuilder().setColor(parseColor(data.color) || 0x5865F2);
  if (data.title)             e.setTitle(rp(data.title));
  if (data.titleUrl && isValidUrl(data.titleUrl)) e.setURL(data.titleUrl);
  if (data.description)       e.setDescription(rp(data.description));
  if (data.footer)            e.setFooter({ text: rp(data.footer), iconURL: data.footerIcon || undefined });
  if (data.authorName)        e.setAuthor({ name: rp(data.authorName), iconURL: data.authorIcon || undefined, url: data.authorUrl || undefined });
  if (data.thumbnail)         e.setThumbnail(data.thumbnail);
  if (data.image)             e.setImage(data.image);
  if (data.fields?.length)    e.addFields(data.fields.map(f => ({ name: rp(f.name).slice(0, 256), value: rp(f.value).slice(0, 1024), inline: !!f.inline })));
  if (data.timestamp)         e.setTimestamp();
  // Discord requires at least one visible field — show placeholder in editor previews
  const hasContent = data.title || data.description || data.image || data.fields?.length || data.authorName;
  if (!hasContent && placeholderOk)
    e.setDescription('*(empty embed — use the buttons above to fill it in)*');
  return e;
}

function buildPreviewEmbeds(template, ctx = null) {
  return template.embeds.map(e => buildEmbedFromData(e, { placeholderOk: true, ctx }));
}

// ── Editor UI ──────────────────────────────────────────────────────────────────

function editorRows(sessionId, embedIndex, totalEmbeds, curEmbed) {
  const tsOn = !!curEmbed?.timestamp;
  const hasFields = !!(curEmbed?.fields?.length);
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`embed_edit_title_${sessionId}`).setLabel('📝 Title').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`embed_edit_desc_${sessionId}`).setLabel('📝 Description').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`embed_edit_color_${sessionId}`).setLabel('🎨 Color').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`embed_edit_footer_${sessionId}`).setLabel('📌 Footer').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`embed_edit_author_${sessionId}`).setLabel('👤 Author').setStyle(ButtonStyle.Primary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`embed_edit_thumb_${sessionId}`).setLabel('🖼️ Thumbnail').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`embed_edit_image_${sessionId}`).setLabel('🖼️ Image').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`embed_edit_timestamp_${sessionId}`).setLabel(`🕐 Timestamp: ${tsOn ? 'On' : 'Off'}`).setStyle(tsOn ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`embed_edit_field_${sessionId}`).setLabel('➕ Field').setStyle(ButtonStyle.Secondary).setDisabled((curEmbed?.fields?.length || 0) >= MAX_FIELDS),
      new ButtonBuilder().setCustomId(`embed_edit_fieldrem_${sessionId}`).setLabel('➖ Field').setStyle(ButtonStyle.Secondary).setDisabled(!hasFields),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`embed_edit_prev_${sessionId}`).setLabel('◄ Prev').setStyle(ButtonStyle.Secondary).setDisabled(embedIndex === 0),
      new ButtonBuilder().setCustomId(`embed_edit_next_${sessionId}`).setLabel('► Next').setStyle(ButtonStyle.Secondary).setDisabled(embedIndex >= totalEmbeds - 1),
      new ButtonBuilder().setCustomId(`embed_edit_add_${sessionId}`).setLabel('➕ Add Embed').setStyle(ButtonStyle.Success).setDisabled(totalEmbeds >= MAX_EMBEDS),
      new ButtonBuilder().setCustomId(`embed_edit_rem_${sessionId}`).setLabel('🗑️ Remove').setStyle(ButtonStyle.Danger).setDisabled(totalEmbeds <= 1),
      new ButtonBuilder().setCustomId(`embed_edit_save_${sessionId}`).setLabel('💾 Save').setStyle(ButtonStyle.Success),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`embed_edit_cancel_${sessionId}`).setLabel('❌ Cancel').setStyle(ButtonStyle.Danger),
    ),
  ];
}

function editorContent(session, totalEmbeds) {
  const action = session.isNew ? 'Creating' : 'Editing';
  const idx    = (session.embedIndex ?? 0) + 1;
  return `${action} embed **${session.name}** — **Embed ${idx}/${totalEmbeds}** — edit fields below, use ◄► to switch embeds, then **Save**.\n*Placeholders available: \`{user}\` \`{username}\` \`{server}\` \`{membercount}\` \`{channel}\`*`;
}

async function launchEditor(interaction, guildId, name, template, isNew) {
  const sessionId  = `${interaction.user.id}-${Date.now()}`;
  const embedIndex = 0;
  activeEdits.set(sessionId, { guildId, name, userId: interaction.user.id, isNew, embedIndex });
  const ctx = { user: interaction.user, guild: interaction.guild, channel: interaction.channel };
  await interaction.reply({
    content:    editorContent({ name, isNew, embedIndex }, template.embeds.length),
    embeds:     buildPreviewEmbeds(template, ctx),
    components: editorRows(sessionId, embedIndex, template.embeds.length, template.embeds[embedIndex]),
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

// ── List (paginated) ────────────────────────────────────────────────────────────

function buildListView(guildId, guild, page) {
  const all       = readTemplates(guildId);
  const entries   = Object.entries(all[guildId] || {});
  const buttons   = readJson('buttons.json', {});
  const totalPages = Math.max(1, Math.ceil(entries.length / LIST_PAGE_SIZE));
  const safePage   = Math.max(0, Math.min(page, totalPages - 1));
  const slice      = entries.slice(safePage * LIST_PAGE_SIZE, (safePage + 1) * LIST_PAGE_SIZE);

  const lines = slice.map(([n, t]) => {
    const tpl = normalizeTemplate(t);
    const btnCount = Object.values(buttons[guildId] || {}).filter(b => b.embedName === n).length;
    return `• **${n}** — ${tpl.embeds.length} embed${tpl.embeds.length !== 1 ? 's' : ''}${btnCount ? ` · 🔘 ${btnCount}` : ''}`;
  });

  const embed = createServerEmbed('info', {
    title: '📋 Embed Templates',
    description: entries.length ? lines.join('\n') : 'No templates yet. Create one with `/embed create`.',
    footer: entries.length ? `Page ${safePage + 1}/${totalPages} • ${entries.length} template${entries.length !== 1 ? 's' : ''}` : undefined,
  }, guild);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`embed_list:${safePage - 1}`).setLabel('◄ Prev').setStyle(ButtonStyle.Secondary).setDisabled(safePage <= 0),
    new ButtonBuilder().setCustomId(`embed_list:${safePage + 1}`).setLabel('Next ►').setStyle(ButtonStyle.Secondary).setDisabled(safePage >= totalPages - 1),
  );

  return { embed, row, totalPages, count: entries.length };
}

// ── Main command ───────────────────────────────────────────────────────────────

module.exports = {
  data: new SlashCommandBuilder()
    .setName('embed').setDescription('Manage embed templates')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s.setName('create').setDescription('Create a new embed template')
      .addStringOption(o => o.setName('name').setDescription('Template name').setRequired(true)))
    .addSubcommand(s => s.setName('edit').setDescription('Edit an existing embed template')
      .addStringOption(o => o.setName('name').setDescription('Template name').setRequired(true).setAutocomplete(true)))
    .addSubcommand(s => s.setName('delete').setDescription('Delete a template — choose from a dropdown'))
    .addSubcommand(s => s.setName('list').setDescription('List all templates'))
    .addSubcommand(s => s.setName('preview').setDescription('Preview a template before sending (only visible to you)')
      .addStringOption(o => o.setName('name').setDescription('Template name').setRequired(true).setAutocomplete(true)))
    .addSubcommand(s => s.setName('duplicate').setDescription('Clone an existing template as a starting point')
      .addStringOption(o => o.setName('name').setDescription('Template to copy').setRequired(true).setAutocomplete(true))
      .addStringOption(o => o.setName('newname').setDescription('Name for the new copy').setRequired(true)))
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
    await interaction.respond(filtered).catch(err => {
      if (err.code !== 10062) throw err;
      // 10062 = interaction expired before respond() — harmless, discard silently
    });
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
      const { embed, row, totalPages } = buildListView(guildId, interaction.guild, 0);
      return interaction.reply({ embeds: [embed], components: totalPages > 1 ? [row] : [] });
    }

    if (sub === 'preview') {
      const payload = buildEmbedPayload(interaction.guild, name, { user: interaction.user, channel: interaction.channel });
      if (!payload)
        return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Not Found', description: `Template **${name}** not found.` }, interaction.guild)], flags: 64 });
      const rows = [...(payload.components || [])];
      if (rows.length < 5) {
        rows.push(new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`embed_previewsend:${name}`).setLabel('📤 Send Here').setStyle(ButtonStyle.Success),
        ));
      }
      return interaction.reply({ content: `👁️ Preview of **${name}** — only you can see this.`, embeds: payload.embeds, components: rows, flags: 64 });
    }

    if (sub === 'duplicate') {
      const newName = interaction.options.getString('newname')?.toLowerCase();
      const template = getTemplate(all, guildId, name);
      if (!template)
        return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Not Found', description: `Template **${name}** not found.` }, interaction.guild)], flags: 64 });
      if (!newName)
        return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Name Required' }, interaction.guild)], flags: 64 });
      if (all[guildId][newName])
        return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Already Exists', description: `Template **${newName}** already exists.` }, interaction.guild)], flags: 64 });
      all[guildId][newName] = JSON.parse(JSON.stringify(template));
      writeJson('embeds.json', all);
      return interaction.reply({ embeds: [createServerEmbed('success', { title: '📋 Duplicated', description: `Copied **${name}** → **${newName}**. Use \`/embed edit name:${newName}\` to customize it.` }, interaction.guild)], flags: 64 });
    }

    if (sub === 'send') {
      const channel = interaction.options.getChannel('channel') || interaction.channel;
      const payload = buildEmbedPayload(interaction.guild, name, { user: interaction.user, channel });
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

function buildEmbedPayload(guild, name, ctx = {}) {
  const all      = readTemplates(guild.id);
  const raw      = all[guild.id]?.[name];
  if (!raw) return null;
  const template = normalizeTemplate(raw);
  const fullCtx  = { guild, ...ctx };
  const builtEmbeds = template.embeds.map(e => buildEmbedFromData(e, { ctx: fullCtx }));

  const buttons         = readJson('buttons.json', {});
  const templateButtons = Object.values(buttons[guild.id] || {}).filter(b => b.embedName === name);
  const rows = [];
  let cur = new ActionRowBuilder();

  for (const btn of templateButtons) {
    try {
      if (cur.components.length >= 5) { rows.push(cur); cur = new ActionRowBuilder(); }
      const safeLabel = btn.label || null;
      if (btn.type === 'link') {
        // Link-style buttons MUST have a valid URL — skip silently rather than
        // crashing the whole send if a legacy/edited record lost its URL.
        if (!btn.url || !isValidUrl(btn.url)) continue;
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
    } catch (err) {
      console.error(`[EMBED PAYLOAD] skipping broken button "${btn.id}":`, err.message);
    }
  }
  if (cur.components.length > 0) rows.push(cur);
  return { embeds: builtEmbeds, components: rows };
}

module.exports.buildEmbedPayload = buildEmbedPayload;

// ── Select menu handler (delete + field-removal flows) ─────────────────────────

module.exports.handleEmbedSelect = async function(interaction) {
  if (interaction.customId.startsWith('embed_fieldsel_')) {
    const sessionId = interaction.customId.slice('embed_fieldsel_'.length);
    const session    = activeEdits.get(sessionId);
    if (!session)
      return interaction.update({ content: null, embeds: [createServerEmbed('error', { title: 'Session Expired', description: 'Run `/embed edit` again.' }, interaction.guild)], components: [] });
    if (session.userId !== interaction.user.id)
      return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Not Your Session' }, interaction.guild)], flags: 64 });

    const all = readJson('embeds.json', {});
    const raw = all[session.guildId]?.[session.name];
    if (!raw) {
      activeEdits.delete(sessionId);
      return interaction.update({ content: null, embeds: [createServerEmbed('error', { title: 'Template Gone' }, interaction.guild)], components: [] });
    }
    const template   = normalizeTemplate(raw);
    const embedIndex = Math.min(session.embedIndex ?? 0, template.embeds.length - 1);
    const curEmbed   = template.embeds[embedIndex];
    const idx        = parseInt(interaction.values[0], 10);
    const fields      = curEmbed.fields || [];
    if (idx >= 0 && idx < fields.length) fields.splice(idx, 1);
    curEmbed.fields = fields;
    all[session.guildId][session.name] = template;
    writeJson('embeds.json', all);

    const ctx = { user: interaction.user, guild: interaction.guild, channel: interaction.channel };
    return interaction.update({
      content:    editorContent(session, template.embeds.length),
      embeds:     buildPreviewEmbeds(template, ctx),
      components: editorRows(sessionId, embedIndex, template.embeds.length, curEmbed),
    });
  }

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

// ── Button handler (confirm / back / preview-send / editor flow) ───────────────

module.exports.handleEmbedButton = async function(interaction) {
  const id = interaction.customId;

  if (id.startsWith('embed_delyes:')) {
    const name    = id.slice('embed_delyes:'.length);
    const all     = readJson('embeds.json', {});
    const guildId = interaction.guild.id;
    if (all[guildId]?.[name]) { delete all[guildId][name]; writeJson('embeds.json', all); }

    // Cascade-delete any buttons that were attached to this template — they
    // can never be sent again once their parent template is gone.
    let removedButtons = 0;
    const buttons = readJson('buttons.json', {});
    if (buttons[guildId]) {
      for (const [btnId, b] of Object.entries(buttons[guildId])) {
        if (b.embedName === name) { delete buttons[guildId][btnId]; removedButtons++; }
      }
      if (removedButtons) writeJson('buttons.json', buttons);
    }

    const success = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('🗑️ Template Deleted')
      .setDescription(`**${name}** has been permanently deleted.${removedButtons ? `\n🔘 ${removedButtons} attached button${removedButtons !== 1 ? 's were' : ' was'} removed too.` : ''}`);
    await interaction.update({ embeds: [success], components: [] });
    setTimeout(() => interaction.message.delete().catch(() => {}), TEMP_MS);
    return;
  }

  if (id === 'embed_delno') {
    return buildDeleteSelector(interaction.guild.id, { reply: (...a) => interaction.update(...a), guild: interaction.guild });
  }

  if (id.startsWith('embed_list:')) {
    const page = parseInt(id.slice('embed_list:'.length), 10) || 0;
    const { embed, row } = buildListView(interaction.guild.id, interaction.guild, page);
    return interaction.update({ embeds: [embed], components: [row] });
  }

  if (id.startsWith('embed_previewsend:')) {
    const name    = id.slice('embed_previewsend:'.length);
    const payload = buildEmbedPayload(interaction.guild, name, { user: interaction.user, channel: interaction.channel });
    if (!payload) return interaction.update({ content: '❌ Template no longer exists.', embeds: [], components: [] });
    await interaction.channel.send({ embeds: payload.embeds, components: payload.components.length ? payload.components : undefined });
    return interaction.update({ content: `✅ Sent **${name}** to this channel.`, embeds: [], components: [] });
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
  const ctx = { user: interaction.user, guild: interaction.guild, channel: interaction.channel };

  if (action === 'save') {
    const total = templateCharCount(template);
    if (total > MAX_TOTAL_CHARS)
      return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Too Much Text', description: `This template has **${total}** characters across all embeds — Discord's limit is **${MAX_TOTAL_CHARS}**. Trim some text and try again.` }, interaction.guild)], flags: 64 });
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
    return interaction.update({ content: editorContent(session, template.embeds.length), embeds: buildPreviewEmbeds(template, ctx), components: editorRows(sessionId, session.embedIndex, template.embeds.length, template.embeds[session.embedIndex]) });
  }
  if (action === 'next') {
    session.embedIndex = Math.min(template.embeds.length - 1, embedIndex + 1);
    activeEdits.set(sessionId, session);
    return interaction.update({ content: editorContent(session, template.embeds.length), embeds: buildPreviewEmbeds(template, ctx), components: editorRows(sessionId, session.embedIndex, template.embeds.length, template.embeds[session.embedIndex]) });
  }
  if (action === 'add') {
    if (template.embeds.length >= MAX_EMBEDS) return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Limit Reached', description: `Max ${MAX_EMBEDS} embeds per template.` }, interaction.guild)], flags: 64 });
    template.embeds.push(blankEmbed());
    session.embedIndex = template.embeds.length - 1;
    activeEdits.set(sessionId, session);
    all[session.guildId][session.name] = template;
    writeJson('embeds.json', all);
    return interaction.update({ content: editorContent(session, template.embeds.length), embeds: buildPreviewEmbeds(template, ctx), components: editorRows(sessionId, session.embedIndex, template.embeds.length, template.embeds[session.embedIndex]) });
  }
  if (action === 'rem') {
    if (template.embeds.length <= 1) return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Cannot Remove', description: 'A template must have at least one embed.' }, interaction.guild)], flags: 64 });
    template.embeds.splice(embedIndex, 1);
    session.embedIndex = Math.min(embedIndex, template.embeds.length - 1);
    activeEdits.set(sessionId, session);
    all[session.guildId][session.name] = template;
    writeJson('embeds.json', all);
    return interaction.update({ content: editorContent(session, template.embeds.length), embeds: buildPreviewEmbeds(template, ctx), components: editorRows(sessionId, session.embedIndex, template.embeds.length, template.embeds[session.embedIndex]) });
  }
  if (action === 'timestamp') {
    template.embeds[embedIndex].timestamp = !template.embeds[embedIndex].timestamp;
    all[session.guildId][session.name] = template;
    writeJson('embeds.json', all);
    return interaction.update({ content: editorContent(session, template.embeds.length), embeds: buildPreviewEmbeds(template, ctx), components: editorRows(sessionId, embedIndex, template.embeds.length, template.embeds[embedIndex]) });
  }
  if (action === 'fieldrem') {
    const curFields = template.embeds[embedIndex].fields || [];
    if (curFields.length === 0)
      return interaction.reply({ embeds: [createServerEmbed('error', { title: 'No Fields', description: 'This embed has no fields to remove.' }, interaction.guild)], flags: 64 });
    const options = curFields.slice(0, 25).map((f, i) =>
      new StringSelectMenuOptionBuilder().setLabel(`${i + 1}. ${f.name}`.slice(0, 100)).setValue(String(i)),
    );
    const selectRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(`embed_fieldsel_${sessionId}`).setPlaceholder('Choose a field to remove…').addOptions(options),
    );
    const backRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`embed_edit_fieldback_${sessionId}`).setLabel('← Back').setStyle(ButtonStyle.Secondary),
    );
    return interaction.update({ content: `Removing a field from embed ${embedIndex + 1} — pick one below.`, embeds: buildPreviewEmbeds(template, ctx), components: [selectRow, backRow] });
  }
  if (action === 'fieldback') {
    return interaction.update({ content: editorContent(session, template.embeds.length), embeds: buildPreviewEmbeds(template, ctx), components: editorRows(sessionId, embedIndex, template.embeds.length, template.embeds[embedIndex]) });
  }

  const curEmbed = template.embeds[embedIndex];

  // Multi-input custom modals
  if (action === 'title') {
    const modal = new ModalBuilder().setCustomId(`embed_modal_title_${sessionId}`).setTitle(`Embed ${embedIndex + 1} — Title`).addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title').setLabel('Title').setStyle(TextInputStyle.Short).setMaxLength(256).setRequired(false).setValue(curEmbed.title || '')),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('titleurl').setLabel('Title URL (optional, makes it a link)').setStyle(TextInputStyle.Short).setMaxLength(500).setRequired(false).setValue(curEmbed.titleUrl || '')),
    );
    await interaction.showModal(modal);
    return true;
  }
  if (action === 'footer') {
    const modal = new ModalBuilder().setCustomId(`embed_modal_footer_${sessionId}`).setTitle(`Embed ${embedIndex + 1} — Footer`).addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('footer').setLabel('Footer text').setStyle(TextInputStyle.Short).setMaxLength(2048).setRequired(false).setValue(curEmbed.footer || '')),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('footericon').setLabel('Footer Icon URL (optional)').setStyle(TextInputStyle.Short).setMaxLength(500).setRequired(false).setValue(curEmbed.footerIcon || '')),
    );
    await interaction.showModal(modal);
    return true;
  }
  if (action === 'author') {
    const modal = new ModalBuilder().setCustomId(`embed_modal_author_${sessionId}`).setTitle(`Embed ${embedIndex + 1} — Author`).addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('authorname').setLabel('Author name').setStyle(TextInputStyle.Short).setMaxLength(256).setRequired(false).setValue(curEmbed.authorName || '')),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('authoricon').setLabel('Author Icon URL (optional)').setStyle(TextInputStyle.Short).setMaxLength(500).setRequired(false).setValue(curEmbed.authorIcon || '')),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('authorurl').setLabel('Author URL (optional link)').setStyle(TextInputStyle.Short).setMaxLength(500).setRequired(false).setValue(curEmbed.authorUrl || '')),
    );
    await interaction.showModal(modal);
    return true;
  }
  if (action === 'field') {
    if ((curEmbed.fields || []).length >= MAX_FIELDS)
      return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Field Limit Reached', description: `This embed already has ${MAX_FIELDS} fields — Discord's maximum.` }, interaction.guild)], flags: 64 });
    const modal = new ModalBuilder().setCustomId(`embed_modal_field_${sessionId}`).setTitle(`Embed ${embedIndex + 1} — Add Field`).addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('fname').setLabel('Field Name').setStyle(TextInputStyle.Short).setMaxLength(256).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('fvalue').setLabel('Field Value').setStyle(TextInputStyle.Paragraph).setMaxLength(1024).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('finline').setLabel('Inline? (yes/no)').setStyle(TextInputStyle.Short).setMaxLength(3).setRequired(false).setValue('no')),
    );
    await interaction.showModal(modal);
    return true;
  }

  // Generic single-field modal triggers
  const fieldMeta = {
    desc:   { label: 'Description',   style: TextInputStyle.Paragraph, max: 4000 },
    color:  { label: 'Color (hex)',   style: TextInputStyle.Short,     max: 7    },
    thumb:  { label: 'Thumbnail URL', style: TextInputStyle.Short,     max: 500  },
    image:  { label: 'Image URL',     style: TextInputStyle.Short,     max: 500  },
  };
  const meta = fieldMeta[action];
  if (!meta) return;

  const currentMap = { desc: 'description', color: 'color', thumb: 'thumbnail', image: 'image' };
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

  const all        = readJson('embeds.json', {});
  const raw        = all[session.guildId][session.name];
  if (!raw) { activeEdits.delete(sessionId); return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Template Gone' }, interaction.guild)], flags: 64 }); }
  const template   = normalizeTemplate(raw);
  const embedIndex = Math.min(session.embedIndex ?? 0, template.embeds.length - 1);
  const curEmbed   = template.embeds[embedIndex];

  if (action === 'title') {
    const title    = interaction.fields.getTextInputValue('title') || null;
    const titleUrl = interaction.fields.getTextInputValue('titleurl') || null;
    if (titleUrl && !isValidUrl(titleUrl))
      return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Invalid URL', description: 'Title URL must start with `http://` or `https://`.' }, interaction.guild)], flags: 64 });
    curEmbed.title = title;
    curEmbed.titleUrl = titleUrl;
  } else if (action === 'footer') {
    const footer     = interaction.fields.getTextInputValue('footer') || null;
    const footerIcon = interaction.fields.getTextInputValue('footericon') || null;
    if (footerIcon && !isValidUrl(footerIcon))
      return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Invalid URL', description: 'Footer icon URL must start with `http://` or `https://`.' }, interaction.guild)], flags: 64 });
    curEmbed.footer = footer;
    curEmbed.footerIcon = footerIcon;
  } else if (action === 'author') {
    const authorName = interaction.fields.getTextInputValue('authorname') || null;
    const authorIcon = interaction.fields.getTextInputValue('authoricon') || null;
    const authorUrl  = interaction.fields.getTextInputValue('authorurl') || null;
    if (authorIcon && !isValidUrl(authorIcon))
      return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Invalid URL', description: 'Author icon URL must start with `http://` or `https://`.' }, interaction.guild)], flags: 64 });
    if (authorUrl && !isValidUrl(authorUrl))
      return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Invalid URL', description: 'Author URL must start with `http://` or `https://`.' }, interaction.guild)], flags: 64 });
    curEmbed.authorName = authorName;
    curEmbed.authorIcon = authorIcon;
    curEmbed.authorUrl  = authorUrl;
  } else if (action === 'field') {
    const fname  = interaction.fields.getTextInputValue('fname').trim();
    const fvalue = interaction.fields.getTextInputValue('fvalue').trim();
    const finlineRaw = (interaction.fields.getTextInputValue('finline') || '').trim().toLowerCase();
    if (!fname || !fvalue)
      return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Missing Fields', description: 'Field name and value are both required.' }, interaction.guild)], flags: 64 });
    if (!curEmbed.fields) curEmbed.fields = [];
    if (curEmbed.fields.length >= MAX_FIELDS)
      return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Field Limit Reached', description: `This embed already has ${MAX_FIELDS} fields — Discord's maximum.` }, interaction.guild)], flags: 64 });
    const inline = ['yes', 'y', 'true', '1'].includes(finlineRaw);
    curEmbed.fields.push({ name: fname.slice(0, 256), value: fvalue.slice(0, 1024), inline });
  } else {
    const map = { desc: 'description', color: 'color', thumb: 'thumbnail', image: 'image' };
    if (map[action] === undefined) return false;
    const value = interaction.fields.getTextInputValue('value');
    if (action === 'color' && value && !isValidHexColor(value))
      return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Invalid Color', description: 'Use a 6-digit hex code like `#5865F2` or `5865F2`.' }, interaction.guild)], flags: 64 });
    if ((action === 'thumb' || action === 'image') && value && !isValidUrl(value))
      return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Invalid URL', description: 'Must be a direct link starting with `http://` or `https://`.' }, interaction.guild)], flags: 64 });
    curEmbed[map[action]] = value || null;
  }

  all[session.guildId][session.name] = template;
  writeJson('embeds.json', all);

  const ctx = { user: interaction.user, guild: interaction.guild, channel: interaction.channel };
  await interaction.update({
    content:    editorContent(session, template.embeds.length),
    embeds:     buildPreviewEmbeds(template, ctx),
    components: editorRows(sessionId, embedIndex, template.embeds.length, curEmbed),
  });
  return true;
};
