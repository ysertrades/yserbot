#!/usr/bin/env bash
# Replaces renderWhop() so scanned courses and tracking log actually show.
set -euo pipefail

python3 << 'PY'
from pathlib import Path
import re

path = Path('web/public/app.js')
js = path.read_text()

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

  const log = Array.isArray(d.log) ? d.log : [];
  const catalog = Array.isArray(d.catalog) ? d.catalog : [];

  if (pillEl) {
    pillEl.textContent = d.enabled
      ? (log.length ? (log.length + " tracked") : "ON")
      : "OFF";
    pillEl.className = "pill " + (d.enabled && log.length ? "on" : "off");
  }

  const draft = {
    enabled: !!d.enabled,
    apiKey: "",
    unlockKey: false,
    companyId: d.companyId || "",
    pollMinutes: d.pollMinutes || 10,
    onlyVideos: d.onlyVideos !== false,
    buttonLabel: d.buttonLabel || "open course",
  };

  const children = [];
  children.push(toggle("Tracking on", draft.enabled, v => { draft.enabled = v; }));

  if (d.hasKey && !draft.unlockKey) {
    children.push(el("p", "hint", "API key locked · " + (d.keyMask || "••••")));
    const unlock = el("button", "btn small", "Change API key");
    unlock.type = "button";
    unlock.addEventListener("click", () => { draft.unlockKey = true; renderWhop(); });
    const row = el("div", "actions");
    row.append(unlock);
    children.push(row);
  } else {
    children.push(textField("Whop API key", draft.apiKey, v => { draft.apiKey = v; }, { placeholder: "Company / Account API key" }));
    children.push(el("p", "hint", "Saved once and locked."));
  }

  children.push(textField("Company ID", draft.companyId, v => { draft.companyId = v; }, { placeholder: "biz_…" }));
  children.push(el("p", "hint", "Required. Example: biz_61…"));
  children.push(textField("Check every (minutes)", String(draft.pollMinutes), v => { draft.pollMinutes = Number(v) || 10; }));
  children.push(toggle("Only video lessons", draft.onlyVideos, v => { draft.onlyVideos = v; }));
  children.push(textField("Button label", draft.buttonLabel, v => { draft.buttonLabel = v; }, { placeholder: "open course" }));
  children.push(el("p", "hint", "Link on each post opens your Whop automatically."));

  if (d.lastError) children.push(el("p", "hint bad", String(d.lastError)));
  else if (d.lastScanAt) children.push(el("p", "hint", "Last scan · " + new Date(d.lastScanAt).toLocaleString()));

  children.push(actions(async () => {
    const body = {
      enabled: draft.enabled,
      companyId: draft.companyId || null,
      pollMinutes: draft.pollMinutes,
      onlyVideos: draft.onlyVideos,
      buttonLabel: draft.buttonLabel,
    };
    if (draft.apiKey.trim()) body.apiKey = draft.apiKey.trim();
    await post("whop", body);
  }));

  form.replaceChildren(...children);

  if (!list) return;
  const blocks = [];

  /* ---- Tracking log ---- */
  blocks.push(el("h3", null, "Tracking log"));
  if (!log.length) {
    blocks.push(el("p", "muted", "Empty. Add a course from the library below (course + channel)."))
  } else {
    for (const e of log) {
      const card = el("div", "panel");
      card.style.cssText = "padding:0.75rem 1rem;margin:0.5rem 0;";
      const head = el("div", "queue-head");
      head.append(el("strong", null, e.title || e.id));
      head.append(el("span", "hint", e.channel ? ("#" + e.channel) : "no channel"));
      card.append(head);
      card.append(el("p", "hint",
        (e.knownCount || 0) + " lessons remembered"
        + (e.baselined ? " · baselined" : " · not baselined yet")
        + (e.addedAt ? (" · " + new Date(e.addedAt).toLocaleDateString()) : "")
      ));

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

  /* ---- Course library from scan ---- */
  blocks.push(el("h3", null, "Course library"));
  if (!catalog.length) {
    blocks.push(el("p", "muted", "No library yet. Save API key + Company ID, then press Scan courses."));
  } else {
    const available = catalog.filter(c => !c.inLog);
    blocks.push(el("p", "hint", catalog.length + " course(s) scanned · " + available.length + " available to add"));

    if (!available.length) {
      blocks.push(el("p", "muted", "Every scanned course is already in the tracking log."));
    } else {
      let pickId = null;
      let pickCh = null;
      let pickRole = null;

      const options = available.map(c => ({
        value: c.id,
        label: (c.title || c.id) + (c.lessonsCount != null ? (" · " + c.lessonsCount + " lessons") : ""),
      }));

      blocks.push(select("Course", "", options, v => { pickId = v || null; }, { blank: "Choose a course…" }));
      blocks.push(pickOne("Channel for this course", "channel", null, v => { pickCh = v; }));
      blocks.push(pickOne("Ping role (optional)", "role", null, v => { pickRole = v; }));

      const addRow = el("div", "actions");
      const addBtn = el("button", "btn primary small", "Add to tracking log");
      addBtn.type = "button";
      addBtn.addEventListener("click", async () => {
        if (!pickId) { toast("Choose a course.", "bad"); return; }
        if (!pickCh) { toast("Choose a channel for this course.", "bad"); return; }
        addBtn.disabled = true;
        try {
          await post("whop", {
            op: "add",
            courseId: pickId,
            channelId: pickCh,
            mentionRoleId: pickRole,
          });
          toast("Added to tracking log.", "good");
        } finally { addBtn.disabled = false; }
      });
      addRow.append(addBtn);
      blocks.push(addRow);

      // Also list names so user can see what was found
      const ul = el("div", "items");
      for (const c of catalog) {
        const line = el("p", "hint",
          (c.inLog ? "✓ " : "· ") + (c.title || c.id)
          + (c.lessonsCount != null ? (" · " + c.lessonsCount + " lessons") : "")
          + (c.inLog ? " (in log)" : "")
        );
        ul.append(line);
      }
      blocks.push(ul);
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
        if (res && res.ok) {
          toast("Library updated · " + res.courses + " course(s).", "good");
        }
      } finally {
        scanBtn.disabled = false;
        scanBtn.textContent = "Scan courses";
      }
    });
  }
}
'''

# Replace existing renderWhop
pat = re.compile(r'\nfunction renderWhop\(\) \{[\s\S]*?\n\}\n(?=\nfunction )')
if not pat.search(js):
    raise SystemExit('renderWhop function not found')
js2, n = pat.subn('\n' + fn + '\n', js, count=1)
if n != 1:
    raise SystemExit('replace count ' + str(n))

if 'renderWhop();' not in js2:
    js2 = js2.replace('  renderFeedForms();\n', '  renderFeedForms();\n  renderWhop();\n', 1)

path.write_text(js2)
text = path.read_text()
assert 'Course library' in text
assert 'Tracking log' in text
assert 'd.catalog' in text or 'catalog' in text
assert 'Whop route' not in text
print('renderWhop fixed OK')
PY

echo "Done. Commit and push, hard-refresh the panel (Ctrl+Shift+R)."
