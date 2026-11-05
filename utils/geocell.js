'use strict';

/**
 * geocell.js — turns a position into small map cells for the entry check.
 *
 * A geohash of 8 characters is a cell about 38 × 19 m. Two people count as
 * "the same place" when one's cell is the other's or touches it (the 3 × 3
 * block around it), which is within roughly 50 m: the same house or building,
 * not the same street. Only these cell names are ever hashed and stored —
 * never the coordinates.
 */

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
const PRECISION = 8;
// Cell size at 8 characters, in degrees.
const CELL_LAT = 180 / 2 ** 20;   // 20 latitude bits
const CELL_LON = 360 / 2 ** 20;   // 20 longitude bits

function encode(lat, lon, precision = PRECISION) {
  let latMin = -90, latMax = 90, lonMin = -180, lonMax = 180;
  let out = '', bit = 0, ch = 0, even = true;
  while (out.length < precision) {
    if (even) {
      const mid = (lonMin + lonMax) / 2;
      if (lon >= mid) { ch = (ch << 1) | 1; lonMin = mid; } else { ch <<= 1; lonMax = mid; }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) { ch = (ch << 1) | 1; latMin = mid; } else { ch <<= 1; latMax = mid; }
    }
    even = !even;
    if (++bit === 5) { out += BASE32[ch]; bit = 0; ch = 0; }
  }
  return out;
}

/** The cell a point is in, and the 3 × 3 block of cells around it. */
function cellsAround(lat, lon) {
  const near = new Set();
  for (const dy of [-1, 0, 1]) {
    for (const dx of [-1, 0, 1]) {
      const y = Math.max(-89.9999, Math.min(89.9999, lat + dy * CELL_LAT));
      let x = lon + dx * CELL_LON;
      if (x > 180) x -= 360; else if (x < -180) x += 360;
      near.add(encode(y, x));
    }
  }
  return { cell: encode(lat, lon), near: [...near] };
}

module.exports = { encode, cellsAround, PRECISION };
