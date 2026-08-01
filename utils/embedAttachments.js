'use strict';

/**
 * embedAttachments.js
 *
 * Keeping a generated image attached to its embed across an edit.
 *
 * Two traps, and the giveaway hit both.
 *
 * The first: Discord renders an attachment inline *unless* an embed claims it
 * through `attachment://name`. Reading an embed back with EmbedBuilder.from()
 * gives you the resolved CDN URL rather than that reference, so re-saving it
 * leaves the file unclaimed — and it appears a second time, above the embed,
 * as well as inside it. That is what happened every time somebody pressed
 * Enter on a giveaway: the entry count edit re-wrote the embed and orphaned
 * its own banner.
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
 * Rewrites CDN links back into `attachment://` references.
 *
 * Called before editing an embed that was read off an existing message, so the
 * files stay claimed and Discord keeps showing them in one place.
 *
 * @param {import('discord.js').Message} message
 * @param {import('discord.js').EmbedBuilder} embed
 * @returns {import('discord.js').EmbedBuilder} the same builder, for chaining
 */
function keepAttachmentRefs(message, embed) {
  const names = [...(message?.attachments?.values?.() || [])].map(a => a.name).filter(Boolean);
  if (!names.length) return embed;

  const restore = url => {
    if (typeof url !== 'string' || url.startsWith('attachment://')) return url;
    // The CDN path ends in the original filename, which is what ties a
    // resolved URL back to the attachment it came from.
    const match = names.find(n => url.includes(`/${n}`));
    return match ? `attachment://${match}` : url;
  };

  const image = embed.data?.image?.url;
  if (image) embed.setImage(restore(image));
  const thumb = embed.data?.thumbnail?.url;
  if (thumb) embed.setThumbnail(restore(thumb));
  return embed;
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

module.exports = { keepAttachmentRefs, applyEmbedImage, replaceFiles };
