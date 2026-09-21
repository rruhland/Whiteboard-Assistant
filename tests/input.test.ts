import { describe, expect, it } from 'vitest';
import { effectivePointerTool, isSpacePanTarget, modalKeyboardIntent, penContactTransition } from '../src/input';

describe('keyboard input routing', () => {
  it('reserves Space-pan for the canvas or page background, not a focused control', () => {
    const canvas = {};
    const body = {};
    const button = {};

    expect(isSpacePanTarget(canvas, canvas, body)).toBe(true);
    expect(isSpacePanTarget(body, canvas, body)).toBe(true);
    expect(isSpacePanTarget(button, canvas, body)).toBe(false);
  });

  it('routes pen tip, barrel, eraser, and conflicting masks by native button state', () => {
    expect(effectivePointerTool({ pointerType: 'pen', button: 0, buttons: 1 }, 'hand', false)).toBe('pen');
    expect(effectivePointerTool({ pointerType: 'pen', button: 2, buttons: 2 }, 'pen', false)).toBe('select');
    expect(effectivePointerTool({ pointerType: 'pen', button: 5, buttons: 32 }, 'select', false)).toBe('eraser');
    expect(effectivePointerTool({ pointerType: 'pen', button: 5, buttons: 34 }, 'pen', false)).toBe('eraser');
    expect(effectivePointerTool({ pointerType: 'pen', button: 0, buttons: 1 }, 'eraser', false)).toBe('pen');
  });

  it('routes touch to navigation and keeps mouse toolbar and temporary hand behavior', () => {
    expect(effectivePointerTool({ pointerType: 'touch', button: 0, buttons: 1 }, 'eraser', false)).toBe('touch');
    expect(effectivePointerTool({ pointerType: 'mouse', button: 0, buttons: 1 }, 'select', false)).toBe('select');
    expect(effectivePointerTool({ pointerType: 'mouse', button: 1, buttons: 4 }, 'pen', false)).toBe('hand');
    expect(effectivePointerTool({ pointerType: 'mouse', button: 0, buttons: 1 }, 'pen', true)).toBe('hand');
    expect(effectivePointerTool({ pointerType: 'mouse', button: 2, buttons: 2 }, 'pen', false)).toBeNull();
  });

  it('ends a pen contact on tip lift even while a barrel button remains held', () => {
    expect(penContactTransition({ pointerType: 'pen', pointerId: 7, buttons: 3, pressure: 0.5 }, null)).toBe('start');
    expect(penContactTransition({ pointerType: 'pen', pointerId: 7, buttons: 2, pressure: 0 }, 7)).toBe('end');
    expect(penContactTransition({ pointerType: 'pen', pointerId: 7, buttons: 3, pressure: 0.5 }, null)).toBe('start');
  });

  it('contains canvas shortcuts and cycles focus while the canvas library is open', () => {
    expect(modalKeyboardIntent(true, 'Delete')).toBe('contain');
    expect(modalKeyboardIntent(true, 'z')).toBe('contain');
    expect(modalKeyboardIntent(true, 'Tab')).toBe('cycle-focus');
    expect(modalKeyboardIntent(true, 'Escape')).toBe('close');
    expect(modalKeyboardIntent(false, 'Delete')).toBe('board');
  });
});
