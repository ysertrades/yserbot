'use strict';

/**
 * ipIntel.js — what kind of connection an address is, for the entry check.
 *
 * Three answers matter: a mobile carrier (many strangers share one address, so
 * a match there is only a note), and a VPN / proxy or a data centre (the
 * address says nothing about who is behind it, so the member is asked to turn
 * it off). Looked up through ip-api.com: free without a key over plain HTTP
 * (non-commercial use, 45 lookups a minute), or the paid HTTPS endpoint when
 * IP_API_KEY is set. Results are kept for a day, so a busy giveaway stays far
 * under the limit. A failed lookup is reported as unknown and never blocks
 * anyone on its own.
 */

const DAY = 24 * 60 * 60 * 1000;
const cache = new Map();   // ip → { at, result }

function endpoint(ip) {
  const fields = 'status,message,mobile,proxy,hosting';
  const key = process.env.IP_API_KEY;
  return key
    ? `https://pro.ip-api.com/json/${encodeURIComponent(ip)}?fields=${fields}&key=${encodeURIComponent(key)}`
    : `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=${fields}`;
}

/** @returns {Promise<{ ok: boolean, mobile?: boolean, vpn?: boolean }>} */
async function lookup(ip) {
  if (!ip) return { ok: false };
  const hit = cache.get(ip);
  if (hit && Date.now() - hit.at < DAY) return hit.result;
  let result = { ok: false };
  try {
    const res = await fetch(endpoint(ip), { signal: AbortSignal.timeout(4000) });
    const j = res.ok ? await res.json() : null;
    if (j && j.status === 'success') result = { ok: true, mobile: !!j.mobile, vpn: !!(j.proxy || j.hosting) };
  } catch { /* unknown: never blocks on its own */ }
  if (result.ok) cache.set(ip, { at: Date.now(), result });
  if (cache.size > 5000) for (const [k, v] of cache) if (Date.now() - v.at > DAY) cache.delete(k);
  return result;
}

module.exports = { lookup };
