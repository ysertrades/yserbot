#!/usr/bin/env bash
# Restores truncated panel files and finishes Whop tracker wiring.
# Run from the repo root:  bash scripts/fix-panel-and-whop.sh
set -euo pipefail

GOOD_WRITES=11a28a465eb15ac9af1fd98a7cababf2ac44e219
GOOD_CSS=d5074d4135ee37650aba1b4483a3939d3cadbb36
GOOD_INDEX=7ee484aa5316f48c0a3ec4b0f4cb04d01f891da8

echo "== 1. Restore writes.js from $GOOD_WRITES =="
git show "$GOOD_WRITES:web/writes.js" > web/writes.js

echo "== 2. Add Whop handlers to writes.js =="
python3 - <<'PY'
from pathlib import Path
t = Path('web/writes.js').read_text()
if "require('./whop')" not in t:
    t = t.replace(
        "const socialPanel = require('./social');",
        "const socialPanel = require('./social');\nconst whopPanel = require('./whop');",
    )
insert = '''
  /* -- Whop courses ------------------------------------------------------- */
  async whop(guildId, body, ctx) {
    const r = whopPanel.saveSettings(guildId, body, ctx);
    if (r.ok && !r.unchanged) {
      await announce(ctx.client, guildId, ctx.session, `📚 **Whop** — ${r.changed.join('; ')}`, 'social');
    }
    return r;
  },
  async whopscan(guildId, body, ctx) {
    const r = await whopPanel.scan(guildId);
    if (r.ok) {
      await announce(ctx.client, guildId, ctx.session,
        `📚 **Whop** scanned — ${r.courses} course(s), ${r.selected} selected`, 'social');
    }
    return r;
  },

'''
if 'async whop(' not in t:
    t = t.replace(
        "  /* -- the wording and colour of the bot's own messages ------------------- */",
        insert + "  /* -- the wording and colour of the bot's own messages ------------------- */",
    )
Path('web/writes.js').write_text(t)
assert 'async newsfeed' in t and 'async whop' in t and 'module.exports' in t
print('writes.js OK', len(t))
PY

echo "== 3. Restore app.css and strip dialkit =="
git show "$GOOD_CSS:web/public/app.css" > web/public/app.css
python3 - <<'PY'
from pathlib import Path
import re
css = Path('web/public/app.css').read_text()
css = re.sub(
    r'/\* ── dialkit lock[^*]*\*/\s*\.dialkit-lock \{.*?\n\.dialkit-lock\.ok \{[^}]+\}\n',
    '', css, count=1, flags=re.S)
css = re.sub(r'\n@keyframes lockShake \{[^}]+\}\n', '\n', css, count=1)
css = re.sub(r'\n@keyframes unlockPulse \{[^}]+\}\n', '\n', css, count=1)
Path('web/public/app.css').write_text(css)
assert 'dialkit' not in css.lower()
print('app.css OK', len(css))
PY

echo "== 4. Strip dialkit from app.js =="
python3 - <<'PY'
from pathlib import Path
import re
js = Path('web/public/app.js').read_text()
js = re.sub(r"\nconst DIALKIT_PASSCODE = '4050';\n", "\n", js)
js = re.sub(r"\nconst DIALKIT_PASSCODE_KEY = 'yserflow\.dialkit\.passcode\.ok';\n", "\n", js)
js = re.sub(r"\nconst dialKitPasscodeRemembered = \(\) => \{[\s\S]*?\};\n\nconst rememberDialKitPasscode = ok => \{[\s\S]*?\};\n", "\n", js, count=1)
js = re.sub(r"\nlet layoutDialMounted = false;\n\nfunction applyLayoutDialKitStyles\(values\) \{[\s\S]*?\n\}\n\nfunction mountLayoutDialKit\(\) \{[\s\S]*?\n\}\n", "\n", js, count=1)
js = re.sub(r"\nfunction openDialKitPasscodeSheet\(\) \{[\s\S]*?\n\}\n\nfunction launchDialKit\(\) \{[\s\S]*?\n\}\n", "\n", js, count=1)
js = js.replace("    rememberDialKitPasscode(false);\n", "")
js = re.sub(
    r"\n  const dial = el\('button', 'btn small', 'DialKit'\);\n  dial\.type = 'button';\n  dial\.addEventListener\('click', launchDialKit\);\n  wrap\.append\(dial\);\n",
    "\n", js, count=1)
left = [l for l in js.splitlines() if 'dialkit' in l.lower() or 'DialKit' in l or 'DIALKIT' in l]
if left:
    raise SystemExit('dialkit still present: ' + repr(left[:8]))
Path('web/public/app.js').write_text(js)
print('app.js OK', len(js))
PY

echo "== 5. Restore index.html without dialkit links =="
git show "$GOOD_INDEX:web/public/index.html" > web/public/index.html
sed -i '/vendor\/dialkit/d' web/public/index.html
grep -qi dialkit web/public/index.html && { echo 'dialkit still in index'; exit 1; } || true

echo "== 6. Wire Whop into api.js =="
python3 - <<'PY'
from pathlib import Path
t = Path('web/api.js').read_text()
if "require('./whop')" not in t:
    t = t.replace(
        "const socialPanel = require('./social');",
        "const socialPanel = require('./social');\nconst whopPanel = require('./whop');",
    )
if 'whop: whopPanel.read' not in t:
    t = t.replace(
        "    social: socialPanel.read(guildId, guild),",
        "    social: socialPanel.read(guildId, guild),\n    whop: whopPanel.read(guildId, guild),",
    )
Path('web/api.js').write_text(t)
print('api.js OK')
PY

echo "== 7. Add whop.lesson to messageStyle.js =="
python3 - <<'PY'
from pathlib import Path
t = Path('utils/messageStyle.js').read_text()
if "'whop.lesson'" in t:
    print('whop.lesson already present')
else:
    needle = """  ...social('youtube', 'YouTube', '#FF0000',
    'Posted when a watched YouTube channel publishes. {title} is the video title.'),

  /* -- market news --------------------------------------------------------- */"""
    insert = """  ...social('youtube', 'YouTube', '#FF0000',
    'Posted when a watched YouTube channel publishes. {title} is the video title.'),

  /* -- Whop courses -------------------------------------------------------- */

  'whop.lesson': {
    group: 'Feeds',
    label: 'Whop lesson',
    blurb: 'Posted when a tracked Whop course gets a new video lesson. Colour and wording live here; the link button label and URL are set on the Feeds screen.',
    shape: 'card',
    parts: ['enabled', 'color', 'title', 'body', 'footer', 'thumbnail', 'timestamp'],
    tokens: ['{title}', '{course}', '{type}'],
    titleLabel: 'Heading',
    bodyLabel: 'Body',
    bodyHint: '{title} is the lesson name. {course} is the course it belongs to. Keep it short — process over hype.',
    defaults: {
      enabled: true,
      color: BRAND.purple,
      title: 'new lesson',
      body: '**{title}**\\n\\ncourse · {course}',
      footer: 'whop · {type}',
      thumbnail: false,
      timestamp: true,
    },
  },

  /* -- market news --------------------------------------------------------- */"""
    if needle not in t:
        raise SystemExit('messageStyle needle not found — check file manually')
    Path('utils/messageStyle.js').write_text(t.replace(needle, insert, 1))
    print('whop.lesson added')
PY

echo "== 8. Add Whop panel section to Feeds in index.html =="
python3 - <<'PY'
from pathlib import Path
html = Path('web/public/index.html').read_text()
if 'id="form-whop"' in html:
    print('Whop form already in index')
else:
    block = '''
      <div class="panel" id="whop-panel">
        <div class="queue-head">
          <h2>Whop courses</h2>
          <span class="pill" id="whop-state"></span>
        </div>
        <p class="muted">API key once. Scan courses, pick which to track, new video lessons post here with an optional link button. Embed look is under Appearance → Whop lesson.</p>
        <form id="form-whop" class="form"></form>
        <div class="actions">
          <button type="button" class="btn" id="whop-scan">Scan courses</button>
        </div>
        <div id="whop-courses" class="items"></div>
      </div>
'''
    # Insert before closing of feeds section if possible
    marker = 'data-section="feeds"'
    if marker not in html:
        print('WARN: feeds section not found — add Whop panel manually')
    else:
        # after release-desk panel inside feeds
        if 'id="release-desk"' in html:
            # append after release-desk closing is hard; insert before economy section
            html = html.replace(
                '<!-- ── Economy',
                block + '\n    <!-- ── Economy',
                1,
            )
        else:
            html = html.replace(
                '<div class="section" data-section="feeds">',
                '<div class="section" data-section="feeds">' + block,
                1,
            )
        Path('web/public/index.html').write_text(html)
        print('Whop panel HTML added')
PY

echo ""
echo "Done. Review changes, then:"
echo "  git add -A"
echo "  git commit -m 'Restore panel files, remove dialkit, wire Whop tracker'"
echo "  git push"
echo ""
echo "After deploy: Feeds → Whop → paste API key → Scan → pick courses → set channel + button URL."
