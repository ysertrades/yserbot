'use strict';

/**
 * Renders the "Drawing winners" GIF once into assets/giveaway/drawing.gif.
 *
 * The bot ships this file instead of drawing the GIF when a giveaway ends: on
 * the host's CPU share the render took seconds, so the card often went by
 * before the GIF had even loaded. Re-run after changing the gift's look:
 *   node scripts/render-drawing-gif.js
 */

const fs = require('fs');
const path = require('path');
const { renderGiftDrawGif, DRAWING_GIF_OPTS } = require('../utils/giftDrawVisual');

const out = path.join(__dirname, '..', 'assets', 'giveaway', 'drawing.gif');
const gif = renderGiftDrawGif(DRAWING_GIF_OPTS);
if (!gif) { console.error('@napi-rs/canvas is not installed'); process.exit(1); }
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, gif);
console.log(`wrote ${path.relative(process.cwd(), out)} (${Math.round(gif.length / 1024)} KB)`);
