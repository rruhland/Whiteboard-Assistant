import { describe, expect, test } from 'vitest';
import { deriveAssistantPanelCards, visiblePreviewStrokes, type AssistantPanelState } from '../src/assistant-panel';
import { generateProposalSet, type ProposalState } from '../src/assistant-planner';
import { plannerFixture } from './assistant-fixtures';

function panelState(): AssistantPanelState {
  const fixture = plannerFixture();
  return { open: true, readOnly: false, proposals: generateProposalSet(fixture.document, fixture.index, fixture.associations, new Set()) };
}

function cardFor(state: ProposalState, options: { readOnly?: boolean } = {}) {
  const value = panelState();
  const proposal = value.proposals!.circle.proposal!;
  if (state === 'unavailable') value.proposals!.circle.proposal = null;
  else proposal.state = state;
  value.readOnly = options.readOnly ?? false;
  return deriveAssistantPanelCards(value).find(({ kind }) => kind === 'active-area-circle')!;
}

describe('assistant proposal panel', () => {
  test('derives independent controls for proposed, rejected, approved, unavailable, stale, and read-only cards', () => {
    expect(cardFor('proposed')).toMatchObject({ canApprove: true, canReject: true, canRegenerate: false, canToggle: true });
    expect(cardFor('rejected')).toMatchObject({ canApprove: false, canReject: false, canRegenerate: true, canToggle: false });
    expect(cardFor('approved')).toMatchObject({ canApprove: false, canReject: false, canRegenerate: false, canToggle: false });
    expect(cardFor('stale')).toMatchObject({ canRegenerate: true, canApprove: false });
    expect(cardFor('unavailable')).toMatchObject({ canApprove: false, canRegenerate: false });
    expect(cardFor('proposed', { readOnly: true })).toMatchObject({ canApprove: false, canReject: false, canRegenerate: false });
  });

  test('renders target, explanation, provenance, and accessible preview state without raw IDs as primary copy', () => {
    const card = deriveAssistantPanelCards(panelState()).find(({ kind }) => kind === 'recent-work-arrow')!;
    expect(card.title).toBe('Recent-work arrow');
    expect(card.explanation).toMatch(/clearest nearby space/i);
    expect(card.previewLabel).toMatch(/arrow preview/i);
    expect(card.provenance).toMatch(/assistant/i);
  });

  test('returns defensive strokes only from proposed visible cards', () => {
    const proposals = panelState().proposals!;
    proposals.arrow.proposal!.visible = false;
    const expected = proposals.circle.proposal!.strokes.map(({ id }) => id);
    const strokes = visiblePreviewStrokes(proposals);
    expect(strokes.map(({ id }) => id)).toEqual(expected);
    strokes[0].points[0].x = 999;
    expect(visiblePreviewStrokes(proposals)[0].points[0].x).not.toBe(999);
  });
});
