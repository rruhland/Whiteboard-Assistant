import type { Point, Viewport } from './board';

export type InkGesture = { type: 'ink'; pointerId: number; points: Point[] };
export type MoveGesture = { type: 'move'; pointerId: number; strokeId: string; origin: Point; current: Point };
export type EraseGesture = { type: 'erase'; pointerId: number; strokeIds: string[] };
export type PanGesture = {
  type: 'pan';
  pointerId: number;
  originScreen: { x: number; y: number };
  currentScreen: { x: number; y: number };
  originViewport: Viewport;
};

export type Gesture = InkGesture | MoveGesture | EraseGesture | PanGesture;

export type GestureUpdate = {
  world?: Point;
  screen?: { x: number; y: number };
  erasedStrokeId?: string;
};

export type GestureCommit =
  | { type: 'ink'; points: Point[] }
  | { type: 'move'; strokeId: string; dx: number; dy: number }
  | { type: 'erase'; strokeIds: string[] }
  | { type: 'pan'; viewport: Viewport };

export function beginGesture(active: Gesture | null, next: Gesture): Gesture {
  return active ?? next;
}

export function updateGesture(gesture: Gesture, pointerId: number, update: GestureUpdate): Gesture {
  if (gesture.pointerId !== pointerId) return gesture;
  if (gesture.type === 'ink' && update.world) {
    return { ...gesture, points: [...gesture.points, update.world] };
  }
  if (gesture.type === 'move' && update.world) {
    return { ...gesture, current: update.world };
  }
  if (gesture.type === 'erase' && update.erasedStrokeId && !gesture.strokeIds.includes(update.erasedStrokeId)) {
    return { ...gesture, strokeIds: [...gesture.strokeIds, update.erasedStrokeId] };
  }
  if (gesture.type === 'pan' && update.screen) {
    return { ...gesture, currentScreen: update.screen };
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
  return { type: 'pan', viewport: previewViewport(gesture) };
}
