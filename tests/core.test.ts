import { describe, expect, test } from 'vitest';
import {
  BoardModel,
  createAddEvent,
  createEraseEvent,
  type BoardDocument,
  type Point,
  type Stroke,
  type StrokeAuthor,
} from '../src/board';
import { parseBoard, serializeBoard, type BoardDocumentV3 } from '../src/document';
import {
  hitTestStroke,
  hitTestStrokesAlongSegment,
  screenToWorld,
  worldToScreen,
  zoomAt,
} from '../src/geometry';

const point = (x: number, y: number, time = 1): Point => ({
  x,
  y,
  pressure: 0.7,
  time,
});

const viewport = { x: -20, y: 30, zoom: 2 };

const stroke = (id: string, x: number, author: StrokeAuthor = 'user'): Stroke => ({
  id,
  createdAt: 1,
  author,
  color: '#000',
  width: 2,
  points: [point(x, 0)],
});

describe('BoardModel', () => {
  test('replays assistant batch add as one undoable operation', () => {
    const strokes = [stroke('assistant-1', 0, 'assistant'), stroke('assistant-2', 20, 'assistant')];
    const model = new BoardModel({ events: [createAddEvent(strokes, 'assistant', { id: 'assistant-add', time: 10 })] });
    expect(model.strokes.map(({ id }) => id)).toEqual(['assistant-1', 'assistant-2']);
    model.undo();
    expect(model.strokes).toEqual([]);
    expect(model.events.at(-1)).toMatchObject({ kind: 'undo', targetId: 'assistant-add', changes: [{ after: null }, { after: null }] });
    model.redo();
    expect(model.strokes.map(({ id }) => id)).toEqual(['assistant-1', 'assistant-2']);
  });

  test('batch erase removes only supplied visible strokes and undoes together', () => {
    const values = [stroke('one', 0), stroke('two', 20), stroke('three', 40)];
    const add = createAddEvent(values, 'user', { id: 'add-all', time: 1 });
    const erase = createEraseEvent(values.slice(0, 2), { id: 'erase-two', time: 2 });
    const model = new BoardModel({ events: [add, erase] });
    expect(model.strokes.map(({ id }) => id)).toEqual(['three']);
    model.undo();
    expect(model.strokes.map(({ id }) => id)).toEqual(['one', 'two', 'three']);
  });

  test('records an add and move while preserving stroke identity and caller input', () => {
    const points = [point(-4, 3), point(5, 8, 2)];
    const model = new BoardModel();
    model.addStroke(points, '#123456', 4);
    const id = model.strokes[0].id;
    points[0].x = 999;

    model.moveStroke(id, 10, -2);

    expect(model.strokes[0]).toMatchObject({ id, color: '#123456', width: 4 });
    expect(model.strokes[0].points).toEqual([point(6, 1), point(15, 6, 2)]);
    expect(model.events).toHaveLength(2);
    expect(model.events[1].changes[0].before?.id).toBe(id);
  });

  test('updates a selected group in one event and preserves stroke metadata through undo and redo', () => {
    const first = stroke('first', 0);
    const second = { ...stroke('second', 10), width: 7, color: '#456', points: [point(10, 0), point(12, 4)] };
    const model = new BoardModel({ events: [createAddEvent([first, second], 'user', { id: 'add', time: 1 })] });
    const transformed = model.strokes.map((value) => ({
      ...value,
      points: value.points.map((sample) => ({ ...sample, x: sample.x + 5, y: sample.y - 3 })),
    }));

    model.updateStrokes(transformed);

    expect(model.events.at(-1)).toMatchObject({ kind: 'move', changes: [{ before: { id: 'first' }, after: { id: 'first' } }, { before: { id: 'second' }, after: { id: 'second' } }] });
    expect(model.strokes[1]).toMatchObject({ id: 'second', width: 7, color: '#456', author: 'user', createdAt: 1 });
    model.undo();
    expect(model.strokes).toEqual([first, second]);
    model.redo();
    expect(model.strokes).toEqual(transformed);
  });

  test('erases a selected group as one undoable event and ignores missing IDs', () => {
    const values = [stroke('first', 0), stroke('second', 10), stroke('third', 20)];
    const model = new BoardModel({ events: [createAddEvent(values, 'user', { id: 'add', time: 1 })] });

    model.eraseStrokes(['first', 'missing', 'second', 'first']);

    expect(model.events.at(-1)).toMatchObject({ kind: 'erase', changes: [{ before: { id: 'first' } }, { before: { id: 'second' } }] });
    expect(model.strokes.map(({ id }) => id)).toEqual(['third']);
    model.undo();
    expect(model.strokes).toEqual(values);
  });

  test('undo restores erased geometry and redo reapplies it', () => {
    const model = new BoardModel();
    model.addStroke([point(1, 1)], '#000', 3);
    const stroke = model.strokes[0];

    model.eraseStroke(stroke.id);
    model.undo();
    expect(model.strokes).toEqual([stroke]);
    expect(model.canRedo).toBe(true);

    model.redo();
    expect(model.strokes).toEqual([]);
    expect(model.canUndo).toBe(true);
  });

  test('undoing an erased lower stroke restores draw order and hit testing after reload', () => {
    const model = new BoardModel();
    model.addStroke([point(0, 0)], '#a', 4);
    const lowerId = model.strokes[0].id;
    model.addStroke([point(0, 0)], '#b', 4);
    const upperId = model.strokes[1].id;
    expect(hitTestStroke(model.strokes, { x: 0, y: 0 }, 0)?.id).toBe(upperId);

    model.eraseStroke(lowerId);
    model.undo();
    expect(model.strokes.map((stroke) => stroke.id)).toEqual([lowerId, upperId]);
    expect(hitTestStroke(model.strokes, { x: 0, y: 0 }, 0)?.id).toBe(upperId);

    const reloaded = new BoardModel(model.toDocument(viewport));
    expect(reloaded.strokes.map((stroke) => stroke.id)).toEqual([lowerId, upperId]);
    expect(hitTestStroke(reloaded.strokes, { x: 0, y: 0 }, 0)?.id).toBe(upperId);
  });

  test('a new edit after undo clears redo without deleting prior events', () => {
    const model = new BoardModel();
    model.addStroke([point(0, 0)], '#000', 2);
    const firstId = model.strokes[0].id;
    model.undo();
    const eventCount = model.events.length;

    model.addStroke([point(9, 9)], '#fff', 2);

    expect(model.canRedo).toBe(false);
    expect(model.events).toHaveLength(eventCount + 1);
    expect(model.events.some((event) => event.changes.some((change) => change.before?.id === firstId))).toBe(true);
  });

  test('round trips document data while preserving events, IDs, geometry, and viewport', () => {
    const model = new BoardModel();
    model.addStroke([point(-8, -2)], '#abc', 6);
    const document: BoardDocumentV3 = { version: 3, events: model.events, associationEvents: [], viewport };
    const restored = parseBoard(serializeBoard(document));

    expect(restored).toEqual({ sourceVersion: 3, document });
    expect(new BoardModel(restored.document).strokes).toEqual(model.strokes);
  });

  test('rebuilds undo and redo availability after loading an event log', () => {
    const model = new BoardModel();
    model.addStroke([point(3, 4)], '#abc', 2);
    const documentAfterAdd = model.toDocument(viewport);
    const loaded = new BoardModel(documentAfterAdd);

    loaded.undo();
    const reloaded = new BoardModel(loaded.toDocument(viewport));
    expect(reloaded.strokes).toEqual([]);
    expect(reloaded.canRedo).toBe(true);
    reloaded.redo();
    expect(reloaded.strokes).toEqual(model.strokes);
  });

  test('rejects unsupported versions, nonfinite geometry, duplicate IDs, and invalid references', () => {
    const base: BoardDocument = { version: 1, events: [], viewport };
    expect(() => parseBoard(JSON.stringify({ ...base, version: 4 }))).toThrow(/version/i);
    expect(() => parseBoard(JSON.stringify({ ...base, viewport: { ...viewport, zoom: NaN } }))).toThrow(/finite|zoom/i);

    const duplicate: Stroke = {
      id: 'same', createdAt: 1, author: 'user', color: '#000', width: 2,
      points: [point(0, 0)],
    };
    const duplicateDoc: BoardDocument = {
      ...base,
      events: [
        { id: 'e1', time: 1, actor: 'user', kind: 'add', changes: [{ before: null, after: duplicate }] },
        { id: 'e2', time: 2, actor: 'user', kind: 'add', changes: [{ before: null, after: duplicate }] },
      ],
    };
    expect(() => parseBoard(JSON.stringify(duplicateDoc))).toThrow(/duplicate|already/i);

    const badUndo: BoardDocument = {
      ...base,
      events: [{ id: 'u1', time: 1, actor: 'user', kind: 'undo', targetId: 'missing', changes: [{ before: null, after: duplicate }] }],
    };
    expect(() => parseBoard(JSON.stringify(badUndo))).toThrow(/target|reference/i);
  });

  test('failed construction from invalid data does not affect an existing model', () => {
    const model = new BoardModel();
    model.addStroke([point(2, 2)], '#000', 1);
    const before = model.strokes;
    expect(() => new BoardModel({ events: [{ id: 'bad', time: 1, actor: 'user', kind: 'erase', changes: [] }] })).toThrow();
    expect(model.strokes).toEqual(before);
  });
});

describe('geometry', () => {
  test('screen and world transforms invert at negative offsets', () => {
    const world = { x: -7.25, y: 11.5 };
    expect(screenToWorld(worldToScreen(world, viewport), viewport)).toEqual(world);
  });

  test('zoomAt keeps the world point under the cursor fixed and clamps zoom', () => {
    const screen = { x: 44, y: 91 };
    const before = screenToWorld(screen, viewport);
    const zoomed = zoomAt(viewport, screen, 2);
    expect(zoomed.zoom).toBe(4);
    expect(screenToWorld(screen, zoomed)).toEqual(before);
    expect(zoomAt(viewport, screen, 0.001).zoom).toBe(0.1);
  });

  test('hit testing checks segments and dots from topmost to bottommost', () => {
    const bottom: Stroke = { id: 'bottom', createdAt: 1, author: 'user', color: '#000', width: 2, points: [point(0, 0), point(10, 0)] };
    const top: Stroke = { id: 'top', createdAt: 2, author: 'user', color: '#fff', width: 2, points: [point(5, 0)] };
    expect(hitTestStroke([bottom, top], { x: 5, y: 0.5 }, 1)?.id).toBe('top');
    expect(hitTestStroke([bottom], { x: 5, y: 1.9 }, 0.1)?.id).toBeUndefined();
    expect(hitTestStroke([top], { x: 5.5, y: 0 }, 0)?.id).toBe('top');
  });

  test('swept hit testing catches a stroke crossed between pointer samples', () => {
    const stroke: Stroke = {
      id: 'vertical', createdAt: 1, author: 'user', color: '#000', width: 2,
      points: [point(10, 0), point(10, 20)],
    };

    expect(hitTestStrokesAlongSegment([stroke], { x: 0, y: 10 }, { x: 20, y: 10 }, 0).map(({ id }) => id)).toEqual(['vertical']);
  });

  test('swept hit testing skips preview-erased strokes to reveal overlaps', () => {
    const bottom: Stroke = { id: 'bottom', createdAt: 1, author: 'user', color: '#000', width: 2, points: [point(0, 0), point(20, 0)] };
    const top: Stroke = { id: 'top', createdAt: 2, author: 'user', color: '#fff', width: 2, points: [point(0, 0), point(20, 0)] };

    expect(hitTestStrokesAlongSegment([bottom, top], { x: 2, y: 0 }, { x: 8, y: 0 }, 0, new Set(['top'])).map(({ id }) => id)).toEqual(['bottom']);
  });

  test('one sparse eraser segment collects every crossed visible stroke', () => {
    const left: Stroke = { id: 'left', createdAt: 1, author: 'user', color: '#000', width: 2, points: [point(5, 0), point(5, 20)] };
    const right: Stroke = { id: 'right', createdAt: 2, author: 'user', color: '#000', width: 2, points: [point(15, 0), point(15, 20)] };

    expect(hitTestStrokesAlongSegment([left, right], { x: 0, y: 10 }, { x: 20, y: 10 }, 0).map(({ id }) => id)).toEqual(['right', 'left']);
  });
});
