// src/control-keyboard.ts
function adjacentTabStop(trigger, backwards = false) {
  const candidates = Array.from(trigger.ownerDocument.querySelectorAll('a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]'));
  const stops = candidates.filter((el) => el === trigger || el.tabIndex >= 0 && !el.matches(":disabled") && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden" && !el.closest('[inert], [aria-hidden="true"], .dialkit-select-dropdown, .dialkit-preset-dropdown, .dialkit-shortcuts-dropdown, .dialkit-color-popover'));
  const index = stops.indexOf(trigger);
  return index < 0 ? void 0 : stops[index + (backwards ? -1 : 1)];
}

// src/dropdown-position.ts
function getDropdownPosition(trigger, portalRoot, options = {}) {
  const { dropdownHeight = 0, gap = 4, allowAbove = true } = options;
  const triggerRect = trigger.getBoundingClientRect();
  const rootRect = portalRoot.getBoundingClientRect();
  const viewport = window.visualViewport;
  const viewportTop = viewport?.offsetTop ?? 0;
  const viewportLeft = viewport?.offsetLeft ?? 0;
  const viewportHeight = viewport?.height ?? window.innerHeight;
  const viewportWidth = viewport?.width ?? window.innerWidth;
  const margin = 8;
  const spaceBelow = Math.max(0, viewportTop + viewportHeight - triggerRect.bottom - gap - margin);
  const spaceAbove = Math.max(0, triggerRect.top - viewportTop - gap - margin);
  const above = allowAbove && spaceBelow < dropdownHeight && spaceAbove > spaceBelow;
  let maxHeight = Math.min(options.maxHeight ?? 320, above ? spaceAbove : spaceBelow);
  const height = Math.min(dropdownHeight, maxHeight);
  const width = Math.min(options.width ?? triggerRect.width, Math.max(0, viewportWidth - margin * 2));
  let left = Math.max(viewportLeft + margin, Math.min(triggerRect.left, viewportLeft + viewportWidth - width - margin));
  let top = Math.max(viewportTop + margin, above ? triggerRect.top - height - gap : triggerRect.bottom + gap);
  if (options.preferSide) {
    const sideRect = trigger.closest(".dialkit-panel-inner")?.getBoundingClientRect() ?? triggerRect;
    const before = sideRect.left - width - gap;
    const after = sideRect.right + gap;
    if (before >= viewportLeft + margin) left = before;
    else if (after + width <= viewportLeft + viewportWidth - margin) left = after;
    maxHeight = Math.min(options.maxHeight ?? 480, viewportHeight - margin * 2);
    top = Math.max(viewportTop + margin, Math.min(triggerRect.top - 32, viewportTop + viewportHeight - Math.min(dropdownHeight, maxHeight) - margin));
  }
  return {
    top: options.fixed ? top : top - rootRect.top + portalRoot.scrollTop - portalRoot.clientTop,
    left: options.fixed ? left : left - rootRect.left + portalRoot.scrollLeft - portalRoot.clientLeft,
    width,
    above,
    maxHeight
  };
}
function observeDropdownPosition(trigger, update, popup) {
  let frame = 0;
  let disposed = false;
  let previous = "";
  const tick = () => {
    if (disposed) return;
    const floating = popup?.();
    if (floating?.isConnected && floating.style.position === "fixed" && typeof floating.showPopover === "function" && !floating.matches(":popover-open")) {
      floating.setAttribute("popover", "manual");
      floating.showPopover();
    }
    const rect = trigger.getBoundingClientRect();
    const root = getDialKitPortalRoot(trigger)?.getBoundingClientRect();
    const viewport = window.visualViewport;
    const next = [
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      root?.x,
      root?.y,
      popup?.()?.scrollHeight,
      window.innerWidth,
      window.innerHeight,
      viewport?.height,
      viewport?.offsetTop,
      viewport?.offsetLeft
    ].join(",");
    if (next !== previous) {
      previous = next;
      update();
    }
    if (!disposed) frame = requestAnimationFrame(tick);
  };
  tick();
  window.addEventListener("scroll", update, true);
  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    window.removeEventListener("scroll", update, true);
  };
}
function getDialKitPortalRoot(trigger) {
  return trigger?.closest(".dialkit-root") ?? null;
}

// src/image-control.ts
var imageControlId = 0;
var MAX_FILE_SIZE = 10 * 1024 * 1024;
function element(tag, className, text) {
  const el = document.createElement(tag);
  el.className = className;
  if (text) el.textContent = text;
  if (tag === "button") el.type = "button";
  return el;
}
function icon(kind) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(svg.namespaceURI, "path");
  path.setAttribute("d", kind === "upload" ? "M12 16V3m-4 4 4-4 4 4M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" : "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm-2 13 5-5 4 4 3-3 6 6M15 7h.01");
  svg.append(path);
  return svg;
}
function imageLabel(value) {
  if (!value) return "No image";
  if (value.startsWith("data:") || value.startsWith("blob:")) return "Uploaded image";
  const name = value.split(/[?#]/)[0].split("/").filter(Boolean).pop();
  try {
    return name ? decodeURIComponent(name) : "Image";
  } catch {
    return name || "Image";
  }
}
function imageOptions(options = [], uploaded = [], value = "") {
  const unique = /* @__PURE__ */ new Map();
  for (const option of [...options, ...uploaded]) {
    const item = typeof option === "string" ? { value: option, label: imageLabel(option) } : option;
    if (item.value && !unique.has(item.value)) unique.set(item.value, item);
  }
  if (value && !unique.has(value)) unique.set(value, { value, label: imageLabel(value) });
  return [...unique.values()];
}
function preview(className) {
  const frame = element("span", `dialkit-image-frame ${className}`);
  const fallback = element("span", "dialkit-image-fallback");
  fallback.append(icon("image"));
  const img = element("img", "dialkit-image-img");
  img.alt = "";
  img.draggable = false;
  img.decoding = "async";
  img.hidden = true;
  frame.append(fallback, img);
  let current;
  img.addEventListener("load", () => {
    img.hidden = false;
    fallback.hidden = true;
    frame.removeAttribute("title");
  });
  img.addEventListener("error", () => {
    img.hidden = true;
    fallback.hidden = false;
    frame.title = "Image unavailable";
  });
  return {
    frame,
    update(value) {
      if (value === current) return;
      current = value;
      img.hidden = true;
      fallback.hidden = false;
      frame.removeAttribute("title");
      if (value) img.src = value;
      else img.removeAttribute("src");
    }
  };
}
function mountImageControl(host, initial, presentation = "popover") {
  const inline = presentation === "inline";
  let props = initial;
  const uploaded = [];
  let popup;
  let stopPosition;
  let updatePicker = () => {
  };
  let resetUpload = () => {
  };
  let reader;
  let uploadRequest = 0;
  const popupId = `dialkit-image-picker-${++imageControlId}`;
  const trigger = element("button", "dialkit-image-control");
  const label = element("span", "dialkit-image-label");
  const name = element("span", "dialkit-image-value");
  const thumbnail = preview("dialkit-image-thumbnail");
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-expanded", "false");
  trigger.append(label, name, thumbnail.frame);
  const fileInput = element("input", "dialkit-image-file");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.hidden = true;
  host.append(trigger, fileInput);
  if (inline) trigger.style.display = "none";
  const choices = () => imageOptions(props.options, uploaded, props.value);
  const render = () => {
    label.textContent = props.label;
    name.textContent = choices().find((item) => item.value === props.value)?.label ?? "No image";
    trigger.setAttribute("aria-label", `Choose ${props.label.toLowerCase()} image: ${name.textContent}`);
    thumbnail.update(props.value);
    updatePicker();
  };
  const commit = (value) => {
    props = { ...props, value };
    render();
    props.onChange(value);
  };
  const close = (restoreFocus = false) => {
    uploadRequest++;
    reader?.abort();
    reader = void 0;
    fileInput.onchange = null;
    stopPosition?.();
    stopPosition = void 0;
    popup?.remove();
    popup = void 0;
    updatePicker = () => {
    };
    resetUpload = () => {
    };
    delete trigger.dataset.open;
    trigger.setAttribute("aria-expanded", "false");
    trigger.removeAttribute("aria-controls");
    document.removeEventListener("pointerdown", outside);
    document.removeEventListener("focusin", focusOutside);
    if (restoreFocus) trigger.focus({ preventScroll: true });
  };
  const outside = (event) => {
    if (!popup?.contains(event.target) && !host.contains(event.target)) close();
  };
  const focusOutside = (event) => {
    if (!popup?.contains(event.target) && !host.contains(event.target)) close();
  };
  const open = () => {
    if (popup) {
      if (!inline) close();
      return;
    }
    const root = inline ? host : getDialKitPortalRoot(host) ?? host;
    popup = element("div", "dialkit-image-popover");
    popup.dataset.presentation = presentation;
    popup.style.position = inline ? "static" : "fixed";
    popup.id = popupId;
    popup.setAttribute("role", inline ? "group" : "dialog");
    const heading = element("div", "dialkit-image-heading");
    const title = element("span", "dialkit-image-title");
    const clear = element("button", "dialkit-image-clear", "Remove");
    clear.addEventListener("click", () => {
      commit("");
      if (!inline) close(true);
    });
    heading.append(title, clear);
    const grid = element("div", "dialkit-image-grid");
    grid.setAttribute("role", "group");
    grid.setAttribute("aria-label", "Available images");
    const empty = element("div", "dialkit-image-empty", "Choose an image to get started.");
    const upload = element("button", "dialkit-button dialkit-image-upload");
    const uploadText = element("span", "", "Upload image");
    upload.append(icon("upload"), uploadText);
    const status = element("div", "dialkit-image-status");
    status.setAttribute("role", "status");
    status.hidden = true;
    upload.addEventListener("click", () => {
      if (!busy) fileInput.click();
    });
    let buttons = [];
    let previousItems = [];
    let busy = false;
    const setBusy = (next) => {
      busy = next;
      upload.setAttribute("aria-disabled", String(next));
      uploadText.textContent = next ? "Loading image\u2026" : "Upload image";
      grid.setAttribute("aria-busy", String(next));
    };
    resetUpload = () => {
      uploadRequest++;
      reader?.abort();
      reader = void 0;
      setBusy(false);
      status.hidden = true;
    };
    const acceptFile = (file) => {
      if (busy) return;
      status.hidden = true;
      if (!file.type.startsWith("image/") || file.size > MAX_FILE_SIZE) {
        status.textContent = file.size > MAX_FILE_SIZE ? "Choose an image smaller than 10 MB." : "Choose an image file, such as PNG, JPG, WebP, GIF, or SVG.";
        status.hidden = false;
        return;
      }
      const request = ++uploadRequest;
      setBusy(true);
      const fail = () => {
        if (request !== uploadRequest) return;
        setBusy(false);
        status.textContent = "This image could not be opened. Try another file.";
        status.hidden = false;
      };
      reader = new FileReader();
      reader.addEventListener("error", fail);
      reader.addEventListener("load", () => {
        if (request !== uploadRequest) return;
        const value = reader?.result;
        reader = void 0;
        if (typeof value !== "string") {
          fail();
          return;
        }
        const check = new Image();
        check.onerror = fail;
        check.onload = () => {
          if (request !== uploadRequest) return;
          setBusy(false);
          if (!uploaded.some((item) => item.value === value)) uploaded.push({ value, label: file.name });
          commit(value);
          buttons.find((button) => button.getAttribute("aria-pressed") === "true")?.focus({ preventScroll: true });
        };
        check.src = value;
      });
      reader.readAsDataURL(file);
    };
    fileInput.onchange = () => {
      const file = fileInput.files?.[0];
      fileInput.value = "";
      if (file) acceptFile(file);
    };
    popup.addEventListener("dragover", (event) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      popup.dataset.dragging = "true";
    });
    popup.addEventListener("dragleave", (event) => {
      if (!popup?.contains(event.relatedTarget)) delete popup.dataset.dragging;
    });
    popup.addEventListener("drop", (event) => {
      event.preventDefault();
      delete popup.dataset.dragging;
      const file = event.dataTransfer?.files[0];
      if (file) acceptFile(file);
    });
    grid.addEventListener("keydown", (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const index = buttons.indexOf(document.activeElement);
      if (index < 0) return;
      const columns = getComputedStyle(grid).gridTemplateColumns.split(" ").length;
      const next = event.key === "ArrowRight" ? index + 1 : event.key === "ArrowLeft" ? index - 1 : event.key === "ArrowDown" ? index + columns : event.key === "ArrowUp" ? index - columns : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : void 0;
      if (next === void 0) return;
      event.preventDefault();
      const button = buttons[Math.max(0, Math.min(buttons.length - 1, next))];
      buttons.forEach((item) => {
        item.tabIndex = item === button ? 0 : -1;
      });
      button.focus({ preventScroll: true });
      button.scrollIntoView({ block: "nearest" });
    });
    popup.addEventListener("keydown", (event) => {
      if (inline) return;
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        close(true);
      }
      if (event.key === "Tab") {
        const first = clear.hidden ? buttons.find((button) => button.tabIndex === 0) ?? upload : clear;
        if (event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === upload) {
          const next = adjacentTabStop(trigger, event.shiftKey);
          close(true);
          if (next) {
            event.preventDefault();
            next.focus();
          }
        }
      }
    });
    updatePicker = () => {
      popup?.setAttribute("aria-label", `${props.label} image picker`);
      title.textContent = props.label;
      clear.hidden = !props.value;
      clear.setAttribute("aria-label", `Remove ${props.label.toLowerCase()} image`);
      const items = choices();
      empty.hidden = items.length > 0;
      grid.hidden = items.length === 0;
      if (items.length !== previousItems.length || items.some((item, i) => item.value !== previousItems[i].value || item.label !== previousItems[i].label)) {
        const focusedIndex = buttons.indexOf(document.activeElement);
        previousItems = items;
        buttons = items.map((item) => {
          const button = element("button", "dialkit-image-option");
          button.setAttribute("aria-label", item.label);
          button.title = item.label;
          const thumb = preview("dialkit-image-option-preview");
          thumb.update(item.value);
          button.append(thumb.frame);
          button.addEventListener("click", () => {
            resetUpload();
            commit(item.value);
          });
          return button;
        });
        grid.replaceChildren(...buttons);
        if (focusedIndex >= 0) buttons[Math.min(focusedIndex, buttons.length - 1)]?.focus({ preventScroll: true });
      }
      const selected = items.findIndex((item) => item.value === props.value);
      buttons.forEach((button, index) => {
        button.setAttribute("aria-pressed", String(index === selected));
        button.tabIndex = index === Math.max(0, selected) ? 0 : -1;
      });
    };
    popup.append(heading, grid, empty, upload, status);
    root.append(popup);
    render();
    const position = () => {
      if (!popup) return;
      if (!host.isConnected || trigger.getClientRects().length === 0) {
        close();
        return;
      }
      const p = getDropdownPosition(trigger, root, { dropdownHeight: popup.scrollHeight + 2, width: 320, maxHeight: 560, preferSide: true, fixed: true, gap: 8 });
      Object.assign(popup.style, { left: `${p.left}px`, top: `${p.top}px`, width: `${p.width}px`, maxHeight: `${p.maxHeight}px`, transformOrigin: p.above ? "bottom" : "top" });
    };
    if (inline) return;
    stopPosition = observeDropdownPosition(trigger, position, () => popup);
    trigger.dataset.open = "true";
    trigger.setAttribute("aria-expanded", "true");
    trigger.setAttribute("aria-controls", popupId);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", focusOutside);
    (buttons.find((button) => button.tabIndex === 0) ?? upload).focus({ preventScroll: true });
  };
  trigger.addEventListener("click", open);
  trigger.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
    if (event.key === "ArrowDown" && !popup) {
      event.preventDefault();
      open();
    }
  });
  render();
  if (inline) open();
  return {
    update(next) {
      if (next.value !== props.value) resetUpload();
      props = next;
      render();
    },
    destroy() {
      close();
      fileInput.onchange = null;
      trigger.remove();
      fileInput.remove();
    }
  };
}
export {
  imageLabel,
  imageOptions,
  mountImageControl
};
//# sourceMappingURL=image-control.js.map