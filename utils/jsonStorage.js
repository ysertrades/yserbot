'use strict';

/**
 * jsonStorage.js — thin shim
 *
 * All reads/writes are delegated to mongoStorage, which handles both the
 * MongoDB-backed path (when MONGODB_URI is set) and the local-file fallback
 * (when it is not).  The exported API is identical to the original so every
 * caller continues to work with zero changes.
 */

const { readJson, writeJson } = require('./mongoStorage');
module.exports = { readJson, writeJson };
