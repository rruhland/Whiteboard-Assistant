import { getObjectBounds, type AssociationModel, type Bounds, type ContentObject } from './association';
import { BoardModel, type Stroke } from './board';
import type { BoardDocumentV3 } from './document';
import { projectHistory, queryChanges, type TemporalIndex } from './temporal';

export type ProposalKind = 'active-area-circle' | 'recent-work-arrow';
export type ProposalState = 'proposed' | 'approved' | 'rejected' | 'unavailable' | 'stale';
export type ProposalRevision = { inkEventCount: number; associationEventCount: number };
export type AssistantProposal = {
  id: string;
  generationId: string;
  fingerprint: string;
  kind: ProposalKind;
  state: ProposalState;
  targetObjectId: string;
  relation: 'annotates' | 'points-to';
  contextPosition: number;
  revision: ProposalRevision;
  candidateIndex: number;
  explanation: string;
  strokes: Stroke[];
  visible: boolean;
};
export type ProposalSlot = { kind: ProposalKind; proposal: AssistantProposal | null; message: string };
export type ProposalSet = { generationId: string; circle: ProposalSlot; arrow: ProposalSlot };
export type ProposalFingerprintInput = {
  kind: ProposalKind;
  targetObjectId: string;
  contextPosition: number;
  revision: ProposalRevision;
  candidateIndex: number;
  strokes: Array<Pick<Stroke, 'color' | 'width' | 'points'>>;
};

const COLOR = '#7657d6';
const WIDTH = 3;
const CIRCLE_PADDINGS = [18, 28, 38] as const;
const ARROW_OFFSETS = [0, -30, 30] as const;

export function revisionOf(document: BoardDocumentV3): ProposalRevision {
  return { inkEventCount: document.events.length, associationEventCount: document.associationEvents.length };
}

function hash(value: string): string {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return (result >>> 0).toString(36);
}

function cleanNumber(value: number): number {
  return Object.is(value, -0) ? 0 : Number(value.toFixed(6));
}

export function proposalFingerprint(input: ProposalFingerprintInput): string {
  const geometry = input.strokes.map(({ color, width, points }) => ({
    color,
    width: cleanNumber(width),
    points: points.map(({ x, y, pressure }) => ({ x: cleanNumber(x), y: cleanNumber(y), pressure: cleanNumber(pressure) })),
  }));
  return `proposal-${hash(JSON.stringify({ kind: input.kind, targetObjectId: input.targetObjectId, contextPosition: input.contextPosition, revision: input.revision, candidateIndex: input.candidateIndex, geometry }))}`;
}

function visibleState(document: BoardDocumentV3, index: TemporalIndex) {
  return projectHistory(document, index, index.entries.length);
}

function selectTarget(document: BoardDocumentV3, index: TemporalIndex, associations: AssociationModel): { object: ContentObject; bounds: Bounds } | null {
  const projection = visibleState(document, index);
  const visible = projection.board.strokes;
  const visibleIds = new Set(visible.map(({ id }) => id));
  const active = associations.objects.filter((object): object is ContentObject => object.objectType === 'content' && object.status === 'active');
  const ownerByStroke = new Map(active.flatMap((object) => object.strokeIds.map((id) => [id, object] as const)));
  const segment = index.segments.at(-1);
  const changes = queryChanges(document, index, segment ? segment.startPosition - 1 : index.entries.length, index.entries.length, { detail: 'geometry' });
  for (const entry of [...changes.entries].reverse()) {
    if (entry.source !== 'ink') continue;
    const event = document.events[entry.inkEventCount - 1];
    for (const change of [...event.changes].reverse()) {
      const value = change.after ?? change.before;
      if (!value || value.author !== 'user' || !visibleIds.has(value.id)) continue;
      const object = ownerByStroke.get(value.id);
      const bounds = object ? getObjectBounds(object, visible) : undefined;
      if (object && bounds) return { object, bounds };
    }
  }
  for (const object of [...active].sort((left, right) => right.lastAssociatedAt - left.lastAssociatedAt || left.id.localeCompare(right.id))) {
    const bounds = getObjectBounds(object, visible);
    if (bounds) return { object, bounds };
  }
  return null;
}

function rawStroke(points: Stroke['points']): Pick<Stroke, 'color' | 'width' | 'points'> {
  return { color: COLOR, width: WIDTH, points };
}

function finishProposal(
  kind: ProposalKind,
  target: ContentObject,
  contextPosition: number,
  revision: ProposalRevision,
  generationId: string,
  candidateIndex: number,
  raw: Array<Pick<Stroke, 'color' | 'width' | 'points'>>,
  explanation: string,
): AssistantProposal {
  const fingerprint = proposalFingerprint({ kind, targetObjectId: target.id, contextPosition, revision, candidateIndex, strokes: raw });
  const id = fingerprint;
  const createdAt = contextPosition;
  const strokes = raw.map((value, index): Stroke => ({ id: `${id}-stroke-${index + 1}`, createdAt, author: 'assistant', color: value.color, width: value.width, points: value.points.map((point) => ({ ...point })) }));
  return { id, generationId, fingerprint, kind, state: 'proposed', targetObjectId: target.id, relation: kind === 'active-area-circle' ? 'annotates' : 'points-to', contextPosition, revision, candidateIndex, explanation, strokes, visible: true };
}

function circleRaw(bounds: Bounds, padding: number): Array<Pick<Stroke, 'color' | 'width' | 'points'>> {
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const radiusX = Math.max((bounds.maxX - bounds.minX) / 2, 6) + padding;
  const radiusY = Math.max((bounds.maxY - bounds.minY) / 2, 6) + padding;
  const points = Array.from({ length: 25 }, (_, index) => {
    const angle = (Math.PI * 2 * index) / 24;
    return { x: cleanNumber(centerX + radiusX * Math.cos(angle)), y: cleanNumber(centerY + radiusY * Math.sin(angle)), pressure: 0.5, time: 0 };
  });
  points[points.length - 1] = { ...points[0] };
  return [rawStroke(points)];
}

type ArrowCandidate = { candidateIndex: number; raw: Array<Pick<Stroke, 'color' | 'width' | 'points'>>; score: readonly number[]; crowded: boolean };

function strokeBounds(stroke: Pick<Stroke, 'points' | 'width'>): Bounds {
  const radius = stroke.width / 2;
  return { minX: Math.min(...stroke.points.map(({ x }) => x)) - radius, minY: Math.min(...stroke.points.map(({ y }) => y)) - radius, maxX: Math.max(...stroke.points.map(({ x }) => x)) + radius, maxY: Math.max(...stroke.points.map(({ y }) => y)) + radius };
}

function intersects(left: Bounds, right: Bounds): boolean {
  return left.minX <= right.maxX && left.maxX >= right.minX && left.minY <= right.maxY && left.maxY >= right.minY;
}

function overlapArea(left: Bounds, right: Bounds): number {
  return Math.max(0, Math.min(left.maxX, right.maxX) - Math.max(left.minX, right.minX)) * Math.max(0, Math.min(left.maxY, right.maxY) - Math.max(left.minY, right.minY));
}

function arrowRaw(bounds: Bounds, directionIndex: number, offset: number): Array<Pick<Stroke, 'color' | 'width' | 'points'>> {
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  let tip = { x: bounds.maxX, y: centerY + offset };
  let start = { x: bounds.maxX + 64, y: centerY + offset };
  if (directionIndex === 1) { tip = { x: bounds.minX, y: centerY + offset }; start = { x: bounds.minX - 64, y: centerY + offset }; }
  if (directionIndex === 2) { tip = { x: centerX + offset, y: bounds.maxY }; start = { x: centerX + offset, y: bounds.maxY + 64 }; }
  if (directionIndex === 3) { tip = { x: centerX + offset, y: bounds.minY }; start = { x: centerX + offset, y: bounds.minY - 64 }; }
  const angle = Math.atan2(start.y - tip.y, start.x - tip.x);
  const head = (sign: number) => ({ x: tip.x + 16 * Math.cos(angle + sign * 0.55), y: tip.y + 16 * Math.sin(angle + sign * 0.55), pressure: 0.5, time: 0 });
  const point = (value: { x: number; y: number }) => ({ x: cleanNumber(value.x), y: cleanNumber(value.y), pressure: 0.5, time: 0 });
  return [rawStroke([point(start), point(tip)]), rawStroke([point(tip), head(1)]), rawStroke([point(tip), head(-1)])];
}

function arrowCandidates(bounds: Bounds, target: ContentObject, visible: readonly Stroke[], associations: AssociationModel): ArrowCandidate[] {
  const excluded = new Set(target.strokeIds);
  const obstacleStrokes = visible.filter(({ id }) => !excluded.has(id));
  const objectBounds = associations.objects.filter(({ id, status }) => id !== target.id && status === 'active').map((object) => getObjectBounds(object, visible)).filter((value): value is Bounds => value !== undefined);
  const candidates: ArrowCandidate[] = [];
  for (let direction = 0; direction < 4; direction += 1) for (let offsetIndex = 0; offsetIndex < ARROW_OFFSETS.length; offsetIndex += 1) {
    const candidateIndex = direction * ARROW_OFFSETS.length + offsetIndex;
    const raw = arrowRaw(bounds, direction, ARROW_OFFSETS[offsetIndex]);
    const parts = raw.map(strokeBounds);
    const strokeHits = obstacleStrokes.reduce((count, stroke) => count + (parts.some((part) => intersects(part, strokeBounds(stroke))) ? 1 : 0), 0);
    const objectHits = objectBounds.reduce((count, object) => count + (parts.some((part) => intersects(part, object)) ? 1 : 0), 0);
    const area = objectBounds.reduce((sum, object) => sum + parts.reduce((partSum, part) => partSum + overlapArea(part, object), 0), 0);
    candidates.push({ candidateIndex, raw, score: [strokeHits, objectHits, cleanNumber(area), Math.abs(ARROW_OFFSETS[offsetIndex]), direction, offsetIndex], crowded: strokeHits + objectHits > 0 });
  }
  return candidates.sort((left, right) => {
    for (let index = 0; index < left.score.length; index += 1) {
      if (left.score[index] !== right.score[index]) return left.score[index] - right.score[index];
    }
    return 0;
  });
}

function slotFor(
  kind: ProposalKind,
  document: BoardDocumentV3,
  index: TemporalIndex,
  associations: AssociationModel,
  rejected: ReadonlySet<string>,
  afterCandidateIndex: number,
  generationId?: string,
): ProposalSlot {
  const target = selectTarget(document, index, associations);
  if (!target) return { kind, proposal: null, message: 'Draw something first' };
  const revision = revisionOf(document);
  const contextPosition = index.entries.length;
  const resolvedGenerationId = generationId ?? `generation-${hash(JSON.stringify({ revision, target: target.object.id }))}`;
  if (kind === 'active-area-circle') {
    for (let candidateIndex = Math.max(0, afterCandidateIndex + 1); candidateIndex < CIRCLE_PADDINGS.length; candidateIndex += 1) {
      const proposal = finishProposal(kind, target.object, contextPosition, revision, resolvedGenerationId, candidateIndex, circleRaw(target.bounds, CIRCLE_PADDINGS[candidateIndex]), 'Circle the active content area.');
      if (!rejected.has(proposal.fingerprint)) return { kind, proposal, message: '' };
    }
    return { kind, proposal: null, message: 'No unused circle candidates remain' };
  }
  const candidates = arrowCandidates(target.bounds, target.object, visibleState(document, index).board.strokes, associations);
  for (const candidate of candidates) {
    if (candidate.candidateIndex <= afterCandidateIndex) continue;
    const explanation = candidate.crowded ? 'The board is crowded; this is the clearest nearby space.' : 'Placed in the clearest nearby space.';
    const proposal = finishProposal(kind, target.object, contextPosition, revision, resolvedGenerationId, candidate.candidateIndex, candidate.raw, explanation);
    if (!rejected.has(proposal.fingerprint)) return { kind, proposal, message: '' };
  }
  return { kind, proposal: null, message: 'No unused arrow candidates remain' };
}

export function generateProposalSet(document: BoardDocumentV3, index: TemporalIndex, associations: AssociationModel, rejected: ReadonlySet<string>): ProposalSet {
  const target = selectTarget(document, index, associations);
  const generationId = target ? `generation-${hash(JSON.stringify({ revision: revisionOf(document), target: target.object.id }))}` : `generation-${hash(JSON.stringify(revisionOf(document)))}`;
  return {
    generationId,
    circle: slotFor('active-area-circle', document, index, associations, rejected, -1, generationId),
    arrow: slotFor('recent-work-arrow', document, index, associations, rejected, -1, generationId),
  };
}

export function regenerateProposal(kind: ProposalKind, document: BoardDocumentV3, index: TemporalIndex, associations: AssociationModel, rejected: ReadonlySet<string>, afterCandidateIndex: number): ProposalSlot {
  return slotFor(kind, document, index, associations, rejected, afterCandidateIndex);
}
