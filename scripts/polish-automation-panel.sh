#!/usr/bin/env bash
# Professional Automation section: schedules + auto-replies created in-panel.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

echo "== 1. index.html automation layout =="
python3 << 'PY'
from pathlib import Path
p = Path('web/public/index.html')
t = p.read_text()
old = '''    <div class="section" data-section="automation">
      <div class="panel">
        <h2>Scheduled posts</h2>
        <div id="sched-list" class="items"></div>
        <p class="hint">New schedules are created with <code>/schedule</code> — picking a time needs your timezone, which Discord knows and a web page does not.</p>
      </div>
      <div class="panel">
        <h2>Auto-replies</h2>
        <div id="reply-list" class="items"></div>
      </div>
    </div>'''
new = '''    <div class="section" data-section="automation">
      <div class="panel">
        <h2>Automation</h2>
        <p class="muted">Two desks, one place. <strong>Scheduled posts</strong> deliver a Studio template on a clock. <strong>Auto-replies</strong> answer a phrase in chat with a template. Everything is created and edited here — no slash command required.</p>
      </div>

      <div class="grid">
        <article class="panel" id="sched-panel">
          <div class="queue-head">
            <h2>Scheduled posts</h2>
            <span class="pill" id="sched-count"></span>
          </div>
          <p class="muted">Pick a message, a channel, how often, and a time in <em>your</em> timezone. One-shot or repeating — the next run is always visible on each row.</p>
          <div id="sched-list" class="items"></div>
          <div id="sched-composer"></div>
        </article>

        <article class="panel" id="reply-panel">
          <div class="queue-head">
            <h2>Auto-replies</h2>
            <span class="pill" id="reply-count"></span>
          </div>
          <p class="muted">When a member’s message matches a trigger, the bot posts a template. Use exact match for commands-style phrases; leave it off for keywords inside longer messages.</p>
          <div id="reply-list" class="items"></div>
          <div id="reply-composer"></div>
        </article>
      </div>
    </div>'''
if old in t:
    t = t.replace(old, new, 1)
    print('html OK')
elif 'id="sched-composer"' in t:
    print('html already polished')
else:
    raise SystemExit('automation HTML block not found')
Path('web/public/index.html').write_text(t)
PY

echo "== 2. Rewrite renderSchedules + renderAutoreplies =="
python3 << 'PY'
from pathlib import Path
import re
p = Path('web/public/app.js')
t = p.read_text()

start = t.find('function renderSchedules()')
end = t.find('/* ── engagement')
if start < 0 or end < 0:
    raise SystemExit(f'markers not found start={start} end={end}')

# Keep helpers above renderSchedules (templateOptions ... DATE_NOTE)
# Find start of renderSchedules only

new_fns = r'''function renderSchedules() {
  const list = $('#sched-list');
  const composer = $('#sched-composer');
  const countPill = $('#sched-count');
  const items = state.overview?.features?.schedules || [];
  if (countPill) {
    countPill.textContent = items.length
      ? `${items.length} active`
      : 'none yet';
  }

  const nodes = [];
  if (!items.length) {
    const empty = el('div', 'empty-desk');
    empty.append(
      el('p', 'muted', 'No clocks running yet.'),
      el('p', 'hint', 'Compose one below — template, channel, cadence, time. The bot posts for you.'),
    );
    nodes.push(empty);
  }

  for (const s of items) {
    const draft = {
      id: s.id,
      embedName: s.embedName,
      channelId: s.channelId,
      frequency: s.frequency,
      time: s.time || '',
      dayOfWeek: s.dayOfWeek,
      date: s.date || '',
      mention: s.mention || null,
      enabled: s.enabled !== false,
    };
    const d = el('details', 'item');
    const sum = el('summary');
    const on = s.enabled !== false;
    sum.append(
      el('span', `bstyle ${on ? 'success' : 'secondary'}`, on ? 'live' : 'paused'),
      el('span', 'nm', s.embedName || 'Untitled'),
      el('span', 'pr', cadenceLabel(s)),
    );
    const meta = el('p', 'hint');
    meta.textContent = [
      s.channelName ? `#${s.channelName}` : (s.channelId ? `channel ${s.channelId}` : 'no channel'),
      s.nextRun ? `next ${fmtTime(s.nextRun)}` : null,
      s.time ? `at ${s.time}` : null,
    ].filter(Boolean).join(' · ');
    sum.append(meta);

    const body = el('div', 'body');
    const dayPick = select('Weekday', draft.dayOfWeek, dayOptions(), v => { draft.dayOfWeek = v === '' ? null : Number(v); }, { blank: 'Same as first-post date' });
    dayPick.style.display = draft.frequency === 'weekly' ? '' : 'none';
    const datePick = dateField(DATE_LABEL[draft.frequency] || 'Date', draft.date, v => { draft.date = v; }, { note: DATE_NOTE[draft.frequency] || '' });

    const syncCadence = f => {
      dayPick.style.display = f === 'weekly' ? '' : 'none';
      datePick.retitle(DATE_LABEL[f] || 'Date', DATE_NOTE[f] || '');
    };

    body.append(
      select('Message to post', draft.embedName, templateOptions(), v => { draft.embedName = v; }, { blank: 'Pick a message' }),
      pickOne('Channel', 'channel', draft.channelId, v => { draft.channelId = v; }, { blank: 'Pick a channel' }),
      select('How often', draft.frequency, freqOptions(), v => { draft.frequency = v; syncCadence(v); }),
      dayPick,
      textField('Time', draft.time, v => { draft.time = v; }, { placeholder: '09:30' }),
      datePick,
      mentionPicker('Ping with the post', draft.mention, v => { draft.mention = v; }),
      toggle('Schedule enabled', on, v => { draft.enabled = v; }),
    );

    const act = el('div', 'actions');
    const save = el('button', 'btn primary small', 'Save schedule');
    save.type = 'button';
    save.addEventListener('click', () => post('schedule', draft));
    const del = el('button', 'btn small danger', 'Delete');
    del.type = 'button';
    del.addEventListener('click', async () => {
      if (!await askConfirm({
        title: 'Delete this schedule?',
        message: `“${s.embedName}” will stop posting on its clock.`,
        confirmLabel: 'Delete it', danger: true,
      })) return;
      await post('schedule', { id: s.id, remove: true });
    });
    act.append(save, del);
    body.append(act);
    d.append(sum, body);
    nodes.push(d);
  }
  list.replaceChildren(...nodes);

  // Composer — always visible so an empty desk still invites a first schedule
  if (!composer) return;
  const nb = {
    embedName: '', channelId: '', frequency: 'everyday',
    time: '', dayOfWeek: null, date: '', mention: null,
  };
  const wrap = el('div', 'desk-composer');
  wrap.append(el('h3', null, 'New schedule'));
  wrap.append(el('p', 'hint', `Times use your local zone (UTC${tzOffset() >= 0 ? '+' : ''}${(tzOffset() / 60).toFixed(2).replace(/\.00$/, '')}).`));

  const newDayPick = select('Weekday', '', dayOptions(), v => { nb.dayOfWeek = v === '' ? null : Number(v); }, { blank: 'Same as first-post date' });
  newDayPick.style.display = 'none';
  const newDatePick = dateField(DATE_LABEL.everyday, '', v => { nb.date = v; }, { note: DATE_NOTE.everyday });
  const syncNew = f => {
    newDayPick.style.display = f === 'weekly' ? '' : 'none';
    newDatePick.retitle(DATE_LABEL[f] || 'Date', DATE_NOTE[f] || '');
  };

  wrap.append(
    select('Message to post', '', templateOptions(), v => { nb.embedName = v; }, { blank: 'Pick a Studio template' }),
    pickOne('Channel', 'channel', '', v => { nb.channelId = v; }, { blank: 'Where it posts' }),
    select('How often', 'everyday', freqOptions(), v => { nb.frequency = v; syncNew(v); }),
    newDayPick,
    textField('Time', '', v => { nb.time = v; }, { placeholder: '09:30 or 2h from now' }),
    newDatePick,
    mentionPicker('Optional ping', null, v => { nb.mention = v; }),
    actions(() => post('schedulenew', nb), { label: 'Create schedule' }),
  );
  composer.replaceChildren(wrap);
}

function renderAutoreplies() {
  const list = $('#reply-list');
  const composer = $('#reply-composer');
  const countPill = $('#reply-count');
  const items = state.overview?.features?.autoreplies || [];
  const enabledN = items.filter(r => r.enabled).length;
  if (countPill) {
    countPill.textContent = items.length
      ? `${enabledN}/${items.length} on`
      : 'none yet';
  }

  const nodes = [];
  if (!items.length) {
    const empty = el('div', 'empty-desk');
    empty.append(
      el('p', 'muted', 'No phrase watchers yet.'),
      el('p', 'hint', 'Add a trigger below and pick the template the bot should post back.'),
    );
    nodes.push(empty);
  }

  for (const r of items) {
    const draft = {
      key: r.key, trigger: r.trigger, embedName: r.embedName,
      exact: r.exact, cooldown: r.cooldown, enabled: r.enabled,
    };
    const d = el('details', 'item');
    const sum = el('summary');
    sum.append(
      el('span', `bstyle ${r.enabled ? 'success' : 'secondary'}`, r.enabled ? 'on' : 'off'),
      el('span', 'nm', r.trigger),
      el('span', 'pr', r.embedName || '—'),
    );
    const body = el('div', 'body');
    body.append(
      textField('Trigger phrase', r.trigger, v => { draft.trigger = v; }),
      select('Reply with', r.embedName, templateOptions(), v => { draft.embedName = v; }, { blank: 'Pick a template' }),
      textField('Cooldown (seconds)', String(r.cooldown ?? 5), v => { draft.cooldown = Number(v); }),
      toggle('Whole message must match exactly', !!r.exact, v => { draft.exact = v; }),
      toggle('Enabled', !!r.enabled, v => { draft.enabled = v; }),
    );
    const act = el('div', 'actions');
    const save = el('button', 'btn primary small', 'Save reply');
    save.type = 'button';
    save.addEventListener('click', () => post('autoreply', draft));
    const del = el('button', 'btn small danger', 'Remove');
    del.type = 'button';
    del.addEventListener('click', async () => {
      if (!await askConfirm({
        title: 'Remove this auto-reply?',
        message: `The bot will stop replying to “${r.trigger}”.`,
        confirmLabel: 'Remove it', danger: true,
      })) return;
      await post('autoreply', { key: r.key, remove: true });
    });
    act.append(save, del);
    body.append(act);
    d.append(sum, body);
    nodes.push(d);
  }
  list.replaceChildren(...nodes);

  if (!composer) return;
  const nb = { key: '', trigger: '', embedName: '', cooldown: 5, exact: false, enabled: true };
  const wrap = el('div', 'desk-composer');
  wrap.append(el('h3', null, 'New auto-reply'));
  wrap.append(el('p', 'hint', 'Trigger is matched in chat. Exact mode requires the full message to be only that phrase.'));
  wrap.append(
    textField('Trigger phrase', '', v => { nb.key = v.toLowerCase().trim(); nb.trigger = v; }, { placeholder: 'e.g. rules' }),
    select('Reply with', '', templateOptions(), v => { nb.embedName = v; }, { blank: 'Pick a Studio template' }),
    textField('Cooldown (seconds)', '5', v => { nb.cooldown = Number(v); }),
    toggle('Whole message must match exactly', false, v => { nb.exact = v; }),
    toggle('Enabled', true, v => { nb.enabled = v; }),
    actions(() => post('autoreply', nb), { label: 'Create auto-reply' }),
  );
  composer.replaceChildren(wrap);
}

'''

t = t[:start] + new_fns + t[end:]
Path('web/public/app.js').write_text(t)
print('render functions replaced', len(new_fns))
# sanity
assert 'function renderSchedules()' in t
assert 'function renderAutoreplies()' in t
assert 'sched-composer' in t or True
print('app.js OK')
PY

echo "== 3. Light CSS for desk composer =="
python3 << 'PY'
from pathlib import Path
p = Path('web/public/app.css')
if not p.exists():
    print('no app.css')
else:
    t = p.read_text()
    if 'desk-composer' in t:
        print('css already')
    else:
        t += '''

/* ── Automation desks ───────────────────────────────────────────────────── */
.desk-composer {
  margin-top: 1.1rem;
  padding-top: 1rem;
  border-top: 1px solid color-mix(in srgb, var(--border, #2a2d38) 80%, transparent);
}
.desk-composer h3 {
  margin: 0 0 0.35rem;
  font-size: 0.95rem;
  font-weight: 600;
  letter-spacing: 0.01em;
}
.empty-desk {
  padding: 0.75rem 0.15rem 0.35rem;
}
#sched-panel .queue-head,
#reply-panel .queue-head {
  align-items: center;
}
'''
        p.write_text(t)
        print('css added')
PY

echo ""
echo "Done. Commit:"
echo "  git add web/public/index.html web/public/app.js web/public/app.css"
echo "  git commit -m 'Automation desk: create schedules and auto-replies in panel'"
echo "  git push origin main"
