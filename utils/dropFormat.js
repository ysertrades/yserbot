'use strict';

/**
 * Solid quantlab separators. Width matches the longest plain content line
 * so every rule on a card lines up to the same end.
 */
function plainLength(s) {
  return String(s)
    .replace(/\*\*/g, '')
    .replace(/##\s*/g, '')
    .replace(/<t:[^>]+>/g, 'in 2 hours')
    .replace(/<@!?&?\d+>/g, '@member')
    .replace(/`[^`]*`/g, 'code')
    .length;
}

function solidRule(...lines) {
  let max = 12;
  for (const line of lines) {
    for (const part of String(line ?? '').split('\n')) {
      if (!part.trim()) continue;
      max = Math.max(max, plainLength(part));
    }
  }
  return '─'.repeat(Math.min(Math.max(max, 12), 40));
}

const BRAND_PURPLE = 0x9397EE;

module.exports = { solidRule, plainLength, BRAND_PURPLE };
