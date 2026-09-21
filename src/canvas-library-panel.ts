import type { CanvasSummary } from './storage';

export type CanvasLibraryPanelState = {
  open: boolean;
  activeCanvasId: string;
  canvases: CanvasSummary[];
  status: string;
};

export type CanvasLibraryPanelActions = {
  onClose(): void;
  onCreate(name: string): void;
  onOpen(id: string): void;
  onRename(id: string, name: string): void;
  onDelete(id: string): void;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] as string);
}

export function orderedCanvasSummaries(values: readonly CanvasSummary[]): CanvasSummary[] {
  return values.map((value) => ({ ...value })).sort((left, right) => (
    right.updatedAt - left.updatedAt || right.createdAt - left.createdAt || left.id.localeCompare(right.id)
  ));
}

export class CanvasLibraryPanel {
  constructor(private readonly root: HTMLElement, private readonly actions: CanvasLibraryPanelActions) {}

  render(state: CanvasLibraryPanelState): void {
    this.root.hidden = !state.open;
    if (!state.open) return;
    const rows = orderedCanvasSummaries(state.canvases).map((canvas) => {
      const active = canvas.id === state.activeCanvasId;
      return `<li class="canvas-library-row${active ? ' active' : ''}" data-canvas-row="${escapeHtml(canvas.id)}">
        <div class="canvas-library-summary"><strong>${escapeHtml(canvas.name)}</strong>${active ? '<span class="active-canvas-badge">Active</span>' : ''}<time datetime="${new Date(canvas.updatedAt).toISOString()}">Updated ${escapeHtml(new Date(canvas.updatedAt).toLocaleString())}</time></div>
        <div class="canvas-library-actions">
          <button type="button" data-open-canvas="${escapeHtml(canvas.id)}" ${active ? 'disabled' : ''}>Open</button>
          <label><span class="sr-only">Rename ${escapeHtml(canvas.name)}</span><input data-rename-input="${escapeHtml(canvas.id)}" value="${escapeHtml(canvas.name)}" /></label>
          <button type="button" data-rename-canvas="${escapeHtml(canvas.id)}">Rename</button>
          <button type="button" class="danger" data-delete-canvas="${escapeHtml(canvas.id)}">Delete</button>
        </div>
      </li>`;
    }).join('');
    this.root.innerHTML = `<div class="canvas-library-header"><div><span class="eyebrow">Local library</span><h2 id="canvas-library-title" tabindex="-1">Canvases</h2></div><button type="button" data-close-library aria-label="Close canvases">×</button></div>
      <form class="canvas-create-form" data-create-canvas><label for="new-canvas-name">New canvas</label><div><input id="new-canvas-name" name="name" autocomplete="off" placeholder="Canvas name" required /><button type="submit">Create</button></div></form>
      <ul class="canvas-library-list">${rows}</ul>
      <p class="panel-status" aria-live="polite">${escapeHtml(state.status)}</p>`;
    this.bind();
  }

  focusEntry(): void {
    this.root.querySelector<HTMLElement>('#canvas-library-title')?.focus();
  }

  private bind(): void {
    this.root.querySelector<HTMLButtonElement>('[data-close-library]')?.addEventListener('click', this.actions.onClose);
    this.root.querySelector<HTMLFormElement>('[data-create-canvas]')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const input = (event.currentTarget as HTMLFormElement).elements.namedItem('name') as HTMLInputElement;
      this.actions.onCreate(input.value);
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-open-canvas]').forEach((button) => button.addEventListener('click', () => this.actions.onOpen(button.dataset.openCanvas as string)));
    this.root.querySelectorAll<HTMLButtonElement>('[data-rename-canvas]').forEach((button) => button.addEventListener('click', () => {
      const id = button.dataset.renameCanvas as string;
      const input = this.root.querySelector<HTMLInputElement>(`[data-rename-input="${CSS.escape(id)}"]`);
      if (input) this.actions.onRename(id, input.value);
    }));
    this.root.querySelectorAll<HTMLButtonElement>('[data-delete-canvas]').forEach((button) => button.addEventListener('click', () => this.actions.onDelete(button.dataset.deleteCanvas as string)));
  }
}
