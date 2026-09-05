type KeyEvent = Pick<KeyboardEvent, 'key' | 'shiftKey' | 'altKey' | 'metaKey' | 'ctrlKey' | 'target' | 'currentTarget' | 'preventDefault' | 'stopPropagation'>;
/** Keyboard steps are relative to the range minimum, including fractional ranges. */
declare function sliderKeyValue(key: string, value: number, min: number, max: number, step: number, shift?: boolean): number | undefined;
declare function handleSliderKey(event: KeyEvent, value: number, min: number, max: number, step: number, change: (value: number) => void, edit: () => void): void;
declare function activateOnKey(event: KeyEvent, activate: () => void): void;
declare function optionKeyIndex(key: string, index: number, count: number, wrap?: boolean): number | undefined;
declare function handleSegmentKey(event: KeyEvent): void;
declare function labelSegmentedControl(group: HTMLElement): void;
declare function openDropdownOnKey(event: KeyEvent, open: () => void): void;
/** Find the next control in the owner's document order, excluding floating content. */
declare function adjacentTabStop(trigger: HTMLElement, backwards?: boolean): HTMLElement | undefined;

export { activateOnKey, adjacentTabStop, handleSegmentKey, handleSliderKey, labelSegmentedControl, openDropdownOnKey, optionKeyIndex, sliderKeyValue };
