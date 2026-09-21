import { parseBoard, serializeBoard, type BoardDocumentV3, type ParsedBoard } from './document';
import { loadWorkspace, workspaceDocument } from './workspace';

export const LEGACY_AUTOSAVE_KEY = 'whiteboard-assistant.board.v1';
export const CANVAS_CATALOG_KEY = 'whiteboard-assistant.canvases.v1';
const CANVAS_DOCUMENT_PREFIX = 'whiteboard-assistant.canvas.v1.';

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type CanvasSummary = { id: string; name: string; createdAt: number; updatedAt: number };
export type CanvasCatalogV1 = { version: 1; activeCanvasId: string; canvases: CanvasSummary[] };
export type CanvasLibrary = { catalog: CanvasCatalogV1; activeDocument: BoardDocumentV3; notice?: string };

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function blankDocument(): BoardDocumentV3 {
  return { version: 3, events: [], associationEvents: [], viewport: { x: 0, y: 0, zoom: 1 } };
}

function normalizeName(name: string): string {
  const value = name.trim();
  if (!value) throw new Error('Canvas name must not be blank');
  return value;
}

function ordered(values: readonly CanvasSummary[]): CanvasSummary[] {
  return values.map((value) => ({ ...value })).sort((left, right) => (
    right.updatedAt - left.updatedAt || right.createdAt - left.createdAt || left.id.localeCompare(right.id)
  ));
}

function cloneCatalog(catalog: CanvasCatalogV1): CanvasCatalogV1 {
  return { version: 1, activeCanvasId: catalog.activeCanvasId, canvases: ordered(catalog.canvases) };
}

function parseCatalog(json: string): CanvasCatalogV1 {
  const value: unknown = JSON.parse(json);
  if (typeof value !== 'object' || value === null) throw new Error('Canvas catalog must be an object');
  const candidate = value as Partial<CanvasCatalogV1>;
  if (candidate.version !== 1 || typeof candidate.activeCanvasId !== 'string' || !candidate.activeCanvasId) throw new Error('Canvas catalog is unsupported');
  if (!Array.isArray(candidate.canvases) || candidate.canvases.length === 0) throw new Error('Canvas catalog must contain a canvas');
  const seen = new Set<string>();
  const canvases = candidate.canvases.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) throw new Error(`Canvas catalog entry ${index} must be an object`);
    const summary = entry as Partial<CanvasSummary>;
    if (typeof summary.id !== 'string' || !summary.id || seen.has(summary.id)) throw new Error(`Canvas catalog entry ${index} has an invalid ID`);
    seen.add(summary.id);
    if (typeof summary.name !== 'string' || !summary.name.trim()) throw new Error(`Canvas catalog entry ${index} has an invalid name`);
    if (typeof summary.createdAt !== 'number' || !Number.isFinite(summary.createdAt) || typeof summary.updatedAt !== 'number' || !Number.isFinite(summary.updatedAt)) {
      throw new Error(`Canvas catalog entry ${index} has invalid timestamps`);
    }
    return { id: summary.id, name: summary.name.trim(), createdAt: summary.createdAt, updatedAt: summary.updatedAt };
  });
  if (!seen.has(candidate.activeCanvasId)) throw new Error('Canvas catalog active ID is missing');
  return { version: 1, activeCanvasId: candidate.activeCanvasId, canvases: ordered(canvases) };
}

function writeCatalog(storage: StorageLike, catalog: CanvasCatalogV1): void {
  storage.setItem(CANVAS_CATALOG_KEY, JSON.stringify(cloneCatalog(catalog)));
}

function latestCatalog(storage: StorageLike, fallback: CanvasCatalogV1): CanvasCatalogV1 {
  const raw = storage.getItem(CANVAS_CATALOG_KEY);
  return raw === null ? cloneCatalog(fallback) : parseCatalog(raw);
}

function version3(parsed: ParsedBoard): BoardDocumentV3 {
  return parsed.sourceVersion === 3 ? parsed.document : workspaceDocument(loadWorkspace(parsed));
}

function readDocument(storage: StorageLike, id: string): BoardDocumentV3 {
  const raw = storage.getItem(canvasDocumentKey(id));
  if (raw === null) throw new Error(`Canvas document ${id} is missing`);
  return version3(parseBoard(raw));
}

function recovery(identity: { id: string; now: number }, notice: string): CanvasLibrary {
  return {
    catalog: { version: 1, activeCanvasId: identity.id, canvases: [{ id: identity.id, name: 'Untitled canvas', createdAt: identity.now, updatedAt: identity.now }] },
    activeDocument: blankDocument(),
    notice,
  };
}

export function canvasDocumentKey(id: string): string {
  return `${CANVAS_DOCUMENT_PREFIX}${id}`;
}

export function initializeCanvasLibrary(storage: StorageLike, identity: { id: string; now: number }): CanvasLibrary {
  const rawCatalog = storage.getItem(CANVAS_CATALOG_KEY);
  if (rawCatalog !== null) {
    let catalog: CanvasCatalogV1;
    try {
      catalog = parseCatalog(rawCatalog);
    } catch (error) {
      return recovery(identity, `Canvas library could not be loaded: ${message(error)}`);
    }
    try {
      return { catalog, activeDocument: readDocument(storage, catalog.activeCanvasId) };
    } catch (error) {
      return { catalog, activeDocument: blankDocument(), notice: `Active canvas document could not be loaded: ${message(error)}` };
    }
  }

  let document = blankDocument();
  let notice: string | undefined;
  const legacy = storage.getItem(LEGACY_AUTOSAVE_KEY);
  if (legacy !== null) {
    try {
      document = version3(parseBoard(legacy));
    } catch (error) {
      notice = `Legacy autosave could not be loaded: ${message(error)}`;
    }
  }
  const catalog: CanvasCatalogV1 = {
    version: 1,
    activeCanvasId: identity.id,
    canvases: [{ id: identity.id, name: 'Untitled canvas', createdAt: identity.now, updatedAt: identity.now }],
  };
  try {
    storage.setItem(canvasDocumentKey(identity.id), serializeBoard(document));
    writeCatalog(storage, catalog);
    return { catalog, activeDocument: document, notice };
  } catch (error) {
    return { ...recovery(identity, `Canvas library could not be saved: ${message(error)}`), activeDocument: document };
  }
}

export function saveActiveCanvas(
  storage: StorageLike,
  catalog: CanvasCatalogV1,
  document: BoardDocumentV3,
  now: number,
): { ok: true; catalog: CanvasCatalogV1 } | { ok: false; error: string } {
  try {
    const current = latestCatalog(storage, catalog);
    if (!current.canvases.some(({ id }) => id === catalog.activeCanvasId)) throw new Error('Active canvas no longer exists');
    storage.setItem(canvasDocumentKey(catalog.activeCanvasId), serializeBoard(document));
    const candidate: CanvasCatalogV1 = {
      version: 1,
      activeCanvasId: catalog.activeCanvasId,
      canvases: current.canvases.map((summary) => summary.id === catalog.activeCanvasId ? { ...summary, updatedAt: now } : { ...summary }),
    };
    writeCatalog(storage, candidate);
    return { ok: true, catalog: cloneCatalog(candidate) };
  } catch (error) {
    return { ok: false, error: `Not saved: ${message(error)}` };
  }
}

export function createCanvas(
  storage: StorageLike,
  catalog: CanvasCatalogV1,
  name: string,
  identity: { id: string; now: number },
): { catalog: CanvasCatalogV1; document: BoardDocumentV3 } {
  const current = latestCatalog(storage, catalog);
  if (current.canvases.some(({ id }) => id === identity.id)) throw new Error('Canvas ID already exists');
  const document = blankDocument();
  const candidate: CanvasCatalogV1 = {
    version: 1,
    activeCanvasId: identity.id,
    canvases: [...current.canvases.map((summary) => ({ ...summary })), { id: identity.id, name: normalizeName(name), createdAt: identity.now, updatedAt: identity.now }],
  };
  storage.setItem(canvasDocumentKey(identity.id), serializeBoard(document));
  writeCatalog(storage, candidate);
  return { catalog: cloneCatalog(candidate), document };
}

export function renameCanvas(storage: StorageLike, catalog: CanvasCatalogV1, id: string, name: string, now: number): CanvasCatalogV1 {
  const current = latestCatalog(storage, catalog);
  if (!current.canvases.some((summary) => summary.id === id)) throw new Error('Canvas does not exist');
  const candidate: CanvasCatalogV1 = {
    version: 1,
    activeCanvasId: current.activeCanvasId,
    canvases: current.canvases.map((summary) => summary.id === id ? { ...summary, name: normalizeName(name), updatedAt: now } : { ...summary }),
  };
  writeCatalog(storage, candidate);
  return cloneCatalog(candidate);
}

export function openCanvas(storage: StorageLike, catalog: CanvasCatalogV1, id: string): { catalog: CanvasCatalogV1; document: BoardDocumentV3 } {
  const current = latestCatalog(storage, catalog);
  if (!current.canvases.some((summary) => summary.id === id)) throw new Error('Canvas does not exist');
  const document = readDocument(storage, id);
  const candidate = { ...cloneCatalog(current), activeCanvasId: id };
  writeCatalog(storage, candidate);
  return { catalog: cloneCatalog(candidate), document };
}

export function deleteCanvas(
  storage: StorageLike,
  catalog: CanvasCatalogV1,
  id: string,
  replacement: { id: string; now: number },
): { catalog: CanvasCatalogV1; document?: BoardDocumentV3; activeChanged: boolean } {
  const current = latestCatalog(storage, catalog);
  if (!current.canvases.some((summary) => summary.id === id)) throw new Error('Canvas does not exist');
  const activeChanged = current.activeCanvasId === id;
  const remaining = ordered(current.canvases.filter((summary) => summary.id !== id));
  if (remaining.length) {
    const activeCanvasId = activeChanged ? remaining[0].id : current.activeCanvasId;
    const document = activeChanged ? readDocument(storage, activeCanvasId) : undefined;
    const candidate: CanvasCatalogV1 = { version: 1, activeCanvasId, canvases: remaining };
    writeCatalog(storage, candidate);
    storage.removeItem(canvasDocumentKey(id));
    return { catalog: cloneCatalog(candidate), document, activeChanged };
  }

  const document = blankDocument();
  const candidate: CanvasCatalogV1 = {
    version: 1,
    activeCanvasId: replacement.id,
    canvases: [{ id: replacement.id, name: 'Untitled canvas', createdAt: replacement.now, updatedAt: replacement.now }],
  };
  storage.setItem(canvasDocumentKey(replacement.id), serializeBoard(document));
  writeCatalog(storage, candidate);
  storage.removeItem(canvasDocumentKey(id));
  return { catalog: cloneCatalog(candidate), document, activeChanged: true };
}

export function readPortableBoard(json: string, current: ParsedBoard): { document: ParsedBoard; replaced: boolean; error?: string } {
  try {
    return { document: parseBoard(json), replaced: true };
  } catch (error) {
    return { document: current, replaced: false, error: `Open failed: ${message(error)}` };
  }
}
