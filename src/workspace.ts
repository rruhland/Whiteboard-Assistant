import { AssociationModel, migrateVersion1 } from './association';
import { BoardModel, type Point, type Viewport } from './board';
import { composeBoardDocument, type BoardDocumentV2, type ParsedBoard } from './document';

export type WorkspaceState = {
  board: BoardModel;
  associations: AssociationModel;
  viewport: Viewport;
  migratedFromVersion1: boolean;
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
