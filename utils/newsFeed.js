'use strict';

// Polls Financial Juice's public RSS feed (financialjuice.com/feed.ashx) for
// real-time market-moving headlines and relays new ones into each guild's
// configured news channel as they're published. No API key / paid tier
// needed — it's a free, public feed that updates within seconds of a
// headline going out.

const { readJson, writeJson } = require('./jsonStorage');
const { TOPICS, expandTopicKeywords, textMatchesKeywords } = require('./newsTopics');
const { isFeatureEnabled } = require('./featureToggles');
// NOTE: do not top-level require newsCardVisual / embedBuilder / messageStyle —
// they are unused on the Components V2 path. A missing or circular dep there
// used to make this module load as {} and blow up ready.js with
// "startNewsFeedRunner is not a function".

// The address Financial Juice publishes as its RSS link. The same endpoint
// as the bare feed.ashx this used to request, with the query string their
// own published link carries.
const FEED_URL          = 'https://www.financialjuice.com/feed.ashx?xy=rss';
