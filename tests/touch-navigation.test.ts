import { describe, expect, test } from 'vitest';
import { abandonTouch, beginTouch, endTouch, touchViewport, updateTouch } from '../src/touch-navigation';

describe('touch navigation', () => {
  test('pans with one finger from the captured origin viewport', () => {
    let state = beginTouch(null, 1, { x: 10, y: 20 }, { x: 4, y: 8, zoom: 2 });
    state = updateTouch(state, 1, { x: 25, y: 14 });
    expect(touchViewport(state)).toEqual({ x: 19, y: 2, zoom: 2 });
  });

  test('pinches around the starting midpoint while translating that midpoint', () => {
    let state = beginTouch(null, 1, { x: 0, y: 0 }, { x: 10, y: 20, zoom: 1 });
    state = beginTouch(state, 2, { x: 100, y: 0 }, touchViewport(state));
    state = updateTouch(state, 1, { x: 0, y: 10 });
    state = updateTouch(state, 2, { x: 200, y: 10 });
    expect(touchViewport(state)).toEqual({ x: 20, y: 50, zoom: 2 });
  });

  test('rebases when one pinch finger lifts without jumping', () => {
    let state = beginTouch(null, 1, { x: 0, y: 0 }, { x: 0, y: 0, zoom: 1 });
    state = beginTouch(state, 2, { x: 100, y: 0 }, touchViewport(state));
    state = updateTouch(state, 2, { x: 200, y: 0 });
    const before = touchViewport(state);
    state = endTouch(state, 1)!;
    expect(touchViewport(state)).toEqual(before);
    state = updateTouch(state, 2, { x: 210, y: 5 });
    expect(touchViewport(state)).toEqual({ ...before, x: before.x + 10, y: before.y + 5 });
  });

  test('clamps pinch zoom to board limits and ignores a third finger in calculation', () => {
    let state = beginTouch(null, 1, { x: 0, y: 0 }, { x: 0, y: 0, zoom: 3 });
    state = beginTouch(state, 2, { x: 10, y: 0 }, touchViewport(state));
    state = beginTouch(state, 3, { x: 999, y: 999 }, touchViewport(state));
    state = updateTouch(state, 2, { x: 100, y: 0 });
    expect(touchViewport(state).zoom).toBe(4);
  });

  test('abandons an in-progress historical gesture without publishing its viewport', () => {
    let state = beginTouch(null, 4, { x: 0, y: 0 }, { x: 10, y: 20, zoom: 1 });
    state = updateTouch(state, 4, { x: 40, y: 60 });
    expect(abandonTouch(state)).toEqual({ pointerIds: [4], navigation: null });
  });
});
