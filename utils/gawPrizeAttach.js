'use strict';
/**
 * Full-resolution prize image attachment for DMs (no canvas resize).
 */
async function buildPrizeFiles(imageOpts) {
  const files = [];
  if (!imageOpts || typeof imageOpts !== 'object') return files;
  try {
    const { AttachmentBuilder } = require('discord.js');
    if (imageOpts.data && typeof imageOpts.data === 'string' && imageOpts.data.startsWith('data:image/')) {
      const mm = imageOpts.data.match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/=]+)$/i);
      if (mm) {
        const ext = mm[1].toLowerCase() === 'jpg' ? 'jpg' : mm[1].toLowerCase();
        const buf = Buffer.from(mm[2], 'base64');
        if (buf.length > 0 && buf.length <= 8 * 1024 * 1024) {
          files.push(new AttachmentBuilder(buf, { name: `prize.${ext === 'jpeg' ? 'jpg' : ext}` }));
        }
      }
    } else if (imageOpts.url && /^https:\/\//i.test(String(imageOpts.url))) {
      const res = await fetch(String(imageOpts.url));
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 0 && buf.length <= 8 * 1024 * 1024) {
          const ct = (res.headers.get('content-type') || '').toLowerCase();
          let ext = 'png';
          if (ct.includes('jpeg') || ct.includes('jpg')) ext = 'jpg';
          else if (ct.includes('webp')) ext = 'webp';
          else if (ct.includes('gif')) ext = 'gif';
          files.push(new AttachmentBuilder(buf, { name: `prize.${ext}` }));
        }
      }
    }
  } catch (err) {
    console.warn('[GIVEAWAY] prize image attach failed:', err.message || err);
  }
  return files;
}

module.exports = { buildPrizeFiles };
