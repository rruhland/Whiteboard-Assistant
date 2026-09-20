import type { Bounds, GraphEdge, GraphNode } from './association';

export type ObjectPanelState = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedStrokeId: string | null;
  selectedObjectId: string | null;
  checkedObjectIds: ReadonlySet<string>;
  overlayEnabled: boolean;
  unassignedStrokeIds: string[];
};

export type ObjectPanelActions = {
  onClose(): void;
  onToggleOverlay(enabled: boolean): void;
  onCheckedObjectsChange(ids: ReadonlySet<string>): void;
  onMerge(ids: readonly string[]): void;
  onSplitSelectedStroke(): void;
  onAssignSelectedStroke(objectId?: string): void;
  onSelectObject(id: string): void;
};

export type ObjectOverlay = { id: string; label: string; bounds: Bounds; selected: boolean; color: string };
export type GraphLayoutNode = { id: string; x: number; y: number };

export function derivePanelControls(state: ObjectPanelState): { canMerge: boolean; canSplit: boolean; canAssignToChecked: boolean; canCreateObject: boolean } {
  const checkedActive = state.nodes.filter(({ id, status }) => status === 'active' && state.checkedObjectIds.has(id));
  const selectedOwner = state.nodes.find(({ status, strokeIds }) => status === 'active' && state.selectedStrokeId !== null && strokeIds.includes(state.selectedStrokeId));
  const isUnassigned = state.selectedStrokeId !== null && state.unassignedStrokeIds.includes(state.selectedStrokeId);
  return {
    canMerge: checkedActive.length >= 2,
    canSplit: Boolean(selectedOwner && selectedOwner.strokeIds.length >= 2),
    canAssignToChecked: isUnassigned && checkedActive.length === 1,
    canCreateObject: isUnassigned,
  };
}

export function layoutGraph(nodes: readonly GraphNode[], width: number, height: number): GraphLayoutNode[] {
  const padding = 18;
  const centers = nodes.map((node, index) => ({
    id: node.id,
    x: node.bounds ? (node.bounds.minX + node.bounds.maxX) / 2 : index,
    y: node.bounds ? (node.bounds.minY + node.bounds.maxY) / 2 : index,
  }));
  if (centers.length === 0) return [];
  const minX = Math.min(...centers.map(({ x }) => x));
  const maxX = Math.max(...centers.map(({ x }) => x));
  const minY = Math.min(...centers.map(({ y }) => y));
  const maxY = Math.max(...centers.map(({ y }) => y));
  const xSpan = maxX - minX;
  const ySpan = maxY - minY;
  return centers.map(({ id, x, y }) => ({
    id,
    x: xSpan === 0 ? width / 2 : padding + ((x - minX) / xSpan) * Math.max(0, width - padding * 2),
    y: ySpan === 0 ? height / 2 : padding + ((y - minY) / ySpan) * Math.max(0, height - padding * 2),
  }));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] as string);
}

function timeLabel(value: number): string {
  return new Date(value).toLocaleString();
}

export class ObjectPanel {
  private status = '';

  constructor(private readonly root: HTMLElement, private readonly actions: ObjectPanelActions) {}

  setStatus(message: string): void {
    this.status = message;
  }

  render(state: ObjectPanelState): void {
    const selectedObject = state.nodes.find(({ id }) => id === state.selectedObjectId) ?? state.nodes.find(({ status }) => status === 'active') ?? state.nodes[0];
    const controls = derivePanelControls(state);
    const activeCount = state.nodes.filter(({ status }) => status === 'active').length;
    const layout = layoutGraph(state.nodes, 280, 150);
    const positions = new Map(layout.map((node) => [node.id, node]));
    const edgeMarkup = state.edges.map((edge) => {
      const source = positions.get(edge.sourceId);
      const target = positions.get(edge.targetId);
      if (!source || !target) return '';
      return `<line x1="${source.x}" y1="${source.y}" x2="${target.x}" y2="${target.y}" class="graph-edge ${edge.type}" />`;
    }).join('');
    const nodeMarkup = state.nodes.map((node) => {
      const position = positions.get(node.id);
      if (!position) return '';
      return `<g class="graph-node ${node.status}" data-object-id="${escapeHtml(node.id)}"><circle cx="${position.x}" cy="${position.y}" r="11" /><text x="${position.x}" y="${position.y + 4}">${escapeHtml(node.label)}</text></g>`;
    }).join('');
    const rows = state.nodes.map((node) => `<li class="object-row ${node.id === selectedObject?.id ? 'selected' : ''}">
      <label><input type="checkbox" data-check-object="${escapeHtml(node.id)}" ${state.checkedObjectIds.has(node.id) ? 'checked' : ''} ${node.status !== 'active' ? 'disabled' : ''} />
      <button type="button" data-select-object="${escapeHtml(node.id)}"><strong>${escapeHtml(node.label)}</strong><span>${node.status} · ${node.visibleStrokeCount}/${node.strokeIds.length} visible</span></button></label>
    </li>`).join('');
    const details = selectedObject ? `<dl class="object-details">
      <div><dt>ID</dt><dd>${escapeHtml(selectedObject.id)}</dd></div>
      <div><dt>Members</dt><dd>${selectedObject.strokeIds.map(escapeHtml).join(', ') || 'None'}</dd></div>
      <div><dt>Parents</dt><dd>${selectedObject.parentIds.map(escapeHtml).join(', ') || 'None'}</dd></div>
      <div><dt>Created</dt><dd>${escapeHtml(timeLabel(selectedObject.createdAt))}</dd></div>
      <div><dt>Last ink</dt><dd>${escapeHtml(timeLabel(selectedObject.lastAssociatedAt))}</dd></div>
      <div><dt>Bounds</dt><dd>${selectedObject.bounds ? `${Math.round(selectedObject.bounds.minX)}, ${Math.round(selectedObject.bounds.minY)} → ${Math.round(selectedObject.bounds.maxX)}, ${Math.round(selectedObject.bounds.maxY)}` : 'No visible bounds'}</dd></div>
    </dl>` : '<p class="empty-objects">Draw a stroke to create the first work object.</p>';

    this.root.innerHTML = `<div class="object-panel-header"><div><span class="eyebrow">Structure</span><h2>Work objects</h2></div><button type="button" data-close-panel aria-label="Close objects panel">×</button></div>
      <div class="object-overview"><span><strong>${activeCount}</strong> active</span><span><strong>${state.unassignedStrokeIds.length}</strong> unassigned</span><label><input type="checkbox" data-overlay ${state.overlayEnabled ? 'checked' : ''} /> Bounds</label></div>
      <section><div class="section-heading"><h3>Map</h3><span><i class="near-key"></i> near <i class="lineage-key"></i> lineage</span></div><svg class="object-graph" viewBox="0 0 280 150" role="img" aria-label="Work object graph">${edgeMarkup}${nodeMarkup}</svg></section>
      <section><h3>Objects</h3><ul class="object-list">${rows}</ul></section>
      <section class="corrections"><h3>Correct grouping</h3><div class="correction-actions"><button type="button" data-merge ${controls.canMerge ? '' : 'disabled'}>Merge checked</button><button type="button" data-split ${controls.canSplit ? '' : 'disabled'}>Split selected stroke</button><button type="button" data-assign ${controls.canAssignToChecked ? '' : 'disabled'}>Assign to checked</button><button type="button" data-assign-new ${controls.canCreateObject ? '' : 'disabled'}>New object</button></div><p class="panel-status" aria-live="polite">${escapeHtml(this.status)}</p></section>
      <section><h3>Details</h3>${details}</section>`;
    this.bind(state);
  }

  private bind(state: ObjectPanelState): void {
    this.root.querySelector<HTMLButtonElement>('[data-close-panel]')?.addEventListener('click', this.actions.onClose);
    this.root.querySelector<HTMLInputElement>('[data-overlay]')?.addEventListener('change', (event) => this.actions.onToggleOverlay((event.currentTarget as HTMLInputElement).checked));
    this.root.querySelectorAll<HTMLInputElement>('[data-check-object]').forEach((input) => input.addEventListener('change', () => {
      const checked = new Set(Array.from(this.root.querySelectorAll<HTMLInputElement>('[data-check-object]:checked')).map(({ dataset }) => dataset.checkObject as string));
      this.actions.onCheckedObjectsChange(checked);
      const merge = this.root.querySelector<HTMLButtonElement>('[data-merge]');
      const assign = this.root.querySelector<HTMLButtonElement>('[data-assign]');
      const assignNew = this.root.querySelector<HTMLButtonElement>('[data-assign-new]');
      if (merge) merge.disabled = checked.size < 2;
      if (assign) assign.disabled = !state.selectedStrokeId || !state.unassignedStrokeIds.includes(state.selectedStrokeId) || checked.size !== 1;
      if (assignNew) assignNew.disabled = !state.selectedStrokeId || !state.unassignedStrokeIds.includes(state.selectedStrokeId);
    }));
    this.root.querySelectorAll<HTMLElement>('[data-select-object]').forEach((element) => element.addEventListener('click', () => {
      this.actions.onSelectObject(element.dataset.selectObject as string);
    }));
    this.root.querySelectorAll<SVGGElement>('[data-object-id]').forEach((element) => element.addEventListener('click', () => {
      this.actions.onSelectObject(element.dataset.objectId as string);
    }));
    this.root.querySelector<HTMLButtonElement>('[data-merge]')?.addEventListener('click', () => {
      const checked = Array.from(this.root.querySelectorAll<HTMLInputElement>('[data-check-object]:checked')).map(({ dataset }) => dataset.checkObject as string);
      this.actions.onMerge(checked);
    });
    this.root.querySelector<HTMLButtonElement>('[data-split]')?.addEventListener('click', this.actions.onSplitSelectedStroke);
    this.root.querySelector<HTMLButtonElement>('[data-assign]')?.addEventListener('click', () => {
      const checked = this.root.querySelector<HTMLInputElement>('[data-check-object]:checked')?.dataset.checkObject;
      this.actions.onAssignSelectedStroke(checked);
    });
    this.root.querySelector<HTMLButtonElement>('[data-assign-new]')?.addEventListener('click', () => this.actions.onAssignSelectedStroke());
  }
}
