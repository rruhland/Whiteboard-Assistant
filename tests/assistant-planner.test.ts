import { describe, expect, test } from 'vitest';
import { generateProposalSet, regenerateProposal } from '../src/assistant-planner';
import { annotationDominatedFixture, annotationOnlyFixture, clearBoardFixture, crowdedFixture, emptyPlannerFixture, plannerFixture, regressingPlannerFixture, rightBlockedFixture } from './assistant-fixtures';

describe('assistant proposal planner', () => {
  test('targets the content object owning the most recently changed visible user stroke', () => {
    const fixture = plannerFixture({ currentSegmentStrokeOrder: ['old-object-stroke', 'recent-object-stroke'] });
    const proposals = generateProposalSet(fixture.document, fixture.index, fixture.associations, new Set());
    expect(proposals.circle.proposal?.targetObjectId).toBe('recent-object');
    expect(proposals.arrow.proposal?.targetObjectId).toBe('recent-object');
  });

  test('ignores assistant annotations and falls back deterministically to visible content', () => {
    const fixture = annotationDominatedFixture();
    expect(generateProposalSet(fixture.document, fixture.index, fixture.associations, new Set()).circle.proposal?.targetObjectId).toBe('content-latest');
  });

  test('returns unavailable slots for an empty or annotation-only board', () => {
    for (const fixture of [emptyPlannerFixture(), annotationOnlyFixture()]) {
      const result = generateProposalSet(fixture.document, fixture.index, fixture.associations, new Set());
      expect([result.circle, result.arrow].every(({ proposal, message }) => proposal === null && message === 'Draw something first')).toBe(true);
    }
  });

  test('uses timeline order rather than the largest timestamp when source times regress', () => {
    const fixture = regressingPlannerFixture({ firstTime: 20_000, secondTime: 10_000 });
    expect(generateProposalSet(fixture.document, fixture.index, fixture.associations, new Set()).circle.proposal?.targetObjectId).toBe('second-source-entry-object');
  });

  test.each([
    [{ minX: 10, minY: 20, maxX: 10, maxY: 20 }, 0],
    [{ minX: -30, minY: -10, maxX: 50, maxY: 30 }, 1],
  ])('builds a closed finite ellipse for bounds %o', (bounds, candidateIndex) => {
    const fixture = plannerFixture({ bounds });
    let slot = generateProposalSet(fixture.document, fixture.index, fixture.associations, new Set()).circle;
    if (candidateIndex) slot = regenerateProposal('active-area-circle', fixture.document, fixture.index, fixture.associations, new Set([slot.proposal!.fingerprint]), slot.proposal!.candidateIndex);
    const proposal = slot.proposal!;
    expect(proposal.strokes[0].points.at(-1)).toEqual(proposal.strokes[0].points[0]);
    expect(proposal.strokes[0].points.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
    expect(proposal.fingerprint).toBe(regenerateProposal('active-area-circle', fixture.document, fixture.index, fixture.associations, new Set(), proposal.candidateIndex - 1).proposal?.fingerprint);
  });

  test('circle regeneration skips rejected padding variants and exhausts cleanly', () => {
    const fixture = plannerFixture();
    const first = generateProposalSet(fixture.document, fixture.index, fixture.associations, new Set()).circle.proposal!;
    const second = regenerateProposal('active-area-circle', fixture.document, fixture.index, fixture.associations, new Set([first.fingerprint]), first.candidateIndex);
    expect(second.proposal?.candidateIndex).toBeGreaterThan(first.candidateIndex);
    const rejected = new Set<string>();
    let slot = generateProposalSet(fixture.document, fixture.index, fixture.associations, rejected).circle;
    while (slot.proposal) { rejected.add(slot.proposal.fingerprint); slot = regenerateProposal('active-area-circle', fixture.document, fixture.index, fixture.associations, rejected, slot.proposal.candidateIndex); }
    expect(slot.message).toMatch(/unused circle/i);
  });

  test('chooses clear right placement before equally clear alternatives', () => {
    const fixture = clearBoardFixture();
    expect(generateProposalSet(fixture.document, fixture.index, fixture.associations, new Set()).arrow.proposal?.candidateIndex).toBe(0);
  });

  test('moves to the lowest-collision side and skips rejected fingerprints', () => {
    const fixture = rightBlockedFixture();
    const first = generateProposalSet(fixture.document, fixture.index, fixture.associations, new Set()).arrow.proposal!;
    expect(Math.floor(first.candidateIndex / 3)).toBe(1);
    const next = regenerateProposal('recent-work-arrow', fixture.document, fixture.index, fixture.associations, new Set([first.fingerprint]), first.candidateIndex);
    expect(next.proposal?.fingerprint).not.toBe(first.fingerprint);
  });

  test('returns a finite stable candidate on a fully occupied board', () => {
    const fixture = crowdedFixture();
    const first = generateProposalSet(fixture.document, fixture.index, fixture.associations, new Set()).arrow.proposal!;
    const second = generateProposalSet(fixture.document, fixture.index, fixture.associations, new Set()).arrow.proposal!;
    expect(second).toEqual(first);
    expect(first.strokes.flatMap(({ points }) => points).every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
    expect(first.explanation).toMatch(/crowded/i);
  });
});
