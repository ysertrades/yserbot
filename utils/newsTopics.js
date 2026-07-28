'use strict';

// Financial Juice's RSS feed doesn't expose real category tags, so this is a
// curated topic list — each one a bundle of keywords grounded in patterns
// actually seen in the live feed (currency pairs, central bank names, futures
// exchanges, etc.) — so users can filter by topic without having to guess
// keywords themselves.
const TOPICS = [
  {
    key: 'forex', emoji: '🔀', label: 'Forex', description: 'Currency pairs & FX moves',
    keywords: ['eur/usd', 'gbp/usd', 'usd/jpy', 'usd/cad', 'aud/usd', 'nzd/usd', 'usd/chf', 'usd/mxn', 'eur/gbp', 'forex', 'fx option', 'currency'],
  },
  {
    key: 'central_banks', emoji: '🏦', label: 'Central Banks', description: 'Fed, ECB, BoE, BoJ & rate decisions',
    keywords: ['fed', 'fomc', 'powell', 'ecb', 'lagarde', 'boe', 'boj', 'rba', 'rbnz', 'snb', 'pboc', 'rate hike', 'rate cut', 'rate decision', 'central bank', 'interest rate'],
  },
  {
    key: 'commodities', emoji: '🛢️', label: 'Commodities', description: 'Oil, gold, gas & metals',
    keywords: ['nymex', 'wti', 'brent', 'crude', 'gold', 'silver', 'copper', 'natural gas', 'gasoline', 'opec'],
  },
  {
    key: 'stocks_indices', emoji: '📈', label: 'Stocks & Indices', description: 'S&P, Nasdaq, Dow & earnings',
    keywords: ['s&p', 'nasdaq', 'dow', 'russell', 'nyse', 'earnings', 'guidance', 'stocks', 'index', 'mag 7'],
  },
  {
    key: 'bonds_yields', emoji: '💵', label: 'Bonds & Yields', description: 'Treasuries, auctions & yields',
    keywords: ['treasury', 'yield', 'bond', 'auction', '2-year', '10-year', '30-year', 'bund', 'gilt', 'jgb'],
  },
  {
    key: 'crypto', emoji: '₿', label: 'Crypto', description: 'Bitcoin, Ethereum & digital assets',
    keywords: ['bitcoin', 'btc', 'ethereum', 'eth', 'crypto', 'blockchain', 'stablecoin'],
  },
  {
    key: 'economic_data', emoji: '📊', label: 'Economic Data', description: 'CPI, GDP, jobs & PMI releases',
    keywords: ['cpi', 'gdp', 'pmi', 'payrolls', 'nfp', 'unemployment', 'inflation', 'retail sales', 'jobless claims', 'ism'],
  },
  {
    key: 'geopolitics', emoji: '🌍', label: 'Geopolitics', description: 'Conflicts, sanctions & diplomacy',
    keywords: ['iran', 'israel', 'ukraine', 'russia', 'china', 'sanctions', 'houthi', 'military', 'missile', 'war'],
  },
];

function getTopic(key) {
  return TOPICS.find(t => t.key === key) || null;
}

// Flattens the keyword bundles for a set of selected topic keys into one
// deduped, lowercase keyword list ready to feed into the news filter.
function expandTopicKeywords(topicKeys) {
  const set = new Set();
  for (const key of topicKeys || []) {
    const topic = getTopic(key);
    if (!topic) continue;
    for (const kw of topic.keywords) set.add(kw);
  }
  return [...set];
}

module.exports = { TOPICS, getTopic, expandTopicKeywords };
