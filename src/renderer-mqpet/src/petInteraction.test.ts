import { describe, expect, it } from 'vitest';
import {
  beginDragSession,
  clampPetCenterToViewport,
  finishDragSession,
  positionFromPointer,
  shouldStartDrag,
  updateDragSessionForPointerMove,
} from './petInteraction';

describe('MQPet drag interaction', () => {
  it('does not treat a pointer-down as a drag before the threshold is crossed', () => {
    const session = beginDragSession({ x: 320, y: 430 }, { x: 300, y: 400 });

    expect(session.dragging).toBe(false);
    expect(shouldStartDrag(session, { x: 323, y: 433 }, 5)).toBe(false);
  });

  it('starts dragging only after the pointer moves beyond the threshold', () => {
    const session = beginDragSession({ x: 320, y: 430 }, { x: 300, y: 400 });

    expect(shouldStartDrag(session, { x: 328, y: 438 }, 5)).toBe(true);
    expect(positionFromPointer({ x: 328, y: 438 }, session)).toEqual({ x: 308, y: 408 });
  });

  it('clears a short pointer movement as a click instead of leaving a sticky drag session', () => {
    const session = beginDragSession({ x: 320, y: 430 }, { x: 300, y: 400 }, 12);
    const moved = updateDragSessionForPointerMove(session, { x: 323, y: 433 }, 5);
    const finished = finishDragSession(moved, 12);

    expect(moved.dragging).toBe(false);
    expect(finished.session).toBeNull();
    expect(finished.result).toEqual({ wasDrag: false, wasClick: true });
  });

  it('ignores releases from stale pointers so a new click can own the session', () => {
    const session = beginDragSession({ x: 320, y: 430 }, { x: 300, y: 400 }, 12);
    const finished = finishDragSession(session, 99);

    expect(finished.session).toBe(session);
    expect(finished.result).toBeNull();
  });

  it('keeps the full penguin inside the viewport while dragging', () => {
    expect(
      clampPetCenterToViewport(
        { x: -100, y: 9999 },
        { width: 800, height: 600 },
        { width: 96, height: 120 },
        12,
      ),
    ).toEqual({ x: 60, y: 528 });
  });
});
