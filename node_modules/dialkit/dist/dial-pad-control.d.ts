import { DialPadConfig, DialPadValue } from './dial-pad.js';

type DialPadProps = Omit<DialPadConfig, 'type'> & {
    label: string;
    value: DialPadValue;
    onChange: (value: DialPadValue) => void;
};
/** Shared pointer, keyboard, and numeric editing behavior for all four frameworks. */
declare function mountDialPad(host: HTMLElement, initial: DialPadProps): {
    update(next: DialPadProps): void;
    destroy(): void;
};

export { type DialPadProps, mountDialPad };
