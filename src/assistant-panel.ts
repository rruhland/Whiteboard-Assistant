import type { Stroke } from './board';
import type { ProposalKind, ProposalSet, ProposalState } from './assistant-planner';

export type AssistantPanelState = { open: boolean; proposals: ProposalSet | null; readOnly: boolean };
export type AssistantPanelActions = {
  onClose(): void;
  onGenerate(): void;
  onApprove(kind: ProposalKind): void;
  onReject(kind: ProposalKind): void;
  onRegenerate(kind: ProposalKind): void;
  onTogglePreview(kind: ProposalKind, visible: boolean): void;
};
export type AssistantPanelCard = {
  kind: ProposalKind;
  title: string;
  state: ProposalState;
  explanation: string;
  targetLabel: string;
  provenance: string;
  previewLabel: string;
  previewVisible: boolean;
  canApprove: boolean;
  canReject: boolean;
  canRegenerate: boolean;
  canToggle: boolean;
};

const kinds: ProposalKind[] = ['active-area-circle', 'recent-work-arrow'];
const slotFor = (proposals: ProposalSet, kind: ProposalKind) => kind === 'active-area-circle' ? proposals.circle : proposals.arrow;

export function deriveAssistantPanelCards(state: AssistantPanelState): AssistantPanelCard[] {
  if (!state.proposals) return [];
  return kinds.map((kind) => {
    const slot = slotFor(state.proposals as ProposalSet, kind);
    const proposal = slot.proposal;
    const proposalState = proposal?.state ?? 'unavailable';
    const proposed = proposalState === 'proposed';
    return {
      kind,
      title: kind === 'active-area-circle' ? 'Active-area circle' : 'Recent-work arrow',
      state: proposalState,
      explanation: proposal?.explanation || slot.message,
      targetLabel: proposal ? 'Selected work object' : 'No eligible work object',
      provenance: 'Generated locally by the scripted assistant',
      previewLabel: `${kind === 'active-area-circle' ? 'Circle' : 'Arrow'} preview`,
      previewVisible: Boolean(proposal?.visible && proposed),
      canApprove: proposed && !state.readOnly,
      canReject: proposed && !state.readOnly,
      canRegenerate: !state.readOnly && (proposalState === 'rejected' || proposalState === 'stale'),
      canToggle: proposed,
    };
  });
}

export function visiblePreviewStrokes(proposals: ProposalSet | null): Stroke[] {
  if (!proposals) return [];
  return [proposals.circle, proposals.arrow]
    .flatMap(({ proposal }) => proposal?.state === 'proposed' && proposal.visible ? proposal.strokes : [])
    .map((stroke) => structuredClone(stroke));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] as string);
}

export class AssistantPanel {
  private state: AssistantPanelState = { open: false, proposals: null, readOnly: false };
  private renderedKey = '';

  constructor(private readonly root: HTMLElement, private readonly actions: AssistantPanelActions) {}

  render(state: AssistantPanelState): void {
    this.state = state;
    this.root.hidden = !state.open;
    const cards = deriveAssistantPanelCards(state);
    const key = state.proposals ? cards.map((card) => `${card.kind}:${slotFor(state.proposals as ProposalSet, card.kind).proposal?.id ?? 'none'}`).join('|') : 'empty';
    if (key !== this.renderedKey) {
      this.root.innerHTML = `<div class="assistant-panel-header"><div><span class="eyebrow">Scripted context</span><h2 tabindex="-1">Assistant suggestions</h2></div><button type="button" data-close aria-label="Close assistant suggestions">×</button></div>
        <p class="assistant-intro">Preview deterministic annotations before adding them to the board.</p>
        <button type="button" data-generate class="assistant-generate">${state.proposals ? 'Generate new suggestions' : 'Generate suggestions'}</button>
        <div class="assistant-cards">${cards.map((card) => `<article class="assistant-card" data-kind="${card.kind}"><div class="assistant-card-heading"><h3>${escapeHtml(card.title)}</h3><span data-state></span></div><p data-explanation></p><p class="assistant-target" data-target></p><p class="assistant-provenance" data-provenance></p><label><input type="checkbox" data-preview> <span data-preview-label></span></label><div class="assistant-actions"><button type="button" data-approve>Approve</button><button type="button" data-reject>Reject</button><button type="button" data-regenerate>Regenerate</button></div></article>`).join('')}</div>`;
      this.bind();
      this.renderedKey = key;
    }
    const currentCards = deriveAssistantPanelCards(state);
    const generate = this.root.querySelector<HTMLButtonElement>('[data-generate]');
    if (generate) generate.disabled = state.readOnly;
    for (const card of currentCards) {
      const element = this.root.querySelector<HTMLElement>(`[data-kind="${card.kind}"]`);
      if (!element) continue;
      const stateLabel = element.querySelector<HTMLElement>('[data-state]');
      if (stateLabel) stateLabel.textContent = card.state;
      const explanation = element.querySelector<HTMLElement>('[data-explanation]');
      if (explanation) explanation.textContent = card.explanation;
      const target = element.querySelector<HTMLElement>('[data-target]');
      if (target) target.textContent = card.targetLabel;
      const provenance = element.querySelector<HTMLElement>('[data-provenance]');
      if (provenance) provenance.textContent = card.provenance;
      const previewLabel = element.querySelector<HTMLElement>('[data-preview-label]');
      if (previewLabel) previewLabel.textContent = card.previewLabel;
      const preview = element.querySelector<HTMLInputElement>('[data-preview]');
      if (preview) { preview.checked = card.previewVisible; preview.disabled = !card.canToggle; preview.setAttribute('aria-label', card.previewLabel); }
      const approve = element.querySelector<HTMLButtonElement>('[data-approve]');
      const reject = element.querySelector<HTMLButtonElement>('[data-reject]');
      const regenerate = element.querySelector<HTMLButtonElement>('[data-regenerate]');
      if (approve) approve.disabled = !card.canApprove;
      if (reject) reject.disabled = !card.canReject;
      if (regenerate) regenerate.disabled = !card.canRegenerate;
    }
  }

  focusHeading(): void { this.root.querySelector<HTMLElement>('h2')?.focus(); }

  private bind(): void {
    this.root.querySelector<HTMLButtonElement>('[data-close]')?.addEventListener('click', this.actions.onClose);
    this.root.querySelector<HTMLButtonElement>('[data-generate]')?.addEventListener('click', this.actions.onGenerate);
    this.root.querySelectorAll<HTMLElement>('[data-kind]').forEach((card) => {
      const kind = card.dataset.kind as ProposalKind;
      card.querySelector<HTMLButtonElement>('[data-approve]')?.addEventListener('click', () => this.actions.onApprove(kind));
      card.querySelector<HTMLButtonElement>('[data-reject]')?.addEventListener('click', () => this.actions.onReject(kind));
      card.querySelector<HTMLButtonElement>('[data-regenerate]')?.addEventListener('click', () => this.actions.onRegenerate(kind));
      card.querySelector<HTMLInputElement>('[data-preview]')?.addEventListener('change', (event) => this.actions.onTogglePreview(kind, (event.currentTarget as HTMLInputElement).checked));
    });
  }
}
