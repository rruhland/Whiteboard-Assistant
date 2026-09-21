import { describe, expect, it } from 'vitest';
import type { Point, Stroke, Viewport } from '../src/board';
import {
  beginGesture,
  finishGesture,
  ownsGesturePointer,
  updateGesture,
  type Gesture,
} from '../src/gesture';
import { selectionBounds } from '../src/selection';

const point = (x: number, y: number, pressure = 0.5, time = 100): Point => ({ x, y, pressure, time });
const stroke = (id: string, x: number): Stroke => ({ id, createdAt: 1, author: 'user', color: '#000', width: 2, points: [point(x, 0)] });

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
    let gesture: Gesture = { type: 'erase', pointerId: 5, strokeIds: [], current: point(0, 0) };
    gesture = updateGesture(gesture, 5, { erasedStrokeIds: ['stroke-a'] });
    gesture = updateGesture(gesture, 5, { erasedStrokeIds: ['stroke-a'] });
    gesture = updateGesture(gesture, 5, { erasedStrokeIds: ['stroke-b'] });

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

  it('does not give unrelated pointer cancellation ownership of an active gesture', () => {
    const gesture: Gesture = { type: 'ink', pointerId: 4, points: [point(1, 1)] };

    expect(ownsGesturePointer(gesture, 999)).toBe(false);
    expect(ownsGesturePointer(gesture, 4)).toBe(true);
  });

  it('updates and commits a reverse-direction additive marquee', () => {
    let gesture: Gesture = { type: 'marquee', pointerId: 7, origin: point(20, 30), current: point(20, 30), additive: true };
    gesture = updateGesture(gesture, 7, { world: point(2, 4) });
    expect(finishGesture(gesture, 7)).toEqual({ type: 'marquee', start: point(20, 30), end: point(2, 4), additive: true });
  });

  it('commits transformed preview strokes from the original snapshot', () => {
    const originals = [stroke('a', 0), stroke('b', 10)];
    let gesture: Gesture = {
      type: 'transform',
      pointerId: 8,
      bounds: selectionBounds(originals)!,
      originals,
      operation: { type: 'move', origin: point(0, 0) },
      current: point(0, 0),
    };
    gesture = updateGesture(gesture, 8, { world: point(5, 3) });
    const commit = finishGesture(gesture, 8);
    expect(commit?.type).toBe('transform');
    expect(commit?.type === 'transform' && commit.strokes.map(({ points }) => points[0])).toEqual([point(5, 3), point(15, 3)]);
  });
});
