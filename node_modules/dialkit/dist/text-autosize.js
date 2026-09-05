// src/text-autosize.ts
function observeTextSize(input) {
  const row = input.parentElement;
  const mirror = input.ownerDocument.createElement("textarea");
  mirror.className = input.className;
  mirror.rows = 1;
  mirror.tabIndex = -1;
  mirror.readOnly = true;
  mirror.inert = true;
  mirror.setAttribute("aria-hidden", "true");
  Object.assign(mirror.style, {
    position: "absolute",
    visibility: "hidden",
    pointerEvents: "none",
    top: "0",
    left: "0",
    height: "0",
    minHeight: "0",
    maxHeight: "none",
    overflow: "hidden",
    transition: "none"
  });
  row.append(mirror);
  let frame = 0;
  let width = 0;
  let disposed = false;
  const update = () => {
    if (disposed || !input.isConnected || !input.offsetWidth) return;
    const style = getComputedStyle(input);
    const lineHeight = parseFloat(style.lineHeight);
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    const gutter = Math.max(0, input.offsetWidth - input.clientWidth - border);
    row.style.setProperty("--dial-text-gutter", `${gutter}px`);
    mirror.style.width = style.width;
    mirror.value = input.value || input.placeholder;
    const minimum = lineHeight + padding + border;
    const maximum = lineHeight * 5 + padding + border;
    const contentHeight = mirror.scrollHeight + border;
    const height = Math.max(minimum, Math.min(maximum, contentHeight));
    input.style.height = `${height}px`;
    input.style.overflowY = contentHeight > maximum ? "auto" : "hidden";
    if (contentHeight <= maximum) input.scrollTop = 0;
    const rowStyle = getComputedStyle(row);
    const rowInsets = parseFloat(rowStyle.paddingTop) + parseFloat(rowStyle.paddingBottom) + parseFloat(rowStyle.borderTopWidth) + parseFloat(rowStyle.borderBottomWidth);
    row.style.height = `${height + rowInsets}px`;
    if (!row.hasAttribute("data-autosized")) {
      void row.offsetHeight;
      row.setAttribute("data-autosized", "true");
    }
  };
  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(update);
  };
  const resize = new ResizeObserver(() => {
    if (input.offsetWidth === width) return;
    width = input.offsetWidth;
    schedule();
  });
  resize.observe(input);
  input.addEventListener("input", update);
  input.ownerDocument.fonts?.addEventListener("loadingdone", schedule);
  update();
  return {
    update,
    destroy() {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      input.removeEventListener("input", update);
      input.ownerDocument.fonts?.removeEventListener("loadingdone", schedule);
      mirror.remove();
      row.removeAttribute("data-autosized");
      row.style.removeProperty("height");
      row.style.removeProperty("--dial-text-gutter");
    }
  };
}
export {
  observeTextSize
};
//# sourceMappingURL=text-autosize.js.map