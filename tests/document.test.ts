import { describe, expect, test } from 'vitest';
import { BoardModel, createAddEvent, type Point, type Stroke, type StrokeAuthor } from '../src/board';
import { composeBoardDocument, parseBoard, serializeBoard, type BoardDocumentV1, type BoardDocumentV2 } from '../src/document';
import type { AssociationEvent } from '../src/association';

const viewport = { x: -20, y: 30, zoom: 2 };
const v1: BoardDocumentV1 = { version: 1, events: [], viewport };
const stroke = (id: string, x: number, author: StrokeAuthor = 'user'): Stroke => ({
  id, createdAt: 1, author, color: '#000', width: 2,
  points: [{ x, y: 0, pressure: 0.5, time: 1 }],
});

function legacyDocument(version: 1 | 2, events: ReturnType<typeof createAddEvent>[]) {
  return version === 1
    ? { version, events, viewport }
    : { version, events, associationEvents: [], viewport };
}

describe('versioned board documents', () => {
  test.each([1, 2] as const)('legacy version %s rejects assistant and batch ink', (version) => {
    const assistant = legacyDocument(version, [createAddEvent([stroke('a', 0, 'assistant')], 'assistant', { id: 'a', time: 1 })]);
    expect(() => parseBoard(JSON.stringify(assistant))).toThrow(/legacy|user|single/i);
    const batch = legacyDocument(version, [createAddEvent([stroke('a', 0), stroke('b', 10)], 'user', { id: 'batch', time: 1 })]);
    expect(() => parseBoard(JSON.stringify(batch))).toThrow(/legacy|single/i);
  });

  test('distinguishes version 1 from version 2 without auto-grouping version 2', () => {
    expect(parseBoard(JSON.stringify(v1)).sourceVersion).toBe(1);
    const document: BoardDocumentV2 = { ...v1, version: 2, associationEvents: [] };
    expect(parseBoard(JSON.stringify(document))).toEqual({ sourceVersion: 2, document });
  });

  test('compose preserves the exact ink log and adds association history', () => {
    const board = new BoardModel();
    const point: Point = { x: 1, y: 2, pressure: 0.5, time: 10 };
    board.addStroke([point], '#123456', 3);
    const associations = { events: [] as AssociationEvent[] };

    const result = composeBoardDocument(board, associations, viewport);

    expect(result.events).toEqual(board.events);
    expect(result.associationEvents).toEqual(associations.events);
    expect(parseBoard(serializeBoard(result))).toEqual({ sourceVersion: 2, document: result });
  });

  test('rejects association history that references an unknown stroke', () => {
    const object = { objectType: 'content' as const, id: 'work-a', label: 'A', strokeIds: ['missing'], createdAt: 1, lastAssociatedAt: 1, status: 'active' as const, parentIds: [] };
    const document: BoardDocumentV2 = {
      version: 2, events: [], viewport,
      associationEvents: [{ id: 'assoc-a', time: 1, actor: 'system', kind: 'auto-create', reason: 'test', changes: [{ before: null, after: object }] }],
    };
    expect(() => parseBoard(JSON.stringify(document))).toThrow(/unknown stroke/i);
  });
});
