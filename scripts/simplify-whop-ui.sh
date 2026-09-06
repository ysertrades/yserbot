#!/usr/bin/env bash
# 1) await saveSettings in writes.js
# 2) replace renderWhop with simpler UI (locked key, no URL/emoji, save on course toggle)
set -euo pipefail

echo "== Fix writes.js await =="
python3 << 'PY'
from pathlib import Path
p = Path("web/writes.js")
t = p.read_text()
old = "const r = whopPanel.saveSettings(guildId, body, ctx);"
new = "const r = await whopPanel.saveSettings(guildId, body, ctx);"
if old in t:
    p.write_text(t.replace(old, new, 1))
    print("writes.js: await added")
elif "await whopPanel.saveSettings" in t:
    print("writes.js: already awaits")
else:
    raise SystemExit("writes.js: could not find saveSettings call")
PY

echo "== Replace renderWhop in app.js =="
python3 << 'PY'
from pathlib import Path
import re
js = Path("web/public/app.js").read_text()

# Remove existing renderWhop function if present
js2 = re.sub(
    r"\nfunction renderWhop\(\) \{[\s\S]*?\n\}\n",
    "\n",
    js,
    count=1,
)

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
    pillEl.textContent = d.enabled ? "ON" : "OFF";
    pillEl.className = "pill " + (d.enabled ? "on" : "off");
  }

  const draft = {
    enabled: !!d.enabled,
    apiKey: "",
    unlockKey: false,
    channelId: d.channelId || null,
    mentionRoleId: d.mentionRoleId || null,
    pollMinutes: d.pollMinutes || 10,
    onlyVideos: d.onlyVideos !== false,
    maxPerCheck: d.maxPerCheck || 5,
    buttonLabel: d.buttonLabel || "open course",
    selectedCourseIds: (d.courses || []).filter(c => c.selected).map(c => c.id),
  };

  const children = [];
  children.push(toggle("Tracking on", draft.enabled, v => { draft.enabled = v; }));

  if (d.hasKey && !draft.unlockKey) {
    children.push(el("p", "hint", `API key locked · ${d.keyMask || "••••"}${d.companyId ? " · " + d.companyId : ""}`));
    const unlock = el("button", "btn small", "Change API key");
    unlock.type = "button";
    unlock.addEventListener("click", () => {
      draft.unlockKey = true;
      renderWhop();
    });
    const row = el("div", "actions");
    row.append(unlock);
    children.push(row);
  } else {
    children.push(textField("Whop API key", draft.apiKey, v => { draft.apiKey = v; }, { placeholder: "Company API key from Whop Developer" }));
    children.push(el("p", "hint", "Saved once and locked. Uses your company automatically for course scans."));
  }

  children.push(pickOne("Post channel", "channel", draft.channelId, v => { draft.channelId = v; }));
  children.push(pickOne("Ping role (optional)", "role", draft.mentionRoleId, v => { draft.mentionRoleId = v; }));
  children.push(textField("Check every (minutes)", String(draft.pollMinutes), v => { draft.pollMinutes = Number(v) || 10; }));
  children.push(toggle("Only video lessons", draft.onlyVideos, v => { draft.onlyVideos = v; }));
  children.push(textField("Button label", draft.buttonLabel, v => { draft.buttonLabel = v; }, { placeholder: "open course" }));
  children.push(el("p", "hint", "Link on each post opens your Whop automatically — no URL to paste."))

  if (d.lastError) children.push(el("p", "hint bad", "Last error: " + d.lastError));
  else if (d.lastScanAt) children.push(el("p", "hint", "Last scan: " + new Date(d.lastScanAt).toLocaleString()));

  children.push(actions(async () => {
    const body = {
      enabled: draft.enabled,
      channelId: draft.channelId,
      mentionRoleId: draft.mentionRoleId,
      pollMinutes: draft.pollMinutes,
      onlyVideos: draft.onlyVideos,
      maxPerCheck: draft.maxPerCheck,
      buttonLabel: draft.buttonLabel,
    };
    if (draft.apiKey.trim()) body.apiKey = draft.apiKey.trim();
    await post("whop", body);
  }));

  form.replaceChildren(...children);

  if (list) {
    const courses = d.courses || [];
    if (!courses.length) {
      list.replaceChildren(el("p", "muted", "No courses yet. Save API key, then Scan courses."));
    } else {
      const selected = new Set(draft.selectedCourseIds);
      const rows = courses.map(c => {
        const row = el("label", "toggle");
        const input = el("input");
        input.type = "checkbox";
        input.checked = selected.has(c.id);
        input.addEventListener("change", async () => {
          if (input.checked) selected.add(c.id);
          else selected.delete(c.id);
          input.disabled = true;
          try {
            await post("whop", { selectedCourseIds: [...selected] }, { quiet: true });
            toast(input.checked ? "Tracking " + (c.title || c.id) : "Stopped " + (c.title || c.id), "good");
          } finally {
            input.disabled = false;
          }
        });
        const title = el("span", null, c.title || c.id);
        const bits = [];
        if (c.lessonsCount != null) bits.push(c.lessonsCount + " lessons");
        if (c.tagline) bits.push(c.tagline);
        const meta = el("span", "hint", bits.join(" · "));
        const right = el("span");
        right.style.display = "flex";
        right.style.flexDirection = "column";
        right.append(title);
        if (meta.textContent) right.append(meta);
        row.append(right, input);
        return row;
      });
      list.replaceChildren(
        el("p", "hint", courses.length + " course(s) · tick to track — saves immediately"),
        ...rows,
      );
    }
  }

  const scanBtn = $("#whop-scan");
  if (scanBtn && !scanBtn.dataset.bound) {
    scanBtn.dataset.bound = "1";
    scanBtn.addEventListener("click", async () => {
      scanBtn.disabled = true;
      scanBtn.textContent = "Scanning…";
      try {
        const res = await post("whopscan", {});
        if (res && res.ok) toast("Found " + res.courses + " course(s).", "good");
      } finally {
        scanBtn.disabled = false;
        scanBtn.textContent = "Scan courses";
      }
    });
  }
}
'''

if "function renderFeedForms()" not in js2:
    raise SystemExit("renderFeedForms missing")
js2 = js2.replace("function renderFeedForms()", fn + "\nfunction renderFeedForms()", 1)

if "renderWhop();" not in js2:
    js2 = js2.replace("  renderFeedForms();\n", "  renderFeedForms();\n  renderWhop();\n", 1)

Path("web/public/app.js").write_text(js2)
assert "function renderWhop(" in Path("web/public/app.js").read_text()
print("app.js: simplified renderWhop OK")
PY

echo ""
echo "Done. Commit:"
echo "  git add -A && git commit -m 'Whop UX: locked key, auto links, fix scan' && git push"
