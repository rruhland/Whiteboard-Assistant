import type { Stroke, Viewport } from './board';
import { previewViewport, type Gesture } from './gesture';
import type { ObjectOverlay } from './object-panel';
import type { ActivitySample } from './temporal';

export type RenderState = {
  strokes: Stroke[];
  viewport: Viewport;
  selectedId: string | null;
  gesture: Gesture | null;
  inkColor: string;
  inkWidth: number;
  objectOverlays: ObjectOverlay[];
  selectedObjectStrokeIds: ReadonlySet<string>;
  activitySamples: ActivitySample[];
  assistantPreviewStrokes: Stroke[];
};

function drawStroke(
  context: CanvasRenderingContext2D,
  stroke: Pick<Stroke, 'points' | 'color' | 'width'>,
  dx = 0,
  dy = 0,
  color = stroke.color,
  width = stroke.width,
): void {
  const [first, ...rest] = stroke.points;
  if (!first) return;
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = width;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  if (rest.length === 0) {
    context.beginPath();
    context.arc(first.x + dx, first.y + dy, width / 2, 0, Math.PI * 2);
    context.fill();
    return;
  }
  context.beginPath();
  context.moveTo(first.x + dx, first.y + dy);
  for (const point of rest) context.lineTo(point.x + dx, point.y + dy);
  context.stroke();
}

export class CanvasRenderer {
  private readonly context: CanvasRenderingContext2D;
  private readonly heatCanvas = document.createElement('canvas');

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D rendering is unavailable');
    this.context = context;
  }

  resize(): boolean {
    const bounds = this.canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(bounds.width * ratio));
    const height = Math.max(1, Math.round(bounds.height * ratio));
    if (this.canvas.width === width && this.canvas.height === height) return false;
    this.canvas.width = width;
    this.canvas.height = height;
    return true;
  }

  render(state: RenderState): void {
    this.resize();
    const ratio = window.devicePixelRatio || 1;
    const bounds = this.canvas.getBoundingClientRect();
    const viewport = state.gesture?.type === 'pan' ? previewViewport(state.gesture) : state.viewport;
    const context = this.context;

    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, bounds.width, bounds.height);
    this.drawGrid(bounds.width, bounds.height, viewport, ratio);

    this.drawActivity(state.activitySamples, viewport, ratio);

    context.setTransform(
      ratio * viewport.zoom,
      0,
      0,
      ratio * viewport.zoom,
      ratio * viewport.x,
      ratio * viewport.y,
    );

    const erased = new Set(state.gesture?.type === 'erase' ? state.gesture.strokeIds : []);
    const movingId = state.gesture?.type === 'move' ? state.gesture.strokeId : null;
    const moveX = state.gesture?.type === 'move' ? state.gesture.current.x - state.gesture.origin.x : 0;
    const moveY = state.gesture?.type === 'move' ? state.gesture.current.y - state.gesture.origin.y : 0;

    for (const stroke of state.strokes) {
      if (erased.has(stroke.id) || stroke.id === movingId) continue;
      if (state.selectedObjectStrokeIds.has(stroke.id)) drawStroke(context, stroke, 0, 0, '#d98945', stroke.width + 3 / viewport.zoom);
      if (stroke.id === state.selectedId) drawStroke(context, stroke, 0, 0, '#2f7d8c', stroke.width + 5 / viewport.zoom);
      drawStroke(context, stroke);
    }

    if (movingId) {
      const moving = state.strokes.find((stroke) => stroke.id === movingId);
      if (moving) {
        if (state.selectedObjectStrokeIds.has(moving.id)) drawStroke(context, moving, moveX, moveY, '#d98945', moving.width + 3 / viewport.zoom);
        drawStroke(context, moving, moveX, moveY, '#2f7d8c', moving.width + 5 / viewport.zoom);
        drawStroke(context, moving, moveX, moveY);
      }
    }

    if (state.gesture?.type === 'ink') {
      drawStroke(context, { points: state.gesture.points, color: state.inkColor, width: state.inkWidth });
    }

    if (state.assistantPreviewStrokes.length) {
      context.save();
      context.globalAlpha = 0.82;
      context.setLineDash([8 / viewport.zoom, 6 / viewport.zoom]);
      for (const stroke of state.assistantPreviewStrokes) {
        drawStroke(context, stroke, 0, 0, '#7657d6', Math.max(stroke.width, 2.5 / viewport.zoom));
      }
      context.restore();
    }

    for (const overlay of state.objectOverlays) this.drawObjectOverlay(overlay, viewport.zoom);
  }

  private drawActivity(samples: ActivitySample[], viewport: Viewport, ratio: number): void {
    if (samples.length === 0) return;
    this.heatCanvas.width = this.canvas.width;
    this.heatCanvas.height = this.canvas.height;
    const heat = this.heatCanvas.getContext('2d');
    if (!heat) return;
    heat.setTransform(ratio * viewport.zoom, 0, 0, ratio * viewport.zoom, ratio * viewport.x, ratio * viewport.y);
    const maximum = Math.max(...samples.map(({ intensity }) => intensity));
    for (const sample of samples) {
      const gradient = heat.createRadialGradient(sample.x, sample.y, 0, sample.x, sample.y, 36);
      const strength = maximum > 0 ? sample.intensity / maximum : 0;
      gradient.addColorStop(0, `rgba(220, 74, 42, ${strength})`);
      gradient.addColorStop(0.45, `rgba(236, 139, 48, ${strength * 0.72})`);
      gradient.addColorStop(1, 'rgba(236, 139, 48, 0)');
      heat.fillStyle = gradient;
      heat.fillRect(sample.x - 36, sample.y - 36, 72, 72);
    }
    this.context.save();
    this.context.setTransform(1, 0, 0, 1, 0, 0);
    this.context.globalAlpha = 0.28;
    this.context.drawImage(this.heatCanvas, 0, 0);
    this.context.restore();
  }

  private drawObjectOverlay(overlay: ObjectOverlay, zoom: number): void {
    const context = this.context;
    const padding = 7 / zoom;
    const lineWidth = (overlay.selected ? 2 : 1.25) / zoom;
    context.save();
    context.strokeStyle = overlay.color;
    context.fillStyle = overlay.color;
    context.lineWidth = lineWidth;
    context.setLineDash([7 / zoom, 5 / zoom]);
    context.strokeRect(
      overlay.bounds.minX - padding,
      overlay.bounds.minY - padding,
      overlay.bounds.maxX - overlay.bounds.minX + padding * 2,
      overlay.bounds.maxY - overlay.bounds.minY + padding * 2,
    );
    context.setLineDash([]);
    context.font = `${12 / zoom}px system-ui, sans-serif`;
    context.fillText(overlay.label, overlay.bounds.minX - padding, overlay.bounds.minY - 11 / zoom);
    context.restore();
  }

  private drawGrid(width: number, height: number, viewport: Viewport, ratio: number): void {
    let spacing = 24 * viewport.zoom;
    while (spacing < 14) spacing *= 2;
    const offsetX = ((viewport.x % spacing) + spacing) % spacing;
    const offsetY = ((viewport.y % spacing) + spacing) % spacing;
    const context = this.context;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = '#c9cec9';
    for (let x = offsetX; x < width; x += spacing) {
      for (let y = offsetY; y < height; y += spacing) {
        context.beginPath();
        context.arc(x, y, 1, 0, Math.PI * 2);
        context.fill();
      }
    }
  }
}
