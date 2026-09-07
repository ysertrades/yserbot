#!/usr/bin/env bash
# Remove live Financial Juice news feed from panel + runtime. Keep layout clean.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

echo "== 1. index.html: drop News feed panel, full-width calendar =="
python3 << 'PY'
from pathlib import Path
p = Path('web/public/index.html')
t = p.read_text()
old = '''      <div class="grid">
        <article class="panel">
          <h2>News feed</h2>
          <form id="form-newsfeed" class="form"></form>
        </article>
        <article class="panel">
          <h2>Economic calendar</h2>
          <form id="form-econcal" class="form"></form>
        </article>
      </div>'''
new = '''      <div class="panel">
        <h2>Economic calendar</h2>
        <form id="form-econcal" class="form"></form>
      </div>'''
if old in t:
    t = t.replace(old, new, 1)
    print('html feeds layout OK')
elif 'form-newsfeed' not in t:
    print('html already without newsfeed')
else:
    raise SystemExit('html newsfeed block not found')
Path('web/public/index.html').write_text(t)
PY

echo "== 2. app.js: overview tiles + systems + renderFeedForms =="
python3 << 'PY'
from pathlib import Path
import re
p = Path('web/public/app.js')
t = p.read_text()

# Tiles: remove newsfeed tile, keep 5 others + maybe leave 6 by not replacing count
old_tiles = '''  paintTiles([
    { value: d.newsfeed.enabled ? 'LIVE' : 'OFF', label: 'News feed', kind: d.newsfeed.enabled ? 'live' : 'idle' },
    { value: d.econcal.enabled ? 'LIVE' : 'OFF', label: 'Calendar', kind: d.econcal.enabled ? 'live' : 'idle' },
    { value: num(d.counts.activeGiveaways), label: 'Giveaways', kind: d.counts.activeGiveaways ? 'live' : 'idle' },
    { value: num(d.counts.embedTemplates), label: 'Templates', kind: '' },
    { value: num(d.counts.shopItems), label: 'Shop items', kind: '' },
    { value: num(d.counts.moderationCases), label: 'Mod cases', kind: '' },
  ]);'''
new_tiles = '''  paintTiles([
    { value: d.econcal.enabled ? 'LIVE' : 'OFF', label: 'Calendar', kind: d.econcal.enabled ? 'live' : 'idle' },
    { value: num(d.counts.activeGiveaways), label: 'Giveaways', kind: d.counts.activeGiveaways ? 'live' : 'idle' },
    { value: num(d.counts.embedTemplates), label: 'Templates', kind: '' },
    { value: num(d.counts.shopItems), label: 'Shop items', kind: '' },
    { value: num(d.counts.moderationCases), label: 'Mod cases', kind: '' },
    { value: d.whop?.enabled ? 'ON' : 'OFF', label: 'Whop', kind: d.whop?.enabled ? 'live' : 'idle' },
  ]);'''
if old_tiles in t:
    t = t.replace(old_tiles, new_tiles, 1)
    print('tiles OK')
else:
    print('WARN tiles')

old_sys = '''  $('#card-systems').replaceChildren(
    row('News feed', pill(d.newsfeed.enabled, 'Running', 'Stopped')),
    row('Feed channel', d.newsfeed.channel ? `#${d.newsfeed.channel}` : 'not set', { dim: !d.newsfeed.channel }),
    row('Sources', chips(d.newsfeed.sources)),
    row('Calendar', pill(d.econcal.enabled, 'Running', 'Stopped')),
    row('Calendar channel', d.econcal.channel ? `#${d.econcal.channel}` : 'not set', { dim: !d.econcal.channel }),
    row('Mod log', d.modlog.channel ? `#${d.modlog.channel}` : 'not set', { dim: !d.modlog.channel }),
  );'''
new_sys = '''  $('#card-systems').replaceChildren(
    row('Calendar', pill(d.econcal.enabled, 'Running', 'Stopped')),
    row('Calendar channel', d.econcal.channel ? `#${d.econcal.channel}` : 'not set', { dim: !d.econcal.channel }),
    row('Whop tracker', pill(!!d.whop?.enabled, 'On', 'Off')),
    row('Mod log', d.modlog.channel ? `#${d.modlog.channel}` : 'not set', { dim: !d.modlog.channel }),
  );'''
if old_sys in t:
    t = t.replace(old_sys, new_sys, 1)
    print('systems card OK')
else:
    # try without optional chaining variants
    print('WARN systems card pattern')

# Remove newsfeed form block from renderFeedForms
old_nf = '''  const nf = { enabled: d.newsfeed.enabled, filterTopics: d.newsfeed.topics.slice() };
  $('#form-newsfeed').replaceChildren(
    toggle('Feed running', nf.enabled, v => { nf.enabled = v; }),
    // Picked, not typed. The filter works off each topic's bundle of
    // keywords, so only one of these keys means anything — and the box that
    // used to be here took any words at all, stored them, and then matched
    // nothing, which looked identical to a filter that was simply strict.
    pickValues('Topics', d.newsfeed.topicOptions || [], nf.filterTopics,
      v => { nf.filterTopics = v; },
      { allNote: 'Nothing picked — every headline is posted.' }),
    pickOne('Channel', 'channel', d.newsfeed.channelId, v => { nf.channelId = v; }),
    row('Sources', chips(d.newsfeed.sources)),
    actions(() => post('newsfeed', nf)),
  );
'''
if old_nf in t:
    t = t.replace(old_nf, '  // News feed removed — Financial Juice live feed retired.\n', 1)
    print('renderFeedForms news removed')
elif 'form-newsfeed' in t:
    t = re.sub(r"  const nf = \{ enabled: d\.newsfeed[\s\S]*?actions\(\(\) => post\('newsfeed', nf\)\),\n  \);\n", '  // News feed removed\n', t, count=1)
    print('renderFeedForms news removed (regex)')
else:
    print('renderFeedForms news already gone')

Path('web/public/app.js').write_text(t)
PY

echo "== 3. ready.js: do not start news runner =="
python3 << 'PY'
from pathlib import Path
p = Path('events/ready.js')
t = p.read_text()
t2 = t.replace("const { startNewsFeedRunner } = require('../utils/newsFeed');\n", '')
t2 = t2.replace('        startNewsFeedRunner(client);\n', '        // News feed runner removed (Financial Juice retired)\n')
if t2 != t:
    p.write_text(t2)
    print('ready.js OK')
else:
    print('ready.js already without news runner or pattern drift')
PY

echo "== 4. newsFeed runner no-op (safe if still required) =="
python3 << 'PY'
from pathlib import Path
p = Path('utils/newsFeed.js')
t = p.read_text()
if 'NEWSFEED_RETIRED' in t:
    print('already retired')
else:
    # Prepend no-op start and keep exports for any require
    stub = '''\n/* NEWSFEED_RETIRED — Financial Juice live feed removed from the product. */\nconst _startNewsFeedRunnerImpl = typeof startNewsFeedRunner === 'function' ? startNewsFeedRunner : null;\n'''
    # Replace startNewsFeedRunner function body is hard; export override at end
    if 'function startNewsFeedRunner' in t:
        t = t.replace(
            'function startNewsFeedRunner',
            'function startNewsFeedRunner_DISABLED',
            1,
        )
        t += '''

/** @deprecated Financial Juice news feed removed */
function startNewsFeedRunner() {
  console.log('[newsFeed] retired — Financial Juice live feed is off');
}
module.exports.startNewsFeedRunner = startNewsFeedRunner;
'''
        # Fix double module.exports if needed
        Path('utils/newsFeed.js').write_text(t)
        print('runner disabled')
    else:
        print('startNewsFeedRunner not found as function')
PY

echo "== 5. /newsfeed command: retired message =="
python3 << 'PY'
from pathlib import Path
p = Path('commands/utility/newsfeed.js')
if not p.exists():
    print('no command file')
else:
    p.write_text('''\'use strict\';

const { SlashCommandBuilder, MessageFlags } = require(\'discord.js\');

module.exports = {
  data: new SlashCommandBuilder()
    .setName(\'newsfeed\')
    .setDescription(\'(Retired) Live market news feed has been removed.\'),
  async execute(interaction) {
    await interaction.reply({
      content: \'The Financial Juice live news feed has been removed. Use **Feeds → Economic calendar** for releases.\',
      flags: MessageFlags.Ephemeral,
    });
  },
};
''')
    print('command retired')
PY

echo "== 6. Feature toggle label =="
python3 << 'PY'
from pathlib import Path
p = Path('utils/featureToggles.js')
t = p.read_text()
old = '''  {
    key: 'newsfeed', label: 'Market News Feed',
    description: 'Live Financial Juice headlines — the /newsfeed command and the scheduled poster both stop.',
    commands: ['newsfeed'],
  },'''
new = '''  {
    key: 'newsfeed', label: 'Market News Feed (retired)',
    description: 'Removed — Financial Juice live feed is no longer available.',
    commands: ['newsfeed'],
  },'''
if old in t:
    p.write_text(t.replace(old, new, 1))
    print('feature toggle labeled retired')
else:
    print('feature toggle pattern skip')
PY

echo ""
echo "Done. Commit panel + ready + command changes (not node_modules)."
echo "  git add web/public/index.html web/public/app.js events/ready.js utils/newsFeed.js commands/utility/newsfeed.js utils/featureToggles.js"
echo "  git commit -m 'Remove Financial Juice news feed; keep Feeds layout'"
echo "  git push && restart bot"
