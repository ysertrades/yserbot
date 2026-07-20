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

/**
 * Calculate risk for a given symbol, risk amount, and stop distance.
 * @param {string} symbol - Futures symbol (e.g. 'ES', 'NQ')
 * @param {number} riskUsd - Dollar amount willing to risk
 * @param {number} stopPoints - Stop distance in points
 * @returns {object} Calculation result
 */
function calculateRisk(symbol, riskUsd, stopPoints) {
  const spec = FUTURES_SPECS[symbol.toUpperCase()];

  if (!spec) {
    return { error: `Unknown symbol: **${symbol}**. Supported: ${Object.keys(FUTURES_SPECS).join(', ')}` };
  }

  if (stopPoints <= 0) {
    return { error: 'Stop distance must be greater than 0.' };
  }

  if (riskUsd <= 0) {
    return { error: 'Risk amount must be greater than 0.' };
  }

  // Standard contract calculation
  const standardRiskPerContract = stopPoints * spec.pointValue;
  const standardContracts = Math.floor(riskUsd / standardRiskPerContract);

  // Micro contract calculation (only if applicable)
  let microResult = null;
  if (spec.microSymbol) {
    const microSpec = FUTURES_SPECS[spec.microSymbol];
    const microRiskPerContract = stopPoints * microSpec.pointValue;
    const microContracts = Math.floor(riskUsd / microRiskPerContract);

    microResult = {
      symbol: spec.microSymbol,
      name: microSpec.name,
      contracts: microContracts,
      riskPerContract: microRiskPerContract,
      totalRisk: microContracts * microRiskPerContract,
    };
  }

  return {
    symbol: spec.symbol,
    name: spec.name,
    color: spec.color,
    riskUsd,
    stopPoints,
    standard: {
      symbol: spec.symbol,
      contracts: standardContracts,
      riskPerContract: standardRiskPerContract,
      totalRisk: standardContracts * standardRiskPerContract,
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
