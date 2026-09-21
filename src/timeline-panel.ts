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
  private state!: TimelinePanelState;
  private renderedIndexKey: string | null = null;

  constructor(private readonly root: HTMLElement, private readonly actions: TimelinePanelActions) {}

  render(state: TimelinePanelState): void {
    this.state = state;
    const controls = deriveTimelineControls(state);
    const entry = state.position && state.position > 0 ? state.index.entries[state.position - 1] : null;
    this.root.hidden = !state.open;
    const indexKey = JSON.stringify(state.index.entries.map(({ id }) => id));
    if (this.renderedIndexKey !== indexKey) {
      const markers = state.index.entries.map((item, index) => `<button type="button" class="timeline-marker ${item.source}" data-position="${index + 1}" data-entry-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(eventLabels[item.kind] ?? 'Board event')}" title="${escapeHtml(eventLabels[item.kind] ?? 'Board event')}"></button>`).join('');
      this.root.innerHTML = `<div class="timeline-header"><div><span class="eyebrow">Temporal context</span><h2 tabindex="-1">History</h2></div><button type="button" data-close aria-label="Close history">×</button></div>
        <div class="timeline-controls"><button type="button" data-previous>Previous</button><input data-range type="range" min="0" aria-label="History position"><button type="button" data-next>Next</button></div>
        <div class="timeline-markers" aria-label="Board events">${markers}</div>
        <div class="timeline-details"><strong></strong><span></span><span></span></div>
        <div class="timeline-options"><label><input type="checkbox" data-heatmap> Recent activity heatmap</label><span class="readonly-note"></span><button type="button" data-now>Return to now</button></div>`;
      this.bind();
      this.renderedIndexKey = indexKey;
    }
    const previous = this.root.querySelector<HTMLButtonElement>('[data-previous]');
    const next = this.root.querySelector<HTMLButtonElement>('[data-next]');
    const range = this.root.querySelector<HTMLInputElement>('[data-range]');
    const heatmap = this.root.querySelector<HTMLInputElement>('[data-heatmap]');
    const now = this.root.querySelector<HTMLButtonElement>('[data-now]');
    if (previous) previous.disabled = !controls.canPrevious;
    if (next) next.disabled = !controls.canNext;
    if (range) { range.max = String(state.index.entries.length); range.value = String(controls.displayPosition); }
    if (heatmap) heatmap.checked = state.heatmapEnabled;
    if (now) now.disabled = !controls.isHistorical;
    this.root.querySelectorAll<HTMLButtonElement>('[data-position]').forEach((button) => button.classList.toggle('selected', Number(button.dataset.position) === state.position));
    const details = this.root.querySelector<HTMLElement>('.timeline-details');
    if (details) {
      (details.children[0] as HTMLElement).textContent = controls.eventDescription;
      (details.children[1] as HTMLElement).textContent = entry ? new Date(entry.time).toLocaleString() : '';
      (details.children[2] as HTMLElement).textContent = controls.segmentDescription;
    }
    const note = this.root.querySelector<HTMLElement>('.readonly-note');
    if (note) note.textContent = controls.isHistorical ? 'Historical view · read only' : 'Viewing current board';
  }

  private bind(): void {
    this.root.querySelector<HTMLButtonElement>('[data-close]')?.addEventListener('click', this.actions.onClose);
    this.root.querySelector<HTMLButtonElement>('[data-previous]')?.addEventListener('click', () => this.actions.onSelectPosition(this.state.position === null ? this.state.index.entries.length : Math.max(0, this.state.position - 1)));
    this.root.querySelector<HTMLButtonElement>('[data-next]')?.addEventListener('click', () => this.actions.onSelectPosition(Math.min(this.state.index.entries.length, (this.state.position ?? this.state.index.entries.length) + 1)));
    this.root.querySelector<HTMLInputElement>('[data-range]')?.addEventListener('input', (event) => this.actions.onSelectPosition(Number((event.currentTarget as HTMLInputElement).value)));
    this.root.querySelector<HTMLInputElement>('[data-heatmap]')?.addEventListener('change', (event) => this.actions.onToggleHeatmap((event.currentTarget as HTMLInputElement).checked));
    this.root.querySelector<HTMLButtonElement>('[data-now]')?.addEventListener('click', this.actions.onReturnToNow);
    this.root.querySelectorAll<HTMLButtonElement>('[data-position]').forEach((button) => button.addEventListener('click', () => this.actions.onSelectPosition(Number(button.dataset.position))));
  }

  focusHeading(): void { this.root.querySelector<HTMLElement>('h2')?.focus(); }
}
