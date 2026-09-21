import { AssociationModel, migrateVersion1 } from './association';
import { BoardModel, type Point, type Viewport } from './board';
import { composeBoardDocument, type BoardDocumentV2, type ParsedBoard } from './document';
import { buildTemporalIndex, projectHistory, type HistoricalProjection, type TemporalIndex } from './temporal';

export type WorkspaceState = {
  board: BoardModel;
  associations: AssociationModel;
  viewport: Viewport;
  migratedFromVersion1: boolean;
};
export type HistorySession = {
  index: TemporalIndex;
  position: number | null;
  projection: HistoricalProjection | null;
  liveViewport: Viewport;
  historicalViewport: Viewport;
  heatmapEnabled: boolean;
};

function knownStrokeIds(board: BoardModel): Set<string> {
  return new Set(board.events.flatMap(({ changes }) => changes.flatMap(({ before, after }) => [before?.id, after?.id].filter((id): id is string => id !== undefined))));
}

export function loadWorkspace(parsed: ParsedBoard): WorkspaceState {
  const board = new BoardModel(parsed.document);
  const knownIds = knownStrokeIds(board);
  const associations = parsed.sourceVersion === 1
    ? migrateVersion1(board.strokes, knownIds)
    : new AssociationModel(parsed.document.associationEvents, knownIds);
  return {
    board,
    associations,
    viewport: { ...parsed.document.viewport },
    migratedFromVersion1: parsed.sourceVersion === 1,
  };
}

export function commitStroke(
  state: WorkspaceState,
  points: Point[],
  color: string,
  width: number,
): { strokeId: string; objectId?: string; associationError?: string } {
  const strokeId = state.board.addStroke(points, color, width);
  const stroke = state.board.strokes.find(({ id }) => id === strokeId);
  if (!stroke) return { strokeId, associationError: 'Committed stroke could not be read' };
  try {
    return { strokeId, objectId: state.associations.associateStroke(stroke, state.board.strokes) };
  } catch (error) {
    return { strokeId, associationError: error instanceof Error ? error.message : String(error) };
  }
}

export function workspaceDocument(state: WorkspaceState): BoardDocumentV2 {
  return composeBoardDocument(state.board, state.associations, state.viewport);
}

export function createHistorySession(state: WorkspaceState): HistorySession {
  return {
    index: buildTemporalIndex(workspaceDocument(state)),
    position: null,
    projection: null,
    liveViewport: { ...state.viewport },
    historicalViewport: { ...state.viewport },
    heatmapEnabled: true,
  };
}

export function selectHistoryPosition(state: WorkspaceState, session: HistorySession, position: number): HistorySession {
  const projection = projectHistory(workspaceDocument(state), session.index, position);
  return { ...session, position, projection, liveViewport: { ...state.viewport }, historicalViewport: { ...session.historicalViewport } };
}

export function returnToNow(state: WorkspaceState, session: HistorySession): HistorySession {
  return { ...session, position: null, projection: null, liveViewport: { ...state.viewport }, historicalViewport: { ...state.viewport } };
}

export function rebuildHistorySession(state: WorkspaceState, session: HistorySession): HistorySession {
  const index = buildTemporalIndex(workspaceDocument(state));
  if (session.position === null) return { ...session, index, projection: null, liveViewport: { ...state.viewport } };
  const position = Math.min(session.position, index.entries.length);
  const projection = projectHistory(workspaceDocument(state), index, position);
  return { ...session, index, position, projection };
}
