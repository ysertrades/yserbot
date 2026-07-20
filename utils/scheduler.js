const ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous 0/O/1/I

function generateScheduleId(existingIds = []) {
    let id;
    do {
        id = Array.from({ length: 6 }, () => ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)]).join('');
    } while (existingIds.includes(id));
    return id;
}

// Parses a UTC offset like "-4", "+5:30", "5.5", "0" into minutes.
// Returns null if the string isn't a valid offset in the -12..+14 range.
function parseUtcOffset(input) {
    if (input === undefined || input === null || input === '') return 0;
    const str = String(input).trim();

    let m = str.match(/^([+-]?)(\d{1,2}):(\d{2})$/);
    if (m) {
        const sign = m[1] === '-' ? -1 : 1;
        const hours = parseInt(m[2], 10);
        const mins = parseInt(m[3], 10);
        const total = sign * (hours * 60 + mins);
        return total >= -720 && total <= 840 ? total : null;
    }

    m = str.match(/^([+-]?\d{1,2}(?:\.\d+)?)$/);
    if (m) {
        const hours = parseFloat(m[1]);
        const total = Math.round(hours * 60);
        return total >= -720 && total <= 840 ? total : null;
    }

    return null;
}

// Day-of-week check performed in the schedule's own timezone (offsetMinutes),
// not the server's local time — a moment near midnight UTC can fall on a
// different calendar day depending on the zone.
function isWeekend(ts, offsetMinutes = 0) {
    const day = new Date(ts + offsetMinutes * 60000).getUTCDay();
    return day === 0 || day === 6;
}

// Pushes a timestamp forward a day at a time until it lands on a Mon–Fri
// in the given timezone.
function nextWeekdayTimestamp(ts, offsetMinutes = 0) {
    let t = ts;
    while (isWeekend(t, offsetMinutes)) t += 86400000;
    return t;
}

// Parses a user-provided time string into an absolute future timestamp (ms).
// Supports:
//   - relative shorthand: "30m", "2h", "1d", "45s" (timezone-independent)
//   - bare clock time: "HH:mm" (next occurrence in the given timezone — today
//     if still ahead there, else tomorrow)
//   - full date + time: "YYYY-MM-DD HH:mm" (interpreted in the given timezone)
// `offsetMinutes` is the schedule's UTC offset (e.g. -240 for UTC-4). Defaults
// to 0 (UTC) when not provided.
// Returns null if the string doesn't match any supported format or is invalid.
function parseScheduleTime(input, offsetMinutes = 0) {
    if (!input) return null;
    const str = input.trim();

    let m = str.match(/^(\d+)([smhd])$/i);
    if (m) {
        const val = parseInt(m[1], 10);
        const unit = m[2].toLowerCase();
        const unitMs = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[unit];
        return Date.now() + val * unitMs;
    }

    m = str.match(/^(\d{1,2}):(\d{2})$/);
    if (m) {
        const hh = parseInt(m[1], 10);
        const mm = parseInt(m[2], 10);
        if (hh > 23 || mm > 59) return null;
        // Read "today" as a calendar date in the schedule's timezone, not
        // the server's own local time.
        const shiftedNow = Date.now() + offsetMinutes * 60000;
        const nowInZone = new Date(shiftedNow);
        let candidate = Date.UTC(nowInZone.getUTCFullYear(), nowInZone.getUTCMonth(), nowInZone.getUTCDate(), hh, mm, 0, 0);
        if (candidate <= shiftedNow) candidate += 86400000;
        return candidate - offsetMinutes * 60000;
    }

    m = str.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/);
    if (m) {
        const [, y, mo, d, hh, mi] = m;
        const candidate = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mi), 0, 0);
        if (isNaN(candidate)) return null;
        return candidate - offsetMinutes * 60000;
    }

    return null;
}

// Given the timestamp a schedule just fired at and its frequency, returns the
// next timestamp it should fire at, or null if it shouldn't repeat.
// Anchored on the *scheduled* slot so the time-of-day (in the schedule's own
// timezone) stays stable run after run, even if one send was a bit late.
function computeNextRun(firedAt, frequency, now = Date.now(), offsetMinutes = 0) {
    if (frequency === 'once') return null;
    const DAY_MS = 86400000;
    let next = firedAt + DAY_MS;
    while (next <= now) next += DAY_MS;
    if (frequency === 'weekdays') next = nextWeekdayTimestamp(next, offsetMinutes);
    return next;
}

module.exports = { generateScheduleId, parseUtcOffset, parseScheduleTime, computeNextRun, nextWeekdayTimestamp, isWeekend };
