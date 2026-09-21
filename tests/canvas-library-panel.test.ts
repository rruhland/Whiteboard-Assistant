import { expect, test } from 'vitest';
import { orderedCanvasSummaries } from '../src/canvas-library-panel';

test('orders canvases by recent update, creation time, then stable ID without mutating input', () => {
  const input = [
    { id: 'b', name: 'B', createdAt: 1, updatedAt: 3 },
    { id: 'a', name: 'A', createdAt: 1, updatedAt: 3 },
    { id: 'c', name: 'C', createdAt: 2, updatedAt: 2 },
  ];
  expect(orderedCanvasSummaries(input).map(({ id }) => id)).toEqual(['a', 'b', 'c']);
  expect(input.map(({ id }) => id)).toEqual(['b', 'a', 'c']);
});
