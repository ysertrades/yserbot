type DropdownPosition = {
    top: number;
    left: number;
    width: number;
    above: boolean;
    maxHeight: number;
};
type DropdownPositionOptions = {
    dropdownHeight?: number;
    gap?: number;
    allowAbove?: boolean;
    width?: number;
    maxHeight?: number;
    preferSide?: boolean;
    fixed?: boolean;
};
declare function getDropdownPosition(trigger: HTMLElement, portalRoot: HTMLElement, options?: DropdownPositionOptions): DropdownPosition;
/** Track scroll, resize, panel dragging, and layout animations while a popup is open. */
declare function observeDropdownPosition(trigger: HTMLElement, update: () => void, popup?: () => HTMLElement | null | undefined): () => void;
declare function getDialKitPortalRoot(trigger: HTMLElement | null | undefined): HTMLElement | null;

export { type DropdownPosition, type DropdownPositionOptions, getDialKitPortalRoot, getDropdownPosition, observeDropdownPosition };
