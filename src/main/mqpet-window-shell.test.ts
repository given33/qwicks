import { describe, expect, it } from 'vitest';
import {
  MQPET_DRAG_STALE_MS,
  computeMqpetShellInteraction,
  isPointInsideMqpetBBox,
  normalizeMqpetBBox,
} from './mqpet-window-shell';

describe('MQPet shell interaction decisions', () => {
  it('treats the padded pet box as interactive and the rest of the desktop as click-through', () => {
    const bbox = { x: 100, y: 100, w: 80, h: 90 };

    expect(isPointInsideMqpetBBox({ x: 94, y: 105 }, bbox)).toBe(true);
    expect(isPointInsideMqpetBBox({ x: 90, y: 105 }, bbox)).toBe(false);

    expect(computeMqpetShellInteraction({
      bbox,
      cursor: { x: 110, y: 120 },
      windowBounds: { x: 0, y: 0 },
      dragging: false,
      draggingStartedAt: 0,
      now: 1000,
    })).toEqual({ interactive: true, shouldClearDragging: false });

    expect(computeMqpetShellInteraction({
      bbox,
      cursor: { x: 10, y: 10 },
      windowBounds: { x: 0, y: 0 },
      dragging: false,
      draggingStartedAt: 0,
      now: 1000,
    })).toEqual({ interactive: false, shouldClearDragging: false });
  });

  it('keeps the overlay interactive while a fresh drag is active even outside the pet box', () => {
    expect(computeMqpetShellInteraction({
      bbox: { x: 100, y: 100, w: 80, h: 90 },
      cursor: { x: 10, y: 10 },
      windowBounds: { x: 0, y: 0 },
      dragging: true,
      draggingStartedAt: 1000,
      now: 1000 + MQPET_DRAG_STALE_MS - 1,
    })).toEqual({ interactive: true, shouldClearDragging: false });
  });

  it('clears stale dragging so a lost mouseup cannot leave the pet sticky forever', () => {
    expect(computeMqpetShellInteraction({
      bbox: { x: 100, y: 100, w: 80, h: 90 },
      cursor: { x: 10, y: 10 },
      windowBounds: { x: 0, y: 0 },
      dragging: true,
      draggingStartedAt: 1000,
      now: 1000 + MQPET_DRAG_STALE_MS,
    })).toEqual({ interactive: false, shouldClearDragging: true });
  });

  it('ignores malformed boxes from Unity instead of trapping input over the desktop', () => {
    expect(normalizeMqpetBBox({ x: Number.NaN, y: 20, w: 80, h: 90 })).toBeNull();
    expect(normalizeMqpetBBox({ x: 10, y: 20, w: 0, h: 90 })).toBeNull();
    expect(normalizeMqpetBBox({ x: 10, y: 20, w: 80, h: 90 })).toEqual({ x: 10, y: 20, w: 80, h: 90 });
  });
});
