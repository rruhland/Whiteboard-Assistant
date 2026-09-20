import { describe, expect, test } from 'vitest';
import {
  BoardModel,
  parseBoard,
  serializeBoard,
  type BoardDocument,
  type Point,
  type Stroke,
} from '../src/board';
import {
  hitTestStroke,
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

describe('BoardModel', () => {
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
    const document = model.toDocument(viewport);
    const restored = parseBoard(serializeBoard(document));

    expect(restored).toEqual(document);
    expect(new BoardModel(restored).strokes).toEqual(model.strokes);
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
    expect(() => parseBoard(JSON.stringify({ ...base, version: 2 }))).toThrow(/version/i);
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
    expect(() => new BoardModel({ version: 1, events: [{ id: 'bad', time: 1, actor: 'user', kind: 'erase', changes: [] }], viewport })).toThrow();
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
});
