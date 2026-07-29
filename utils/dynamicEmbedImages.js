'use strict';

/**
 * dynamicEmbedImages.js
 *
 * Embed templates (utils/jsonStorage → embeds.json) normally store a plain
 * image URL. A template can instead store `dynamic:<key>` in its image
 * field to mean "regenerate this pixel-art image fresh every time the
 * template is sent/previewed" — the same AttachmentBuilder + attachment://
 * trick /fish, /mine, etc. already use, just wired into the reusable
 * template system so a template stays live (edit/delete/re-send whenever)
 * without needing a permanently-hosted image URL this environment has no
 * way to produce.
 */

const { AttachmentBuilder } = require('discord.js');
const { generateEconomyShowcaseImage } = require('./economyShowcaseVisual');

const DYNAMIC_IMAGES = {
  economyShowcase: { filename: 'economy_showcase.png', generate: generateEconomyShowcaseImage },
};

const DYNAMIC_PREFIX = 'dynamic:';

function isDynamicImage(value) {
  return typeof value === 'string' && value.startsWith(DYNAMIC_PREFIX);
}

function dynamicImageKey(value) {
  return value.slice(DYNAMIC_PREFIX.length);
}

function dynamicAttachmentRef(value) {
  const entry = DYNAMIC_IMAGES[dynamicImageKey(value)];
  return entry ? `attachment://${entry.filename}` : null;
}

// One AttachmentBuilder per distinct dynamic image referenced anywhere in
// the template (usually just one), so a multi-embed template referencing
// the same dynamic image twice doesn't generate/attach it twice.
function collectDynamicAttachments(template) {
  const seen = new Set();
  const files = [];
  for (const e of template.embeds) {
    if (!isDynamicImage(e.image)) continue;
    const key = dynamicImageKey(e.image);
    const entry = DYNAMIC_IMAGES[key];
    if (!entry || seen.has(key)) continue;
    seen.add(key);
    files.push(new AttachmentBuilder(entry.generate(), { name: entry.filename }));
  }
  return files;
}

module.exports = { DYNAMIC_IMAGES, isDynamicImage, dynamicImageKey, dynamicAttachmentRef, collectDynamicAttachments };
