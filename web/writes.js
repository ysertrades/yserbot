'use strict';

/**
 * web/writes.js
 *
 * The panel's edit operations.
 *
 * Two rules hold everywhere in this file:
 *
 *   1. Nothing writes storage directly. Every change goes through the same
 *      helpers the slash commands use, so the panel can't produce a state a
 *      command wouldn't, and the in-memory cache stays coherent.
 *   2. Every change is announced in the server's mod-log channel. A web panel
 *      that can quietly alter a shop or a filter is worse than one that can't
 *      change anything — the log is what makes it safe to hand out.
 */

const { EmbedBuilder } = require('discord.js');
const { readJson, writeJson } = require('../utils/jsonStorage');
const {
  setAutoModSettings, setModLogSettings, setNewsFeedSettings, setEconCalSettings,
  getAutoModSettings, getNewsFeedSettings, getEconCalSettings,
  getModLogChannel,
} = require('../utils/modConfig');
const { listSources } = require('../utils/newsFeed');
const composer = require('./composer');
const giveaways = require('./giveaways');
const settings = require('./settings');
const features = require('./features');

const IMPACTS = ['high', 'medium', 'low'];

/* ─── audit ──────────────────────────────────────────────────────────────── */

async function announce(client, guildId, session, summary) {
  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;
    const channel = getModLogChannel(guild);
    if (!channel) return;
    await channel.send({
      embeds: [new EmbedBuilder()
        .setColor(0x4C7DFF)
        .setAuthor({ name: `${session.name} · control panel` })
        .setDescription(summary)
        .setFooter({ text: 'Changed from the web panel' })
        .setTimestamp()],
    });
  } catch (err) {
    // A missing channel or a permissions problem must not fail the edit that
    // already succeeded — the change is real either way.
    console.error('[Panel] could not write the audit entry:', err.message);
  }
}

/* ─── validation helpers ─────────────────────────────────────────────────── */

const str = (body, key, max) => {
  const v = body[key];
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : null;
};

const bool = (body, key) => (typeof body[key] === 'boolean' ? body[key] : null);

const list = (body, key, allowed, max = 40) => {
  if (!Array.isArray(body[key])) return null;
  const seen = new Set();
  for (const v of body[key].slice(0, max)) {
    if (typeof v !== 'string') continue;
    const clean = v.trim().toLowerCase();
    if (!clean) continue;
    if (allowed && !allowed.includes(clean)) continue;
    seen.add(clean);
  }
  return [...seen];
};

/** A channel id is only accepted if it names a real text channel in the guild. */
function channelIn(guild, id) {
  if (id === null || id === '') return { ok: true, value: null };
  if (typeof id !== 'string' || !/^\d{5,25}$/.test(id)) return { ok: false };
  const ch = guild.channels.cache.get(id);
  if (!ch || !ch.isTextBased?.()) return { ok: false };
  return { ok: true, value: id, name: ch.name };
}

/* ─── operations ─────────────────────────────────────────────────────────── */

const OPS = {
  /* -- news feed --------------------------------------------------------- */
  async newsfeed(guildId, body, { client, session, guild }) {
    const current = getNewsFeedSettings(guildId);
    const patch = {};
    const notes = [];

    const enabled = bool(body, 'enabled');
    if (enabled !== null && enabled !== current.enabled) {
      patch.enabled = enabled;
      notes.push(`feed **${enabled ? 'started' : 'stopped'}**`);
    }

    if ('channelId' in body) {
      const ch = channelIn(guild, body.channelId);
      if (!ch.ok) return { error: 'bad_channel' };
      if (ch.value !== current.channelId) {
        patch.channelId = ch.value;
        notes.push(ch.value ? `channel set to <#${ch.value}>` : 'channel cleared');
      }
    }

    if ('sources' in body) {
      const valid = listSources().map(s => s.key);
      const next = list(body, 'sources', valid);
      if (next === null) return { error: 'bad_sources' };
      if (next.length === 0) return { error: 'no_sources' };
      if (next.join() !== (current.sources || []).join()) {
        patch.sources = next;
        notes.push(`sources set to ${next.join(', ')}`);
      }
    }

    if ('filterTopics' in body) {
      const next = list(body, 'filterTopics', null, 20);
      if (next === null) return { error: 'bad_topics' };
      if (next.join() !== (current.filterTopics || []).join()) {
        patch.filterTopics = next;
        notes.push(next.length ? `topics set to ${next.join(', ')}` : 'topic filter cleared');
      }
    }

    if (notes.length === 0) return { unchanged: true };
    setNewsFeedSettings(guildId, patch);
    await announce(client, guildId, session, `📰 **News feed** — ${notes.join('; ')}`);
    return { ok: true };
  },

  /* -- economic calendar ------------------------------------------------- */
  async econcal(guildId, body, { client, session, guild }) {
    const current = getEconCalSettings(guildId);
    const patch = {};
    const notes = [];

    const enabled = bool(body, 'enabled');
    if (enabled !== null && enabled !== current.enabled) {
      patch.enabled = enabled;
      notes.push(`calendar **${enabled ? 'started' : 'stopped'}**`);
    }

    if ('channelId' in body) {
      const ch = channelIn(guild, body.channelId);
      if (!ch.ok) return { error: 'bad_channel' };
      if (ch.value !== current.channelId) {
        patch.channelId = ch.value;
        notes.push(ch.value ? `channel set to <#${ch.value}>` : 'channel cleared');
      }
    }

    if ('impactFilter' in body) {
      const next = list(body, 'impactFilter', IMPACTS);
      if (next === null) return { error: 'bad_impact' };
      if (next.join() !== (current.impactFilter || []).join()) {
        patch.impactFilter = next;
        notes.push(next.length ? `impact set to ${next.join(', ')}` : 'impact filter cleared');
      }
    }

    if ('currencyFilter' in body) {
      // Currencies are free text upstream, so this only enforces the shape:
      // three letters, which is what every code in the feed looks like.
      const next = (list(body, 'currencyFilter', null, 25) || []).filter(c => /^[a-z]{3}$/.test(c));
      if (next.join() !== (current.currencyFilter || []).join()) {
        patch.currencyFilter = next.map(c => c.toUpperCase());
        notes.push(next.length ? `currencies set to ${patch.currencyFilter.join(', ')}` : 'currency filter cleared');
      }
    }

    if (notes.length === 0) return { unchanged: true };
    setEconCalSettings(guildId, patch);
    await announce(client, guildId, session, `📅 **Economic calendar** — ${notes.join('; ')}`);
    return { ok: true };
  },

  /* -- moderation -------------------------------------------------------- */
  async moderation(guildId, body, { client, session }) {
    const current = getAutoModSettings(guildId);
    const patch = {};
    const notes = [];

    for (const [field, label] of [
      ['badWords', 'word filter'],
      ['linkFilter', 'link filter'],
      ['mentionSpamProtection', 'mention spam protection'],
    ]) {
      const v = bool(body, field);
      if (v !== null && v !== current[field]) {
        patch[field] = v;
        notes.push(`${label} **${v ? 'on' : 'off'}**`);
      }
    }

    if ('customWords' in body) {
      const next = list(body, 'customWords', null, 100);
      if (next === null) return { error: 'bad_words' };
      if (next.join() !== (current.customWords || []).join()) {
        patch.customWords = next;
        // The words themselves are deliberately not echoed into the log.
        notes.push(`custom word list now has ${next.length} ${next.length === 1 ? 'entry' : 'entries'}`);
      }
    }

    if ('modLog' in body && typeof body.modLog === 'object' && body.modLog) {
      const logPatch = {};
      for (const k of ['members', 'messages', 'roles', 'purges']) {
        const v = bool(body.modLog, k);
        if (v !== null) logPatch[k] = v;
      }
      if (Object.keys(logPatch).length) {
        setModLogSettings(guildId, logPatch);
        notes.push(`log categories updated`);
      }
    }

    if (notes.length === 0) return { unchanged: true };
    if (Object.keys(patch).length) setAutoModSettings(guildId, patch);
    await announce(client, guildId, session, `🛡️ **Moderation** — ${notes.join('; ')}`);
    return { ok: true };
  },

  /* -- shop -------------------------------------------------------------- */
  async shop(guildId, body, { client, session }) {
    const id = str(body, 'id', 60);
    if (!id) return { error: 'bad_item' };

    const all = readJson('shop.json', {});
    const items = all[guildId]?.items;
    if (!items || !items[id]) return { error: 'unknown_item' };

    const item = items[id];
    const notes = [];

    const name = str(body, 'name', 80);
    if (name && name !== item.name) { notes.push(`renamed to "${name}"`); item.name = name; }

    const description = str(body, 'description', 200);
    if (description && description !== item.description) { notes.push('description updated'); item.description = description; }

    if ('price' in body) {
      const price = Number(body.price);
      if (!Number.isInteger(price) || price < 0 || price > 1e9) return { error: 'bad_price' };
      if (price !== item.price) { notes.push(`price ${item.price} → ${price}`); item.price = price; }
    }

    if (notes.length === 0) return { unchanged: true };
    all[guildId].items = items;
    writeJson('shop.json', all);
    await announce(client, guildId, session, `🛒 **Shop** — \`${id}\`: ${notes.join('; ')}`);
    return { ok: true };
  },

};

/* ─── composer, giveaways, settings ──────────────────────────────────────── */

// These delegate to their own modules, and only add the audit entry — the
// modules stay free of Discord-message concerns and can be tested on their own.
Object.assign(OPS, {
  async template(guildId, body, ctx) {
    const r = composer.saveTemplate(guildId, body);
    if (r.ok) await announce(ctx.client, guildId, ctx.session, `🧩 **Template** \`${r.name}\` ${r.isNew ? 'created' : 'updated'}`);
    return r;
  },
  async templatedelete(guildId, body, ctx) {
    const r = composer.deleteTemplate(guildId, body);
    if (r.ok) {
      const extra = r.removedButtons ? ` (and ${r.removedButtons} button${r.removedButtons === 1 ? '' : 's'})` : '';
      await announce(ctx.client, guildId, ctx.session, `🗑️ **Template** \`${r.name}\` deleted${extra}`);
    }
    return r;
  },
  async button(guildId, body, ctx) {
    const r = composer.saveButton(guildId, body, ctx);
    if (r.ok) await announce(ctx.client, guildId, ctx.session, `🔘 **Button** \`${r.id}\` ${r.isNew ? 'added' : 'updated'}`);
    return r;
  },
  async buttondelete(guildId, body, ctx) {
    const r = composer.deleteButton(guildId, body);
    if (r.ok) await announce(ctx.client, guildId, ctx.session, `🔘 **Button** \`${r.id}\` removed`);
    return r;
  },
  async send(guildId, body, ctx) {
    const r = await composer.send(guildId, body, ctx);
    if (r.ok) await announce(ctx.client, guildId, ctx.session, `📤 Sent **${body.name}** to <#${r.channelId}>`);
    return r;
  },
  async updatepost(guildId, body, ctx) {
    const r = await composer.updatePost(guildId, body, ctx);
    if (r.ok) await announce(ctx.client, guildId, ctx.session, `♻️ Updated a posted **${r.templateName}** message`);
    return r;
  },
  async giveawayend(guildId, body, ctx) {
    const r = await giveaways.endNow(guildId, body, ctx);
    if (r.ok) await announce(ctx.client, guildId, ctx.session, `🎟️ Ended a ${r.kind} giveaway early`);
    return r;
  },
  async giveawayreroll(guildId, body, ctx) {
    const r = await giveaways.reroll(guildId, body, ctx);
    if (r.ok) await announce(ctx.client, guildId, ctx.session, `🎲 Rerolled giveaway \`${r.shortId}\``);
    return r;
  },
  async settings(guildId, body, ctx) {
    const r = settings.save(guildId, body, ctx);
    if (r.ok) await announce(ctx.client, guildId, ctx.session, `⚙️ **Server settings** — ${r.changed.join('; ')} updated`);
    return r;
  },

  /* -- the remaining feature surfaces ------------------------------------ */
  async feature(guildId, body, ctx) {
    const r = features.saveGroup(guildId, String(body.group || ''), body, ctx.guild);
    if (r.ok) await announce(ctx.client, guildId, ctx.session, `🎛️ **${r.label}** — ${r.changed.join('; ')} updated`);
    return r;
  },
  async levels(guildId, body, ctx) {
    const r = features.saveLevels(guildId, body);
    if (r.ok) await announce(ctx.client, guildId, ctx.session, '📈 **Levelling** settings updated');
    return r;
  },
  async levelrole(guildId, body, ctx) {
    const r = features.saveLevelRole(guildId, body, ctx.guild);
    if (r.ok) {
      await announce(ctx.client, guildId, ctx.session, r.removed
        ? `📈 Level ${r.removed} reward role removed`
        : `📈 Level ${r.level} now grants <@&${r.roleId}>`);
    }
    return r;
  },
  async schedule(guildId, body, ctx) {
    const r = features.saveSchedule(guildId, body, ctx.guild);
    if (r.ok) {
      await announce(ctx.client, guildId, ctx.session, r.removed
        ? `🗓️ Scheduled post \`${r.removed}\` deleted`
        : `🗓️ Scheduled post \`${r.id}\` — ${r.changed.join(', ')} changed`);
    }
    return r;
  },
  async autoreply(guildId, body, ctx) {
    const r = features.saveAutoreply(guildId, body);
    if (r.ok) {
      await announce(ctx.client, guildId, ctx.session, r.removed
        ? `💬 Auto-reply \`${r.removed}\` removed`
        : `💬 Auto-reply \`${r.key}\` ${r.isNew ? 'added' : 'updated'}`);
    }
    return r;
  },
  async coins(guildId, body, ctx) {
    const r = features.adjustCoins(guildId, body, ctx.guild);
    if (r.ok) {
      // Coin movements are the one thing worth logging in full detail — the
      // before and after make an unintended change obvious at a glance.
      await announce(ctx.client, guildId, ctx.session, r.count
        ? `🪙 **${r.mode === 'give' ? 'Gave' : 'Took'} ${r.amount.toLocaleString()}** coins ${r.mode === 'give' ? 'to' : 'from'} **${r.count}** members`
        : `🪙 <@${r.userId}> — ${r.mode} ${r.amount.toLocaleString()} · ${r.before.toLocaleString()} → **${r.after.toLocaleString()}**`);
    }
    return r;
  },
});

async function apply(op, guildId, body, ctx) {
  const handler = OPS[op];
  if (!handler) return { error: 'unknown_operation' };
  return handler(guildId, body, ctx);
}

module.exports = { apply, OPS };
