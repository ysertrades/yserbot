/**
 * Futures contract specifications
 * pointValue = dollar value of 1 full point move
 */
const FUTURES_SPECS = {
  ES: {
    name: 'E-mini S&P 500',
    symbol: 'ES',
    tickSize: 0.25,
    tickValue: 12.5,
    pointValue: 50,
    microSymbol: 'MES',
    color: 0x474747,
  },
  MES: {
    name: 'Micro E-mini S&P 500',
    symbol: 'MES',
    tickSize: 0.25,
    tickValue: 1.25,
    pointValue: 5,
    microSymbol: null,
    color: 0x474747,
  },
  NQ: {
    name: 'E-mini Nasdaq-100',
    symbol: 'NQ',
    tickSize: 0.25,
    tickValue: 5,
    pointValue: 20,
    microSymbol: 'MNQ',
    color: 0x474747,
  },
  MNQ: {
    name: 'Micro E-mini Nasdaq-100',
    symbol: 'MNQ',
    tickSize: 0.25,
    tickValue: 0.5,
    pointValue: 2,
    microSymbol: null,
    color: 0x474747,
  },
  YM: {
    name: 'E-mini Dow',
    symbol: 'YM',
    tickSize: 1,
    tickValue: 5,
    pointValue: 5,
    microSymbol: 'MYM',
    color: 0x474747,
  },
  MYM: {
    name: 'Micro E-mini Dow',
    symbol: 'MYM',
    tickSize: 1,
    tickValue: 0.5,
    pointValue: 0.5,
    microSymbol: null,
    color: 0xd35400,
  },
  RTY: {
    name: 'E-mini Russell 2000',
    symbol: 'RTY',
    tickSize: 0.1,
    tickValue: 5,
    pointValue: 50,
    microSymbol: 'M2K',
    color: 0x474747,
  },
  M2K: {
    name: 'Micro E-mini Russell 2000',
    symbol: 'M2K',
    tickSize: 0.1,
    tickValue: 0.5,
    pointValue: 5,
    microSymbol: null,
    color: 0x474747,
  },
  GC: {
    name: 'Gold Futures',
    symbol: 'GC',
    tickSize: 0.1,
    tickValue: 10,
    pointValue: 100,
    microSymbol: 'MGC',
    color: 0x474747,
  },
  MGC: {
    name: 'Micro Gold Futures',
    symbol: 'MGC',
    tickSize: 0.1,
    tickValue: 1,
    pointValue: 10,
    microSymbol: null,
    color: 0x474747,
  },
  SI: {
    name: 'Silver Futures',
    symbol: 'SI',
    tickSize: 0.005,
    tickValue: 25,
    pointValue: 5000,
    microSymbol: 'SIL',
    color: 0x474747,
  },
  SIL: {
    name: 'Micro Silver Futures',
    symbol: 'SIL',
    tickSize: 0.005,
    tickValue: 5,
    pointValue: 1000,
    microSymbol: null,
    color: 0x474747,
  },
};

// Money is compared and summed here, so it is held to the cent. Without this
// a tick value like silver's 0.005 × 5000 reintroduces binary-float dust into
// figures that are then printed as dollars.
const round2 = n => Math.round(n * 100) / 100;

/**
 * Calculate risk for a given symbol, risk amount, and stop distance.
 *
 * The stop is given in **ticks**, not points, because a tick is the only
 * distance a futures contract can actually move. ES trades in 0.25s, so a
 * "1.3 point" stop is not a stop anyone can place — asking for points invited
 * a number the exchange would never fill at, and then sized the position from
 * it. Ticks are whole by definition, so the input and the fill agree.
 *
 * Risk per contract is the tick count times the contract's own tick value,
 * which is the exchange's own figure rather than a number derived through
 * points — so the arithmetic is the same one the broker does.
 *
 * @param {string} symbol - Futures symbol (e.g. 'ES', 'NQ')
 * @param {number} riskUsd - Dollar amount willing to risk
 * @param {number} stopTicks - Stop distance in ticks (whole number)
 * @returns {object} Calculation result
 */
function calculateRisk(symbol, riskUsd, stopTicks) {
  const spec = FUTURES_SPECS[symbol.toUpperCase()];

  if (!spec) {
    return { error: `Unknown symbol: **${symbol}**. Supported: ${Object.keys(FUTURES_SPECS).join(', ')}` };
  }

  if (!Number.isFinite(stopTicks) || stopTicks <= 0) {
    return { error: 'Stop distance must be greater than 0 ticks.' };
  }

  // A fraction of a tick is not a price the market trades at, so it is
  // refused rather than quietly rounded into a position size.
  if (!Number.isInteger(stopTicks)) {
    return { error: `Stop distance must be a whole number of ticks. One ${spec.symbol} tick is ${spec.tickSize} points.` };
  }

  if (!Number.isFinite(riskUsd) || riskUsd <= 0) {
    return { error: 'Risk amount must be greater than 0.' };
  }

  // Standard contract calculation
  const standardRiskPerContract = round2(stopTicks * spec.tickValue);
  const standardContracts = Math.floor(riskUsd / standardRiskPerContract);

  // Micro contract calculation (only if applicable)
  let microResult = null;
  if (spec.microSymbol) {
    const microSpec = FUTURES_SPECS[spec.microSymbol];
    // Every contract here shares its micro's tick size — that is what makes
    // them a pair — so the ratio is 1 and the same tick count is the same
    // price distance. It is written out rather than assumed so a future pair
    // that does not share one still converts instead of silently mis-sizing.
    const microTicks = stopTicks * (spec.tickSize / microSpec.tickSize);
    const microRiskPerContract = round2(microTicks * microSpec.tickValue);
    const microContracts = Math.floor(riskUsd / microRiskPerContract);

    microResult = {
      symbol: spec.microSymbol,
      name: microSpec.name,
      contracts: microContracts,
      riskPerContract: microRiskPerContract,
      totalRisk: round2(microContracts * microRiskPerContract),
    };
  }

  return {
    symbol: spec.symbol,
    name: spec.name,
    color: spec.color,
    riskUsd,
    stopTicks,
    // The same distance in points, for anyone reading the result who thinks
    // in points. Nothing is calculated from it.
    stopPoints: round2(stopTicks * spec.tickSize),
    tickSize: spec.tickSize,
    tickValue: spec.tickValue,
    standard: {
      symbol: spec.symbol,
      contracts: standardContracts,
      riskPerContract: standardRiskPerContract,
      totalRisk: round2(standardContracts * standardRiskPerContract),
    },
    micro: microResult,
    needsMicro: standardContracts === 0,
  };
}

/**
 * Format a number as a USD currency string
 * @param {number} value
 * @returns {string}
 */
function formatUsd(value) {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

module.exports = { calculateRisk, formatUsd, FUTURES_SPECS };
