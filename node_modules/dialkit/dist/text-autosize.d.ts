/** Measure a separate textarea so resizing never resets the editor's scroll or selection. */
declare function observeTextSize(input: HTMLTextAreaElement): {
    update: () => void;
    destroy: () => void;
};

export { observeTextSize };
