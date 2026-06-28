export interface DragPoint {
  x: number;
  y: number;
}

export interface DragSession {
  pointerDown: boolean;
  dragging: boolean;
  moved: boolean;
  pointerId: number;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
}

export interface FinishedDragSession {
  session: DragSession | null;
  result: { wasDrag: boolean; wasClick: boolean } | null;
}

export function beginDragSession(
  pointer: DragPoint,
  petPosition: DragPoint,
  pointerId = 0,
): DragSession {
  return {
    pointerDown: true,
    dragging: false,
    moved: false,
    pointerId,
    startX: pointer.x,
    startY: pointer.y,
    offsetX: pointer.x - petPosition.x,
    offsetY: pointer.y - petPosition.y,
  };
}

export function shouldStartDrag(
  session: Pick<DragSession, 'startX' | 'startY'>,
  pointer: DragPoint,
  threshold: number,
): boolean {
  return Math.hypot(pointer.x - session.startX, pointer.y - session.startY) > threshold;
}

export function positionFromPointer(
  pointer: DragPoint,
  session: Pick<DragSession, 'offsetX' | 'offsetY'>,
): DragPoint {
  return { x: pointer.x - session.offsetX, y: pointer.y - session.offsetY };
}

export function updateDragSessionForPointerMove(
  session: DragSession,
  pointer: DragPoint,
  threshold: number,
): DragSession {
  if (session.dragging) return session;
  if (!shouldStartDrag(session, pointer, threshold)) return session;
  return { ...session, dragging: true, moved: true };
}

export function finishDragSession(
  session: DragSession | null,
  pointerId?: number,
): FinishedDragSession {
  if (!session?.pointerDown) return { session: null, result: null };
  if (pointerId !== undefined && session.pointerId !== pointerId) return { session, result: null };
  return {
    session: null,
    result: {
      wasDrag: session.dragging || session.moved,
      wasClick: !session.dragging && !session.moved,
    },
  };
}

export function clampPetCenterToViewport(
  point: DragPoint,
  viewport: { width: number; height: number },
  pet: { width: number; height: number },
  margin: number,
): DragPoint {
  const minX = margin + pet.width / 2;
  const minY = margin + pet.height / 2;
  const maxX = Math.max(minX, viewport.width - margin - pet.width / 2);
  const maxY = Math.max(minY, viewport.height - margin - pet.height / 2);
  return {
    x: Math.max(minX, Math.min(maxX, point.x)),
    y: Math.max(minY, Math.min(maxY, point.y)),
  };
}
