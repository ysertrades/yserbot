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
  PANEL_LOG_CATEGORIES: LOG_CATEGORIES,
  getPanelLogSettings: panelLogSettings,
  setPanelLogSettings,
} = require('../utils/modConfig');
const { listSources } = require('../utils/newsFeed');
const { IMPACT_LEVELS, CURRENCIES } = require('../utils/economicCalendar');
const { BANNERS, getBannerCopy, setBannerCopy, changedFields } = require('../utils/bannerCopy');
const composer = require('./composer');
const giveaways = require('./giveaways');
const settings = require('./settings');
const features = require('./features');
const tickets = require('./tickets');
const casinoPanel = require('./casino');
const links = require('./links');
const moderationPanel = require('./moderation');
const economyPanel = require('./economy');

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/* ─── audit ──────────────────────────────────────────────────────────────── */

/**
 * @param {string|null} category one of LOG_CATEGORIES, or null for
 *   "always log this" — used by coin adjustments.
 */
async function announce(client, guildId, session, summary, category = null) {
  try {
    if (category && panelLogSettings(guildId)[category] === false) return;
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

/** A role id is only accepted if it names a real role in the guild. */
function roleIn(guild, id) {
  if (id === null || id === '') return { ok: true, value: null };
  if (typeof id !== 'string' || !/^\d{5,25}$/.test(id)) return { ok: false };
  const role = guild.roles.cache.get(id);
  if (!role) return { ok: false };
  return { ok: true, value: id, name: role.name };
}

/**
 * Like list(), but preserves the vocabulary's own casing.
 *
 * list() lower-cases everything, which is right for keys the bot compares
 * lower-cased and wrong for anything compared literally — an impact filter of
 * "high" never matches an event whose impact is "High", so the feed silently
 * goes quiet instead of narrowing.
 */
function canonList(body, key, vocabulary, max = 40) {
  if (!Array.isArray(body[key])) return null;
  const byLower = new Map(vocabulary.map(v => [v.toLowerCase(), v]));
  const seen = new Set();
  for (const raw of body[key].slice(0, max)) {
    if (typeof raw !== 'string') continue;
    const canon = byLower.get(raw.trim().toLowerCase());
    if (canon) seen.add(canon);
  }
  // A list that had entries but matched nothing is a mistake, not a request to
  // clear the filter — and "clear" would widen the feed rather than narrow it,
  // which is the opposite of what was asked for. Clearing needs an empty list.
  if (body[key].length > 0 && seen.size === 0) return null;
  // Ordered by the vocabulary rather than by what arrived, so the stored value
  // is stable and the "did this change" comparison stays honest.
  return vocabulary.filter(v => seen.has(v));
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
    await announce(client, guildId, session, `📰 **News feed** — ${notes.join('; ')}`, 'feeds');
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

    if ('roleId' in body) {
      const role = roleIn(guild, body.roleId);
      if (!role.ok) return { error: 'bad_role' };
      if (role.value !== current.roleId) {
        patch.roleId = role.value;
        notes.push(role.value ? `reminder ping role set to <@&${role.value}>` : 'reminder ping role cleared');
      }
    }

    if ('impactFilter' in body) {
      // Stored in the calendar's own casing. filterEvents compares these
      // straight against an event's `impact` ("High", "Holiday"), so a
      // lower-cased list matches nothing and silently mutes the entire feed —
      // which is what the panel used to write.
      const next = canonList(body, 'impactFilter', IMPACT_LEVELS);
      if (next === null) return { error: 'bad_impact' };
      if (next.join() !== (current.impactFilter || []).join()) {
        patch.impactFilter = next;
        notes.push(next.length ? `impact set to ${next.join(', ')}` : 'impact filter cleared');
      }
    }

    if ('currencyFilter' in body) {
      const next = canonList(body, 'currencyFilter', CURRENCIES);
      if (next === null) return { error: 'bad_currency' };
      if (next.join() !== (current.currencyFilter || []).join()) {
        patch.currencyFilter = next;
        notes.push(next.length ? `currencies set to ${next.join(', ')}` : 'currency filter cleared');
      }
    }

    if (body.weeklyPost && typeof body.weeklyPost === 'object') {
      const wp = body.weeklyPost;
      const next = { ...current.weeklyPost };
      const wpNotes = [];

      if (typeof wp.enabled === 'boolean' && wp.enabled !== next.enabled) {
        next.enabled = wp.enabled;
        wpNotes.push(wp.enabled ? 'on' : 'off');
      }
      for (const [key, min, max] of [['weekday', 0, 6], ['hour', 0, 23], ['minute', 0, 59]]) {
        if (wp[key] === undefined) continue;
        const n = Number(wp[key]);
        if (!Number.isInteger(n) || n < min || n > max) return { error: 'bad_weekly' };
        if (n !== next[key]) { next[key] = n; wpNotes.push(key); }
      }
      if (wp.offsetMinutes !== undefined) {
        const n = Number(wp.offsetMinutes);
        // Real UTC offsets run -12:00 to +14:00.
        if (!Number.isInteger(n) || n < -720 || n > 840) return { error: 'bad_weekly' };
        if (n !== next.offsetMinutes) { next.offsetMinutes = n; wpNotes.push('timezone'); }
      }

      if (wpNotes.length) {
        patch.weeklyPost = next;
        notes.push(`weekly summary ${next.enabled
          ? `on · ${WEEKDAYS[next.weekday]} ${String(next.hour).padStart(2, '0')}:${String(next.minute).padStart(2, '0')} UTC${next.offsetMinutes >= 0 ? '+' : ''}${next.offsetMinutes / 60}`
          : 'off'}`);
      }
    }

    if (notes.length === 0) return { unchanged: true };
    setEconCalSettings(guildId, patch);
    await announce(client, guildId, session, `📅 **Economic calendar** — ${notes.join('; ')}`, 'feeds');
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
    await announce(client, guildId, session, `🛡️ **Moderation** — ${notes.join('; ')}`, 'moderation');
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
    await announce(client, guildId, session, `🛒 **Shop** — \`${id}\`: ${notes.join('; ')}`, 'shop');
    return { ok: true };
  },

};

/* ─── composer, giveaways, settings ──────────────────────────────────────── */

// These delegate to their own modules, and only add the audit entry — the
// modules stay free of Discord-message concerns and can be tested on their own.
Object.assign(OPS, {
  async template(guildId, body, ctx) {
    const r = composer.saveTemplate(guildId, body);
    if (r.ok) await announce(ctx.client, guildId, ctx.session, `🧩 **Template** \`${r.name}\` ${r.isNew ? 'created' : 'updated'}`, 'composer');
    return r;
  },
  async templatedelete(guildId, body, ctx) {
    const r = composer.deleteTemplate(guildId, body);
    if (r.ok) {
      const extra = r.removedButtons ? ` (and ${r.removedButtons} button${r.removedButtons === 1 ? '' : 's'})` : '';
      await announce(ctx.client, guildId, ctx.session, `🗑️ **Template** \`${r.name}\` deleted${extra}`, 'composer');
    }
    return r;
  },
  async button(guildId, body, ctx) {
    const r = composer.saveButton(guildId, body, ctx);
    if (r.ok) await announce(ctx.client, guildId, ctx.session, `🔘 **Button** \`${r.id}\` ${r.isNew ? 'added' : 'updated'}`, 'composer');
    return r;
  },
  async buttondelete(guildId, body, ctx) {
    const r = composer.deleteButton(guildId, body);
    if (r.ok) await announce(ctx.client, guildId, ctx.session, `🔘 **Button** \`${r.id}\` removed`, 'composer');
    return r;
  },
  async send(guildId, body, ctx) {
    const r = await composer.send(guildId, body, ctx);
    if (r.ok) await announce(ctx.client, guildId, ctx.session, `📤 Sent **${body.name}** to <#${r.channelId}>`, 'composer');
    return r;
  },
  async updatepost(guildId, body, ctx) {
    const r = await composer.updatePost(guildId, body, ctx);
    if (r.ok) await announce(ctx.client, guildId, ctx.session, `♻️ Updated a posted **${r.templateName}** message`, 'composer');
    return r;
  },
  async giveawaystart(guildId, body, ctx) {
    const r = await giveaways.create(guildId, body, ctx);
    if (r.ok) {
      await announce(ctx.client, guildId, ctx.session,
        `🎟️ Started a **${r.label}** giveaway in #${r.channelName} — ${r.winners} winner${r.winners === 1 ? '' : 's'}, ends <t:${Math.floor(r.endsAt / 1000)}:R>`, 'giveaways');
    }
    return r;
  },
  async lotteryclear(guildId, body, ctx) {
    const r = features.clearLottery(guildId);
    if (r.ok) await announce(ctx.client, guildId, ctx.session, `🎫 Cleared today's lottery pool (${r.cleared} entrant${r.cleared === 1 ? '' : 's'})`, 'giveaways');
    return r;
  },
  async giveawayend(guildId, body, ctx) {
    const r = await giveaways.endNow(guildId, body, ctx);
    if (r.ok) await announce(ctx.client, guildId, ctx.session, `🎟️ Ended a ${r.kind} giveaway early`, 'giveaways');
    return r;
  },
  async giveawayreroll(guildId, body, ctx) {
    const r = await giveaways.reroll(guildId, body, ctx);
    if (r.ok) await announce(ctx.client, guildId, ctx.session, `🎲 Rerolled giveaway \`${r.shortId}\``, 'giveaways');
    return r;
  },
  async giveawaydelete(guildId, body, ctx) {
    const r = giveaways.remove(guildId, body);
    if (r.ok) {
      await announce(ctx.client, guildId, ctx.session,
        `🗑️ Removed finished giveaway **${r.title}** (\`${r.shortId}\`) from the panel — it can no longer be rerolled`, 'giveaways');
    }
    return r;
  },
  async settings(guildId, body, ctx) {
    const r = settings.save(guildId, body, ctx);
    if (r.ok) await announce(ctx.client, guildId, ctx.session, `⚙️ **Server settings** — ${r.changed.join('; ')} updated`, 'settings');
    return r;
  },

  /* -- reports and warnings ---------------------------------------------- */
  async report(guildId, body, ctx) {
    const r = await moderationPanel.act(guildId, body, ctx);
    if (!r.ok) return r;
    await announce(ctx.client, guildId, ctx.session, r.action === 'dismiss'
      ? `🚨 Report about <@${r.targetId}> dismissed`
      : `🚨 Report about <@${r.targetId}> — **${r.label}** · case #${r.caseId}`, 'moderation');
    return r;
  },
  async warnclear(guildId, body, ctx) {
    const r = moderationPanel.clearWarnings(guildId, body, ctx);
    if (r.ok) {
      await announce(ctx.client, guildId, ctx.session,
        `⚠️ Cleared **${r.removed}** warning${r.removed === 1 ? '' : 's'} for <@${r.userId}>`, 'moderation');
    }
    return r;
  },
  async warnsettings(guildId, body, ctx) {
    const r = moderationPanel.saveWarnSettings(guildId, body);
    if (r.ok) await announce(ctx.client, guildId, ctx.session, `⚠️ **Warnings** — ${r.changed.join('; ')}`, 'moderation');
    return r;
  },

  /* -- link approval requests -------------------------------------------- */
  async linkrequest(guildId, body, ctx) {
    const r = await links.decide(guildId, body, ctx);
    if (!r.ok) return r;
    const who = `<@${r.userId}>`;
    if (r.action === 'approve') {
      await announce(ctx.client, guildId, ctx.session,
        `🔗 **Link approved** for ${who} — \`${r.link}\` · one link per ${r.cooldownLabel}`, 'moderation');
    } else if (r.action === 'deny') {
      await announce(ctx.client, guildId, ctx.session, `🔗 **Link denied** for ${who} — \`${r.link}\``, 'moderation');
    } else {
      await announce(ctx.client, guildId, ctx.session,
        `🔗 Discarded a stale link request from ${who} without notifying them`, 'moderation');
    }
    return r;
  },
  async linkrevoke(guildId, body, ctx) {
    const r = links.revoke(guildId, body, ctx);
    if (r.ok) {
      await announce(ctx.client, guildId, ctx.session,
        `🔗 Link permission revoked for <@${r.userId}> — they must ask again`, 'moderation');
    }
    return r;
  },

  /* -- casino ------------------------------------------------------------ */
  async casino(guildId, body, ctx) {
    const r = casinoPanel.save(guildId, body);
    if (r.ok) await announce(ctx.client, guildId, ctx.session, `🎰 **Casino** — ${r.changed.join('; ')}`, 'features');
    return r;
  },

  /* -- tickets ----------------------------------------------------------- */
  async tickets(guildId, body, ctx) {
    const r = tickets.save(guildId, body, ctx.guild);
    if (r.ok) await announce(ctx.client, guildId, ctx.session, `🎫 **Tickets** — ${r.changed.join('; ')} updated`, 'tickets');
    return r;
  },
  async ticketclose(guildId, body, ctx) {
    const r = await tickets.close(guildId, body, ctx);
    if (r.ok) {
      await announce(ctx.client, guildId, ctx.session,
        `🎫 Closed ticket **#${r.name}**${r.ownerId ? ` (opened by <@${r.ownerId}>)` : ''}`, 'tickets');
    }
    return r;
  },
  async ticketpanel(guildId, body, ctx) {
    const r = await tickets.postPanel(guildId, body, ctx);
    if (r.ok) await announce(ctx.client, guildId, ctx.session, `🎫 Posted the ticket panel to #${r.channelName}`, 'tickets');
    return r;
  },

  /* -- what the panel writes to the mod log ------------------------------ */
  //
  // Turning a category off is itself always logged, whichever way it went —
  // otherwise the log could be silenced without leaving any sign that it had
  // been, which would defeat the point of having it.
  async panellog(guildId, body, ctx) {
    const current = panelLogSettings(guildId);
    const next = { ...current };
    const notes = [];

    for (const key of Object.keys(LOG_CATEGORIES)) {
      if (typeof body[key] !== 'boolean' || body[key] === current[key]) continue;
      next[key] = body[key];
      notes.push(`${LOG_CATEGORIES[key].label} ${body[key] ? 'on' : 'off'}`);
    }
    if (!notes.length) return { unchanged: true };

    setPanelLogSettings(guildId, next);

    await announce(ctx.client, guildId, ctx.session, `🧾 **Panel logging** — ${notes.join('; ')}`);
    return { ok: true };
  },

  /* -- studio banner wording --------------------------------------------- */
  //
  // Studio used to be preview-only: it rendered an image and offered a
  // download, and nothing it produced ever reached an embed. This is what
  // makes the edit stick, so `dynamic:tradingViewBanner` in a template sends
  // the wording that was typed here.
  async banner(guildId, body, ctx) {
    const key = String(body.template || '');
    if (!BANNERS[key]) return { error: 'unknown_template' };

    const before = getBannerCopy(guildId, key);
    const saved = setBannerCopy(guildId, key, body.copy && typeof body.copy === 'object' ? body.copy : {});
    if (JSON.stringify(before) === JSON.stringify(saved)) return { unchanged: true };

    const custom = changedFields(key, saved);
    await announce(ctx.client, guildId, ctx.session, custom.length
      ? `🎨 **${BANNERS[key].label}** banner — ${custom.join(', ')} changed`
      : `🎨 **${BANNERS[key].label}** banner reset to its default wording`, 'studio');
    return { ok: true, template: key, copy: saved };
  },

  /* -- economy ----------------------------------------------------------- */
  async economy(guildId, body, ctx) {
    const r = economyPanel.saveActivity(guildId, body);
    if (r.ok) await announce(ctx.client, guildId, ctx.session, `🪙 **${r.label}** — ${r.changed.join('; ')}`, 'features');
    return r;
  },
  async economyjobs(guildId, body, ctx) {
    const r = economyPanel.saveJobs(guildId, body);
    if (r.ok) await announce(ctx.client, guildId, ctx.session, `🏢 **Jobs** — ${r.changed.join('; ')}`, 'features');
    return r;
  },
  async economyglobal(guildId, body, ctx) {
    const r = economyPanel.saveGlobal(guildId, body);
    if (r.ok) await announce(ctx.client, guildId, ctx.session, `📈 **Economy** — ${r.changed.join('; ')}`, 'features');
    return r;
  },

  /* -- verification ------------------------------------------------------ */
  //
  // Posting the panel from here rather than only from /verify setup: the
  // wording is edited on this screen, and having to go back to Discord to make
  // the edit visible is exactly the round trip the panel exists to remove.
  async verifypanel(guildId, body, ctx) {
    const channelId = String(body.channelId || '');
    const channel = ctx.guild?.channels?.cache?.get(channelId);
    if (!channel?.isTextBased?.()) return { error: 'bad_channel' };

    const { buildVerifyPanel } = require('../commands/utility/verify');
    try {
      await channel.send(buildVerifyPanel(ctx.guild));
    } catch (err) {
      return { error: 'send_failed', detail: err.message };
    }
    await announce(ctx.client, guildId, ctx.session, `🔐 Posted the verification panel to #${channel.name}`, 'features');
    return { ok: true, channelName: channel.name };
  },

  /* -- the remaining feature surfaces ------------------------------------ */
  async feature(guildId, body, ctx) {
    const r = features.saveGroup(guildId, String(body.group || ''), body, ctx.guild);
    if (r.ok) await announce(ctx.client, guildId, ctx.session, `🎛️ **${r.label}** — ${r.changed.join('; ')} updated`, 'features');
    return r;
  },
  async levels(guildId, body, ctx) {
    const r = features.saveLevels(guildId, body);
    if (r.ok) await announce(ctx.client, guildId, ctx.session, '📈 **Levelling** settings updated', 'features');
    return r;
  },
  async levelrole(guildId, body, ctx) {
    const r = features.saveLevelRole(guildId, body, ctx.guild);
    if (r.ok) {
      await announce(ctx.client, guildId, ctx.session, r.removed
        ? `📈 Level ${r.removed} reward role removed`
        : `📈 Level ${r.level} now grants <@&${r.roleId}>`, 'features');
    }
    return r;
  },
  async schedulenew(guildId, body, ctx) {
    const r = features.createSchedule(guildId, { ...body, createdBy: ctx.session.uid }, ctx.guild);
    if (r.ok) {
      await announce(ctx.client, guildId, ctx.session,
        `🗓️ Scheduled **${r.embedName}** in #${r.channelName} — first run <t:${Math.floor(r.time / 1000)}:F>`, 'automation');
    }
    return r;
  },
  async schedule(guildId, body, ctx) {
    const r = features.saveSchedule(guildId, body, ctx.guild);
    if (r.ok) {
      await announce(ctx.client, guildId, ctx.session, r.removed
        ? `🗓️ Scheduled post \`${r.removed}\` deleted`
        : `🗓️ Scheduled post \`${r.id}\` — ${r.changed.join(', ')} changed`, 'automation');
    }
    return r;
  },
  async autoreply(guildId, body, ctx) {
    const r = features.saveAutoreply(guildId, body);
    if (r.ok) {
      await announce(ctx.client, guildId, ctx.session, r.removed
        ? `💬 Auto-reply \`${r.removed}\` removed`
        : `💬 Auto-reply \`${r.key}\` ${r.isNew ? 'added' : 'updated'}`, 'automation');
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
