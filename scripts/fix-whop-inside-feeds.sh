#!/usr/bin/env bash
# Move #whop-panel inside the feeds section so it only shows on Feeds.
set -euo pipefail
python3 << 'PY'
from pathlib import Path
p = Path('web/public/index.html')
t = p.read_text()

# Already inside feeds?
if 'data-section="feeds"' in t:
    feeds_start = t.find('data-section="feeds"')
    # Find matching close of feeds - look for whop relative to feeds close
    pass

marker_out = '''    </div>


      <div class="panel" id="whop-panel">'''

# Current broken structure: feeds closes, then whop floats outside
broken = '''      </div>
    </div>


      <div class="panel" id="whop-panel">
        <div class="queue-head">
          <h2>Whop courses</h2>
          <span class="pill" id="whop-state"></span>
        </div>
        <p class="muted">API key once. Scan courses, pick which to track. New video lessons post here. Embed look: Appearance → Whop lesson. Optional link button below.</p>
        <form id="form-whop" class="form"></form>
        <div class="actions" style="border-top:none;padding-top:0;margin-top:0.5rem">
          <button type="button" class="btn small" id="whop-scan">Scan courses</button>
        </div>
        <div id="whop-courses" class="items" style="margin-top:1rem"></div>
      </div>

    <!-- ── Economy'''

fixed = '''      </div>

      <div class="panel" id="whop-panel">
        <div class="queue-head">
          <h2>Whop courses</h2>
          <span class="pill" id="whop-state"></span>
        </div>
        <p class="muted">API key once. Scan courses, pick which to track. New video lessons post here. Embed look: Appearance → Whop lesson. Optional link button below.</p>
        <form id="form-whop" class="form"></form>
        <div class="actions" style="border-top:none;padding-top:0;margin-top:0.5rem">
          <button type="button" class="btn small" id="whop-scan">Scan courses</button>
        </div>
        <div id="whop-courses" class="items" style="margin-top:1rem"></div>
      </div>
    </div>

    <!-- ── Economy'''

if broken in t:
    t = t.replace(broken, fixed, 1)
    p.write_text(t)
    print('Whop panel moved inside feeds section')
elif 'id="whop-panel"' in t and t.find('id="whop-panel"') < t.find('data-section="economy"'):
    # Check if whop is between feeds open and feeds close
    fs = t.find('data-section="feeds"')
    wp = t.find('id="whop-panel"')
    # Find first </div> structure - simpler check: economy should come after feeds close after whop
    print('Checking placement...')
    # If already fixed, feeds section should contain whop-panel
    chunk = t[fs:t.find('data-section="economy"')]
    if 'id="whop-panel"' in chunk and chunk.rstrip().endswith('</div>') or 'whop-panel' in chunk:
        # verify not closed early
        if '</div>\n\n\n      <div class="panel" id="whop-panel">' in t:
            print('still broken pattern')
            raise SystemExit(1)
        print('Whop already appears before economy section; verify nested in feeds')
        # If pattern with early close still exists, fail
        if 'release-desk' in chunk and 'whop-panel' in chunk:
            print('OK: whop inside feeds chunk')
        else:
            print('WARN: unexpected structure')
else:
    print('WARN: pattern not found')
    # dump context around whop
    i = t.find('whop-panel')
    print(repr(t[i-80:i+80]))
    raise SystemExit(1)

# Sanity: whop-panel must appear after feeds and before economy, and feeds must close after whop
i_feeds = t.find('data-section="feeds"')
i_whop = t.find('id="whop-panel"')
i_econ = t.find('data-section="economy"')
assert i_feeds < i_whop < i_econ, (i_feeds, i_whop, i_econ)
print('order OK: feeds < whop < economy')
PY
