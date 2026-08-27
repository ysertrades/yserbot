const { readJson, writeJson } = require('./jsonStorage');
const { computeNextRun } = require('./scheduler');
const { mentionSend } = require('./mentionTarget');

const CHECK_INTERVAL_MS = 5000;

// A schedule pointing at a channel or a template that no longer exists can
// never fire, so it is deleted. Everything else is treated as bad luck.
const PERMANENT_FAILURES = new Set(['channel-missing', 'template-missing']);

// Starts the background loop that fires due schedules. Safe to call once
// after the client is ready (needs client.guilds.cache populated).
function startScheduleRunner(client) {
    const tick = () => checkSchedules(client).catch(err => console.error('[SCHEDULE RUNNER ERROR]', err));
    tick(); // catch up on anything due immediately (e.g. bot was offline)
    setInterval(tick, CHECK_INTERVAL_MS);
}

async function checkSchedules(client) {
    const schedules = readJson('schedules.json', {});
    const now = Date.now();
    let changed = false;

    for (const guildId of Object.keys(schedules)) {
        const guildSchedules = schedules[guildId];
        const guild = client.guilds.cache.get(guildId);
        if (!guild) continue; // bot no longer in this guild; leave data as-is

        for (const id of Object.keys(guildSchedules)) {
            const schedule = guildSchedules[id];
            if (schedule.time > now) continue;

            changed = true;
            const result = await fireSchedule(guild, schedule).catch(err => {
                console.error(`[SCHEDULE ${id}] failed to send:`, err);
                return { ok: false, reason: 'send-error' };
            });

            // Only a reason that cannot get better on its own deletes the
            // schedule. A send that failed — a rate limit, a permission that
            // came back, a template with one bad field — used to delete it too,
            // so a scheduled post could quietly disappear and nothing said so.
            // Those roll forward to the next occurrence and try again instead.
            if (!result.ok && PERMANENT_FAILURES.has(result.reason)) {
                console.warn(`[SCHEDULE ${id}] removed (${result.reason}) — guild ${guildId}`);
                delete guildSchedules[id];
                continue;
            }
            if (!result.ok) {
                console.warn(`[SCHEDULE ${id}] send failed (${result.reason}) — will try again at its next run`);
            }

            const next = computeNextRun(schedule.time, schedule.frequency, now, schedule.offsetMinutes || 0);
            if (next) {
                schedule.time = next;
                schedule.lastRun = now;
            } else {
                delete guildSchedules[id];
            }
        }
    }

    if (changed) writeJson('schedules.json', schedules);
}

async function fireSchedule(guild, schedule) {
    const channel = guild.channels.cache.get(schedule.channelId);
    if (!channel || !channel.isTextBased()) {
        return { ok: false, reason: 'channel-missing' };
    }

    // Required lazily to avoid a require cycle at module-load time.
    const { buildEmbedPayload } = require('../commands/utility/embed');
    const payload = buildEmbedPayload(guild, schedule.embedName, { channel });
    if (!payload) {
        return { ok: false, reason: 'template-missing' };
    }

    const { text: content, allowedMentions } = mentionSend(schedule.mention);

    await channel.send({ content: content ?? undefined, embeds: payload.embeds, files: payload.files, components: payload.components.length > 0 ? payload.components : undefined, allowedMentions });
    return { ok: true };
}

module.exports = { startScheduleRunner };
