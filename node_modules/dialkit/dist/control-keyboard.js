// src/control-keyboard.ts
function sliderKeyValue(key, value, min, max, step, shift = false) {
  if (key === "Home") return min;
  if (key === "End") return max;
  const direction = ["ArrowRight", "ArrowUp", "PageUp"].includes(key) ? 1 : ["ArrowLeft", "ArrowDown", "PageDown"].includes(key) ? -1 : 0;
  if (!direction) return void 0;
  if (!(step > 0) || max <= min) return min;
  const amount = key.startsWith("Page") || shift ? 10 : 1;
  const position = (value - min) / step;
  const nextStep = direction > 0 ? Math.floor(position + 1e-9) + amount : Math.ceil(position - 1e-9) - amount;
  const next = min + nextStep * step;
  return Math.max(min, Math.min(max, Number(next.toPrecision(14))));
}
function handleSliderKey(event, value, min, max, step, change, edit) {
  if (event.target !== event.currentTarget || event.altKey || event.metaKey || event.ctrlKey) return;
  const next = sliderKeyValue(event.key, value, min, max, step, event.shiftKey);
  if (next === void 0 && event.key !== "Enter") return;
  event.preventDefault();
  event.stopPropagation();
  if (next === void 0) edit();
  else change(next);
}
function activateOnKey(event, activate) {
  if (event.target !== event.currentTarget || !["Enter", " "].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  activate();
}
function optionKeyIndex(key, index, count, wrap = false) {
  if (!count) return void 0;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  const delta = ["ArrowRight", "ArrowDown"].includes(key) ? 1 : ["ArrowLeft", "ArrowUp"].includes(key) ? -1 : 0;
  if (!delta) return void 0;
  return wrap ? (index + delta + count) % count : Math.max(0, Math.min(count - 1, index + delta));
}
function handleSegmentKey(event) {
  if (event.altKey || event.metaKey || event.ctrlKey) return;
  const group = event.currentTarget;
  const buttons = Array.from(group.querySelectorAll(".dialkit-segmented-button:not(:disabled)"));
  const next = optionKeyIndex(event.key, buttons.indexOf(event.target), buttons.length, true);
  if (next === void 0) return;
  event.preventDefault();
  event.stopPropagation();
  buttons[next].focus({ preventScroll: true });
  buttons[next].click();
}
var labelId = 0;
function labelSegmentedControl(group) {
  if (group.hasAttribute("aria-label") || group.hasAttribute("aria-labelledby")) return;
  const label = group.closest(".dialkit-labeled-control")?.querySelector(".dialkit-labeled-control-label");
  if (!label) {
    group.setAttribute("aria-label", "Options");
    return;
  }
  label.id || (label.id = `dialkit-segment-label-${++labelId}`);
  group.setAttribute("aria-labelledby", label.id);
}
function openDropdownOnKey(event, open) {
  if (!["ArrowDown", "ArrowUp"].includes(event.key) || event.altKey || event.metaKey || event.ctrlKey) return;
  event.preventDefault();
  event.stopPropagation();
  open();
}
function adjacentTabStop(trigger, backwards = false) {
  const candidates = Array.from(trigger.ownerDocument.querySelectorAll('a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]'));
  const stops = candidates.filter((el) => el === trigger || el.tabIndex >= 0 && !el.matches(":disabled") && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden" && !el.closest('[inert], [aria-hidden="true"], .dialkit-select-dropdown, .dialkit-preset-dropdown, .dialkit-shortcuts-dropdown, .dialkit-color-popover'));
  const index = stops.indexOf(trigger);
  return index < 0 ? void 0 : stops[index + (backwards ? -1 : 1)];
}
export {
  activateOnKey,
  adjacentTabStop,
  handleSegmentKey,
  handleSliderKey,
  labelSegmentedControl,
  openDropdownOnKey,
  optionKeyIndex,
  sliderKeyValue
};
//# sourceMappingURL=control-keyboard.js.map