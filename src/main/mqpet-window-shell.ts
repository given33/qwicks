export interface MqpetBBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MqpetPoint {
  x: number;
  y: number;
}

export interface MqpetWindowOrigin {
  x: number;
  y: number;
}

export interface MqpetShellInteractionInput {
  bbox: MqpetBBox | null;
  cursor: MqpetPoint;
  windowBounds: MqpetWindowOrigin;
  dragging: boolean;
  draggingStartedAt: number;
  now: number;
}

export interface MqpetShellInteractionDecision {
  interactive: boolean;
  shouldClearDragging: boolean;
}

const MQPET_BBOX_PAD = 8;
export const MQPET_DRAG_STALE_MS = 15_000;

export function normalizeMqpetBBox(raw: MqpetBBox | null): MqpetBBox | null {
  if (!raw) return null;
  const values = [raw.x, raw.y, raw.w, raw.h];
  if (!values.every(Number.isFinite)) return null;
  if (raw.w <= 0 || raw.h <= 0) return null;
  return raw;
}

export function isPointInsideMqpetBBox(point: MqpetPoint, bbox: MqpetBBox): boolean {
  return point.x >= bbox.x - MQPET_BBOX_PAD
    && point.x <= bbox.x + bbox.w + MQPET_BBOX_PAD
    && point.y >= bbox.y - MQPET_BBOX_PAD
    && point.y <= bbox.y + bbox.h + MQPET_BBOX_PAD;
}

export function computeMqpetShellInteraction(input: MqpetShellInteractionInput): MqpetShellInteractionDecision {
  const dragIsFresh = input.dragging
    && input.draggingStartedAt > 0
    && input.now - input.draggingStartedAt < MQPET_DRAG_STALE_MS;

  if (dragIsFresh) return { interactive: true, shouldClearDragging: false };

  const shouldClearDragging = input.dragging && !dragIsFresh;
  const bbox = normalizeMqpetBBox(input.bbox);
  if (!bbox) return { interactive: false, shouldClearDragging };

  const localCursor = {
    x: input.cursor.x - input.windowBounds.x,
    y: input.cursor.y - input.windowBounds.y,
  };

  return {
    interactive: isPointInsideMqpetBBox(localCursor, bbox),
    shouldClearDragging,
  };
}
