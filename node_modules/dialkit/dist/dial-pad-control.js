// src/dial-pad.ts
var PAD_GRID_DIVISIONS = 6;
function padGridIntersection(x, y, width, height) {
  if (width <= 0 || height <= 0) return void 0;
  const column = Math.round(x / width * PAD_GRID_DIVISIONS);
  const row = Math.round(y / height * PAD_GRID_DIVISIONS);
  if (column < 1 || column >= PAD_GRID_DIVISIONS || row < 1 || row >= PAD_GRID_DIVISIONS) return void 0;
  const target = { x: column / PAD_GRID_DIVISIONS * width, y: row / PAD_GRID_DIVISIONS * height };
  return Math.abs(x - target.x) <= 8 && Math.abs(y - target.y) <= 8 ? target : void 0;
}
function resolvePadAxis(config = [0, -1, 1, 0.01]) {
  const [initial, min, max, suppliedStep] = config;
  const step = suppliedStep ?? (max - min) / 200;
  if (![initial, min, max, step, max - min].every(Number.isFinite) || max <= min || step <= 0) {
    throw new RangeError("DialPad axes need finite [default, min, max, step?] values, min < max, and a positive step.");
  }
  const axis = { default: initial, min, max, step };
  axis.default = snapPadAxis(initial, axis);
  return axis;
}
function snapPadAxis(value, axis) {
  if (!Number.isFinite(value)) return axis.default;
  const clamped = Math.max(axis.min, Math.min(axis.max, value));
  if (clamped === axis.min || clamped === axis.max) return clamped;
  const snapped = axis.min + Math.round((clamped - axis.min) / axis.step) * axis.step;
  return Math.max(axis.min, Math.min(axis.max, Number(snapped.toPrecision(12))));
}
function normalizePadValue(value, config = {}) {
  const axes = { x: resolvePadAxis(config.x), y: resolvePadAxis(config.y) };
  const input = typeof value === "object" && value !== null ? value : {};
  return {
    x: typeof input.x === "number" ? snapPadAxis(input.x, axes.x) : axes.x.default,
    y: typeof input.y === "number" ? snapPadAxis(input.y, axes.y) : axes.y.default
  };
}
function padValueFromPoint(x, y, config = {}) {
  const horizontal = resolvePadAxis(config.x);
  const vertical = resolvePadAxis(config.y);
  return {
    x: snapPadAxis(horizontal.min + x * (horizontal.max - horizontal.min), horizontal),
    y: snapPadAxis(vertical.max - y * (vertical.max - vertical.min), vertical)
  };
}
function padValueFromKey(value, key, shift, config = {}) {
  const axis = key === "ArrowLeft" || key === "ArrowRight" ? "x" : key === "ArrowUp" || key === "ArrowDown" ? "y" : void 0;
  if (!axis) return void 0;
  const range = resolvePadAxis(config[axis]);
  const direction = key === "ArrowRight" || key === "ArrowUp" ? 1 : -1;
  return { ...value, [axis]: snapPadAxis(value[axis] + direction * range.step * (shift ? 10 : 1), range) };
}

// src/dial-pad-control.ts
var nextId = 0;
function element(tag, className, text) {
  const el = document.createElement(tag);
  el.className = className;
  if (text) el.textContent = text;
  return el;
}
function mountDialPad(host, initial) {
  let props = initial;
  let value = normalizePadValue(props.value, props);
  let drag;
  const root = element("div", "dialkit-pad");
  const fields = element("div", "dialkit-pad-fields");
  const caption = element("div", "dialkit-pad-caption");
  const label = element("span", "dialkit-pad-label");
  caption.append(label);
  fields.append(caption);
  const surface = element("div", "dialkit-pad-surface");
  surface.tabIndex = 0;
  surface.setAttribute("role", "group");
  const plane = element("div", "dialkit-pad-plane");
  plane.setAttribute("aria-hidden", "true");
  const grid = element("div", "dialkit-pad-grid");
  grid.setAttribute("aria-hidden", "true");
  for (let index = 1; index < PAD_GRID_DIVISIONS; index++) {
    const vertical = element("span", "dialkit-pad-grid-line dialkit-pad-grid-vertical");
    const horizontal = element("span", "dialkit-pad-grid-line dialkit-pad-grid-horizontal");
    vertical.style.left = `${index / PAD_GRID_DIVISIONS * 100}%`;
    horizontal.style.top = `${index / PAD_GRID_DIVISIONS * 100}%`;
    grid.append(vertical, horizontal);
  }
  const center = element("span", "dialkit-pad-center");
  const point = element("span", "dialkit-pad-point");
  plane.append(center, point);
  surface.append(grid, plane);
  const instructions = element("span", "dialkit-pad-instructions", "Arrow keys adjust each axis. Shift adjusts by ten steps. Home resets both axes. Hold Shift while dragging to lock an axis.");
  instructions.id = `dialkit-pad-help-${++nextId}`;
  surface.setAttribute("aria-describedby", instructions.id);
  const inputs = ["x", "y"].map((axis) => {
    const field = element("label", "dialkit-pad-field");
    const name = element("span", "dialkit-pad-axis");
    const input = element("input", "dialkit-pad-value");
    input.type = "text";
    input.inputMode = "decimal";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("role", "spinbutton");
    field.append(name, input);
    fields.append(field);
    input.addEventListener("focus", () => input.select());
    input.addEventListener("blur", () => {
      const number = input.value.trim() === "" ? NaN : Number(input.value);
      if (Number.isFinite(number)) commit({ ...value, [axis]: number });
      input.value = String(value[axis]);
    });
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter" || event.key === "Escape") {
        event.preventDefault();
        if (event.key === "Escape") input.value = String(value[axis]);
        input.blur();
        surface.focus({ preventScroll: true });
      } else if (!event.altKey && !event.metaKey && !event.ctrlKey && ["ArrowUp", "ArrowDown"].includes(event.key)) {
        event.preventDefault();
        const range = resolvePadAxis(props[axis]);
        const draft = input.value.trim() === "" ? NaN : Number(input.value);
        const current = Number.isFinite(draft) ? draft : value[axis];
        const direction = event.key === "ArrowUp" ? 1 : -1;
        commit({ ...value, [axis]: snapPadAxis(current + direction * range.step * (event.shiftKey ? 10 : 1), range) });
        input.value = String(value[axis]);
      }
    });
    return { axis, name, input };
  });
  root.append(fields, surface, instructions);
  host.append(root);
  function render() {
    label.textContent = props.label;
    label.title = props.label;
    const names = { x: props.labels?.x ?? "X", y: props.labels?.y ?? "Y" };
    surface.setAttribute("aria-label", `${props.label}: ${names.x} ${value.x}, ${names.y} ${value.y}`);
    inputs.forEach(({ axis, name, input }) => {
      const range = resolvePadAxis(props[axis]);
      name.textContent = names[axis];
      name.title = names[axis];
      input.setAttribute("aria-label", `${props.label} ${names[axis]}`);
      input.setAttribute("aria-valuemin", String(range.min));
      input.setAttribute("aria-valuemax", String(range.max));
      input.setAttribute("aria-valuenow", String(value[axis]));
      if (document.activeElement !== input) input.value = String(value[axis]);
      const fraction = (value[axis] - range.min) / (range.max - range.min);
      point.style[axis === "x" ? "left" : "top"] = `${(axis === "x" ? fraction : 1 - fraction) * 100}%`;
    });
  }
  function commit(next) {
    const normalized = normalizePadValue(next, props);
    if (normalized.x === value.x && normalized.y === value.y) return;
    value = normalized;
    render();
    props.onChange({ ...value });
  }
  function endDrag() {
    const id = drag?.id;
    drag = void 0;
    delete surface.dataset.dragging;
    if (id !== void 0 && surface.hasPointerCapture(id)) surface.releasePointerCapture(id);
  }
  function move(event, released = false) {
    if (!drag || event.pointerId !== drag.id) return;
    if (Math.max(Math.abs(event.clientX - drag.start.x), Math.abs(event.clientY - drag.start.y)) >= 3) {
      drag.moved = true;
      surface.dataset.dragging = "true";
    }
    const bounds = plane.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    let x = event.clientX - drag.offset.x;
    let y = event.clientY - drag.offset.y;
    if (released && !drag.moved && !event.shiftKey) {
      const gridBounds = grid.getBoundingClientRect();
      const intersection = padGridIntersection(event.clientX - gridBounds.left, event.clientY - gridBounds.top, gridBounds.width, gridBounds.height);
      if (intersection) {
        x = gridBounds.left + intersection.x;
        y = gridBounds.top + intersection.y;
      }
    }
    const next = padValueFromPoint(
      (x - bounds.left) / bounds.width,
      (y - bounds.top) / bounds.height,
      props
    );
    if (event.shiftKey) {
      if (!drag.lock) {
        const dx = Math.abs(event.clientX - drag.start.x);
        const dy = Math.abs(event.clientY - drag.start.y);
        if (Math.max(dx, dy) < 3) return;
        drag.lock = dx >= dy ? "x" : "y";
        drag.lockValue = { ...value };
      }
      const fixed = drag.lock === "x" ? "y" : "x";
      next[fixed] = drag.lockValue[fixed];
    } else {
      drag.lock = void 0;
      drag.lockValue = void 0;
    }
    commit(next);
  }
  surface.addEventListener("dblclick", () => commit(normalizePadValue(void 0, props)));
  surface.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || drag) return;
    event.preventDefault();
    surface.focus({ preventScroll: true });
    const bounds = point.getBoundingClientRect();
    const onPoint = event.target === point;
    drag = {
      id: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      value: { ...value },
      offset: onPoint ? { x: event.clientX - bounds.left - bounds.width / 2, y: event.clientY - bounds.top - bounds.height / 2 } : { x: 0, y: 0 },
      moved: false
    };
    surface.setPointerCapture(event.pointerId);
    move(event);
  });
  surface.addEventListener("pointermove", move);
  surface.addEventListener("pointerup", (event) => {
    if (event.pointerId !== drag?.id) return;
    move(event, true);
    endDrag();
  });
  surface.addEventListener("pointercancel", (event) => {
    if (event.pointerId === drag?.id) endDrag();
  });
  surface.addEventListener("lostpointercapture", (event) => {
    if (event.pointerId === drag?.id) endDrag();
  });
  surface.addEventListener("keydown", (event) => {
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    const next = padValueFromKey(value, event.key, event.shiftKey, props);
    if (next || event.key === "Home" || event.key === "Escape" && drag) {
      event.preventDefault();
      event.stopPropagation();
      if (next) commit(next);
      else if (event.key === "Home") {
        endDrag();
        commit(normalizePadValue(void 0, props));
      } else if (drag) {
        const start = drag.value;
        endDrag();
        commit(start);
      }
    }
  });
  render();
  return {
    update(next) {
      props = next;
      value = normalizePadValue(next.value, props);
      render();
    },
    destroy() {
      endDrag();
      root.remove();
    }
  };
}
export {
  mountDialPad
};
//# sourceMappingURL=dial-pad-control.js.map