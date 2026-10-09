'use strict';

const TOPICS = [
  {
    key: 'forex', emoji: '🔀', label: 'Forex', description: 'Currency pairs & FX moves',
    keywords: [
      'forex', 'fx ', ' fx', 'currency', 'currencies', 'cable', 'greenback', 'loonie', 'aussie', 'kiwi',
      'eur/usd', 'eurusd', 'gbp/usd', 'gbpusd', 'usd/jpy', 'usdjpy', 'usd/cad', 'usdcad',
      'aud/usd', 'audusd', 'nzd/usd', 'nzdusd', 'usd/chf', 'usdchf', 'usd/mxn', 'usdmxn',
      'eur/gbp', 'eurgbp', 'eur/jpy', 'eurjpy', 'gbp/jpy', 'gbpjpy', 'usd/cnh', 'usdcnh',
      'dollar index', 'dxy', 'nonfarm', 'nfp',
    ],
  },
  {
    key: 'central_banks', emoji: '🏦', label: 'Central Banks', description: 'Fed, ECB, BoE, BoJ & rate decisions',
    keywords: [
      'fed', 'fomc', 'powell', 'federal reserve', 'ecb', 'lagarde', 'boe', 'bailey', 'boj', 'ueda',
      'rba', 'rbnz', 'snb', 'pboc', "people's bank", 'central bank',
      'rate hike', 'rate cut', 'rate decision', 'interest rate', 'policy rate', 'dot plot',
      'qe ', 'quantitative', 'balance sheet', 'hawkish', 'dovish',
    ],
  },
  {
    key: 'commodities', emoji: '🛢️', label: 'Commodities', description: 'Oil, gold, gas & metals',
    keywords: [
      'nymex', 'wti', 'brent', 'crude', 'oil ', ' oil', 'gold', 'silver', 'copper', 'platinum',
      'natural gas', 'natgas', 'gasoline', 'opec', 'commodity', 'commodities', 'bullion',
      'xau', 'xag', 'lng',
    ],
  },
  {
    key: 'stocks_indices', emoji: '📈', label: 'Stocks & Indices', description: 'S&P, Nasdaq, Dow & earnings',
    keywords: [
      's&p', 's&p 500', 'spx', 'sp500', 'nasdaq', 'ndx', 'dow', 'djia', 'russell', 'nyse',
      'earnings', 'guidance', 'stocks', 'stock', 'shares', 'equity', 'equities',
      'index', 'indices', 'imbalance', 'mag 7', 'mag7', 'magnificent', 'ipo', 'buyback',
      'dividend', 'market cap', 'sec filing', 'premarket', 'pre-market', 'after hours', 'after-hours',
      'fear and greed', 'fear & greed', 'cnn fear', 'sentiment',
      'apple', 'aapl', 'microsoft', 'msft', 'amazon', 'amzn', 'alphabet', 'google', 'googl',
      'meta', 'tesla', 'tsla', 'nvidia', 'nvda', 'broadcom', 'avgo',
    ],
  },
  {
    key: 'bonds_yields', emoji: '💵', label: 'Bonds & Yields', description: 'Treasuries, auctions & yields',
    keywords: [
      'treasury', 'treasuries', 'yield', 'yields', 'bond', 'bonds', 'auction',
      '2-year', '2 year', '10-year', '10 year', '30-year', '30 year',
      'bund', 'gilt', 'jgb', 'tips', 'duration', 'spread',
    ],
  },
  {
    key: 'crypto', emoji: '₿', label: 'Crypto', description: 'Bitcoin, Ethereum & digital assets',
    keywords: [
      'bitcoin', 'btc', 'ethereum', 'eth', 'crypto', 'cryptocurrency', 'blockchain',
      'stablecoin', 'usdt', 'usdc', 'solana', 'sol ', 'xrp', 'binance', 'coinbase',
      'defi', 'altcoin', 'memecoin',
    ],
  },
  {
    key: 'economic_data', emoji: '📊', label: 'Economic Data', description: 'CPI, GDP, jobs & PMI releases',
    keywords: [
      'cpi', 'ppi', 'gdp', 'pmi', 'payrolls', 'nfp', 'nonfarm', 'non-farm',
      'unemployment', 'inflation', 'retail sales', 'jobless claims', 'ism',
      'housing starts', 'consumer confidence', 'durable goods', 'trade balance',
      'pce', 'core pce', 'jolts',
      'fear and greed', 'fear & greed',
    ],
  },
  {
    key: 'geopolitics', emoji: '🌍', label: 'Geopolitics', description: 'Conflicts, sanctions & diplomacy',
    keywords: [
      'iran', 'israel', 'ukraine', 'russia', 'china', 'taiwan', 'sanctions',
      'houthi', 'military', 'missile', 'war', 'ceasefire', 'nato', 'pentagon',
      'white house', 'state department', 'diplomat', 'tariff', 'tariffs',
    ],
  },
  {
    key: 'trump', emoji: '🦅', label: 'Trump / Truth Social',
    description: 'Trump posts & Truth Social items on Financial Juice',
    keywords: [
      'trump', 'truth social', 'truthsocial', 'realdonaldtrump', 'president trump',
      'donald trump', 'maga',
    ],
  },
];

function getTopic(key) {
  return TOPICS.find(t => t.key === key) || null;
}

const TOPIC_ALIASES = {
  equities: 'stocks_indices',
  stocks: 'stocks_indices',
  equity: 'stocks_indices',
  indices: 'stocks_indices',
  rates: 'central_banks',
  fx: 'forex',
};

function expandTopicKeywords(topicKeys) {
  const set = new Set();
  for (const raw of topicKeys || []) {
    const key = TOPIC_ALIASES[String(raw).toLowerCase()] || String(raw).toLowerCase();
    const topic = getTopic(key);
    if (!topic) continue;
    for (const kw of topic.keywords) set.add(String(kw).toLowerCase());
  }
  return [...set];
}

function textMatchesKeywords(title, body, keywords) {
  const raw = `${title || ''} ${body || ''}`.toLowerCase();
  if (!raw.trim() || !keywords || !keywords.length) return false;
  const compact = raw.replace(/[\/\s\-_.,]/g, '');
  for (const w of keywords) {
    if (!w) continue;
    if (raw.includes(w)) return true;
    const cw = w.replace(/[\/\s\-_.,]/g, '');
    if (cw.length >= 4 && compact.includes(cw)) return true;
  }
  return false;
}

module.exports = { TOPICS, getTopic, expandTopicKeywords, textMatchesKeywords };
