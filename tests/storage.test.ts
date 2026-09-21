import { describe, expect, test } from 'vitest';
import type { BoardDocumentV3, ParsedBoard } from '../src/document';
import {
  CANVAS_CATALOG_KEY,
  LEGACY_AUTOSAVE_KEY,
  canvasDocumentKey,
  createCanvas,
  deleteCanvas,
  initializeCanvasLibrary,
  openCanvas,
  readPortableBoard,
  renameCanvas,
  saveActiveCanvas,
  type CanvasCatalogV1,
  type StorageLike,
} from '../src/storage';

const empty: BoardDocumentV3 = { version: 3, events: [], associationEvents: [], viewport: { x: 0, y: 0, zoom: 1 } };
const filledDocument: BoardDocumentV3 = {
  ...empty,
  viewport: { x: 4, y: 8, zoom: 1.25 },
  events: [{ id: 'add', time: 1, actor: 'user', kind: 'add', changes: [{ before: null, after: { id: 'stroke', createdAt: 1, author: 'user', color: '#000', width: 2, points: [{ x: 1, y: 2, pressure: 0.5, time: 1 }] } }] }],
};
const summary = (id: string, name = id, updatedAt = 1) => ({ id, name, createdAt: 1, updatedAt });

function memoryStorage(initial: Record<string, string> = {}, failOnSet = Infinity): StorageLike & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial));
  let writes = 0;
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      writes += 1;
      if (writes === failOnSet) throw new Error('quota exceeded');
      values.set(key, value);
    },
    removeItem: (key) => { values.delete(key); },
  };
}

describe('canvas library persistence', () => {
  test('migrates the legacy autosave once into an Untitled canvas', () => {
    const storage = memoryStorage({ [LEGACY_AUTOSAVE_KEY]: JSON.stringify(filledDocument) });
    const first = initializeCanvasLibrary(storage, { id: 'canvas-a', now: 100 });
    expect(first.catalog).toEqual({ version: 1, activeCanvasId: 'canvas-a', canvases: [{ id: 'canvas-a', name: 'Untitled canvas', createdAt: 100, updatedAt: 100 }] });
    expect(first.activeDocument).toEqual(filledDocument);
    const second = initializeCanvasLibrary(storage, { id: 'unused', now: 200 });
    expect(second.catalog).toEqual(first.catalog);
    expect(storage.getItem(LEGACY_AUTOSAVE_KEY)).not.toBeNull();
  });

  test('keeps documents isolated while create, save, and open update the catalog', () => {
    const storage = memoryStorage();
    const initial = initializeCanvasLibrary(storage, { id: 'a', now: 1 });
    const created = createCanvas(storage, initial.catalog, '  Second  ', { id: 'b', now: 2 });
    const saved = saveActiveCanvas(storage, created.catalog, filledDocument, 3);
    expect(saved.ok).toBe(true);
    const reopened = openCanvas(storage, saved.ok ? saved.catalog : created.catalog, 'a');
    expect(reopened.document.events).toEqual([]);
    expect(openCanvas(storage, reopened.catalog, 'b').document).toEqual(filledDocument);
    expect(created.catalog.canvases.find(({ id }) => id === 'b')?.name).toBe('Second');
  });

  test('renames duplicate names, deletes inactive and active canvases, and replaces the last canvas', () => {
    const storage = memoryStorage();
    const library = initializeCanvasLibrary(storage, { id: 'a', now: 1 });
    const second = createCanvas(storage, library.catalog, 'Same', { id: 'b', now: 2 });
    const renamed = renameCanvas(storage, second.catalog, 'a', 'Same', 3);
    expect(renamed.canvases.map(({ name }) => name)).toEqual(['Same', 'Same']);
    const withoutA = deleteCanvas(storage, renamed, 'a', { id: 'unused', now: 4 });
    expect(withoutA.activeChanged).toBe(false);
    const replacement = deleteCanvas(storage, withoutA.catalog, 'b', { id: 'c', now: 5 });
    expect(replacement.activeChanged).toBe(true);
    expect(replacement.catalog.canvases).toEqual([{ id: 'c', name: 'Untitled canvas', createdAt: 5, updatedAt: 5 }]);
    expect(replacement.document?.events).toEqual([]);
  });

  test('opens the most recently updated remaining canvas after deleting the active canvas', () => {
    const catalog: CanvasCatalogV1 = { version: 1, activeCanvasId: 'active', canvases: [summary('older', 'Older', 2), summary('newer', 'Newer', 3), summary('active', 'Active', 4)] };
    const storage = memoryStorage({
      [CANVAS_CATALOG_KEY]: JSON.stringify(catalog),
      [canvasDocumentKey('older')]: JSON.stringify(empty),
      [canvasDocumentKey('newer')]: JSON.stringify(filledDocument),
      [canvasDocumentKey('active')]: JSON.stringify(empty),
    });
    const result = deleteCanvas(storage, catalog, 'active', { id: 'unused', now: 9 });
    expect(result.catalog.activeCanvasId).toBe('newer');
    expect(result.document).toEqual(filledDocument);
  });

  test('rejects blank names and malformed target documents without changing the active catalog', () => {
    const storage = memoryStorage();
    const library = initializeCanvasLibrary(storage, { id: 'a', now: 1 });
    expect(() => createCanvas(storage, library.catalog, '   ', { id: 'b', now: 2 })).toThrow(/name/i);
    storage.setItem(canvasDocumentKey('broken'), '{broken');
    const catalog = { ...library.catalog, canvases: [...library.catalog.canvases, { id: 'broken', name: 'Broken', createdAt: 2, updatedAt: 2 }] };
    storage.setItem(CANVAS_CATALOG_KEY, JSON.stringify(catalog));
    expect(() => openCanvas(storage, catalog, 'broken')).toThrow(/JSON|document/i);
    expect(catalog.activeCanvasId).toBe('a');
  });

  test('recovers to an in-memory blank canvas without overwriting a malformed catalog', () => {
    const storage = memoryStorage({ [CANVAS_CATALOG_KEY]: '{broken' });
    const result = initializeCanvasLibrary(storage, { id: 'recovery', now: 9 });
    expect(result.catalog.activeCanvasId).toBe('recovery');
    expect(result.activeDocument.events).toEqual([]);
    expect(result.notice).toMatch(/could not be loaded/i);
    expect(storage.getItem(CANVAS_CATALOG_KEY)).toBe('{broken');
    expect(saveActiveCanvas(storage, result.catalog, empty, 10)).toMatchObject({ ok: false });
    expect(storage.getItem(CANVAS_CATALOG_KEY)).toBe('{broken');
  });

  test('retains a valid catalog when its active document is malformed', () => {
    const catalog: CanvasCatalogV1 = { version: 1, activeCanvasId: 'broken', canvases: [summary('healthy', 'Healthy', 2), summary('broken', 'Broken', 3)] };
    const storage = memoryStorage({
      [CANVAS_CATALOG_KEY]: JSON.stringify(catalog),
      [canvasDocumentKey('healthy')]: JSON.stringify(filledDocument),
      [canvasDocumentKey('broken')]: '{broken',
    });
    const library = initializeCanvasLibrary(storage, { id: 'recovery', now: 9 });
    expect(library.catalog).toEqual({ ...catalog, canvases: [summary('broken', 'Broken', 3), summary('healthy', 'Healthy', 2)] });
    expect(library.activeDocument).toEqual(empty);
    expect(library.notice).toMatch(/document/i);
    const saved = saveActiveCanvas(storage, library.catalog, empty, 10);
    expect(saved.ok).toBe(true);
    expect(JSON.parse(storage.getItem(CANVAS_CATALOG_KEY)!)).toMatchObject({ canvases: expect.arrayContaining([expect.objectContaining({ id: 'healthy' }), expect.objectContaining({ id: 'broken' })]) });
  });

  test('merges stale-tab saves and mutations with the latest stored catalog', () => {
    const storage = memoryStorage();
    const first = initializeCanvasLibrary(storage, { id: 'a', now: 1 });
    const stale = initializeCanvasLibrary(storage, { id: 'unused', now: 2 }).catalog;
    createCanvas(storage, first.catalog, 'B', { id: 'b', now: 3 });

    const saved = saveActiveCanvas(storage, stale, filledDocument, 4);
    expect(saved.ok && saved.catalog.canvases.map(({ id }) => id).sort()).toEqual(['a', 'b']);
    const renamed = renameCanvas(storage, stale, 'a', 'Renamed A', 5);
    expect(renamed.canvases.map(({ id }) => id).sort()).toEqual(['a', 'b']);
    const deleted = deleteCanvas(storage, stale, 'a', { id: 'unused', now: 6 });
    expect(deleted.catalog.canvases.map(({ id }) => id)).toEqual(['b']);
  });

  test.each([1, 2])('does not publish created catalog state when staged write %s fails', (failOnSet) => {
    const storage = memoryStorage({}, failOnSet);
    const original: CanvasCatalogV1 = { version: 1, activeCanvasId: 'a', canvases: [summary('a', 'A')] };
    expect(() => createCanvas(storage, original, 'B', { id: 'b', now: 2 })).toThrow(/quota/i);
    expect(original).toEqual({ version: 1, activeCanvasId: 'a', canvases: [summary('a', 'A')] });
  });

  test('reports an active-document save failure without publishing new catalog state', () => {
    const storage = memoryStorage({}, 1);
    const catalog: CanvasCatalogV1 = { version: 1, activeCanvasId: 'a', canvases: [summary('a', 'A')] };
    expect(saveActiveCanvas(storage, catalog, filledDocument, 2)).toEqual({ ok: false, error: 'Not saved: quota exceeded' });
    expect(catalog.canvases[0].updatedAt).toBe(1);
  });
});

describe('portable board parsing', () => {
  test('retains the current document when portable JSON is malformed', () => {
    const current: ParsedBoard = { sourceVersion: 3, document: empty };
    const result = readPortableBoard('{broken', current);
    expect(result.document).toBe(current);
    expect(result.replaced).toBe(false);
    expect(result.error).toMatch(/^Open failed:/);
  });

  test('accepts a valid portable document without canvas metadata', () => {
    const current: ParsedBoard = { sourceVersion: 3, document: empty };
    expect(readPortableBoard(JSON.stringify(filledDocument), current)).toEqual({ document: { sourceVersion: 3, document: filledDocument }, replaced: true });
  });
});
