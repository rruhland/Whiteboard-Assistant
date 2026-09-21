import { describe, expect, test } from 'vitest';
import type { Point, Stroke } from '../src/board';
import {
  containedStrokeIds,
  hitSelectionHandle,
  mergeSelection,
  renderedStrokeBounds,
  selectionBounds,
  selectionHandlePoints,
  transformSelection,
} from '../src/selection';

const point = (x: number, y: number): Point => ({ x, y, pressure: 0.5, time: 1 });
const line = (id: string, x1: number, y1: number, x2: number, y2: number, width: number): Stroke => ({
  id,
  createdAt: 1,
  author: 'user',
  color: '#000',
  width,
  points: [point(x1, y1), point(x2, y2)],
});
const dot = (id: string, x: number, y: number): Stroke => ({ ...line(id, x, y, x, y, 4), points: [point(x, y)] });

describe('selection geometry', () => {
  test('selects only strokes whose rendered bounds are fully contained in either drag direction', () => {
    const inside = line('inside', 2, 2, 8, 8, 2);
    const widthCrosses = line('width-crosses', 0.5, 4, 8, 4, 2);
    const endpointCrosses = line('endpoint-crosses', 3, 3, 11, 3, 1);
    expect(containedStrokeIds([inside, widthCrosses, endpointCrosses], point(0, 0), point(10, 10))).toEqual(['inside']);
    expect(containedStrokeIds([inside], point(10, 10), point(0, 0))).toEqual(['inside']);
  });

  test('normal selection replaces while Shift selection only adds', () => {
    expect(mergeSelection(new Set(['old']), ['new'], false)).toEqual(new Set(['new']));
    expect(mergeSelection(new Set(['old']), ['old', 'new'], true)).toEqual(new Set(['old', 'new']));
    expect(mergeSelection(new Set(['old']), [], true)).toEqual(new Set(['old']));
    expect(mergeSelection(new Set(['old']), [], false)).toEqual(new Set());
  });

  test('keeps handle hit areas constant in screen pixels', () => {
    const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 50 };
    expect(hitSelectionHandle(point(104, 25), bounds, 1)).toBe('e');
    expect(hitSelectionHandle(point(102, 25), bounds, 2)).toBe('e');
    expect(selectionHandlePoints(bounds, 2).rotate.y).toBe(-14);
  });

  test('edge resize changes one axis and preserves stroke width and metadata', () => {
    const source = line('a', 0, 0, 10, 10, 6);
    const bounds = renderedStrokeBounds(source);
    const [after] = transformSelection([source], bounds, { type: 'resize', handle: 'e', origin: point(bounds.maxX, 5) }, point(bounds.maxX + 10, 5));
    expect(after.width).toBe(6);
    expect(after).toMatchObject({ id: 'a', author: 'user', createdAt: 1, color: '#000' });
    expect(after.points.map(({ y }) => y)).toEqual([0, 10]);
    expect(after.points[1].x).toBeGreaterThan(10);
  });

  test('corner resize uses one positive scale for both axes without flipping', () => {
    const source = line('a', 0, 0, 10, 20, 2);
    const bounds = renderedStrokeBounds(source);
    const [after] = transformSelection([source], bounds, { type: 'resize', handle: 'se', origin: point(bounds.maxX, bounds.maxY) }, point(bounds.maxX + 12, bounds.maxY + 1));
    const xRatio = (after.points[1].x - after.points[0].x) / 10;
    const yRatio = (after.points[1].y - after.points[0].y) / 20;
    expect(xRatio).toBeCloseTo(yRatio);
    expect(xRatio).toBeGreaterThan(0);
  });

  test('rotates around the selection center from an immutable snapshot', () => {
    const source = line('a', 0, 0, 10, 0, 3);
    const bounds = renderedStrokeBounds(source);
    const once = transformSelection([source], bounds, { type: 'rotate', originAngle: -Math.PI / 2 }, point(11.5, 0));
    const repeated = transformSelection([source], bounds, { type: 'rotate', originAngle: -Math.PI / 2 }, point(11.5, 0));
    expect(repeated).toEqual(once);
    expect(once[0].width).toBe(3);
    expect(once[0].points[0].x).toBeCloseTo(5);
    expect(once[0].points[1].x).toBeCloseTo(5);
  });

  test('resizes point and one-dimensional selections to finite nonflipped geometry', () => {
    for (const source of [dot('dot', 5, 5), line('vertical', 5, 0, 5, 10, 4)]) {
      const bounds = selectionBounds([source])!;
      const result = transformSelection([source], bounds, { type: 'resize', handle: 'nw', origin: point(bounds.minX, bounds.minY) }, point(999, 999));
      expect(result[0].points.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
      expect(result[0].width).toBe(source.width);
      expect(selectionBounds(result)).not.toBeNull();
    }
  });

  test('moves every stroke without mutating its input', () => {
    const sources = [line('a', 0, 0, 4, 4, 2), dot('b', 10, 10)];
    const original = structuredClone(sources);
    const moved = transformSelection(sources, selectionBounds(sources)!, { type: 'move', origin: point(2, 3) }, point(7, 1));
    expect(moved.map(({ points }) => points[0])).toEqual([point(5, -2), point(15, 8)]);
    expect(sources).toEqual(original);
  });
});
