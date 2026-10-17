'use strict';

/**
 * Commands the bot does not load, in one place.
 *
 * index.js and deploy-commands.js each kept their own list, and only
 * index.js skipped economy and cards — so `npm run deploy` registered slash
 * commands that the running bot had no handler for, and using them failed.
 */
const SKIP_COMMAND_FOLDERS = new Set(['_disabled', 'economy']); // economy + casino cmds off
const SKIP_COMMAND_FILES = new Set(['cards.js', 'cardsettings.js']); // cards retired

module.exports = { SKIP_COMMAND_FOLDERS, SKIP_COMMAND_FILES };
