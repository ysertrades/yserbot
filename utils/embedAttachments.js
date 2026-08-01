'use strict';

/**
 * embedAttachments.js
 *
 * Keeping a generated image attached to its embed across an edit.
 *
 * Two traps, and the giveaway hit both.
 *
 * The first: Discord shows an attachment above an embed unless it can tell the
 * embed is displaying that same file — and a signed CDN link copied out of one
 * message and written back into another is not something it can tell that
 * from. So the banner appeared twice, once inside the embed and once above it,
 * every time somebody pressed Enter and the entry count was rewritten.
 *
 * The second: editing with `files` and no `attachments` *adds* to what is
 * already there rather than replacing it, so re-sending the same banner on
 * every edit stacks copies of it.
 */

const { AttachmentBuilder } = require('discord.js');
const {
  isDynamicImage, dynamicAttachmentRef, collectDynamicAttachments,
} = require('./dynamicEmbedImages');

/**
 * Edit options for a message whose picture must survive a text-only change.
 *
 * This is the entry-count edit on a giveaway, and it took three attempts to get
 * right, so it is worth writing down why it ends up here.
 *
 * A CDN link is not a stable name for an attachment. Discord signs them —
 * `?ex=…&is=…&hm=…` — and re-signs them every time it hands the message back.
 * The client only hides a file from the standalone previews above an embed when
 * it can tell the embed is showing that same file, so an embed carrying a
 * link that no longer matches gets both: the picture inside the embed, and the
 * attachment again above it. Copying the URL out of the live message with
 * EmbedBuilder.from() and writing it straight back is exactly that.
 *
 * Rewriting the link to `attachment://name` is closer but still a guess about
 * what Discord will resolve it against, because the request carries no files.
 *
 * So this does the one thing that is not a guess: it re-uploads the picture,
 * the same way the original message that renders correctly was posted, and
 * clears the old attachment so there is exactly one. `attachment://name` then
 * refers to a file in this very request. The banner is memoised, so redrawing
 * costs nothing; the upload is the price of the message being right.
 *
 * @param {import('discord.js').EmbedBuilder} embed  edited in place
 * @param {string|null} imageUrl  what the giveaway stored: a generated key, a
 *   link, or nothing
 * @param {string|null} guildId   so a generated banner uses this server's wording
 * @returns {object} extra options to spread into the edit
 */
function reattachEmbedImage(embed, imageUrl, guildId = null) {
  if (!imageUrl) return {};

  // A plain link is hosted somewhere else, so there is no attachment to lose
  // and nothing to re-upload. Setting it is enough.
  if (!isDynamicImage(imageUrl)) {
    const files = applyEmbedImage(embed, imageUrl, guildId);
    return files.length ? replaceFiles(files) : {};
  }

  const files = applyEmbedImage(embed, imageUrl, guildId);
  // If the banner could not be drawn, leave the embed exactly as it was rather
  // than editing it into a state with a reference to a file that is not there.
  return files.length ? replaceFiles(files) : {};
}

/**
 * The same, for a picture that is built by the caller rather than looked up.
 *
 * The coins giveaway draws its own banner with its own wording, so it hands the
 * finished attachment in instead of a key to look up.
 */
function reattachBuilt(embed, attachment) {
  if (!attachment?.name) return {};
  try { embed.setImage(`attachment://${attachment.name}`); }
  catch (err) {
    console.error('[Embed] could not reference the rebuilt image:', err.message ?? err);
    return {};
  }
  return replaceFiles([attachment]);
}

/**
 * Puts an image on an embed, whichever kind it is.
 *
 * A generated banner is not a URL — it has to be drawn, attached and then
 * referenced. Handing `dynamic:whatever` straight to setImage produces an
 * embed Discord rejects outright, which loses the whole message rather than
 * just the picture.
 *
 * @returns {AttachmentBuilder[]} files to send alongside; empty for a plain URL
 */
function applyEmbedImage(embed, imageUrl, guildId = null) {
  if (!imageUrl) return [];

  // setImage validates, and throws rather than returning — on anything that is
  // not a URL, which `dynamic:prizeGiveawayBanner` is not. Thrown out of a
  // giveaway ending, that took the whole result down with it: the winners were
  // drawn and written, the message was never updated, and the giveaway stayed
  // listed as running. An image is decoration; nothing it does should be able
  // to lose the thing it decorates.
  const set = url => {
    try { embed.setImage(url); return true; }
    catch (err) {
      console.error('[Embed] refusing an image Discord would not take:', url, err.message ?? err);
      return false;
    }
  };

  if (!isDynamicImage(imageUrl)) { set(imageUrl); return []; }

  const ref = dynamicAttachmentRef(imageUrl);
  const files = collectDynamicAttachments({ embeds: [{ image: imageUrl }] }, guildId);
  if (!ref || !files.length) return [];
  return set(ref) ? files : [];
}

/**
 * Edit options that replace the attachments rather than adding to them.
 *
 * `attachments: []` is the part that matters — without it Discord keeps every
 * file already on the message and appends the new one.
 */
function replaceFiles(files) {
  return { files, attachments: [] };
}

module.exports = { reattachEmbedImage, reattachBuilt, applyEmbedImage, replaceFiles };
