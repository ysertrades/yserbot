#!/usr/bin/env bash
# Rewrites renderWhop() for tracking-log UX.
set -euo pipefail

python3 << 'PY'
from pathlib import Path
import re

path = Path('web/public/app.js')
js = path.read_text()

# Strip any existing renderWhop
js = re.sub(r'\nfunction renderWhop\(\) \{[\s\S]*?\n\}\n', '\n', js, count=1)

fn = r'''
function renderWhop() {
  const d = state.overview?.whop;
  const form = $("#form-whop");
  const list = $("#whop-courses");
  const pillEl = $("#whop-state");
  if (!form) return;
  if (!d) {
    form.replaceChildren(el("p", "muted", "Whop data not loaded yet."));
    return;
  }

  if (pillEl) {
    pillEl.textContent = d.enabled ? (d.log?.length ? d.log.length + " LIVE" : "ON") : "OFF";
    pillEl.className = "pill " + (d.enabled && d.log?.length ? "on" : "off");
  }

  const draft = {
    enabled: !!d.enabled,
    apiKey: "",
    unlockKey: false,
    companyId: d.companyId || "",
    companyRoute: d.companyRoute || "",
    pollMinutes: d.pollMinutes || 10,
    onlyVideos: d.onlyVideos !== false,
    buttonLabel: d.buttonLabel || "open course",
    addCourseId: null,
    addChannelId: null,
    addRoleId: null,
  };

  const children = [];
  children.push(toggle("Tracking on", draft.enabled, v => { draft.enabled = v; }));

  /* credentials — locked when set */
  if (d.hasKey && !draft.unlockKey) {
    children.push(el("p", "hint", `API key locked · ${d.keyMask || "••••"}`));
    const unlock = el("button", "btn small", "Change API key");
    unlock.type = "button";
    unlock.addEventListener("click", () => { draft.unlockKey = true; renderWhop(); });
    const row = el("div", "actions");
    row.append(unlock);
    children.push(row);
  } else {
    children.push(textField("Whop API key", draft.apiKey, v => { draft.apiKey = v; }, { placeholder: "Company / Account API key" }));
  }

  children.push(textField("Company ID", draft.companyId, v => { draft.companyId = v; }, { placeholder: "biz_…" }));
  children.push(el("p", "hint", "Required. From Whop Developer dashboard or /accounts/me."))
  children.push(textField("Whop page slug (optional)", draft.companyRoute, v => { draft.companyRoute = v; }, { placeholder: "your-slug" }));
  children.push(textField("Check every (minutes)", String(draft.pollMinutes), v => { draft.pollMinutes = Number(v) || 10; }));
  children.push(toggle("Only video lessons", draft.onlyVideos, v => { draft.onlyVideos = v; }));
  children.push(textField("Button label", draft.buttonLabel, v => { draft.buttonLabel = v; }, { placeholder: "open course" }));
  children.push(el("p", "hint", "Each post gets a link to your Whop automatically."))

  if (d.lastError) children.push(el("p", "hint bad", d.lastError));
  else if (d.lastScanAt) children.push(el("p", "hint", "Last scan · " + new Date(d.lastScanAt).toLocaleString()));

  children.push(actions(async () => {
    const body = {
      enabled: draft.enabled,
      companyId: draft.companyId || null,
      companyRoute: draft.companyRoute || null,
      pollMinutes: draft.pollMinutes,
      onlyVideos: draft.onlyVideos,
      buttonLabel: draft.buttonLabel,
    };
    if (draft.apiKey.trim()) body.apiKey = draft.apiKey.trim();
    await post("whop", body);
  }));

  form.replaceChildren(...children);

  /* ---- catalog + tracking log ---- */
  if (!list) return;

  const blocks = [];

  // Tracking log (saved courses)
  blocks.push(el("h3", null, "Tracking log"));
  const log = d.log || [];
  if (!log.length) {
    blocks.push(el("p", "muted", "Nothing tracked yet. Scan, then Add a course with its channel."))
  } else {
    for (const e of log) {
      const card = el("div", "panel");
      card.style.padding = "0.75rem 1rem";
      card.style.marginBottom = "0.5rem";
      const head = el("div", "queue-head");
      head.append(el("strong", null, e.title || e.id));
      head.append(el("span", "hint", e.channel ? "#" + e.channel : "no channel"));
      card.append(head);
      card.append(el("p", "hint", (e.knownCount || 0) + " lessons baselined · added " + (e.addedAt ? new Date(e.addedAt).toLocaleDateString() : "—")));

      let ch = e.channelId || null;
      let role = e.mentionRoleId || null;
      card.append(pickOne("Channel", "channel", ch, v => { ch = v; }));
      card.append(pickOne("Ping role", "role", role, v => { role = v; }));

      const acts = el("div", "actions");
      const save = el("button", "btn small primary", "Save");
      save.type = "button";
      save.addEventListener("click", async () => {
        save.disabled = true;
        try {
          await post("whop", { op: "update", courseId: e.id, channelId: ch, mentionRoleId: role });
        } finally { save.disabled = false; }
      });
      const remove = el("button", "btn small", "Remove");
      remove.type = "button";
      remove.addEventListener("click", async () => {
        remove.disabled = true;
        try {
          await post("whop", { op: "remove", courseId: e.id });
          toast("Removed from log.", "good");
        } finally { remove.disabled = false; }
      });
      acts.append(save, remove);
      card.append(acts);
      blocks.push(card);
    }
  }

  // Catalog to add from
  blocks.push(el("h3", null, "Course library"));
  const catalog = d.catalog || [];
  if (!catalog.length) {
    blocks.push(el("p", "muted", "Press Scan courses after saving API key + Company ID."));
  } else {
    blocks.push(el("p", "hint", catalog.length + " course(s) · pick one, set channel, Add to log"));

    let pickId = null;
    let pickCh = null;
    let pickRole = null;

    const options = catalog.filter(c => !c.inLog).map(c => ({
      value: c.id,
      label: c.title + (c.lessonsCount != null ? ` (${c.lessonsCount})` : ""),
    }));

    if (!options.length) {
      blocks.push(el("p", "muted", "Every scanned course is already in the log."));
    } else {
      blocks.push(select("Course to add", "", options, v => { pickId = v || null; }, { blank: "Choose a course…" }));
      blocks.push(pickOne("Post channel for this course", "channel", null, v => { pickCh = v; }));
      blocks.push(pickOne("Ping role (optional)", "role", null, v => { pickRole = v; }));

      const addRow = el("div", "actions");
      const addBtn = el("button", "btn primary small", "Add to tracking log");
      addBtn.type = "button";
      addBtn.addEventListener("click", async () => {
        if (!pickId) { toast("Choose a course first.", "bad"); return; }
        if (!pickCh) { toast("Choose a channel for this course.", "bad"); return; }
        addBtn.disabled = true;
        try {
          await post("whop", { op: "add", courseId: pickId, channelId: pickCh, mentionRoleId: pickRole });
          toast("Added to tracking log.", "good");
        } finally { addBtn.disabled = false; }
      });
      addRow.append(addBtn);
      blocks.push(addRow);
    }
  }

  list.replaceChildren(...blocks);

  const scanBtn = $("#whop-scan");
  if (scanBtn && !scanBtn.dataset.bound) {
    scanBtn.dataset.bound = "1";
    scanBtn.addEventListener("click", async () => {
      scanBtn.disabled = true;
      scanBtn.textContent = "Scanning…";
      try {
        const res = await post("whopscan", {});
        if (res && res.ok) toast("Library: " + res.courses + " course(s).", "good");
      } finally {
        scanBtn.disabled = false;
        scanBtn.textContent = "Scan courses";
      }
    });
  }
}
'''

if 'function renderFeedForms()' not in js:
    raise SystemExit('renderFeedForms missing')
js = js.replace('function renderFeedForms()', fn + '\nfunction renderFeedForms()', 1)

if 'renderWhop();' not in js:
    js = js.replace('  renderFeedForms();\n', '  renderFeedForms();\n  renderWhop();\n', 1)

path.write_text(js)
assert 'function renderWhop(' in path.read_text()
assert 'Tracking log' in path.read_text()
print('renderWhop log UI OK')

# await writes
w = Path('web/writes.js').read_text()
if 'await whopPanel.saveSettings' not in w:
    w = w.replace('const r = whopPanel.saveSettings(guildId, body, ctx);',
                  'const r = await whopPanel.saveSettings(guildId, body, ctx);', 1)
    Path('web/writes.js').write_text(w)
    print('writes await OK')
else:
    print('writes already awaits')
PY

echo "Done — commit and push, then restart."
