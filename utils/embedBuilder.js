const { EmbedBuilder, MessageFlags } = require('discord.js');

// Discord embeds only support a single solid sidebar colour — no true gradients.
// These colours are chosen as rich, distinct stops across the visible spectrum
// so each embed type has its own unmistakable identity (the closest we can get
// to a "gradient" across the bot's palette).
const colors = {
    success:   0x2ECC71,   // emerald green
    error:     0xFF4757,   // vivid red-orange
    info:      0x5865F2,   // Discord blurple
    warning:   0xFFA502,   // warm amber
    giveaway:  0xFFD700,   // gold
    ticket:    0x00CEC9,   // teal cyan
    userinfo:  0xA855F7,   // violet-purple
    shop:      0xFF6B35,   // rich orange
    inventory: 0x3B82F6,   // electric blue
    schedule:  0xEC4899,   // hot pink
    welcome:   0x10B981,   // jade green
    leave:     0xF97316,   // sunset orange
    casino:    0xE11D48,   // crimson
    economy:   0xF59E0B,   // golden amber
    mod:       0xEF4444,   // alert red
    news:      0x1D9BF0,   // market-blue
    breaking:  0xFF3B30,   // urgent red
};

// Auto-prefixed icon per embed type, used to give plain confirmation titles
// ("Removed", "Not Found", ...) a consistent, recognizable look without
// every command having to remember its own emoji.
const typeIcons = {
    success: '✅',
    error: '❌',
    info: 'ℹ️',
    warning: '⚠️',
    giveaway: '🎟️',
    ticket: '🎫',
    userinfo: '👤',
    shop: '🛒',
    inventory: '🎒',
    schedule: '🗓️',
    welcome: '🌱',
    leave: '🍂',
};

// Matches an emoji (or emoji-presentation symbol) at the start of a string,
// so we don't double up when a title already has one (e.g. "🔨 Banned").
const LEADING_EMOJI = /^\p{Extended_Pictographic}/u;

function parseColor(colorInput) {
    if (!colorInput) return null;
    if (colorInput.startsWith('#')) {
        const parsed = parseInt(colorInput.slice(1), 16);
        return isNaN(parsed) ? null : parsed;
    }
    const parsed = parseInt(colorInput, 16);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 0xFFFFFF) return parsed;
    return null;
}

// Strict format check for user-submitted hex colors — used to reject bad
// input at the point of entry (modals) instead of silently falling back to
// the default blurple, which used to hide typos from the user.
function isValidHexColor(input) {
    if (!input || typeof input !== 'string') return false;
    return /^#?[0-9A-Fa-f]{6}$/.test(input.trim());
}

// Loose but useful URL check for image/thumbnail/icon/link fields — requires
// an http(s) URL so Discord doesn't silently reject the embed/button later.
function isValidUrl(input) {
    if (!input || typeof input !== 'string') return false;
    try {
        const u = new URL(input.trim());
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
        return false;
    }
}

function decorateTitle(type, title) {
    if (!title) return title;
    if (LEADING_EMOJI.test(title)) return title;
    const icon = typeIcons[type];
    return icon ? `${icon} ${title}` : title;
}

function createEmbed(type, options = {}) {
    const embed = new EmbedBuilder()
        .setColor(options.color || colors[type] || colors.info);

    // Pass `timestamp: false` to leave it off. Discord already prints the time
    // beside every message, so on a one-line confirmation the stamp is a whole
    // extra row saying something the client said already.
    if (options.timestamp !== false) embed.setTimestamp();

    if (options.title) embed.setTitle(decorateTitle(type, options.title));
    if (options.description) embed.setDescription(options.description);
    if (options.footer) embed.setFooter({ text: options.footer, iconURL: options.footerIcon });
    if (options.thumbnail) embed.setThumbnail(options.thumbnail);
    if (options.image) embed.setImage(options.image);
    if (options.author) embed.setAuthor({ name: options.author.name, iconURL: options.author.iconURL });
    if (options.fields) {
        for (const field of options.fields) {
            embed.addFields({
                name: field.name,
                value: field.value,
                inline: field.inline || false,
            });
        }
    }
    return embed;
}

// Guild-flavored variant: adds a consistent brand footer and a small author
// tag (server icon + name).
//
// It used to add them to everything, which is how a one-line "❌ Not Locked"
// became a five-line card: an author row saying YSER Flow, the line itself,
// then a footer repeating the server name and a timestamp Discord had already
// printed beside the message. Four fifths of it was chrome.
//
// So the polish now goes on the things that are actually being read — a card
// with fields, a picture, or chrome the caller asked for by name. A bare title
// and a sentence is an acknowledgement, and an acknowledgement is two lines.
function createServerEmbed(type, options = {}, guild) {
  const isCard = !!(options.fields?.length || options.image || options.footer || options.author);
  if (!isCard) return createEmbed(type, { ...options, timestamp: false });

  const footerText = options.footer || `${guild?.name || 'Server'} • YSER Flow`;
  const author = options.author
    || (guild ? { name: 'YSER Flow', iconURL: guild.iconURL?.({ dynamic: true }) || undefined } : undefined);
  return createEmbed(type, { ...options, footer: footerText, author });
}

const TEMP_REPLY_MS = 5000; // matches the "embed sent" confirmation delay this mirrors

// Ephemeral confirmations (success/error acknowledgements) auto-delete after
// a few seconds instead of piling up in the interaction history — same
// behavior the embed editor's "embed sent" confirmation already had.
// Only for a *fresh* ephemeral `interaction.reply(...)`: never use this for
// a public reply (mod-action records like /warn, /ban must stay visible to
// the rest of the server) or for a reply whose components the user still
// needs to interact with.
async function sendTempReply(interaction, payload, ms = TEMP_REPLY_MS) {
    await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    setTimeout(() => interaction.deleteReply().catch(() => {}), ms);
}

// Same idea for a confirmation sent via `interaction.followUp(...)` — e.g.
// after `deferUpdate()`, where the original message is a panel being
// restored separately and the followUp is just a transient "done" notice.
async function sendTempFollowUp(interaction, payload, ms = TEMP_REPLY_MS) {
    const msg = await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
    setTimeout(() => msg.delete().catch(() => {}), ms);
}

module.exports = { createEmbed, createServerEmbed, colors, parseColor, isValidHexColor, isValidUrl, sendTempReply, sendTempFollowUp };
