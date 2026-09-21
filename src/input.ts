export type Tool = 'pen' | 'select' | 'eraser' | 'hand';
export type PointerDescriptor = { pointerType: string; button: number; buttons: number };

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
