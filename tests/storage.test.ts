import { describe, expect, it } from 'vitest';
import type { BoardDocumentV2, ParsedBoard } from '../src/document';
import {
  AUTOSAVE_KEY,
  loadAutosave,
  openPortableBoard,
  readPortableBoard,
  saveAutosave,
  type StorageLike,
} from '../src/storage';

const empty: BoardDocumentV2 = { version: 2, events: [], associationEvents: [], viewport: { x: 4, y: 8, zoom: 1.25 } };
const parsedEmpty: ParsedBoard = { sourceVersion: 2, document: empty };

function memoryStorage(initial?: string): StorageLike {
  let value = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_key, next) => {
      value = next;
    },
  };
}

describe('board persistence', () => {
  it('round-trips autosave documents including their viewport', () => {
    const storage = memoryStorage();

    expect(saveAutosave(storage, empty)).toEqual({ ok: true });
    expect(loadAutosave(storage)).toEqual({ document: parsedEmpty });
  });

  it('reports unavailable storage instead of claiming a save succeeded', () => {
    const storage: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded');
      },
    };

    expect(saveAutosave(storage, empty)).toEqual({ ok: false, error: 'Not saved: quota exceeded' });
  });

  it('returns a usable empty result and explanation for a corrupt autosave', () => {
    const result = loadAutosave(memoryStorage('{broken'));

    expect(result.document).toBeUndefined();
    expect(result.error).toMatch(/^Autosave could not be loaded:/);
  });

  it('retains the current document when portable JSON is malformed', () => {
    const current = parsedEmpty;
    const result = readPortableBoard('{broken', current);

    expect(result.document).toBe(current);
    expect(result.replaced).toBe(false);
    expect(result.error).toMatch(/^Open failed:/);
  });

  it('accepts a valid portable document and reports replacement', () => {
    const current: ParsedBoard = { sourceVersion: 2, document: { ...empty, viewport: { x: 0, y: 0, zoom: 1 } } };
    const result = readPortableBoard(JSON.stringify(empty), current);

    expect(result).toEqual({ document: parsedEmpty, replaced: true });
    expect(AUTOSAVE_KEY).toContain('whiteboard');
  });

  it('keeps a storage failure visible after opening a valid portable board', () => {
    const unavailable: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded');
      },
    };

    const result = openPortableBoard(JSON.stringify(empty), parsedEmpty, unavailable);

    expect(result.document).toEqual(parsedEmpty);
    expect(result.replaced).toBe(true);
    expect(result.error).toBe('Not saved: quota exceeded');
  });
});
