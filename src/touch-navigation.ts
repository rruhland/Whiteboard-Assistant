import { BOARD_ZOOM_LIMITS, type Viewport } from './board';

export type ScreenPoint = { x: number; y: number };
export type TouchNavigation = {
  contacts: ReadonlyMap<number, ScreenPoint>;
  originContacts: ReadonlyMap<number, ScreenPoint>;
  originViewport: Viewport;
};

function cloneContacts(contacts: ReadonlyMap<number, ScreenPoint>): Map<number, ScreenPoint> {
  return new Map([...contacts].map(([id, point]) => [id, { ...point }]));
}

function midpoint(first: ScreenPoint, second: ScreenPoint): ScreenPoint {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

function distance(first: ScreenPoint, second: ScreenPoint): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

export function touchViewport(state: TouchNavigation): Viewport {
  const ids = [...state.contacts.keys()].slice(0, 2);
  const firstId = ids[0];
  if (firstId === undefined) return { ...state.originViewport };
  const currentFirst = state.contacts.get(firstId)!;
  const originFirst = state.originContacts.get(firstId) ?? currentFirst;
  const secondId = ids[1];
  if (secondId === undefined) {
    return {
      x: state.originViewport.x + currentFirst.x - originFirst.x,
      y: state.originViewport.y + currentFirst.y - originFirst.y,
      zoom: state.originViewport.zoom,
    };
  }

  const currentSecond = state.contacts.get(secondId)!;
  const originSecond = state.originContacts.get(secondId) ?? currentSecond;
  const originMidpoint = midpoint(originFirst, originSecond);
  const currentMidpoint = midpoint(currentFirst, currentSecond);
  const originDistance = distance(originFirst, originSecond);
  const factor = originDistance > 0 ? distance(currentFirst, currentSecond) / originDistance : 1;
  const zoom = Math.min(BOARD_ZOOM_LIMITS.max, Math.max(BOARD_ZOOM_LIMITS.min, state.originViewport.zoom * factor));
  const world = {
    x: (originMidpoint.x - state.originViewport.x) / state.originViewport.zoom,
    y: (originMidpoint.y - state.originViewport.y) / state.originViewport.zoom,
  };
  return {
    x: currentMidpoint.x - world.x * zoom,
    y: currentMidpoint.y - world.y * zoom,
    zoom,
  };
}

export function beginTouch(
  state: TouchNavigation | null,
  pointerId: number,
  screen: ScreenPoint,
  viewport: Viewport,
): TouchNavigation {
  if (!state) {
    const contacts = new Map([[pointerId, { ...screen }]]);
    return { contacts, originContacts: cloneContacts(contacts), originViewport: { ...viewport } };
  }
  const originViewport = touchViewport(state);
  const contacts = cloneContacts(state.contacts);
  contacts.set(pointerId, { ...screen });
  return { contacts, originContacts: cloneContacts(contacts), originViewport };
}

export function updateTouch(state: TouchNavigation, pointerId: number, screen: ScreenPoint): TouchNavigation {
  if (!state.contacts.has(pointerId)) return state;
  const contacts = cloneContacts(state.contacts);
  contacts.set(pointerId, { ...screen });
  return { ...state, contacts };
}

export function endTouch(state: TouchNavigation, pointerId: number): TouchNavigation | null {
  if (!state.contacts.has(pointerId)) return state;
  const originViewport = touchViewport(state);
  const contacts = cloneContacts(state.contacts);
  contacts.delete(pointerId);
  if (contacts.size === 0) return null;
  return { contacts, originContacts: cloneContacts(contacts), originViewport };
}

export function abandonTouch(state: TouchNavigation | null): { pointerIds: number[]; navigation: null } {
  return { pointerIds: state ? [...state.contacts.keys()] : [], navigation: null };
}
