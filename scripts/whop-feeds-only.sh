#!/usr/bin/env bash
# Surgical: Whop UI only runs with Feeds forms, not as a global overview paint.
set -euo pipefail
python3 << 'PY'
from pathlib import Path
p = Path('web/public/app.js')
t = p.read_text()

# 1) Remove renderWhop() from renderOverview only
old_ov = """function renderOverview() {
  if (!state.overview) return;
  renderOverviewCards();
  renderFeedForms();
  renderWhop();
  renderModerationForm();"""

new_ov = """function renderOverview() {
  if (!state.overview) return;
  renderOverviewCards();
  renderFeedForms();
  renderModerationForm();"""

if old_ov in t:
    t = t.replace(old_ov, new_ov, 1)
    print('removed renderWhop from renderOverview')
elif 'renderFeedForms();\n  renderWhop();' in t:
    t = t.replace('  renderFeedForms();\n  renderWhop();\n', '  renderFeedForms();\n', 1)
    print('removed renderWhop line near renderFeedForms')
else:
    print('WARN: overview pattern not found (maybe already fixed)')

# 2) Call renderWhop at end of renderFeedForms (Feeds section only)
if 'renderReleaseDesk();\n  renderWhop();' in t:
    print('renderFeedForms already calls renderWhop')
elif '  renderReleaseDesk();\n}' in t:
    t = t.replace(
        '  renderReleaseDesk();\n}',
        '  renderReleaseDesk();\n  renderWhop();\n}',
        1,
    )
    print('added renderWhop to end of renderFeedForms')
else:
    print('WARN: renderFeedForms end not found')

p.write_text(t)
assert 'function renderWhop' in t
print('done')
PY
