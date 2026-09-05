type ColorControlProps = {
    label: string;
    value: string;
    onChange: (value: string) => void;
};
/** One interaction/rendering implementation shared by the four framework adapters. */
declare function mountColorControl(host: HTMLElement, initial: ColorControlProps, presentation?: 'popover' | 'inline'): {
    update(next: ColorControlProps): void;
    destroy(): void;
};

export { type ColorControlProps, mountColorControl };
