import { describe, expect, test } from 'vitest';
import { derivePanelControls, layoutGraph, type ObjectPanelState } from '../src/object-panel';
import type { GraphNode } from '../src/association';

const nodes: GraphNode[] = [
  { objectType: 'content', id: 'a', label: 'A', strokeIds: ['one', 'two'], createdAt: 0, lastAssociatedAt: 1, status: 'active', parentIds: [], visibleStrokeCount: 2, bounds: { minX: -20, minY: -5, maxX: -20, maxY: -5 } },
  { objectType: 'content', id: 'b', label: 'B', strokeIds: ['three'], createdAt: 0, lastAssociatedAt: 2, status: 'active', parentIds: [], visibleStrokeCount: 1, bounds: { minX: 10, minY: 10, maxX: 20, maxY: 20 } },
];

function state(overrides: Partial<ObjectPanelState> = {}): ObjectPanelState {
  return { nodes, edges: [], selectedStrokeId: 'one', selectedObjectId: 'a', checkedObjectIds: new Set(['a', 'b']), overlayEnabled: true, unassignedStrokeIds: [], readOnly: false, ...overrides };
}

describe('object panel view model', () => {
  test('content corrections exclude checked annotation nodes', () => {
    const annotation: GraphNode = { objectType: 'annotation', id: 'note', label: 'Assistant arrow', strokeIds: ['assistant'], createdAt: 3, lastAssociatedAt: 3, status: 'active', parentIds: [], annotationKind: 'arrow', links: [{ type: 'points-to', targetObjectId: 'a' }], proposalId: 'proposal', contextPosition: 1, createdBy: 'assistant', approvedAt: 3, visibleStrokeCount: 1 };
    expect(derivePanelControls(state({ nodes: [...nodes, annotation], checkedObjectIds: new Set(['a', 'note']) }))).toMatchObject({ canMerge: false });
  });

  test('enables whole-annotation deletion only for a live selected annotation with visible members', () => {
    const annotation = (visibleStrokeCount: number): GraphNode => ({ objectType: 'annotation', id: 'note', label: 'Assistant circle', strokeIds: ['assistant'], createdAt: 3, lastAssociatedAt: 3, status: 'active', parentIds: [], annotationKind: 'circle', links: [{ type: 'annotates', targetObjectId: 'a' }], proposalId: 'proposal', contextPosition: 1, createdBy: 'assistant', approvedAt: 3, visibleStrokeCount });
    expect(derivePanelControls(state({ nodes: [...nodes, annotation(2)], selectedObjectId: 'note' }))).toMatchObject({ canDeleteSelectedAnnotation: true });
    expect(derivePanelControls(state({ nodes: [...nodes, annotation(0)], selectedObjectId: 'note' }))).toMatchObject({ canDeleteSelectedAnnotation: false });
    expect(derivePanelControls(state({ nodes: [...nodes, annotation(2)], selectedObjectId: 'note', readOnly: true }))).toMatchObject({ canDeleteSelectedAnnotation: false });
  });

  test('enables merge and split for eligible selections', () => {
    expect(derivePanelControls(state())).toMatchObject({ canMerge: true, canSplit: true, canAssignToChecked: false, canCreateObject: false });
  });

  test('enables assignment only for an unassigned selected stroke and at most one checked target', () => {
    expect(derivePanelControls(state({ selectedStrokeId: 'loose', unassignedStrokeIds: ['loose'], checkedObjectIds: new Set(['a']) }))).toMatchObject({ canAssignToChecked: true, canCreateObject: true });
    expect(derivePanelControls(state({ selectedStrokeId: 'loose', unassignedStrokeIds: ['loose'] }))).toMatchObject({ canAssignToChecked: false, canCreateObject: true });
  });

  test('normalizes graph coordinates for negative and zero-size bounds', () => {
    const layout = layoutGraph(nodes, 280, 160);
    expect(layout.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
    expect(layout.every(({ x, y }) => x >= 0 && x <= 280 && y >= 0 && y <= 160)).toBe(true);
  });

  test('disables every correction in historical mode', () => {
    expect(derivePanelControls(state({ readOnly: true }))).toEqual({ canMerge: false, canSplit: false, canAssignToChecked: false, canCreateObject: false, canDeleteSelectedAnnotation: false });
  });
});
