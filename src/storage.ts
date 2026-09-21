import { parseBoard, serializeBoard, type BoardDocumentV3, type ParsedBoard } from './document';

export const AUTOSAVE_KEY = 'whiteboard-assistant.board.v1';

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function saveAutosave(storage: StorageLike, document: BoardDocumentV3): { ok: true } | { ok: false; error: string } {
  try {
    storage.setItem(AUTOSAVE_KEY, serializeBoard(document));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `Not saved: ${message(error)}` };
  }
}

export function loadAutosave(storage: StorageLike): { document?: ParsedBoard; error?: string } {
  try {
    const saved = storage.getItem(AUTOSAVE_KEY);
    return saved === null ? {} : { document: parseBoard(saved) };
  } catch (error) {
    return { error: `Autosave could not be loaded: ${message(error)}` };
  }
}

export function readPortableBoard(
  json: string,
  current: ParsedBoard,
): { document: ParsedBoard; replaced: boolean; error?: string } {
  try {
    return { document: parseBoard(json), replaced: true };
  } catch (error) {
    return { document: current, replaced: false, error: `Open failed: ${message(error)}` };
  }
}

export function openPortableBoard(
  json: string,
  current: ParsedBoard,
  storage: StorageLike | null,
): { document: ParsedBoard; replaced: boolean; error?: string } {
  const opened = readPortableBoard(json, current);
  if (!opened.replaced) return opened;
  if (!storage) return { ...opened, error: 'Not saved: local storage is unavailable' };
  const stateDocument = opened.document.sourceVersion === 3 ? opened.document.document : null;
  if (!stateDocument) return opened;
  const saved = saveAutosave(storage, stateDocument);
  return saved.ok ? opened : { ...opened, error: saved.error };
}
