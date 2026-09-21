import { AssociationModel, getObjectBounds, type AnnotationObject, type AssociationEvent, type ContentObject } from './association';
import { BoardModel, createAddEvent, createEraseEvent, type EventIdentity, type Stroke } from './board';
import { generateProposalSet, regenerateProposal, revisionOf, type AssistantProposal, type ProposalKind, type ProposalSet, type ProposalSlot } from './assistant-planner';
import { workspaceDocument, type HistorySession, type WorkspaceState } from './workspace';

export type AssistantSession = {
  proposals: ProposalSet | null;
  rejectedFingerprints: Set<string>;
};
export type WorkspaceMutation = 'ink' | 'undo' | 'redo' | 'association' | 'import' | 'assistant-approval' | 'partial-erase' | 'annotation-delete' | 'viewport';

function cloneSession(session: AssistantSession): AssistantSession {
  return { proposals: session.proposals ? structuredClone(session.proposals) : null, rejectedFingerprints: new Set(session.rejectedFingerprints) };
}

function slotName(kind: ProposalKind): 'circle' | 'arrow' {
  return kind === 'active-area-circle' ? 'circle' : 'arrow';
}

function replaceSlot(proposals: ProposalSet, kind: ProposalKind, slot: ProposalSlot): ProposalSet {
  return { ...structuredClone(proposals), [slotName(kind)]: structuredClone(slot) };
}

export function createAssistantSession(): AssistantSession {
  return { proposals: null, rejectedFingerprints: new Set() };
}

export function hasAssistantCandidate(session: AssistantSession): boolean {
  return Boolean(session.proposals?.circle.proposal || session.proposals?.arrow.proposal);
}

function requireLive(history: HistorySession): void {
  if (history.position !== null) throw new Error('Assistant actions are available only at Now, not in historical mode');
}

export function generateAssistantSession(workspace: WorkspaceState, history: HistorySession, session: AssistantSession): AssistantSession {
  requireLive(history);
  return { proposals: generateProposalSet(workspaceDocument(workspace), history.index, workspace.associations, session.rejectedFingerprints), rejectedFingerprints: new Set(session.rejectedFingerprints) };
}

export function rejectAssistantProposal(session: AssistantSession, kind: ProposalKind): AssistantSession {
  const next = cloneSession(session);
  if (!next.proposals) throw new Error('No assistant proposals are available');
  const slot = next.proposals[slotName(kind)];
  if (!slot.proposal || slot.proposal.state !== 'proposed') throw new Error('Only a proposed suggestion can be rejected');
  next.rejectedFingerprints.add(slot.proposal.fingerprint);
  slot.proposal.state = 'rejected';
  slot.proposal.visible = false;
  slot.message = 'Rejected for this session';
  return next;
}

export function regenerateAssistantSlot(workspace: WorkspaceState, history: HistorySession, session: AssistantSession, kind: ProposalKind): AssistantSession {
  requireLive(history);
  const next = cloneSession(session);
  if (!next.proposals) throw new Error('No assistant proposals are available');
  const current = next.proposals[slotName(kind)];
  const afterCandidateIndex = current.proposal?.candidateIndex ?? -1;
  const slot = regenerateProposal(kind, workspaceDocument(workspace), history.index, workspace.associations, next.rejectedFingerprints, afterCandidateIndex);
  next.proposals = replaceSlot(next.proposals, kind, slot);
  return next;
}

export function setProposalVisibility(session: AssistantSession, kind: ProposalKind, visible: boolean): AssistantSession {
  const next = cloneSession(session);
  const proposal = next.proposals?.[slotName(kind)].proposal;
  if (!proposal || proposal.state !== 'proposed') return next;
  proposal.visible = visible;
  return next;
}

export function invalidateAssistantSession(session: AssistantSession, message = 'Canvas changed. Regenerate this suggestion.'): AssistantSession {
  const next = cloneSession(session);
  if (!next.proposals) return next;
  for (const slot of [next.proposals.circle, next.proposals.arrow]) {
    if (!slot.proposal || slot.proposal.state === 'approved' || slot.proposal.state === 'rejected') continue;
    slot.proposal.state = 'stale';
    slot.proposal.visible = false;
    slot.message = message;
  }
  return next;
}

export function afterWorkspaceMutation(session: AssistantSession, mutation: WorkspaceMutation, approvedGenerationId?: string): AssistantSession {
  if (mutation === 'viewport') return cloneSession(session);
  if (mutation !== 'assistant-approval') return invalidateAssistantSession(session);
  const next = cloneSession(session);
  if (!next.proposals) return next;
  for (const slot of [next.proposals.circle, next.proposals.arrow]) {
    if (!slot.proposal || slot.proposal.generationId === approvedGenerationId) continue;
    slot.proposal.state = 'stale';
    slot.proposal.visible = false;
    slot.message = 'Canvas changed. Regenerate this suggestion.';
  }
  return next;
}

function validGeometry(strokes: readonly Stroke[]): boolean {
  return strokes.length > 0 && strokes.every((stroke) => stroke.author === 'assistant' && stroke.id.length > 0 && stroke.color.length > 0 && Number.isFinite(stroke.createdAt) && Number.isFinite(stroke.width) && stroke.width > 0 && stroke.points.length > 0 && stroke.points.every(({ x, y, pressure, time }) => [x, y, pressure, time].every(Number.isFinite)));
}

function targetFor(workspace: WorkspaceState, proposal: AssistantProposal): ContentObject {
  const target = workspace.associations.objects.find(({ id }) => id === proposal.targetObjectId);
  if (!target || target.objectType !== 'content' || target.status !== 'active' || !getObjectBounds(target, workspace.board.strokes)) throw new Error('Assistant proposal target is missing or no longer visible');
  return target;
}

function knownStrokeIds(board: BoardModel): Set<string> {
  return new Set(board.events.flatMap(({ changes }) => changes.flatMap(({ before, after }) => [before?.id, after?.id].filter((id): id is string => id !== undefined))));
}

function assertNoIdCollisions(workspace: WorkspaceState, proposal: AssistantProposal): void {
  const strokeIds = knownStrokeIds(workspace.board);
  if (proposal.strokes.some(({ id }) => strokeIds.has(id)) || new Set(proposal.strokes.map(({ id }) => id)).size !== proposal.strokes.length) throw new Error('Assistant proposal has a duplicate stroke ID');
  const eventIds = new Set(workspace.board.events.map(({ id }) => id));
  if (eventIds.has(`event:${proposal.id}`)) throw new Error('Assistant proposal event ID already exists');
  const objectIds = new Set(workspace.associations.objects.map(({ id }) => id));
  if (objectIds.has(`annotation:${proposal.id}`)) throw new Error('Assistant annotation ID already exists');
  if (workspace.associations.events.some(({ id }) => id === `association:${proposal.id}`)) throw new Error('Assistant association ID already exists');
}

function revalidateSibling(workspace: WorkspaceState, sibling: AssistantProposal, generationId: string): AssistantProposal {
  const next = structuredClone(sibling);
  if (next.generationId !== generationId || next.state !== 'proposed') return next;
  try {
    targetFor(workspace, next);
    if (!validGeometry(next.strokes)) throw new Error('invalid geometry');
    assertNoIdCollisions(workspace, next);
    next.revision = revisionOf(workspaceDocument(workspace));
    return next;
  } catch {
    next.state = 'stale';
    next.visible = false;
    return next;
  }
}

export function approveAssistantProposal(workspace: WorkspaceState, history: HistorySession, session: AssistantSession, kind: ProposalKind, time: number): { session: AssistantSession; annotationId: string } {
  requireLive(history);
  if (!Number.isFinite(time)) throw new Error('Approval time must be finite');
  const proposals = session.proposals;
  const proposal = proposals?.[slotName(kind)].proposal;
  if (!proposals || !proposal || proposal.state !== 'proposed') throw new Error('Only a proposed assistant suggestion can be approved');
  if (session.rejectedFingerprints.has(proposal.fingerprint)) throw new Error('Rejected assistant proposal cannot be approved');
  const currentRevision = revisionOf(workspaceDocument(workspace));
  if (proposal.revision.inkEventCount !== currentRevision.inkEventCount || proposal.revision.associationEventCount !== currentRevision.associationEventCount) throw new Error('Assistant proposal has a stale revision');
  targetFor(workspace, proposal);
  if (!validGeometry(proposal.strokes)) throw new Error('Assistant proposal geometry must be finite and valid');
  assertNoIdCollisions(workspace, proposal);

  const add = createAddEvent(proposal.strokes, 'assistant', { id: `event:${proposal.id}`, time });
  const candidateBoard = new BoardModel({ events: [...workspace.board.events, add] });
  const annotationId = `annotation:${proposal.id}`;
  const annotation: AnnotationObject = {
    objectType: 'annotation', id: annotationId,
    label: proposal.kind === 'active-area-circle' ? 'Assistant circle' : 'Assistant arrow',
    strokeIds: proposal.strokes.map(({ id }) => id), createdAt: time, lastAssociatedAt: time, status: 'active', parentIds: [],
    annotationKind: proposal.kind === 'active-area-circle' ? 'circle' : 'arrow', links: [{ type: proposal.relation, targetObjectId: proposal.targetObjectId }],
    proposalId: proposal.id, contextPosition: proposal.contextPosition, createdBy: 'assistant', approvedAt: time,
  };
  const association: AssociationEvent = { id: `association:${proposal.id}`, time, actor: 'user', kind: 'assistant-annotation', reason: 'Approved assistant suggestion', changes: [{ before: null, after: annotation }] };
  const candidateAssociations = new AssociationModel([...workspace.associations.events, association], knownStrokeIds(candidateBoard));

  workspace.board = candidateBoard;
  workspace.associations = candidateAssociations;

  const next = cloneSession(session);
  const approved = next.proposals?.[slotName(kind)].proposal as AssistantProposal;
  approved.state = 'approved';
  approved.visible = false;
  if (next.proposals) {
    const siblingName = kind === 'active-area-circle' ? 'arrow' : 'circle';
    const sibling = next.proposals[siblingName].proposal;
    if (sibling) next.proposals[siblingName].proposal = revalidateSibling(workspace, sibling, proposal.generationId);
  }
  return { session: next, annotationId };
}

export function deleteAnnotation(workspace: WorkspaceState, history: HistorySession, annotationId: string, identity: EventIdentity): string | null {
  requireLive(history);
  const object = workspace.associations.objects.find(({ id }) => id === annotationId);
  if (!object || object.objectType !== 'annotation') throw new Error(`${annotationId} is not an annotation`);
  const members = new Set(object.strokeIds);
  const visible = workspace.board.strokes.filter(({ id }) => members.has(id));
  if (visible.length === 0) return null;
  const erase = createEraseEvent(visible, identity);
  const candidate = new BoardModel({ events: [...workspace.board.events, erase] });
  workspace.board = candidate;
  return identity.id;
}
