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

export interface MqpetWindowSize {
  width: number;
  height: number;
}

export interface MqpetWindowBounds extends MqpetWindowOrigin, MqpetWindowSize {}

export interface MqpetWindowOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  frame: boolean;
  transparent: boolean;
  resizable: boolean;
  movable: boolean;
  minimizable: boolean;
  maximizable: boolean;
  fullscreenable: boolean;
  hasShadow: boolean;
  skipTaskbar: boolean;
  alwaysOnTop: boolean;
  focusable: boolean;
  show: boolean;
  webPreferences: {
    preload: string;
    contextIsolation: boolean;
    sandbox: boolean;
  };
}

export interface MqpetShellInteractionInput {
  bbox: MqpetBBox | null;
  cursor: MqpetPoint;
  windowBounds: MqpetWindowOrigin & Partial<MqpetWindowSize>;
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

export function createMqpetWindowOptions(input: {
  bounds: MqpetWindowBounds;
  preload: string;
}): MqpetWindowOptions {
  return {
    x: input.bounds.x,
    y: input.bounds.y,
    width: input.bounds.width,
    height: input.bounds.height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    show: false,
    webPreferences: {
      preload: input.preload,
      contextIsolation: true,
      sandbox: true,
    },
  };
}

export function normalizeMqpetBBox(raw: MqpetBBox | null): MqpetBBox | null {
  if (!raw) return null;
  const values = [raw.x, raw.y, raw.w, raw.h];
  if (!values.every(Number.isFinite)) return null;
  if (raw.w <= 0 || raw.h <= 0) return null;
  return raw;
}

export function clampMqpetBBoxToWindow(raw: MqpetBBox | null, windowSize: MqpetWindowSize): MqpetBBox | null {
  const bbox = normalizeMqpetBBox(raw);
  if (!bbox || !Number.isFinite(windowSize.width) || !Number.isFinite(windowSize.height)) return null;
  if (windowSize.width <= 0 || windowSize.height <= 0) return null;

  const left = Math.max(0, bbox.x);
  const top = Math.max(0, bbox.y);
  const right = Math.min(windowSize.width, bbox.x + bbox.w);
  const bottom = Math.min(windowSize.height, bbox.y + bbox.h);
  const width = right - left;
  const height = bottom - top;

  if (width <= 0 || height <= 0) return null;
  return { x: left, y: top, w: width, h: height };
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
  const bbox = input.windowBounds.width !== undefined && input.windowBounds.height !== undefined
    ? clampMqpetBBoxToWindow(input.bbox, { width: input.windowBounds.width, height: input.windowBounds.height })
    : normalizeMqpetBBox(input.bbox);
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
