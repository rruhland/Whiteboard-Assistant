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

function distanceSquaredToSegment(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return (point.x - start.x) ** 2 + (point.y - start.y) ** 2;
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  const x = start.x + t * dx;
  const y = start.y + t * dy;
  return (point.x - x) ** 2 + (point.y - y) ** 2;
}

function cross(
  first: { x: number; y: number },
  second: { x: number; y: number },
  third: { x: number; y: number },
): number {
  return (second.x - first.x) * (third.y - first.y) - (second.y - first.y) * (third.x - first.x);
}

function segmentsIntersect(
  firstStart: { x: number; y: number },
  firstEnd: { x: number; y: number },
  secondStart: { x: number; y: number },
  secondEnd: { x: number; y: number },
): boolean {
  const firstSideStart = cross(firstStart, firstEnd, secondStart);
  const firstSideEnd = cross(firstStart, firstEnd, secondEnd);
  const secondSideStart = cross(secondStart, secondEnd, firstStart);
  const secondSideEnd = cross(secondStart, secondEnd, firstEnd);
  if (firstSideStart * firstSideEnd < 0 && secondSideStart * secondSideEnd < 0) return true;
  const epsilon = 1e-9;
  const onSegment = (point: { x: number; y: number }, start: { x: number; y: number }, end: { x: number; y: number }): boolean => (
    Math.abs(cross(start, end, point)) <= epsilon
    && point.x >= Math.min(start.x, end.x) - epsilon
    && point.x <= Math.max(start.x, end.x) + epsilon
    && point.y >= Math.min(start.y, end.y) - epsilon
    && point.y <= Math.max(start.y, end.y) + epsilon
  );
  return onSegment(secondStart, firstStart, firstEnd)
    || onSegment(secondEnd, firstStart, firstEnd)
    || onSegment(firstStart, secondStart, secondEnd)
    || onSegment(firstEnd, secondStart, secondEnd);
}

function distanceSquaredBetweenSegments(
  firstStart: Point,
  firstEnd: Point,
  secondStart: { x: number; y: number },
  secondEnd: { x: number; y: number },
): number {
  if (segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd)) return 0;
  return Math.min(
    distanceSquaredToSegment(secondStart, firstStart, firstEnd),
    distanceSquaredToSegment(secondEnd, firstStart, firstEnd),
    distanceSquaredToSegment(firstStart, secondStart, secondEnd),
    distanceSquaredToSegment(firstEnd, secondStart, secondEnd),
  );
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

export function hitTestStrokesAlongSegment(
  strokes: Stroke[],
  start: { x: number; y: number },
  end: { x: number; y: number },
  tolerance: number,
  excludedIds: ReadonlySet<string> = new Set(),
): Stroke[] {
  finite(start.x, 'start.x');
  finite(start.y, 'start.y');
  finite(end.x, 'end.x');
  finite(end.y, 'end.y');
  finite(tolerance, 'tolerance');
  if (tolerance < 0) throw new Error('tolerance must not be negative');
  const hits: Stroke[] = [];
  for (let index = strokes.length - 1; index >= 0; index -= 1) {
    const stroke = strokes[index];
    if (excludedIds.has(stroke.id)) continue;
    const radius = stroke.width / 2 + tolerance;
    for (let pointIndex = 0; pointIndex < stroke.points.length; pointIndex += 1) {
      const strokeEnd = stroke.points[pointIndex];
      const strokeStart = stroke.points[pointIndex - 1] ?? strokeEnd;
      if (distanceSquaredBetweenSegments(strokeStart, strokeEnd, start, end) <= radius * radius) {
        hits.push(stroke);
        break;
      }
    }
  }
  return hits;
}
