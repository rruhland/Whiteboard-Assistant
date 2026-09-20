import { describe, expect, it } from 'vitest';
import type { Point, Viewport } from '../src/board';
import {
  beginGesture,
  finishGesture,
  updateGesture,
  type Gesture,
} from '../src/gesture';

const point = (x: number, y: number, pressure = 0.5, time = 100): Point => ({ x, y, pressure, time });

describe('gesture state', () => {
  it('keeps the first pointer active and ignores updates from other pointers', () => {
    const active = beginGesture(null, { type: 'ink', pointerId: 7, points: [point(1, 2)] });
    const stillActive = beginGesture(active, { type: 'ink', pointerId: 8, points: [point(9, 9)] });
    const unchanged = updateGesture(stillActive, 8, { world: point(3, 4) });

    expect(unchanged).toBe(active);
    expect(unchanged?.type === 'ink' && unchanged.points).toEqual([point(1, 2)]);
  });

  it('returns an ink commit only for the active pointer, including a single-point dot', () => {
    const gesture = beginGesture(null, { type: 'ink', pointerId: 3, points: [point(-2, 6)] });

    expect(finishGesture(gesture, 4)).toBeNull();
    expect(finishGesture(gesture, 3)).toEqual({ type: 'ink', points: [point(-2, 6)] });
  });

  it('computes move deltas without mutating the model during preview', () => {
    let gesture: Gesture = {
      type: 'move',
      pointerId: 2,
      strokeId: 'stroke-a',
      origin: point(10, 20),
      current: point(10, 20),
    };

    gesture = updateGesture(gesture, 2, { world: point(13, 15) });

    expect(finishGesture(gesture, 2)).toEqual({ type: 'move', strokeId: 'stroke-a', dx: 3, dy: -5 });
  });

  it('collects each erased stroke once and commits only when the gesture finishes', () => {
    let gesture: Gesture = { type: 'erase', pointerId: 5, strokeIds: [] };
    gesture = updateGesture(gesture, 5, { erasedStrokeId: 'stroke-a' });
    gesture = updateGesture(gesture, 5, { erasedStrokeId: 'stroke-a' });
    gesture = updateGesture(gesture, 5, { erasedStrokeId: 'stroke-b' });

    expect(finishGesture(gesture, 5)).toEqual({ type: 'erase', strokeIds: ['stroke-a', 'stroke-b'] });
  });

  it('previews pan from the starting viewport without accumulating drift', () => {
    const viewport: Viewport = { x: 20, y: -5, zoom: 2 };
    let gesture: Gesture = {
      type: 'pan',
      pointerId: 9,
      originScreen: { x: 100, y: 80 },
      currentScreen: { x: 100, y: 80 },
      originViewport: viewport,
    };

    gesture = updateGesture(gesture, 9, { screen: { x: 130, y: 60 } });

    expect(finishGesture(gesture, 9)).toEqual({ type: 'pan', viewport: { x: 50, y: -25, zoom: 2 } });
    expect(viewport).toEqual({ x: 20, y: -5, zoom: 2 });
  });
});
