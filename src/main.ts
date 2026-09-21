import './style.css';
import { getUnassignedVisibleStrokes, projectGraph } from './association';
import { AssistantPanel, visiblePreviewStrokes } from './assistant-panel';
import { afterWorkspaceMutation, approveAssistantProposal, createAssistantSession, deleteAnnotation, generateAssistantSession, hasAssistantCandidate, regenerateAssistantSlot, rejectAssistantProposal, setProposalVisibility, type AssistantSession, type WorkspaceMutation } from './assistant-session';
import { type Point } from './board';
import { CanvasLibraryPanel } from './canvas-library-panel';
import { CanvasRenderer } from './canvas';
import { serializeBoard, type BoardDocumentV3 } from './document';
import { screenToWorld, hitTestStroke, hitTestStrokesAlongSegment, zoomAt } from './geometry';
import {
  beginGesture,
  finishGesture,
  ownsGesturePointer,
  updateGesture,
  type Gesture,
} from './gesture';
import { effectivePointerTool, isSpacePanTarget, modalKeyboardIntent, penContactTransition, type Tool } from './input';
import { ObjectPanel, type ObjectOverlay, type ObjectPanelState } from './object-panel';
import { containedStrokeIds, hitSelectionHandle, mergeSelection, selectionBounds, type SelectionOperation } from './selection';
import { createCanvas, deleteCanvas, initializeCanvasLibrary, openCanvas, readPortableBoard, renameCanvas, saveActiveCanvas, type CanvasCatalogV1, type StorageLike } from './storage';
import { buildActivitySamples } from './temporal';
import { TimelinePanel } from './timeline-panel';
import { abandonTouch, beginTouch, endTouch, touchViewport, updateTouch, type TouchNavigation } from './touch-navigation';
import { commitStroke, createHistorySession, loadWorkspace, rebuildHistorySession, returnToNow, selectHistoryPosition, workspaceDocument, type HistorySession, type WorkspaceState } from './workspace';

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
const objectsToggle = element<HTMLButtonElement>('#objects-toggle');
const objectPanelRoot = element<HTMLElement>('#object-panel');
const objectPanelBackdrop = element<HTMLButtonElement>('#object-panel-backdrop');
const historyToggle = element<HTMLButtonElement>('#history-toggle');
const timelinePanelRoot = element<HTMLElement>('#timeline-panel');
const historicalStatus = element<HTMLElement>('#historical-status');
const assistantToggle = element<HTMLButtonElement>('#assistant-toggle');
const assistantPanelRoot = element<HTMLElement>('#assistant-panel');
const assistantPanelBackdrop = element<HTMLButtonElement>('#assistant-panel-backdrop');
const canvasesToggle = element<HTMLButtonElement>('#canvases-toggle');
const resetPageButton = element<HTMLButtonElement>('#reset-page');
const canvasLibraryRoot = element<HTMLElement>('#canvas-library');
const canvasLibraryBackdrop = element<HTMLButtonElement>('#canvas-library-backdrop');

let workspace: WorkspaceState = loadWorkspace({
  sourceVersion: 3,
  document: { version: 3, events: [], associationEvents: [], viewport: { x: 0, y: 0, zoom: 1 } },
});
let selectedIds = new Set<string>();
let activeTool: Tool = 'pen';
let activeGesture: Gesture | null = null;
let touchNavigation: TouchNavigation | null = null;
let penEditPointerId: number | null = null;
const suppressedTouchIds = new Set<number>();
let spacePressed = false;
let renderFrame = 0;
let navigationSaveTimer = 0;
let cachedEventCount = 0;
let hasDrawn = false;
let storage: StorageLike | null = null;
let canvasCatalog: CanvasCatalogV1 = { version: 1, activeCanvasId: 'memory', canvases: [{ id: 'memory', name: 'Untitled canvas', createdAt: Date.now(), updatedAt: Date.now() }] };
let canvasLibraryOpen = false;
let canvasLibraryStatus = '';
let objectPanelOpen = false;
let overlayEnabled = true;
let checkedObjectIds = new Set<string>();
let selectedObjectId: string | null = null;
let historicalSelectedObjectId: string | null = null;
let timelinePanelOpen = false;
let assistantPanelOpen = false;
let assistantSession: AssistantSession = createAssistantSession();

try {
  storage = window.localStorage;
  const identity = { id: globalThis.crypto.randomUUID(), now: Date.now() };
  const library = initializeCanvasLibrary(storage, identity);
  canvasCatalog = library.catalog;
  workspace = loadWorkspace({ sourceVersion: 3, document: library.activeDocument });
  if (library.notice) {
    saveStatus.textContent = library.notice;
    saveStatus.dataset.state = 'error';
  } else saveStatus.textContent = 'Restored active canvas';
} catch (error) {
  saveStatus.textContent = `Autosave unavailable: ${error instanceof Error ? error.message : String(error)}`;
  saveStatus.dataset.state = 'error';
}

function currentDocument() {
  return workspaceDocument(workspace);
}

function singleSelectedId(): string | null {
  return selectedIds.size === 1 ? selectedIds.values().next().value ?? null : null;
}

function panelState(): ObjectPanelState {
  const board = displayBoard();
  const associations = displayAssociations();
  const graph = projectGraph(associations, board.strokes);
  return {
    ...graph,
    selectedStrokeId: isHistorical() ? null : singleSelectedId(),
    selectedObjectId: isHistorical() ? historicalSelectedObjectId : selectedObjectId,
    checkedObjectIds,
    overlayEnabled,
    unassignedStrokeIds: getUnassignedVisibleStrokes(associations, board.strokes).map(({ id }) => id),
    readOnly: isHistorical(),
  };
}

let historySession: HistorySession = createHistorySession(workspace);
function isHistorical(): boolean { return historySession.position !== null; }
function displayBoard() { return historySession.projection?.board ?? workspace.board; }
function displayAssociations() { return historySession.projection?.associations ?? workspace.associations; }
function liveDisplayViewport() { return isHistorical() ? historySession.historicalViewport : workspace.viewport; }
function displayViewport() { return touchNavigation ? touchViewport(touchNavigation) : liveDisplayViewport(); }

function blankDocument(): BoardDocumentV3 {
  return { version: 3, events: [], associationEvents: [], viewport: { x: 0, y: 0, zoom: 1 } };
}

function activeCanvasName(): string {
  return canvasCatalog.canvases.find(({ id }) => id === canvasCatalog.activeCanvasId)?.name ?? 'Untitled canvas';
}

function replaceWorkspace(document: BoardDocumentV3): void {
  cancelActiveGesture();
  if (touchNavigation) {
    for (const id of touchNavigation.contacts.keys()) {
      if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    }
  }
  touchNavigation = null;
  suppressedTouchIds.clear();
  penEditPointerId = null;
  workspace = loadWorkspace({ sourceVersion: 3, document });
  selectedIds.clear();
  selectedObjectId = null;
  historicalSelectedObjectId = null;
  checkedObjectIds.clear();
  historySession = createHistorySession(workspace);
  assistantSession = createAssistantSession();
  objectPanelOpen = false;
  timelinePanelOpen = false;
  assistantPanelOpen = false;
  refreshCachedMetadata();
  updateControls();
  scheduleRender();
}

function refreshPanel(): void {
  objectsToggle.setAttribute('aria-expanded', String(objectPanelOpen));
  objectPanelRoot.hidden = !objectPanelOpen;
  objectPanelBackdrop.hidden = !objectPanelOpen;
  if (objectPanelOpen) objectPanel.render(panelState());
}

function closeObjectPanel(): void {
  objectPanelOpen = false;
  refreshPanel();
  objectsToggle.focus();
}

function refreshAssistantPanel(): void {
  assistantToggle.setAttribute('aria-expanded', String(assistantPanelOpen));
  assistantPanelBackdrop.hidden = !assistantPanelOpen;
  assistantPanel.render({ open: assistantPanelOpen, proposals: assistantSession.proposals, readOnly: isHistorical() });
}

function closeAssistantPanel(): void {
  assistantPanelOpen = false;
  refreshAssistantPanel();
  assistantToggle.focus();
}

function finishAssociationCorrection(message: string): void {
  assistantSession = afterWorkspaceMutation(assistantSession, 'association');
  const activeIds = new Set(workspace.associations.objects.filter(({ status }) => status === 'active').map(({ id }) => id));
  checkedObjectIds = new Set([...checkedObjectIds].filter((id) => activeIds.has(id)));
  objectPanel.setStatus(message);
  rebuildHistory();
  updateControls();
  scheduleRender();
  persist();
}

function correction(action: () => string | readonly [string, string], success: string): void {
  if (isHistorical()) return;
  try {
    action();
    finishAssociationCorrection(success);
  } catch (error) {
    objectPanel.setStatus(error instanceof Error ? error.message : String(error));
    refreshPanel();
  }
}

const objectPanel = new ObjectPanel(objectPanelRoot, {
  onClose: closeObjectPanel,
  onToggleOverlay(enabled) { overlayEnabled = enabled; refreshPanel(); scheduleRender(); },
  onCheckedObjectsChange(ids) { checkedObjectIds = new Set(ids); },
  onMerge(ids) {
    correction(() => {
      const childId = workspace.associations.mergeObjects(ids);
      selectedObjectId = childId;
      checkedObjectIds = new Set([childId]);
      return childId;
    }, 'Objects merged');
  },
  onSplitSelectedStroke() {
    correction(() => {
      const strokeId = singleSelectedId();
      if (!strokeId) throw new Error('Select exactly one stroke to split');
      const owner = workspace.associations.objects.find(({ status, strokeIds }) => status === 'active' && strokeIds.includes(strokeId));
      if (!owner) throw new Error('The selected stroke has no active object');
      const children = workspace.associations.splitObject(owner.id, strokeId);
      selectedObjectId = children[0];
      checkedObjectIds = new Set(children);
      return children;
    }, 'Object split');
  },
  onAssignSelectedStroke(objectId) {
    correction(() => {
      const strokeId = singleSelectedId();
      if (!strokeId) throw new Error('Select exactly one unassigned stroke');
      const assignedId = workspace.associations.assignStroke(strokeId, objectId);
      selectedObjectId = assignedId;
      checkedObjectIds = new Set([assignedId]);
      return assignedId;
    }, objectId ? 'Stroke assigned' : 'Object created');
  },
  onSelectObject(id) {
    if (isHistorical()) historicalSelectedObjectId = id;
    else selectedObjectId = id;
    refreshPanel();
    scheduleRender();
  },
  onDeleteSelectedAnnotation() {
    if (isHistorical() || !selectedObjectId) return;
    try {
      const eventId = deleteAnnotation(workspace, historySession, selectedObjectId, { id: `event-delete-annotation-${Date.now()}`, time: Date.now() });
      if (!eventId) { objectPanel.setStatus('Annotation is already erased'); refreshPanel(); return; }
      assistantSession = afterWorkspaceMutation(assistantSession, 'annotation-delete');
      refreshCachedMetadata();
      rebuildHistory();
      objectPanel.setStatus('Annotation deleted');
      updateControls();
      scheduleRender();
      persist();
    } catch (error) {
      objectPanel.setStatus(error instanceof Error ? error.message : String(error));
      refreshPanel();
    }
  },
});

function enterHistoryPosition(position: number): void {
  cancelActiveGesture();
  try {
    const entering = !isHistorical();
    historySession = selectHistoryPosition(workspace, historySession, position);
    if (entering) historicalSelectedObjectId = null;
    selectedIds.clear();
    assistantSession = { proposals: null, rejectedFingerprints: new Set(assistantSession.rejectedFingerprints) };
    assistantPanelOpen = false;
    activeTool = 'hand';
    canvas.dataset.tool = activeTool;
    updateControls();
    scheduleRender();
  } catch (error) {
    historySession = returnToNow(workspace, historySession);
    setStatus(`History unavailable: ${error instanceof Error ? error.message : String(error)}`, 'error');
    updateControls();
    scheduleRender();
  }
}

function showNow(): void {
  cancelActiveGesture();
  const abandoned = abandonTouch(touchNavigation);
  touchNavigation = abandoned.navigation;
  for (const id of abandoned.pointerIds) {
    suppressedTouchIds.add(id);
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  }
  historySession = returnToNow(workspace, historySession);
  historicalSelectedObjectId = null;
  updateControls();
  scheduleRender();
}

const timelinePanel = new TimelinePanel(timelinePanelRoot, {
  onClose() { timelinePanelOpen = false; updateControls(); historyToggle.focus(); },
  onSelectPosition: enterHistoryPosition,
  onReturnToNow: showNow,
  onToggleHeatmap(enabled) { historySession = { ...historySession, heatmapEnabled: enabled }; updateControls(); scheduleRender(); },
});

const assistantPanel = new AssistantPanel(assistantPanelRoot, {
  onClose: closeAssistantPanel,
  onGenerate() {
    if (isHistorical()) return;
    try {
      assistantSession = generateAssistantSession(workspace, historySession, assistantSession);
      updateControls();
      scheduleRender();
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error), 'error'); }
  },
  onApprove(kind) {
    if (isHistorical()) return;
    try {
      const generationId = kind === 'active-area-circle'
        ? assistantSession.proposals?.circle.proposal?.generationId
        : assistantSession.proposals?.arrow.proposal?.generationId;
      const result = approveAssistantProposal(workspace, historySession, assistantSession, kind, Date.now());
      assistantSession = afterWorkspaceMutation(result.session, 'assistant-approval', generationId);
      selectedObjectId = result.annotationId;
      refreshCachedMetadata();
      rebuildHistory();
      updateControls();
      scheduleRender();
      persist();
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error), 'error'); updateControls(); }
  },
  onReject(kind) {
    if (isHistorical()) return;
    try { assistantSession = rejectAssistantProposal(assistantSession, kind); updateControls(); scheduleRender(); }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error), 'error'); }
  },
  onRegenerate(kind) {
    if (isHistorical()) return;
    try { assistantSession = regenerateAssistantSlot(workspace, historySession, assistantSession, kind); updateControls(); scheduleRender(); }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error), 'error'); }
  },
  onTogglePreview(kind, visible) {
    if (isHistorical()) return;
    assistantSession = setProposalVisibility(assistantSession, kind, visible);
    updateControls();
    scheduleRender();
  },
});

function refreshCanvasLibrary(): void {
  canvasesToggle.setAttribute('aria-expanded', String(canvasLibraryOpen));
  canvasLibraryBackdrop.hidden = !canvasLibraryOpen;
  canvasLibraryPanel.render({
    open: canvasLibraryOpen,
    activeCanvasId: canvasCatalog.activeCanvasId,
    canvases: canvasCatalog.canvases,
    status: canvasLibraryStatus,
  });
}

function closeCanvasLibrary(): void {
  canvasLibraryOpen = false;
  refreshCanvasLibrary();
  canvasesToggle.focus();
}

function canvasLibraryError(error: unknown): void {
  canvasLibraryStatus = error instanceof Error ? error.message : String(error);
  setStatus(canvasLibraryStatus, 'error');
  refreshCanvasLibrary();
}

const canvasLibraryPanel = new CanvasLibraryPanel(canvasLibraryRoot, {
  onClose: closeCanvasLibrary,
  onCreate(name) {
    if (!storage) { canvasLibraryError('Canvas library is unavailable'); return; }
    try {
      const created = createCanvas(storage, canvasCatalog, name, { id: globalThis.crypto.randomUUID(), now: Date.now() });
      canvasCatalog = created.catalog;
      replaceWorkspace(created.document);
      canvasLibraryStatus = '';
      closeCanvasLibrary();
      setStatus('Canvas created and saved locally');
    } catch (error) { canvasLibraryError(error); }
  },
  onOpen(id) {
    if (!storage) { canvasLibraryError('Canvas library is unavailable'); return; }
    try {
      const opened = openCanvas(storage, canvasCatalog, id);
      canvasCatalog = opened.catalog;
      replaceWorkspace(opened.document);
      canvasLibraryStatus = '';
      closeCanvasLibrary();
      setStatus('Canvas opened');
    } catch (error) { canvasLibraryError(error); }
  },
  onRename(id, name) {
    if (!storage) { canvasLibraryError('Canvas library is unavailable'); return; }
    try {
      canvasCatalog = renameCanvas(storage, canvasCatalog, id, name, Date.now());
      canvasLibraryStatus = 'Canvas renamed';
      setStatus('Canvas renamed');
      refreshCanvasLibrary();
    } catch (error) { canvasLibraryError(error); }
  },
  onDelete(id) {
    if (!storage) { canvasLibraryError('Canvas library is unavailable'); return; }
    const summary = canvasCatalog.canvases.find((canvas) => canvas.id === id);
    if (!summary || !window.confirm(`Delete “${summary.name}” and its complete history?`)) return;
    try {
      const deleted = deleteCanvas(storage, canvasCatalog, id, { id: globalThis.crypto.randomUUID(), now: Date.now() });
      canvasCatalog = deleted.catalog;
      if (deleted.activeChanged && deleted.document) replaceWorkspace(deleted.document);
      canvasLibraryStatus = 'Canvas deleted';
      setStatus('Canvas deleted');
      refreshCanvasLibrary();
    } catch (error) { canvasLibraryError(error); }
  },
});

function refreshCachedMetadata(): void {
  cachedEventCount = workspace.board.events.length;
  hasDrawn = workspace.board.events.some((event) => event.kind === 'add');
}

function rebuildHistory(): void {
  try {
    historySession = rebuildHistorySession(workspace, historySession);
  } catch (error) {
    historySession = returnToNow(workspace, historySession);
    setStatus(`History unavailable: ${error instanceof Error ? error.message : String(error)}`, 'error');
  }
}

refreshCachedMetadata();

function scheduleRender(): void {
  if (renderFrame) return;
  renderFrame = window.requestAnimationFrame(() => {
    renderFrame = 0;
    const board = displayBoard();
    const associations = displayAssociations();
    const graph = projectGraph(associations, board.strokes);
    const selectedObject = graph.nodes.find(({ id }) => id === selectedObjectId);
    const objectOverlays: ObjectOverlay[] = overlayEnabled ? graph.nodes
      .filter((node) => node.status === 'active' && node.bounds)
      .map((node) => ({ id: node.id, label: node.label, bounds: node.bounds!, selected: node.id === selectedObjectId, color: node.id === selectedObjectId ? '#c66c28' : '#4d8790' })) : [];
    renderer.render({
      strokes: board.strokes,
      viewport: displayViewport(),
      selectedIds: isHistorical() ? new Set() : selectedIds,
      gesture: activeGesture,
      inkColor: colorInput.value,
      inkWidth: Number(widthInput.value),
      objectOverlays,
      selectedObjectStrokeIds: new Set(selectedObject?.strokeIds ?? []),
      activitySamples: isHistorical() && historySession.heatmapEnabled && historySession.position !== null
        ? buildActivitySamples(currentDocument(), historySession.index, historySession.position)
        : [],
      assistantPreviewStrokes: isHistorical() ? [] : visiblePreviewStrokes(assistantSession.proposals),
    });
  });
}

function updateControls(): void {
  const strokes = displayBoard().strokes;
  strokeCount.textContent = String(strokes.length);
  editCount.textContent = String(cachedEventCount);
  zoomLevel.textContent = `${Math.round(displayViewport().zoom * 100)}%`;
  undoButton.disabled = isHistorical() || !workspace.board.canUndo;
  redoButton.disabled = isHistorical() || !workspace.board.canRedo;
  openButton.disabled = isHistorical();
  saveButton.disabled = isHistorical();
  resetPageButton.disabled = isHistorical();
  assistantToggle.disabled = isHistorical();
  colorInput.disabled = isHistorical();
  widthInput.disabled = isHistorical();
  onboarding.hidden = hasDrawn;
  document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.tool === activeTool));
    button.disabled = isHistorical() && button.dataset.tool !== 'hand';
  });
  const titledControls: HTMLElement[] = [undoButton, redoButton, openButton, saveButton, colorInput, widthInput, ...Array.from(document.querySelectorAll<HTMLElement>('[data-tool]'))];
  for (const control of titledControls) {
    if (control.dataset.liveTitle === undefined) control.dataset.liveTitle = control.title;
    control.title = isHistorical() ? 'Return to now to edit' : control.dataset.liveTitle;
  }
  historicalStatus.hidden = !isHistorical();
  historyToggle.setAttribute('aria-expanded', String(timelinePanelOpen));
  timelinePanel.render({ index: historySession.index, open: timelinePanelOpen, position: historySession.position, heatmapEnabled: historySession.heatmapEnabled });
  refreshPanel();
  refreshAssistantPanel();
  refreshCanvasLibrary();
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
  const result = saveActiveCanvas(storage, canvasCatalog, currentDocument(), Date.now());
  if (result.ok) {
    canvasCatalog = result.catalog;
    setStatus('Saved locally');
    if (canvasLibraryOpen) refreshCanvasLibrary();
    return true;
  }
  setStatus(result.error, 'error');
  return false;
}

function persistNavigationSoon(): void {
  window.clearTimeout(navigationSaveTimer);
  navigationSaveTimer = window.setTimeout(persist, 220);
}

function afterEdit(mutation: WorkspaceMutation = 'ink'): void {
  assistantSession = afterWorkspaceMutation(assistantSession, mutation);
  refreshCachedMetadata();
  const visibleIds = new Set(workspace.board.strokes.map(({ id }) => id));
  selectedIds = new Set([...selectedIds].filter((id) => visibleIds.has(id)));
  rebuildHistory();
  updateControls();
  scheduleRender();
  persist();
}

function cancelActiveGesture(): void {
  if (!activeGesture) return;
  const pointerId = activeGesture.pointerId;
  activeGesture = null;
  if (penEditPointerId === pointerId) penEditPointerId = null;
  if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
  scheduleRender();
}

function applyNavigationViewport(viewport: { x: number; y: number; zoom: number }): void {
  if (isHistorical()) historySession = { ...historySession, historicalViewport: viewport };
  else {
    workspace.viewport = viewport;
    assistantSession = afterWorkspaceMutation(assistantSession, 'viewport');
  }
}

function setTool(tool: Tool): void {
  if (isHistorical() && tool !== 'hand') return;
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
  const world = screenToWorld(screenPoint(event), displayViewport());
  return { ...world, pressure: event.pressure, time: Date.now() };
}

function hitAt(world: Point): string | undefined {
  return hitTestStroke(displayBoard().strokes, world, 7 / displayViewport().zoom)?.id;
}

function selectedStrokes() {
  return displayBoard().strokes.filter(({ id }) => selectedIds.has(id));
}

function startPointer(event: PointerEvent): void {
  if (event.pointerType === 'touch') {
    if (penEditPointerId !== null || activeGesture || suppressedTouchIds.size > 0) {
      suppressedTouchIds.add(event.pointerId);
    } else {
      touchNavigation = beginTouch(touchNavigation, event.pointerId, screenPoint(event), displayViewport());
    }
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
    scheduleRender();
    return;
  }
  if (event.pointerType === 'pen' && penContactTransition(event, penEditPointerId) !== 'start') return;
  if (activeGesture) return;
  const effectiveTool = effectivePointerTool(event, activeTool, spacePressed);
  if (!effectiveTool || effectiveTool === 'touch') return;
  if (event.pointerType === 'pen' && touchNavigation) {
    const viewport = touchViewport(touchNavigation);
    for (const id of touchNavigation.contacts.keys()) suppressedTouchIds.add(id);
    touchNavigation = null;
    applyNavigationViewport(viewport);
    if (!isHistorical()) persistNavigationSoon();
  }
  if (isHistorical() && effectiveTool !== 'hand') { event.preventDefault(); return; }
  const screen = screenPoint(event);
  const world = worldPoint(event);
  let next: Gesture | null = null;

  if (effectiveTool === 'pen') {
    next = { type: 'ink', pointerId: event.pointerId, points: [world] };
  } else if (effectiveTool === 'hand') {
    next = { type: 'pan', pointerId: event.pointerId, originScreen: screen, currentScreen: screen, originViewport: { ...displayViewport() } };
  } else if (effectiveTool === 'select') {
    const originals = selectedStrokes();
    const bounds = selectionBounds(originals);
    const handle = bounds ? hitSelectionHandle(world, bounds, displayViewport().zoom) : null;
    let operation: SelectionOperation | null = null;
    if (bounds && handle === 'rotate') {
      const center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
      operation = { type: 'rotate', originAngle: Math.atan2(world.y - center.y, world.x - center.x) };
    } else if (bounds && handle && handle !== 'rotate') {
      operation = { type: 'resize', handle, origin: world };
    } else if (bounds && hitTestStroke(originals, world, 7 / displayViewport().zoom)) {
      operation = { type: 'move', origin: world };
    }
    next = operation && bounds
      ? { type: 'transform', pointerId: event.pointerId, bounds, originals, operation, current: world }
      : { type: 'marquee', pointerId: event.pointerId, origin: world, current: world, additive: event.shiftKey };
  } else if (effectiveTool === 'eraser') {
    const strokeId = hitAt(world);
    next = { type: 'erase', pointerId: event.pointerId, strokeIds: strokeId ? [strokeId] : [], current: world };
  }

  if (next) {
    activeGesture = beginGesture(activeGesture, next);
    if (event.pointerType === 'pen') penEditPointerId = event.pointerId;
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(event.pointerId);
  }
  event.preventDefault();
  updateControls();
  scheduleRender();
}

function movePointer(event: PointerEvent): void {
  if (event.pointerType === 'touch') {
    if (touchNavigation?.contacts.has(event.pointerId)) {
      touchNavigation = updateTouch(touchNavigation, event.pointerId, screenPoint(event));
      event.preventDefault();
      scheduleRender();
    }
    return;
  }
  if (event.pointerType === 'pen') {
    const transition = penContactTransition(event, penEditPointerId);
    if (transition === 'start') {
      startPointer(event);
      return;
    }
    if (transition === 'end') {
      finishActivePointer(event, false);
      return;
    }
  }
  if (!activeGesture || activeGesture.pointerId !== event.pointerId) return;
  if (activeGesture.type === 'pan') {
    activeGesture = updateGesture(activeGesture, event.pointerId, { screen: screenPoint(event) });
  } else if (activeGesture.type === 'erase') {
    const world = worldPoint(event);
    const strokeIds = hitTestStrokesAlongSegment(
      displayBoard().strokes,
      activeGesture.current,
      world,
      7 / displayViewport().zoom,
      new Set(activeGesture.strokeIds),
    ).map(({ id }) => id);
    activeGesture = updateGesture(activeGesture, event.pointerId, { world, erasedStrokeIds: strokeIds });
  } else {
    activeGesture = updateGesture(activeGesture, event.pointerId, { world: worldPoint(event) });
  }
  event.preventDefault();
  scheduleRender();
}

function finishActivePointer(event: PointerEvent, includeFinalSample: boolean): void {
  if (!activeGesture || activeGesture.pointerId !== event.pointerId) return;
  if (includeFinalSample) movePointer(event);
  if (!activeGesture || activeGesture.pointerId !== event.pointerId) return;
  const commit = finishGesture(activeGesture, event.pointerId);
  activeGesture = null;
  if (penEditPointerId === event.pointerId) penEditPointerId = null;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  if (!commit) return;

  if (commit.type === 'ink') {
    const result = commitStroke(workspace, commit.points, colorInput.value, Number(widthInput.value));
    afterEdit('ink');
    if (result.associationError) setStatus(`Stroke saved; grouping failed: ${result.associationError}`, 'error');
  } else if (commit.type === 'move') {
    if (commit.dx !== 0 || commit.dy !== 0) {
      workspace.board.moveStroke(commit.strokeId, commit.dx, commit.dy);
      afterEdit('ink');
    } else {
      scheduleRender();
    }
  } else if (commit.type === 'erase') {
    for (const id of commit.strokeIds) workspace.board.eraseStroke(id);
    if (commit.strokeIds.length) afterEdit('partial-erase');
    else scheduleRender();
  } else if (commit.type === 'marquee') {
    selectedIds = mergeSelection(selectedIds, containedStrokeIds(displayBoard().strokes, commit.start, commit.end), commit.additive);
    updateControls();
    scheduleRender();
  } else if (commit.type === 'transform') {
    const current = new Map(workspace.board.strokes.map((stroke) => [stroke.id, stroke]));
    const changed = commit.strokes.some((stroke) => {
      const before = current.get(stroke.id);
      return before && stroke.points.some((point, index) => point.x !== before.points[index]?.x || point.y !== before.points[index]?.y);
    });
    if (changed) {
      workspace.board.updateStrokes(commit.strokes);
      afterEdit('ink');
    } else scheduleRender();
  } else {
    applyNavigationViewport(commit.viewport);
    updateControls();
    scheduleRender();
    if (!isHistorical()) persistNavigationSoon();
  }
}

function endPointer(event: PointerEvent): void {
  if (event.pointerType === 'touch') {
    if (suppressedTouchIds.delete(event.pointerId)) {
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      return;
    }
    if (!touchNavigation?.contacts.has(event.pointerId)) return;
    touchNavigation = updateTouch(touchNavigation, event.pointerId, screenPoint(event));
    const viewport = touchViewport(touchNavigation);
    touchNavigation = endTouch(touchNavigation, event.pointerId);
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (!touchNavigation) {
      applyNavigationViewport(viewport);
      updateControls();
      if (!isHistorical()) persistNavigationSoon();
    }
    scheduleRender();
    return;
  }
  finishActivePointer(event, event.pointerType !== 'pen');
}

function changeZoom(factor: number, anchor?: { x: number; y: number }): void {
  cancelActiveGesture();
  const bounds = canvas.getBoundingClientRect();
  const viewport = zoomAt(displayViewport(), anchor ?? { x: bounds.width / 2, y: bounds.height / 2 }, factor);
  if (isHistorical()) historySession = { ...historySession, historicalViewport: viewport };
  else { workspace.viewport = viewport; assistantSession = afterWorkspaceMutation(assistantSession, 'viewport'); }
  updateControls();
  scheduleRender();
  if (!isHistorical()) persistNavigationSoon();
}

function undo(): void {
  if (isHistorical()) return;
  cancelActiveGesture();
  workspace.board.undo();
  afterEdit('undo');
}

function redo(): void {
  if (isHistorical()) return;
  cancelActiveGesture();
  workspace.board.redo();
  afterEdit('redo');
}

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

canvas.addEventListener('pointerdown', startPointer);
canvas.addEventListener('pointermove', movePointer);
canvas.addEventListener('pointerup', endPointer);
const cancelPointerGesture = (event: PointerEvent): void => {
  if (event.pointerType === 'touch') {
    suppressedTouchIds.delete(event.pointerId);
    if (touchNavigation?.contacts.has(event.pointerId)) {
      const viewport = touchViewport(touchNavigation);
      touchNavigation = endTouch(touchNavigation, event.pointerId);
      if (!touchNavigation) applyNavigationViewport(viewport);
      scheduleRender();
    }
    return;
  }
  if (ownsGesturePointer(activeGesture, event.pointerId)) cancelActiveGesture();
};
canvas.addEventListener('pointercancel', cancelPointerGesture);
canvas.addEventListener('lostpointercapture', cancelPointerGesture);
canvas.addEventListener('contextmenu', (event) => event.preventDefault());
canvas.addEventListener('wheel', (event) => {
  if (activeGesture || touchNavigation) return;
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
  if (isHistorical()) historySession = { ...historySession, historicalViewport: { x: 0, y: 0, zoom: 1 } };
  else { workspace.viewport = { x: 0, y: 0, zoom: 1 }; assistantSession = afterWorkspaceMutation(assistantSession, 'viewport'); }
  updateControls();
  scheduleRender();
  if (!isHistorical()) persistNavigationSoon();
});

canvasesToggle.addEventListener('click', () => {
  cancelActiveGesture();
  if (touchNavigation) {
    applyNavigationViewport(touchViewport(touchNavigation));
    touchNavigation = null;
  }
  objectPanelOpen = false;
  timelinePanelOpen = false;
  assistantPanelOpen = false;
  canvasLibraryOpen = true;
  canvasLibraryStatus = '';
  updateControls();
  canvasLibraryPanel.focusEntry();
});
canvasLibraryBackdrop.addEventListener('click', closeCanvasLibrary);
resetPageButton.addEventListener('click', () => {
  if (isHistorical()) return;
  if (!window.confirm(`Reset “${activeCanvasName()}”? This permanently clears its canvas, objects, and complete history.`)) return;
  replaceWorkspace(blankDocument());
  if (persist()) setStatus('Canvas reset');
});

saveButton.addEventListener('click', () => {
  if (isHistorical()) return;
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
  if (isHistorical()) return;
  cancelActiveGesture();
  fileInput.click();
});
fileInput.addEventListener('change', async () => {
  if (isHistorical()) { fileInput.value = ''; return; }
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;
  try {
    const result = readPortableBoard(await file.text(), { sourceVersion: 3, document: currentDocument() });
    if (!result.replaced) {
      setStatus(result.error ?? 'Open failed', 'error');
      return;
    }
    const sourceVersion = result.document.sourceVersion;
    const document = workspaceDocument(loadWorkspace(result.document));
    replaceWorkspace(document);
    if (persist()) setStatus(sourceVersion === 3 ? 'Board opened and saved to active canvas' : 'Board opened, upgraded, and saved to active canvas');
  } catch (error) {
    setStatus(`Open failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
  }
});

window.addEventListener('keydown', (event) => {
  const libraryIntent = modalKeyboardIntent(canvasLibraryOpen, event.key);
  if (libraryIntent === 'close') {
    event.preventDefault();
    closeCanvasLibrary();
    return;
  }
  if (libraryIntent === 'cycle-focus') {
    const focusable = Array.from(canvasLibraryRoot.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex="0"]'));
    if (focusable.length) {
      event.preventDefault();
      const current = focusable.indexOf(document.activeElement as HTMLElement);
      const next = current < 0
        ? (event.shiftKey ? focusable.length - 1 : 0)
        : (current + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
      focusable[next].focus();
    }
    return;
  }
  if (libraryIntent === 'contain') return;
  if (event.key === 'Escape' && isHistorical()) {
    event.preventDefault();
    showNow();
    return;
  }
  if (event.key === 'Escape' && timelinePanelOpen) {
    event.preventDefault();
    timelinePanelOpen = false;
    updateControls();
    historyToggle.focus();
    return;
  }
  if (isEditable(event.target)) return;
  if (event.key === 'Escape' && assistantPanelOpen) {
    event.preventDefault();
    closeAssistantPanel();
    return;
  }
  if (event.key === 'Escape' && objectPanelOpen) {
    event.preventDefault();
    closeObjectPanel();
    return;
  }
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
  if (timelinePanelOpen && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
    event.preventDefault();
    const current = historySession.position ?? historySession.index.entries.length + 1;
    if (event.key === 'ArrowLeft' && historySession.index.entries.length > 0) enterHistoryPosition(Math.max(0, Math.min(historySession.index.entries.length, current - 1)));
    if (event.key === 'ArrowRight' && isHistorical()) enterHistoryPosition(Math.min(historySession.index.entries.length, (historySession.position ?? 0) + 1));
    return;
  }
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
  } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedIds.size) {
    if (isHistorical()) return;
    event.preventDefault();
    cancelActiveGesture();
    workspace.board.eraseStrokes([...selectedIds]);
    selectedIds.clear();
    afterEdit('partial-erase');
  }
});
window.addEventListener('keyup', (event) => {
  if (event.code === 'Space') spacePressed = false;
});
window.addEventListener('blur', () => {
  spacePressed = false;
  if (touchNavigation) {
    applyNavigationViewport(touchViewport(touchNavigation));
    touchNavigation = null;
  }
  suppressedTouchIds.clear();
  cancelActiveGesture();
});

new ResizeObserver(scheduleRender).observe(canvas);
objectsToggle.addEventListener('click', () => {
  objectPanelOpen = !objectPanelOpen;
  if (objectPanelOpen && window.innerWidth < 760) { timelinePanelOpen = false; assistantPanelOpen = false; }
  updateControls();
  if (objectPanelOpen) objectPanelRoot.querySelector<HTMLElement>('button, input')?.focus();
});
historyToggle.addEventListener('click', () => {
  timelinePanelOpen = !timelinePanelOpen;
  if (timelinePanelOpen && window.innerWidth < 760) { objectPanelOpen = false; assistantPanelOpen = false; }
  updateControls();
  if (timelinePanelOpen) timelinePanel.focusHeading();
});
assistantToggle.addEventListener('click', () => {
  if (isHistorical()) return;
  assistantPanelOpen = !assistantPanelOpen;
  if (assistantPanelOpen && window.innerWidth < 760) { objectPanelOpen = false; timelinePanelOpen = false; }
  if (assistantPanelOpen && !hasAssistantCandidate(assistantSession)) assistantSession = generateAssistantSession(workspace, historySession, assistantSession);
  updateControls();
  scheduleRender();
  if (assistantPanelOpen) assistantPanel.focusHeading();
});
objectPanelBackdrop.addEventListener('click', closeObjectPanel);
assistantPanelBackdrop.addEventListener('click', closeAssistantPanel);
canvas.dataset.tool = activeTool;
updateControls();
scheduleRender();
