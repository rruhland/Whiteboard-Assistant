import type { Point, Stroke } from './board';

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export type SelectionHandle = ResizeHandle | 'rotate';
export type SelectionOperation =
  | { type: 'move'; origin: Point }
  | { type: 'resize'; handle: ResizeHandle; origin: Point }
  | { type: 'rotate'; originAngle: number };

const MIN_SIZE = 1;
const HANDLE_HIT_SIZE = 12;
const ROTATION_OFFSET = 28;

function cloneStroke(stroke: Stroke): Stroke {
  return { ...stroke, points: stroke.points.map((point) => ({ ...point })) };
}

function center(bounds: Bounds): { x: number; y: number } {
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
}

export function renderedStrokeBounds(stroke: Stroke): Bounds {
  const padding = stroke.width / 2;
  return {
    minX: Math.min(...stroke.points.map(({ x }) => x)) - padding,
    minY: Math.min(...stroke.points.map(({ y }) => y)) - padding,
    maxX: Math.max(...stroke.points.map(({ x }) => x)) + padding,
    maxY: Math.max(...stroke.points.map(({ y }) => y)) + padding,
  };
}

export function selectionBounds(strokes: readonly Stroke[]): Bounds | null {
  if (!strokes.length) return null;
  const bounds = strokes.map(renderedStrokeBounds);
  return {
    minX: Math.min(...bounds.map(({ minX }) => minX)),
    minY: Math.min(...bounds.map(({ minY }) => minY)),
    maxX: Math.max(...bounds.map(({ maxX }) => maxX)),
    maxY: Math.max(...bounds.map(({ maxY }) => maxY)),
  };
}

export function containedStrokeIds(strokes: readonly Stroke[], start: Point, end: Point): string[] {
  const marquee: Bounds = {
    minX: Math.min(start.x, end.x),
    minY: Math.min(start.y, end.y),
    maxX: Math.max(start.x, end.x),
    maxY: Math.max(start.y, end.y),
  };
  return strokes.filter((stroke) => {
    const bounds = renderedStrokeBounds(stroke);
    return bounds.minX >= marquee.minX && bounds.minY >= marquee.minY && bounds.maxX <= marquee.maxX && bounds.maxY <= marquee.maxY;
  }).map(({ id }) => id);
}

export function mergeSelection(current: ReadonlySet<string>, enclosed: readonly string[], additive: boolean): Set<string> {
  return additive ? new Set([...current, ...enclosed]) : new Set(enclosed);
}

export function selectionHandlePoints(bounds: Bounds, zoom: number): Record<SelectionHandle, { x: number; y: number }> {
  const midpoint = center(bounds);
  return {
    nw: { x: bounds.minX, y: bounds.minY },
    n: { x: midpoint.x, y: bounds.minY },
    ne: { x: bounds.maxX, y: bounds.minY },
    e: { x: bounds.maxX, y: midpoint.y },
    se: { x: bounds.maxX, y: bounds.maxY },
    s: { x: midpoint.x, y: bounds.maxY },
    sw: { x: bounds.minX, y: bounds.maxY },
    w: { x: bounds.minX, y: midpoint.y },
    rotate: { x: midpoint.x, y: bounds.minY - ROTATION_OFFSET / zoom },
  };
}

export function hitSelectionHandle(point: Point, bounds: Bounds, zoom: number): SelectionHandle | null {
  const points = selectionHandlePoints(bounds, zoom);
  const order: SelectionHandle[] = ['rotate', 'nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const radiusSquared = (HANDLE_HIT_SIZE / zoom) ** 2;
  const hits = order.map((handle, priority) => {
    const target = points[handle];
    return { handle, priority, distance: (target.x - point.x) ** 2 + (target.y - point.y) ** 2 };
  }).filter(({ distance }) => distance <= radiusSquared);
  hits.sort((left, right) => left.distance - right.distance || left.priority - right.priority);
  return hits[0]?.handle ?? null;
}

function resizeAnchor(bounds: Bounds, handle: ResizeHandle): { x: number; y: number } {
  const midpoint = center(bounds);
  return {
    x: handle.includes('w') ? bounds.maxX : handle.includes('e') ? bounds.minX : midpoint.x,
    y: handle.includes('n') ? bounds.maxY : handle.includes('s') ? bounds.minY : midpoint.y,
  };
}

function safeScale(numerator: number, denominator: number, minimum: number): number {
  if (denominator === 0) return 1;
  return Math.max(minimum, numerator / denominator);
}

export function transformSelection(
  strokes: readonly Stroke[],
  bounds: Bounds,
  operation: SelectionOperation,
  current: Point,
): Stroke[] {
  if (operation.type === 'move') {
    const dx = current.x - operation.origin.x;
    const dy = current.y - operation.origin.y;
    return strokes.map((stroke) => ({ ...cloneStroke(stroke), points: stroke.points.map((point) => ({ ...point, x: point.x + dx, y: point.y + dy })) }));
  }

  if (operation.type === 'rotate') {
    const pivot = center(bounds);
    const angle = Math.atan2(current.y - pivot.y, current.x - pivot.x) - operation.originAngle;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    return strokes.map((stroke) => ({
      ...cloneStroke(stroke),
      points: stroke.points.map((point) => {
        const x = point.x - pivot.x;
        const y = point.y - pivot.y;
        return { ...point, x: pivot.x + x * cosine - y * sine, y: pivot.y + x * sine + y * cosine };
      }),
    }));
  }

  const { handle, origin } = operation;
  const anchor = resizeAnchor(bounds, handle);
  const changesX = handle.includes('w') || handle.includes('e');
  const changesY = handle.includes('n') || handle.includes('s');
  const width = Math.max(MIN_SIZE, bounds.maxX - bounds.minX);
  const height = Math.max(MIN_SIZE, bounds.maxY - bounds.minY);
  let scaleX = changesX ? safeScale(current.x - anchor.x, origin.x - anchor.x, MIN_SIZE / width) : 1;
  let scaleY = changesY ? safeScale(current.y - anchor.y, origin.y - anchor.y, MIN_SIZE / height) : 1;
  if (changesX && changesY) {
    const uniform = Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? scaleX : scaleY;
    const minimum = Math.max(MIN_SIZE / width, MIN_SIZE / height);
    scaleX = Math.max(minimum, uniform);
    scaleY = scaleX;
  }
  return strokes.map((stroke) => ({
    ...cloneStroke(stroke),
    points: stroke.points.map((point) => ({
      ...point,
      x: anchor.x + (point.x - anchor.x) * scaleX,
      y: anchor.y + (point.y - anchor.y) * scaleY,
    })),
  }));
}
