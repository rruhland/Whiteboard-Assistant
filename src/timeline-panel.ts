import type { TemporalIndex } from './temporal';

export type TimelinePanelState = {
  index: TemporalIndex;
  open: boolean;
  position: number | null;
  heatmapEnabled: boolean;
};
export type TimelinePanelActions = {
  onClose(): void;
  onSelectPosition(position: number): void;
  onReturnToNow(): void;
  onToggleHeatmap(enabled: boolean): void;
};
export type TimelineControls = {
  canPrevious: boolean;
  canNext: boolean;
  isHistorical: boolean;
  displayPosition: number;
  eventDescription: string;
  segmentDescription: string;
};

const eventLabels: Record<string, string> = {
  add: 'Stroke added', move: 'Stroke moved', erase: 'Stroke erased', undo: 'Edit undone', redo: 'Edit redone',
  'auto-create': 'Object created', 'auto-append': 'Stroke grouped', 'manual-assign': 'Grouping corrected', 'manual-merge': 'Objects merged', 'manual-split': 'Object split',
};

export function deriveTimelineControls(state: TimelinePanelState): TimelineControls {
  const displayPosition = state.position ?? state.index.entries.length;
  const entry = state.position === null || state.position === 0 ? null : state.index.entries[state.position - 1];
  const segment = entry ? state.index.segments.find(({ id }) => id === entry.segmentId) : null;
  return {
    canPrevious: state.position === null ? state.index.entries.length > 0 : state.position > 0,
    canNext: state.position !== null && state.position < state.index.entries.length,
    isHistorical: state.position !== null,
    displayPosition,
    eventDescription: state.position === null ? 'Current board' : state.position === 0 ? 'Start of board' : eventLabels[entry?.kind ?? ''] ?? 'Board event',
    segmentDescription: segment ? `Activity ${state.index.segments.findIndex(({ id }) => id === segment.id) + 1} · events ${segment.startPosition}–${segment.endPosition}` : 'No activity segment',
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] as string);
}

export class TimelinePanel {
  constructor(private readonly root: HTMLElement, private readonly actions: TimelinePanelActions) {}

  render(state: TimelinePanelState): void {
    const controls = deriveTimelineControls(state);
    const entry = state.position && state.position > 0 ? state.index.entries[state.position - 1] : null;
    const markers = state.index.entries.map((item, index) => `<button type="button" class="timeline-marker ${item.source} ${state.position === index + 1 ? 'selected' : ''}" data-position="${index + 1}" aria-label="${escapeHtml(eventLabels[item.kind] ?? 'Board event')}" title="${escapeHtml(eventLabels[item.kind] ?? 'Board event')}"></button>`).join('');
    this.root.hidden = !state.open;
    this.root.innerHTML = `<div class="timeline-header"><div><span class="eyebrow">Temporal context</span><h2 tabindex="-1">History</h2></div><button type="button" data-close aria-label="Close history">×</button></div>
      <div class="timeline-controls"><button type="button" data-previous ${controls.canPrevious ? '' : 'disabled'}>Previous</button><input data-range type="range" min="0" max="${state.index.entries.length}" value="${controls.displayPosition}" aria-label="History position"><button type="button" data-next ${controls.canNext ? '' : 'disabled'}>Next</button></div>
      <div class="timeline-markers" aria-label="Board events">${markers}</div>
      <div class="timeline-details"><strong>${escapeHtml(controls.eventDescription)}</strong><span>${entry ? escapeHtml(new Date(entry.time).toLocaleString()) : ''}</span><span>${escapeHtml(controls.segmentDescription)}</span></div>
      <div class="timeline-options"><label><input type="checkbox" data-heatmap ${state.heatmapEnabled ? 'checked' : ''}> Recent activity heatmap</label><span class="readonly-note">${controls.isHistorical ? 'Historical view · read only' : 'Viewing current board'}</span><button type="button" data-now ${controls.isHistorical ? '' : 'disabled'}>Return to now</button></div>`;
    this.root.querySelector<HTMLButtonElement>('[data-close]')?.addEventListener('click', this.actions.onClose);
    this.root.querySelector<HTMLButtonElement>('[data-previous]')?.addEventListener('click', () => this.actions.onSelectPosition(state.position === null ? state.index.entries.length : Math.max(0, state.position - 1)));
    this.root.querySelector<HTMLButtonElement>('[data-next]')?.addEventListener('click', () => this.actions.onSelectPosition(Math.min(state.index.entries.length, (state.position ?? state.index.entries.length) + 1)));
    this.root.querySelector<HTMLInputElement>('[data-range]')?.addEventListener('input', (event) => this.actions.onSelectPosition(Number((event.currentTarget as HTMLInputElement).value)));
    this.root.querySelector<HTMLInputElement>('[data-heatmap]')?.addEventListener('change', (event) => this.actions.onToggleHeatmap((event.currentTarget as HTMLInputElement).checked));
    this.root.querySelector<HTMLButtonElement>('[data-now]')?.addEventListener('click', this.actions.onReturnToNow);
    this.root.querySelectorAll<HTMLButtonElement>('[data-position]').forEach((button) => button.addEventListener('click', () => this.actions.onSelectPosition(Number(button.dataset.position))));
  }

  focusHeading(): void { this.root.querySelector<HTMLElement>('h2')?.focus(); }
}
