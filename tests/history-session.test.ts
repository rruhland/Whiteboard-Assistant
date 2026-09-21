import { describe, expect, test } from 'vitest';
import { serializeBoard } from '../src/document';
import { commitStroke, createHistorySession, loadWorkspace, rebuildHistorySession, returnToNow, selectHistoryPosition, workspaceDocument } from '../src/workspace';

const point = (x: number, y: number) => ({ x, y, pressure: 0.5, time: 1 });
function historyWorkspaceFixture() {
  const stroke = { id: 'stroke-1', createdAt: 1, author: 'user' as const, color: '#000', width: 2, points: [point(0, 0)] };
  return loadWorkspace({ sourceVersion: 2, document: {
    version: 2,
    viewport: { x: 4, y: 8, zoom: 1.5 },
    events: [{ id: 'add-1', time: 1, actor: 'user', kind: 'add', changes: [{ before: null, after: stroke }] }],
    associationEvents: [{ id: 'assoc-1', time: 1, actor: 'system', kind: 'auto-create', reason: 'fixture', changes: [{ before: null, after: { id: 'object-1', label: 'A', strokeIds: ['stroke-1'], createdAt: 1, lastAssociatedAt: 1, status: 'active', parentIds: [] } }] }],
  } });
}

describe('history session', () => {
  test('history selection never mutates the live document or viewport', () => {
    const state = historyWorkspaceFixture();
    const before = serializeBoard(workspaceDocument(state));
    const session = selectHistoryPosition(state, createHistorySession(state), 1);
    session.historicalViewport.x = 999;
    expect(serializeBoard(workspaceDocument(state))).toBe(before);
    expect(state.viewport).toEqual({ x: 4, y: 8, zoom: 1.5 });
  });

  test('return to now restores live display and rebuild follows new live edits', () => {
    const state = historyWorkspaceFixture();
    let session = selectHistoryPosition(state, createHistorySession(state), 0);
    session = returnToNow(state, session);
    commitStroke(state, [point(3, 3)], '#000', 2);
    session = rebuildHistorySession(state, session);
    expect(session.position).toBeNull();
    expect(session.index.totalInkEvents).toBe(state.board.events.length);
    expect(session.projection).toBeNull();
  });

  test('failed projection leaves prior session at now', () => {
    const state = historyWorkspaceFixture();
    const current = createHistorySession(state);
    const corruptedSession = { ...current, index: { ...current.index, entries: [{ ...current.index.entries[0], inkEventCount: 999 }] } };
    expect(() => selectHistoryPosition(state, corruptedSession, 1)).toThrow();
    expect(corruptedSession.position).toBeNull();
    expect(corruptedSession.projection).toBeNull();
  });
});
