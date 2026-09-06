#!/usr/bin/env bash
# Completes Whop Feeds UI (HTML + app.js). Run from repo root.
set -euo pipefail

echo "== 1. Add Whop panel to Feeds in index.html =="
python3 - <<'PY'
from pathlib import Path
html = Path('web/public/index.html').read_text()
if 'id="form-whop"' in html:
    print('index.html already has Whop panel')
else:
    block = '''
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
'''
    if 'id="release-desk"' in html:
        # insert after the release-desk panel closes, before Economy
        marker = '    <!-- ── Economy'
        if marker not in html:
            marker = 'data-section="economy"'
            html = html.replace(
                '<div class="section" data-section="economy">',
                block + '\n    <div class="section" data-section="economy">',
                1,
            )
        else:
            html = html.replace(marker, block + '\n' + marker, 1)
    else:
        html = html.replace(
            '</div>\n\n    <!-- ── Economy',
            block + '\n    </div>\n\n    <!-- ── Economy',
            1,
        )
    Path('web/public/index.html').write_text(html)
    assert 'id="form-whop"' in Path('web/public/index.html').read_text()
    print('index.html OK')
PY

echo "== 2. Add renderWhop() to app.js =="
python3 - <<'PY'
from pathlib import Path
js = Path('web/public/app.js').read_text()

if 'function renderWhop(' in js:
    print('renderWhop already present')
else:
    fn = r'''
function renderWhop() {
  const d = state.overview?.whop;
  const form = $('#form-whop');
  const list = $('#whop-courses');
  const pillEl = $('#whop-state');
  if (!form) return;
  if (!d) {
    form.replaceChildren(el('p', 'muted', 'Whop data not loaded yet.'));
    return;
  }

  if (pillEl) {
    pillEl.textContent = d.enabled ? 'ON' : 'OFF';
    pillEl.className = 'pill ' + (d.enabled ? 'on' : 'off');
  }

  const draft = {
    enabled: !!d.enabled,
    apiKey: '',
    channelId: d.channelId || null,
    mentionRoleId: d.mentionRoleId || null,
    pollMinutes: d.pollMinutes || 10,
    onlyVideos: d.onlyVideos !== false,
    maxPerCheck: d.maxPerCheck || 5,
    buttonLabel: d.buttonLabel || 'open lesson',
    buttonUrl: d.buttonUrl || '',
    buttonEmoji: d.buttonEmoji || '',
    selectedCourseIds: (d.courses || []).filter(c => c.selected).map(c => c.id),
  };

  const keyHint = d.hasKey
    ? el('p', 'hint', `Key saved: ${d.keyMask || '••••'}. Leave blank to keep. Type a new key to replace. Clear the field and save empty only after choosing clear carefully.`)
    : el('p', 'hint', 'Paste your Whop API key once. It is stored for this server and not shown again in full.');

  form.replaceChildren(
    toggle('Tracking on', draft.enabled, v => { draft.enabled = v; }),
    textField('Whop API key', draft.apiKey, v => { draft.apiKey = v; }, { placeholder: d.hasKey ? '(saved — leave blank to keep)' : 'whop_...' }),
    keyHint,
    pickOne('Post channel', 'channel', draft.channelId, v => { draft.channelId = v; }),
    pickOne('Ping role (optional)', 'role', draft.mentionRoleId, v => { draft.mentionRoleId = v; }),
    textField('Check every (minutes)', String(draft.pollMinutes), v => { draft.pollMinutes = Number(v) || 10; }),
    textField('At most this many new lessons per check', String(draft.maxPerCheck), v => { draft.maxPerCheck = Number(v) || 5; }),
    toggle('Only video lessons', draft.onlyVideos, v => { draft.onlyVideos = v; }),
    textField('Link button label', draft.buttonLabel, v => { draft.buttonLabel = v; }, { placeholder: 'open lesson' }),
    textField('Link button URL', draft.buttonUrl, v => { draft.buttonUrl = v; }, { placeholder: 'https://...' }),
    textField('Link button emoji (optional)', draft.buttonEmoji, v => { draft.buttonEmoji = v; }, { placeholder: '' }),
    el('p', 'hint', d.lastError ? `Last error: ${d.lastError}` : (d.lastScanAt ? `Last scan: ${new Date(d.lastScanAt).toLocaleString()}` : 'Scan courses after saving your API key.')),
    actions(async () => {
      const body = {
        enabled: draft.enabled,
        channelId: draft.channelId,
        mentionRoleId: draft.mentionRoleId,
        pollMinutes: draft.pollMinutes,
        onlyVideos: draft.onlyVideos,
        maxPerCheck: draft.maxPerCheck,
        buttonLabel: draft.buttonLabel,
        buttonUrl: draft.buttonUrl || null,
        buttonEmoji: draft.buttonEmoji || null,
        selectedCourseIds: draft.selectedCourseIds,
      };
      if (draft.apiKey.trim()) body.apiKey = draft.apiKey.trim();
      await post('whop', body);
    }),
  );

  // Course checklist
  if (list) {
    const courses = d.courses || [];
    if (!courses.length) {
      list.replaceChildren(el('p', 'muted', 'No courses yet. Save your API key, then press Scan courses.'));
    } else {
      const selected = new Set(draft.selectedCourseIds);
      const rows = courses.map(c => {
        const row = el('label', 'toggle');
        const input = el('input');
        input.type = 'checkbox';
        input.checked = selected.has(c.id);
        input.addEventListener('change', () => {
          if (input.checked) selected.add(c.id);
          else selected.delete(c.id);
          draft.selectedCourseIds = [...selected];
        });
        const title = el('span', null, c.title || c.id);
        const meta = el('span', 'hint', [c.lessonsCount != null ? `${c.lessonsCount} lessons` : null, c.tagline].filter(Boolean).join(' · '));
        const right = el('span');
        right.style.display = 'flex';
        right.style.flexDirection = 'column';
        right.append(title);
        if (meta.textContent) right.append(meta);
        row.append(right, input);
        return row;
      });
      const saveCourses = el('div', 'actions');
      const btn = el('button', 'btn primary small', 'Save course selection');
      btn.type = 'button';
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await post('whop', { selectedCourseIds: draft.selectedCourseIds });
        } finally {
          btn.disabled = false;
        }
      });
      saveCourses.append(btn);
      list.replaceChildren(el('p', 'hint', `${courses.length} course(s) · ${selected.size} selected`), ...rows, saveCourses);
    }
  }

  const scanBtn = $('#whop-scan');
  if (scanBtn && !scanBtn.dataset.bound) {
    scanBtn.dataset.bound = '1';
    scanBtn.addEventListener('click', async () => {
      scanBtn.disabled = true;
      scanBtn.textContent = 'Scanning…';
      try {
        const res = await post('whopscan', {});
        if (res?.ok) toast(`Found ${res.courses} course(s).`, 'good');
      } finally {
        scanBtn.disabled = false;
        scanBtn.textContent = 'Scan courses';
      }
    });
  }
}
'''
    # Insert before renderFeedForms
    marker = 'function renderFeedForms()'
    if marker not in js:
        raise SystemExit('renderFeedForms not found')
    js = js.replace(marker, fn + '\n' + marker, 1)

# Call renderWhop from renderOverview
if 'renderWhop();' not in js:
    if 'renderFeedForms();' in js:
        js = js.replace(
            '  renderFeedForms();
',
            '  renderFeedForms();
  renderWhop();
',
            1,
        )
    else:
        raise SystemExit('could not wire renderWhop call')

Path('web/public/app.js').write_text(js)
assert 'function renderWhop(' in Path('web/public/app.js').read_text()
assert 'renderWhop();' in Path('web/public/app.js').read_text()
print('app.js OK')
PY

echo "== 3. Ensure whop.lesson in messageStyle =="
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
    blurb: 'Posted when a tracked Whop course gets a new video lesson.',
    shape: 'card',
    parts: ['enabled', 'color', 'title', 'body', 'footer', 'thumbnail', 'timestamp'],
    tokens: ['{title}', '{course}', '{type}'],
    titleLabel: 'Heading',
    bodyLabel: 'Body',
    bodyHint: '{title} is the lesson name. {course} is the course.',
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
        print('WARN: could not add whop.lesson — add manually in Appearance catalogue')
    else:
        Path('utils/messageStyle.js').write_text(t.replace(needle, insert, 1))
        print('whop.lesson added')
PY

echo ""
echo "Done. Commit and push:"
echo "  git add -A"
echo "  git commit -m 'Complete Whop Feeds UI'"
echo "  git push origin main"
echo ""
echo "Then restart the bot. Panel path: Feeds → Whop courses"
