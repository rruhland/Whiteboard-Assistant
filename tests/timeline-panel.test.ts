import { describe, expect, test } from 'vitest';
import { deriveTimelineControls, type TimelinePanelState } from '../src/timeline-panel';
import type { TemporalIndex, TimelineEntry } from '../src/temporal';

const kinds = ['add', 'erase', 'manual-merge', 'manual-split'] as const;
const entries: TimelineEntry[] = kinds.map((kind, index) => ({ id: `${index < 2 ? 'ink' : 'association'}:${kind}`, source: index < 2 ? 'ink' : 'association', eventId: kind, kind, time: index, inkEventCount: Math.min(index + 1, 2), associationEventCount: Math.max(0, index - 1), segmentId: index < 2 ? 'segment-1' : 'segment-2' }));
const index: TemporalIndex = { entries, segments: [
  { id: 'segment-1', startPosition: 1, endPosition: 2, startedAt: 0, endedAt: 1, inkEventCount: 2, associationEventCount: 0 },
  { id: 'segment-2', startPosition: 3, endPosition: 4, startedAt: 2, endedAt: 3, inkEventCount: 0, associationEventCount: 2 },
], totalInkEvents: 2, totalAssociationEvents: 2 };
const state = (overrides: Partial<TimelinePanelState> = {}): TimelinePanelState => ({ index, open: true, position: null, heatmapEnabled: true, ...overrides });
const stateAt = (id: string) => state({ position: entries.findIndex((entry) => entry.id === id) + 1 });

describe('timeline controls', () => {
  test('derives controls at start, middle, latest history, and now', () => {
    expect(deriveTimelineControls(state({ position: 0 }))).toMatchObject({ canPrevious: false, canNext: true, isHistorical: true, displayPosition: 0 });
    expect(deriveTimelineControls(state({ position: 2 }))).toMatchObject({ canPrevious: true, canNext: true, isHistorical: true });
    expect(deriveTimelineControls(state({ position: 4 }))).toMatchObject({ canPrevious: true, canNext: false, isHistorical: true });
    expect(deriveTimelineControls(state({ position: null }))).toMatchObject({ canPrevious: true, canNext: false, isHistorical: false, displayPosition: 4 });
  });
  test('describes ink and association events', () => {
    expect(deriveTimelineControls(stateAt('ink:erase')).eventDescription).toBe('Stroke erased');
    expect(deriveTimelineControls(stateAt('association:manual-merge')).eventDescription).toBe('Objects merged');
  });
});
