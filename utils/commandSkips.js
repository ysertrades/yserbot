'use strict';

/**
 * Commands the bot does not load, in one place.
 *
 * index.js and deploy-commands.js each kept their own list and drifted, so
 * `npm run deploy` registered slash commands the running bot had no handler
 * for. The economy, casino and cards commands are now deleted outright, so
 * only the conventional parking folder is left here.
 */
const SKIP_COMMAND_FOLDERS = new Set(['_disabled']);
const SKIP_COMMAND_FILES = new Set();

module.exports = { SKIP_COMMAND_FOLDERS, SKIP_COMMAND_FILES };
