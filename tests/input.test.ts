import { describe, expect, it } from 'vitest';
import { isSpacePanTarget } from '../src/input';

describe('keyboard input routing', () => {
  it('reserves Space-pan for the canvas or page background, not a focused control', () => {
    const canvas = {};
    const body = {};
    const button = {};

    expect(isSpacePanTarget(canvas, canvas, body)).toBe(true);
    expect(isSpacePanTarget(body, canvas, body)).toBe(true);
    expect(isSpacePanTarget(button, canvas, body)).toBe(false);
  });
});
