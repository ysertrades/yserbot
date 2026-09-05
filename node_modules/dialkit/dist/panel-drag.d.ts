type PanelDragOffset = {
    x: number;
    y: number;
};
type PanelDragStart = {
    pointerX: number;
    pointerY: number;
    elX: number;
    elY: number;
};
type PanelDragOriginX = 'left' | 'right';
type PanelDragOriginY = 'top' | 'bottom';
type PanelCorner = `${PanelDragOriginY}-${PanelDragOriginX}`;
declare function getPanelDragHandle(target: EventTarget | null, panel: HTMLElement | null): HTMLElement | null;
declare function getPanelDragStart(pointerX: number, pointerY: number, panel: HTMLElement): PanelDragStart;
declare function getPanelDragOffset(start: PanelDragStart, pointerX: number, pointerY: number): PanelDragOffset;
declare function hasPanelDragMoved(start: PanelDragStart, pointerX: number, pointerY: number): boolean;
declare function getPanelOriginX(position: string, offset: PanelDragOffset | null, viewportWidth?: number | undefined): PanelDragOriginX;
declare function getPanelOriginY(position: string, offset: PanelDragOffset | null, viewportHeight?: number | undefined): PanelDragOriginY;
/** Use the bubble's center for both the snap destination and animation origin. */
declare function getPanelCorner(position: string, offset: PanelDragOffset | null, viewportWidth?: number | undefined, viewportHeight?: number | undefined): PanelCorner;
declare function blockPanelDragClick(handle: HTMLElement): void;
/** A pointer can end while a framework is replacing the dragged header. */
declare function capturePanelPointer(handle: HTMLElement, pointerId: number): void;
declare function releasePanelPointer(handle: HTMLElement, pointerId: number): void;

export { type PanelCorner, type PanelDragOffset, type PanelDragOriginX, type PanelDragOriginY, type PanelDragStart, blockPanelDragClick, capturePanelPointer, getPanelCorner, getPanelDragHandle, getPanelDragOffset, getPanelDragStart, getPanelOriginX, getPanelOriginY, hasPanelDragMoved, releasePanelPointer };
