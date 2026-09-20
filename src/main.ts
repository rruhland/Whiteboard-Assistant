import './style.css';
import { BoardModel, serializeBoard, type BoardDocument, type Point, type Viewport } from './board';
import { CanvasRenderer } from './canvas';
import { screenToWorld, hitTestStroke, hitTestStrokesAlongSegment, zoomAt } from './geometry';
import {
  beginGesture,
  finishGesture,
  ownsGesturePointer,
  updateGesture,
  type Gesture,
} from './gesture';
import { isSpacePanTarget } from './input';
import { loadAutosave, openPortableBoard, saveAutosave, type StorageLike } from './storage';

type Tool = 'pen' | 'select' | 'eraser' | 'hand';

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing required element: ${selector}`);
  return found;
}

const canvas = element<HTMLCanvasElement>('#board');
const renderer = new CanvasRenderer(canvas);
const colorInput = element<HTMLInputElement>('#ink-color');
const widthInput = element<HTMLInputElement>('#ink-width');
const widthValue = element<HTMLOutputElement>('#width-value');
const undoButton = element<HTMLButtonElement>('#undo');
const redoButton = element<HTMLButtonElement>('#redo');
const openButton = element<HTMLButtonElement>('#open-board');
const saveButton = element<HTMLButtonElement>('#save-board');
const fileInput = element<HTMLInputElement>('#file-input');
const strokeCount = element<HTMLElement>('#stroke-count');
const editCount = element<HTMLElement>('#edit-count');
const zoomLevel = element<HTMLElement>('#zoom-level');
const saveStatus = element<HTMLElement>('#save-status');
const onboarding = element<HTMLElement>('#onboarding');

let model = new BoardModel();
let viewport: Viewport = { x: 0, y: 0, zoom: 1 };
let selectedId: string | null = null;
let activeTool: Tool = 'pen';
let activeGesture: Gesture | null = null;
let spacePressed = false;
let renderFrame = 0;
let navigationSaveTimer = 0;
let cachedEventCount = 0;
let hasDrawn = false;
let storage: StorageLike | null = null;

try {
  storage = window.localStorage;
  const restored = loadAutosave(storage);
  if (restored.document) {
    model = new BoardModel(restored.document);
    viewport = restored.document.viewport;
    saveStatus.textContent = 'Restored autosave';
  } else if (restored.error) {
    saveStatus.textContent = restored.error;
    saveStatus.dataset.state = 'error';
  }
} catch (error) {
  saveStatus.textContent = `Autosave unavailable: ${error instanceof Error ? error.message : String(error)}`;
  saveStatus.dataset.state = 'error';
}

function currentDocument(): BoardDocument {
  return model.toDocument(viewport);
}

function refreshCachedMetadata(): void {
  cachedEventCount = model.events.length;
  hasDrawn = model.events.some((event) => event.kind === 'add');
}

refreshCachedMetadata();

function scheduleRender(): void {
  if (renderFrame) return;
  renderFrame = window.requestAnimationFrame(() => {
    renderFrame = 0;
    renderer.render({
      strokes: model.strokes,
      viewport,
      selectedId,
      gesture: activeGesture,
      inkColor: colorInput.value,
      inkWidth: Number(widthInput.value),
    });
  });
}

function updateControls(): void {
  const strokes = model.strokes;
  strokeCount.textContent = String(strokes.length);
  editCount.textContent = String(cachedEventCount);
  zoomLevel.textContent = `${Math.round(viewport.zoom * 100)}%`;
  undoButton.disabled = !model.canUndo;
  redoButton.disabled = !model.canRedo;
  onboarding.hidden = hasDrawn;
  document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.tool === activeTool));
  });
}

function setStatus(message: string, state: 'normal' | 'error' = 'normal'): void {
  saveStatus.textContent = message;
  if (state === 'error') saveStatus.dataset.state = 'error';
  else delete saveStatus.dataset.state;
}

function persist(): boolean {
  if (!storage) {
    setStatus('Not saved: local storage is unavailable', 'error');
    return false;
  }
  const result = saveAutosave(storage, currentDocument());
  if (result.ok) {
    setStatus('Saved locally');
    return true;
  }
  setStatus(result.error, 'error');
  return false;
}

function persistNavigationSoon(): void {
  window.clearTimeout(navigationSaveTimer);
  navigationSaveTimer = window.setTimeout(persist, 220);
}

function afterEdit(): void {
  refreshCachedMetadata();
  if (selectedId && !model.strokes.some((stroke) => stroke.id === selectedId)) selectedId = null;
  updateControls();
  scheduleRender();
  persist();
}

function cancelActiveGesture(): void {
  if (!activeGesture) return;
  const pointerId = activeGesture.pointerId;
  activeGesture = null;
  if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
  scheduleRender();
}

function setTool(tool: Tool): void {
  cancelActiveGesture();
  activeTool = tool;
  canvas.dataset.tool = tool;
  updateControls();
  canvas.focus({ preventScroll: true });
}

function screenPoint(event: PointerEvent | WheelEvent): { x: number; y: number } {
  const bounds = canvas.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

function worldPoint(event: PointerEvent): Point {
  const world = screenToWorld(screenPoint(event), viewport);
  return { ...world, pressure: event.pressure, time: Date.now() };
}

function hitAt(world: Point): string | undefined {
  return hitTestStroke(model.strokes, world, 7 / viewport.zoom)?.id;
}

function startPointer(event: PointerEvent): void {
  if (activeGesture || (event.button !== 0 && event.button !== 1)) return;
  const effectiveTool: Tool = event.button === 1 || spacePressed ? 'hand' : activeTool;
  const screen = screenPoint(event);
  const world = worldPoint(event);
  let next: Gesture | null = null;

  if (effectiveTool === 'pen' && event.button === 0) {
    next = { type: 'ink', pointerId: event.pointerId, points: [world] };
  } else if (effectiveTool === 'hand') {
    next = { type: 'pan', pointerId: event.pointerId, originScreen: screen, currentScreen: screen, originViewport: { ...viewport } };
  } else if (effectiveTool === 'select' && event.button === 0) {
    const strokeId = hitAt(world);
    selectedId = strokeId ?? null;
    if (strokeId) next = { type: 'move', pointerId: event.pointerId, strokeId, origin: world, current: world };
  } else if (effectiveTool === 'eraser' && event.button === 0) {
    const strokeId = hitAt(world);
    next = { type: 'erase', pointerId: event.pointerId, strokeIds: strokeId ? [strokeId] : [], current: world };
  }

  if (next) {
    activeGesture = beginGesture(activeGesture, next);
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(event.pointerId);
  }
  event.preventDefault();
  updateControls();
  scheduleRender();
}

function movePointer(event: PointerEvent): void {
  if (!activeGesture || activeGesture.pointerId !== event.pointerId) return;
  if (activeGesture.type === 'pan') {
    activeGesture = updateGesture(activeGesture, event.pointerId, { screen: screenPoint(event) });
  } else if (activeGesture.type === 'erase') {
    const world = worldPoint(event);
    const strokeIds = hitTestStrokesAlongSegment(
      model.strokes,
      activeGesture.current,
      world,
      7 / viewport.zoom,
      new Set(activeGesture.strokeIds),
    ).map(({ id }) => id);
    activeGesture = updateGesture(activeGesture, event.pointerId, { world, erasedStrokeIds: strokeIds });
  } else {
    activeGesture = updateGesture(activeGesture, event.pointerId, { world: worldPoint(event) });
  }
  event.preventDefault();
  scheduleRender();
}

function endPointer(event: PointerEvent): void {
  if (!activeGesture || activeGesture.pointerId !== event.pointerId) return;
  movePointer(event);
  const commit = finishGesture(activeGesture, event.pointerId);
  activeGesture = null;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  if (!commit) return;

  if (commit.type === 'ink') {
    model.addStroke(commit.points, colorInput.value, Number(widthInput.value));
    afterEdit();
  } else if (commit.type === 'move') {
    if (commit.dx !== 0 || commit.dy !== 0) {
      model.moveStroke(commit.strokeId, commit.dx, commit.dy);
      afterEdit();
    } else {
      scheduleRender();
    }
  } else if (commit.type === 'erase') {
    for (const id of commit.strokeIds) model.eraseStroke(id);
    if (commit.strokeIds.length) afterEdit();
    else scheduleRender();
  } else {
    viewport = commit.viewport;
    updateControls();
    scheduleRender();
    persistNavigationSoon();
  }
}

function changeZoom(factor: number, anchor?: { x: number; y: number }): void {
  cancelActiveGesture();
  const bounds = canvas.getBoundingClientRect();
  viewport = zoomAt(viewport, anchor ?? { x: bounds.width / 2, y: bounds.height / 2 }, factor);
  updateControls();
  scheduleRender();
  persistNavigationSoon();
}

function undo(): void {
  cancelActiveGesture();
  model.undo();
  afterEdit();
}

function redo(): void {
  cancelActiveGesture();
  model.redo();
  afterEdit();
}

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

canvas.addEventListener('pointerdown', startPointer);
canvas.addEventListener('pointermove', movePointer);
canvas.addEventListener('pointerup', endPointer);
const cancelPointerGesture = (event: PointerEvent): void => {
  if (ownsGesturePointer(activeGesture, event.pointerId)) cancelActiveGesture();
};
canvas.addEventListener('pointercancel', cancelPointerGesture);
canvas.addEventListener('lostpointercapture', cancelPointerGesture);
canvas.addEventListener('contextmenu', (event) => event.preventDefault());
canvas.addEventListener('wheel', (event) => {
  if (activeGesture) return;
  event.preventDefault();
  changeZoom(Math.exp(-event.deltaY * 0.0015), screenPoint(event));
}, { passive: false });

document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((button) => {
  button.addEventListener('click', () => setTool(button.dataset.tool as Tool));
});
colorInput.addEventListener('input', scheduleRender);
widthInput.addEventListener('input', () => {
  widthValue.value = widthInput.value;
  scheduleRender();
});
undoButton.addEventListener('click', undo);
redoButton.addEventListener('click', redo);
element<HTMLButtonElement>('#zoom-out').addEventListener('click', () => changeZoom(1 / 1.2));
element<HTMLButtonElement>('#zoom-in').addEventListener('click', () => changeZoom(1.2));
element<HTMLButtonElement>('#reset-view').addEventListener('click', () => {
  cancelActiveGesture();
  viewport = { x: 0, y: 0, zoom: 1 };
  updateControls();
  scheduleRender();
  persistNavigationSoon();
});

saveButton.addEventListener('click', () => {
  cancelActiveGesture();
  const blob = new Blob([serializeBoard(currentDocument())], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `whiteboard-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  setStatus('Board file downloaded');
});

openButton.addEventListener('click', () => {
  cancelActiveGesture();
  fileInput.click();
});
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;
  try {
    const result = openPortableBoard(await file.text(), currentDocument(), storage);
    if (!result.replaced) {
      setStatus(result.error ?? 'Open failed', 'error');
      return;
    }
    model = new BoardModel(result.document);
    viewport = result.document.viewport;
    selectedId = null;
    refreshCachedMetadata();
    updateControls();
    scheduleRender();
    if (result.error) setStatus(result.error, 'error');
    else setStatus('Board opened and saved locally');
  } catch (error) {
    setStatus(`Open failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
  }
});

window.addEventListener('keydown', (event) => {
  if (isEditable(event.target)) return;
  const command = event.ctrlKey || event.metaKey;
  if (command && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
    return;
  }
  if (command && event.key.toLowerCase() === 'y') {
    event.preventDefault();
    redo();
    return;
  }
  if (command || event.altKey) return;
  if (event.code === 'Space') {
    if (!isSpacePanTarget(event.target, canvas, document.body)) return;
    spacePressed = true;
    event.preventDefault();
    return;
  }
  const toolByKey: Partial<Record<string, Tool>> = { p: 'pen', v: 'select', e: 'eraser', h: 'hand' };
  const tool = toolByKey[event.key.toLowerCase()];
  if (tool) {
    event.preventDefault();
    setTool(tool);
  } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) {
    event.preventDefault();
    cancelActiveGesture();
    model.eraseStroke(selectedId);
    selectedId = null;
    afterEdit();
  }
});
window.addEventListener('keyup', (event) => {
  if (event.code === 'Space') spacePressed = false;
});
window.addEventListener('blur', () => {
  spacePressed = false;
  cancelActiveGesture();
});

new ResizeObserver(scheduleRender).observe(canvas);
canvas.dataset.tool = activeTool;
updateControls();
scheduleRender();
