export const HOVER_MENU_SHOW_DELAY_MS = 300;
export const HOVER_MENU_HIDE_DELAY_MS = 500;
export const HOVER_MENU_PENGUIN_RADIUS = 60;
export const HOVER_MENU_MAX_RADIUS = 250;

export interface HoverMenuState {
  open: boolean;
  mustExitBeforeShow: boolean;
  showElapsedMs: number;
  hideElapsedMs: number;
}

export type HoverMenuEvent =
  | { type: 'pointer-distance'; distance: number; dtMs: number }
  | { type: 'force-open' }
  | { type: 'force-close' }
  | { type: 'picked' };

export function createHoverMenuState(): HoverMenuState {
  return {
    open: false,
    mustExitBeforeShow: false,
    showElapsedMs: 0,
    hideElapsedMs: 0,
  };
}

export function reduceHoverMenu(state: HoverMenuState, event: HoverMenuEvent): HoverMenuState {
  if (event.type === 'force-open') {
    return { ...state, open: true, mustExitBeforeShow: false, showElapsedMs: 0, hideElapsedMs: 0 };
  }
  if (event.type === 'force-close') {
    return { ...state, open: false, showElapsedMs: 0, hideElapsedMs: 0 };
  }
  if (event.type === 'picked') {
    return { open: false, mustExitBeforeShow: true, showElapsedMs: 0, hideElapsedMs: 0 };
  }

  const dtMs = Math.max(0, event.dtMs);
  const insidePenguin = event.distance <= HOVER_MENU_PENGUIN_RADIUS;
  const insideMenu = event.distance <= HOVER_MENU_MAX_RADIUS;

  if (state.mustExitBeforeShow) {
    return {
      ...state,
      mustExitBeforeShow: insidePenguin,
      showElapsedMs: 0,
      hideElapsedMs: 0,
    };
  }

  if (!state.open) {
    if (!insidePenguin) return { ...state, showElapsedMs: 0, hideElapsedMs: 0 };
    const showElapsedMs = state.showElapsedMs + dtMs;
    return {
      ...state,
      open: showElapsedMs >= HOVER_MENU_SHOW_DELAY_MS,
      showElapsedMs,
      hideElapsedMs: 0,
    };
  }

  if (insidePenguin || insideMenu) {
    return { ...state, showElapsedMs: 0, hideElapsedMs: 0 };
  }

  const hideElapsedMs = state.hideElapsedMs + dtMs;
  return {
    ...state,
    open: hideElapsedMs < HOVER_MENU_HIDE_DELAY_MS,
    showElapsedMs: 0,
    hideElapsedMs,
  };
}
