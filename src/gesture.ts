import type { Point, Stroke, Viewport } from './board';
import { transformSelection, type Bounds, type SelectionOperation } from './selection';

export type InkGesture = { type: 'ink'; pointerId: number; points: Point[] };
export type MoveGesture = { type: 'move'; pointerId: number; strokeId: string; origin: Point; current: Point };
export type EraseGesture = { type: 'erase'; pointerId: number; strokeIds: string[]; current: Point };
export type PanGesture = {
  type: 'pan';
  pointerId: number;
  originScreen: { x: number; y: number };
  currentScreen: { x: number; y: number };
  originViewport: Viewport;
};
export type MarqueeGesture = { type: 'marquee'; pointerId: number; origin: Point; current: Point; additive: boolean };
export type TransformGesture = {
  type: 'transform';
  pointerId: number;
  bounds: Bounds;
  originals: Stroke[];
  operation: SelectionOperation;
  current: Point;
};

export type Gesture = InkGesture | MoveGesture | EraseGesture | PanGesture | MarqueeGesture | TransformGesture;

export type GestureUpdate = {
  world?: Point;
  screen?: { x: number; y: number };
  erasedStrokeIds?: string[];
};

export type GestureCommit =
  | { type: 'ink'; points: Point[] }
  | { type: 'move'; strokeId: string; dx: number; dy: number }
  | { type: 'erase'; strokeIds: string[] }
  | { type: 'pan'; viewport: Viewport }
  | { type: 'marquee'; start: Point; end: Point; additive: boolean }
  | { type: 'transform'; strokes: Stroke[] };

export function beginGesture(active: Gesture | null, next: Gesture): Gesture {
  return active ?? next;
}

export function ownsGesturePointer(gesture: Gesture | null, pointerId: number): boolean {
  return gesture?.pointerId === pointerId;
}

export function updateGesture(gesture: Gesture, pointerId: number, update: GestureUpdate): Gesture {
  if (gesture.pointerId !== pointerId) return gesture;
  if (gesture.type === 'ink' && update.world) {
    return { ...gesture, points: [...gesture.points, update.world] };
  }
  if (gesture.type === 'move' && update.world) {
    return { ...gesture, current: update.world };
  }
  if (gesture.type === 'erase') {
    const additions = (update.erasedStrokeIds ?? []).filter((id) => !gesture.strokeIds.includes(id));
    const strokeIds = additions.length ? [...gesture.strokeIds, ...additions] : gesture.strokeIds;
    return { ...gesture, strokeIds, current: update.world ?? gesture.current };
  }
  if (gesture.type === 'pan' && update.screen) {
    return { ...gesture, currentScreen: update.screen };
  }
  if ((gesture.type === 'marquee' || gesture.type === 'transform') && update.world) {
    return { ...gesture, current: update.world };
  }
  return gesture;
}

export function previewViewport(gesture: PanGesture): Viewport {
  return {
    x: gesture.originViewport.x + gesture.currentScreen.x - gesture.originScreen.x,
    y: gesture.originViewport.y + gesture.currentScreen.y - gesture.originScreen.y,
    zoom: gesture.originViewport.zoom,
  };
}

export function finishGesture(gesture: Gesture | null, pointerId: number): GestureCommit | null {
  if (!gesture || gesture.pointerId !== pointerId) return null;
  if (gesture.type === 'ink') return { type: 'ink', points: gesture.points };
  if (gesture.type === 'move') {
    return {
      type: 'move',
      strokeId: gesture.strokeId,
      dx: gesture.current.x - gesture.origin.x,
      dy: gesture.current.y - gesture.origin.y,
    };
  }
  if (gesture.type === 'erase') return { type: 'erase', strokeIds: gesture.strokeIds };
  if (gesture.type === 'marquee') return { type: 'marquee', start: gesture.origin, end: gesture.current, additive: gesture.additive };
  if (gesture.type === 'transform') return { type: 'transform', strokes: transformSelection(gesture.originals, gesture.bounds, gesture.operation, gesture.current) };
  return { type: 'pan', viewport: previewViewport(gesture) };
}
