export type Tool = 'pen' | 'select' | 'eraser' | 'hand';
export type PointerDescriptor = { pointerType: string; button: number; buttons: number };
export type PenContactDescriptor = { pointerType: string; pointerId: number; buttons: number; pressure: number };
export type ModalKeyboardIntent = 'board' | 'close' | 'cycle-focus' | 'contain';

export function isSpacePanTarget(target: unknown, canvas: unknown, background: unknown): boolean {
  return target === canvas || target === background;
}

export function effectivePointerTool(
  pointer: PointerDescriptor,
  activeTool: Tool,
  spacePressed: boolean,
): Tool | 'touch' | null {
  if (pointer.pointerType === 'touch') return 'touch';
  if (pointer.pointerType === 'pen') {
    if (pointer.button === 5 || (pointer.buttons & 32) !== 0) return 'eraser';
    if (pointer.button === 2 || (pointer.buttons & 2) !== 0) return 'select';
    return 'pen';
  }
  if (pointer.pointerType !== 'mouse') return null;
  if (pointer.button === 1 || spacePressed) return 'hand';
  return pointer.button === 0 ? activeTool : null;
}

export function penContactTransition(pointer: PenContactDescriptor, activePointerId: number | null): 'start' | 'continue' | 'end' | 'none' {
  if (pointer.pointerType !== 'pen') return 'none';
  const touching = pointer.pressure > 0 || (pointer.buttons & 1) !== 0;
  if (activePointerId === pointer.pointerId) return touching ? 'continue' : 'end';
  return activePointerId === null && touching ? 'start' : 'none';
}

export function modalKeyboardIntent(open: boolean, key: string): ModalKeyboardIntent {
  if (!open) return 'board';
  if (key === 'Escape') return 'close';
  return key === 'Tab' ? 'cycle-focus' : 'contain';
}

export function shouldClearSelectionOnStart(
  pointerType: string,
  tool: Tool,
  additive: boolean,
  overSelection: boolean,
): boolean {
  return pointerType === 'pen' && !overSelection && !(tool === 'select' && additive);
}
