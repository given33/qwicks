import { describe, expect, it } from 'vitest';
import { createHoverMenuState, reduceHoverMenu, type HoverMenuState } from './hoverMenu';

function step(state: HoverMenuState, distance: number, dtMs: number): HoverMenuState {
  return reduceHoverMenu(state, { type: 'pointer-distance', distance, dtMs });
}

describe('MQPet hover menu timing', () => {
  it('shows after staying within 60px for 300ms', () => {
    let state = createHoverMenuState();
    state = step(state, 40, 299);
    expect(state.open).toBe(false);

    state = step(state, 40, 1);
    expect(state.open).toBe(true);
  });

  it('cancels pending show when pointer leaves penguin radius', () => {
    let state = createHoverMenuState();
    state = step(state, 40, 200);
    state = step(state, 80, 200);
    state = step(state, 40, 99);
    expect(state.open).toBe(false);
  });

  it('hides after staying outside 250px for 500ms', () => {
    let state = { ...createHoverMenuState(), open: true };
    state = step(state, 260, 499);
    expect(state.open).toBe(true);

    state = step(state, 260, 1);
    expect(state.open).toBe(false);
  });

  it('does not hide while pointer is inside the menu radius', () => {
    let state = { ...createHoverMenuState(), open: true };
    state = step(state, 260, 300);
    state = step(state, 200, 400);
    expect(state.open).toBe(true);
  });

  it('locks re-show after a pick until pointer exits the penguin radius', () => {
    let state = reduceHoverMenu({ ...createHoverMenuState(), open: true }, { type: 'picked' });
    expect(state.open).toBe(false);
    expect(state.mustExitBeforeShow).toBe(true);

    state = step(state, 40, 500);
    expect(state.open).toBe(false);

    state = step(state, 80, 0);
    expect(state.mustExitBeforeShow).toBe(false);
    state = step(state, 40, 300);
    expect(state.open).toBe(true);
  });
});
