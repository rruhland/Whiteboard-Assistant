import type { Point, Stroke, Viewport } from './board';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;

function finite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
}

function assertViewport(viewport: Viewport): void {
  finite(viewport.x, 'viewport.x');
  finite(viewport.y, 'viewport.y');
  finite(viewport.zoom, 'viewport.zoom');
  if (viewport.zoom <= 0) throw new Error('viewport.zoom must be positive');
}

export function screenToWorld(point: { x: number; y: number }, viewport: Viewport): { x: number; y: number } {
  finite(point.x, 'point.x');
  finite(point.y, 'point.y');
  assertViewport(viewport);
  return { x: (point.x - viewport.x) / viewport.zoom, y: (point.y - viewport.y) / viewport.zoom };
}

export function worldToScreen(point: { x: number; y: number }, viewport: Viewport): { x: number; y: number } {
  finite(point.x, 'point.x');
  finite(point.y, 'point.y');
  assertViewport(viewport);
  return { x: point.x * viewport.zoom + viewport.x, y: point.y * viewport.zoom + viewport.y };
}

export function zoomAt(viewport: Viewport, screen: { x: number; y: number }, factor: number): Viewport {
  assertViewport(viewport);
  finite(factor, 'factor');
  if (factor <= 0) throw new Error('factor must be positive');
  const world = screenToWorld(screen, viewport);
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, viewport.zoom * factor));
  return { x: screen.x - world.x * zoom, y: screen.y - world.y * zoom, zoom };
}

function distanceSquaredToSegment(point: { x: number; y: number }, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return (point.x - start.x) ** 2 + (point.y - start.y) ** 2;
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  const x = start.x + t * dx;
  const y = start.y + t * dy;
  return (point.x - x) ** 2 + (point.y - y) ** 2;
}

export function hitTestStroke(strokes: Stroke[], world: { x: number; y: number }, tolerance: number): Stroke | undefined {
  finite(world.x, 'world.x');
  finite(world.y, 'world.y');
  finite(tolerance, 'tolerance');
  if (tolerance < 0) throw new Error('tolerance must not be negative');
  for (let index = strokes.length - 1; index >= 0; index -= 1) {
    const stroke = strokes[index];
    const radius = stroke.width / 2 + tolerance;
    const points = stroke.points;
    for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
      const end = points[pointIndex];
      const start = points[pointIndex - 1] ?? end;
      if (distanceSquaredToSegment(world, start, end) <= radius * radius) return stroke;
    }
  }
  return undefined;
}
