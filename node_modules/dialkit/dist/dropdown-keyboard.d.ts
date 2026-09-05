/** Shared focus/selection behavior; framework adapters continue to own values and rendering. */
declare function observeDropdownKeyboard(trigger: HTMLElement, getPopup: () => HTMLElement | null | undefined, close: () => void, kind?: 'select' | 'presets' | 'help'): () => void;

export { observeDropdownKeyboard };
