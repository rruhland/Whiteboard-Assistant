import { describe, expect, test, vi } from 'vitest';
import { BoardModel, type Point } from '../src/board';
import { getUnassignedVisibleStrokes } from '../src/association';
import type { BoardDocumentV2 } from '../src/document';
import { commitStroke, loadWorkspace, workspaceDocument } from '../src/workspace';

const point = (x: number, y: number): Point => ({ x, y, pressure: 0.5, time: 1 });
const emptyV2: BoardDocumentV2 = { version: 2, events: [], associationEvents: [], viewport: { x: 0, y: 0, zoom: 1 } };

describe('workspace coordination', () => {
  test('commits ink and association before producing an autosave document', () => {
    const state = loadWorkspace({ sourceVersion: 2, document: emptyV2 });
    const result = commitStroke(state, [point(1, 1)], '#000', 4);
    const saved = workspaceDocument(state);
    expect(saved.events.at(-1)?.changes[0].after?.id).toBe(result.strokeId);
    expect(saved.associationEvents.at(-1)?.changes[0].after?.strokeIds).toContain(result.strokeId);
  });

  test('keeps committed ink visible when association throws', () => {
    const state = loadWorkspace({ sourceVersion: 2, document: emptyV2 });
    vi.spyOn(state.associations, 'associateStroke').mockImplementation(() => { throw new Error('association failed'); });
    const result = commitStroke(state, [point(1, 1)], '#000', 4);
    expect(state.board.strokes.map(({ id }) => id)).toContain(result.strokeId);
    expect(result.associationError).toMatch(/association failed/);
  });

  test('ink undo and redo change visibility without changing membership', () => {
    const state = loadWorkspace({ sourceVersion: 2, document: emptyV2 });
    const result = commitStroke(state, [point(1, 1)], '#000', 4);
    state.board.undo();
    expect(state.associations.objects.find(({ id }) => id === result.objectId)?.strokeIds).toContain(result.strokeId);
    state.board.redo();
    expect(state.associations.objects.find(({ id }) => id === result.objectId)?.strokeIds).toContain(result.strokeId);
  });

  test('version 2 load preserves an intentionally unassigned visible stroke', () => {
    const board = new BoardModel();
    board.addStroke([point(2, 2)], '#000', 3);
    const loaded = loadWorkspace({ sourceVersion: 2, document: { ...emptyV2, events: board.events } });
    expect(getUnassignedVisibleStrokes(loaded.associations, loaded.board.strokes)).toHaveLength(1);
  });

  test('version 1 loads and deterministically migrates current visible strokes', () => {
    const board = new BoardModel();
    board.addStroke([point(2, 2)], '#000', 3);
    const document = board.toDocument({ x: 4, y: 5, zoom: 2 });
    const loaded = loadWorkspace({ sourceVersion: 1, document });
    expect(loaded.migratedFromVersion).toBe(1);
    expect(loaded.associations.objects[0].strokeIds).toEqual([board.strokes[0].id]);
    expect(loaded.viewport).toEqual(document.viewport);
  });
});
