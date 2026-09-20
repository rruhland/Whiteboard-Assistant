import { describe, expect, test } from 'vitest';
import { derivePanelControls, layoutGraph, type ObjectPanelState } from '../src/object-panel';
import type { GraphNode } from '../src/association';

const nodes: GraphNode[] = [
  { id: 'a', label: 'A', strokeIds: ['one', 'two'], createdAt: 0, lastAssociatedAt: 1, status: 'active', parentIds: [], visibleStrokeCount: 2, bounds: { minX: -20, minY: -5, maxX: -20, maxY: -5 } },
  { id: 'b', label: 'B', strokeIds: ['three'], createdAt: 0, lastAssociatedAt: 2, status: 'active', parentIds: [], visibleStrokeCount: 1, bounds: { minX: 10, minY: 10, maxX: 20, maxY: 20 } },
];

function state(overrides: Partial<ObjectPanelState> = {}): ObjectPanelState {
  return { nodes, edges: [], selectedStrokeId: 'one', checkedObjectIds: new Set(['a', 'b']), overlayEnabled: true, unassignedStrokeIds: [], ...overrides };
}

describe('object panel view model', () => {
  test('enables merge and split for eligible selections', () => {
    expect(derivePanelControls(state())).toMatchObject({ canMerge: true, canSplit: true, canAssign: false });
  });

  test('enables assignment only for an unassigned selected stroke and at most one checked target', () => {
    expect(derivePanelControls(state({ selectedStrokeId: 'loose', unassignedStrokeIds: ['loose'], checkedObjectIds: new Set(['a']) })).canAssign).toBe(true);
    expect(derivePanelControls(state({ selectedStrokeId: 'loose', unassignedStrokeIds: ['loose'] })).canAssign).toBe(false);
  });

  test('normalizes graph coordinates for negative and zero-size bounds', () => {
    const layout = layoutGraph(nodes, 280, 160);
    expect(layout.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
    expect(layout.every(({ x, y }) => x >= 0 && x <= 280 && y >= 0 && y <= 160)).toBe(true);
  });
});
