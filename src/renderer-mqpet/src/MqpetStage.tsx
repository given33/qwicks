import { useEffect, useRef, useState } from 'react';
import {
  animForFsm,
  initialFsm,
  onAnimComplete as completeFsmAnimation,
  onClick,
  onDeath,
  onDragEnd,
  onDragStart,
  onLevelUp,
  onMenu,
  onRevive,
  onStatusFeedback,
  onTick,
  type MqPetFsm,
} from '@shared/mqpet-fsm';
import { stageOf } from '@shared/mqpet-data';
import type { MqpetConsolePanelRequest } from '@shared/mqpet-console-panel';
import { consolePanelForMenuAction } from '@shared/mqpet-source-assets';
import type { MqPetSave } from '@shared/mqpet-state';
import { PenguinSprite } from './PenguinSprite';
import { RadialMenu, type MenuPick } from './RadialMenu';
import { createHoverMenuState, HOVER_MENU_MAX_RADIUS, reduceHoverMenu, type HoverMenuState } from './hoverMenu';
import { animationEventForStateUpdate, shouldApplyStatusFeedback, sourceAssetForStageFrame } from './mqpetStageEvents';
import {
  beginDragSession,
  clampPetCenterToViewport,
  finishDragSession,
  positionFromPointer,
  type DragSession,
  updateDragSessionForPointerMove,
} from './petInteraction';
import { useFrameLoop } from './useFrameLoop';

type Bridge = {
  reportBBox: (bbox: { x: number; y: number; w: number; h: number } | null) => void;
  setDragging: (dragging: boolean) => void;
  heartbeat: () => void;
  log: (msg: string) => void;
  interact: () => Promise<unknown>;
  work: () => Promise<unknown>;
  learn: () => Promise<unknown>;
  toggleConsole: () => Promise<unknown>;
  openConsolePanel: (request: MqpetConsolePanelRequest) => Promise<unknown>;
  getSourceAsset: (sourcePath: string) => Promise<ArrayBuffer | null>;
  getState: () => Promise<unknown>;
  onStateChanged: (cb: (state: unknown) => void) => () => void;
};

function getBridge(): Bridge | null {
  return typeof window !== 'undefined' ? (window as unknown as { mqpet?: Bridge }).mqpet ?? null : null;
}

const PET_SCALE = 0.7;
const PENGUIN_W = Math.round(128 * PET_SCALE);
const PENGUIN_H = Math.round(144 * PET_SCALE);
const DRAG_THRESHOLD = 5;
const VIEWPORT_MARGIN = 12;
const MENU_HIT_RADIUS = HOVER_MENU_MAX_RADIUS;
export function MqpetStage(): React.ReactElement {
  const bridge = useRef(getBridge());
  const [fsm, setFsm] = useState<MqPetFsm>(initialFsm);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pos, setPos] = useState({ x: 300, y: 400 });
  const posRef = useRef(pos);
  const drag = useRef<DragSession | null>(null);
  const penguinDivRef = useRef<HTMLDivElement | null>(null);
  const bboxPending = useRef(false);
  const hoverMenu = useRef<HoverMenuState>(createHoverMenuState());
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  const saveRef = useRef<MqPetSave | null>(null);
  const lastStatusFeedbackAt = useRef(0);

  posRef.current = pos;

  function applyHoverMenu(next: HoverMenuState): void {
    hoverMenu.current = next;
    setMenuOpen(next.open);
  }

  function distanceToPet(pointer: { x: number; y: number }): number {
    const p = posRef.current;
    return Math.hypot(pointer.x - p.x, pointer.y - p.y);
  }

  useFrameLoop((dt) => {
    setFsm((state) => {
      const ticked = onTick(state, dt);
      const save = saveRef.current;
      if (!save || !shouldApplyStatusFeedback(save, performance.now(), lastStatusFeedbackAt.current)) return ticked;
      const feedback = onStatusFeedback(ticked, save.state);
      if (feedback !== ticked) lastStatusFeedbackAt.current = performance.now();
      return feedback;
    });

    const pointer = lastPointer.current;
    if (!pointer || drag.current?.dragging) return;
    applyHoverMenu(reduceHoverMenu(hoverMenu.current, {
      type: 'pointer-distance',
      distance: distanceToPet(pointer),
      dtMs: dt,
    }));
  });

  function clampToViewport(point: { x: number; y: number }): { x: number; y: number } {
    return clampPetCenterToViewport(
      point,
      { width: window.innerWidth, height: window.innerHeight },
      { width: PENGUIN_W, height: PENGUIN_H },
      VIEWPORT_MARGIN,
    );
  }

  function writePosition(point: { x: number; y: number }, syncState: boolean): void {
    const next = clampToViewport(point);
    posRef.current = next;
    const el = penguinDivRef.current;
    if (el) {
      el.style.left = `${next.x}px`;
      el.style.top = `${next.y}px`;
    }
    if (syncState) setPos(next);
    reportBBoxSoon();
  }

  function reportBBoxSoon(): void {
    if (bboxPending.current) return;
    bboxPending.current = true;
    requestAnimationFrame(() => {
      bboxPending.current = false;
      const p = posRef.current;
      const halfW = menuOpen ? MENU_HIT_RADIUS : PENGUIN_W / 2;
      const halfH = menuOpen ? MENU_HIT_RADIUS : PENGUIN_H / 2;
      bridge.current?.reportBBox({
        x: p.x - halfW,
        y: p.y - halfH,
        w: halfW * 2,
        h: halfH * 2,
      });
    });
  }

  useEffect(() => {
    bridge.current?.log(`MqpetStage mounted, bridge=${bridge.current ? 'OK' : 'NULL'}`);
    writePosition(posRef.current, true);
    const timer = window.setInterval(() => bridge.current?.heartbeat(), 2000);
    void bridge.current?.getState().then((raw) => {
      saveRef.current = raw as MqPetSave;
    });
    const unsubscribe = bridge.current?.onStateChanged((raw) => {
      const previous = saveRef.current;
      const next = raw as MqPetSave;
      saveRef.current = next;
      const event = animationEventForStateUpdate(previous, next);
      if (event === 'feed') setFsm((state) => onMenu(state, 'feed'));
      else if (event === 'clean') setFsm((state) => onMenu(state, 'clean'));
      else if (event === 'level-up' || event === 'stage-change') setFsm((state) => onLevelUp(state));
      else if (event === 'death') setFsm((state) => onDeath(state));
      else if (event === 'revive') setFsm((state) => onRevive(state));
    });
    return () => {
      window.clearInterval(timer);
      unsubscribe?.();
      bridge.current?.setDragging(false);
      bridge.current?.reportBBox(null);
    };
  }, []);

  useEffect(() => {
    reportBBoxSoon();
  }, [menuOpen, pos]);

  useEffect(() => {
    function moveDrag(pointer: { x: number; y: number }): void {
      const session = drag.current;
      if (!session?.pointerDown) return;

      const next = updateDragSessionForPointerMove(session, pointer, DRAG_THRESHOLD);
      if (!session.dragging && next.dragging) {
        bridge.current?.setDragging(true);
        setFsm((state) => onDragStart(state));
      }

      drag.current = next;
      const current = drag.current;
      if (!current?.dragging) return;
      writePosition(positionFromPointer(pointer, current), true);
    }

    function finishDrag(pointerId?: number): void {
      const finished = finishDragSession(drag.current, pointerId);
      drag.current = finished.session;
      if (!finished.result) return;
      bridge.current?.setDragging(false);
      setPos({ ...posRef.current });

      if (finished.result.wasDrag) {
        setFsm((state) => onDragEnd(state));
        return;
      }

      void bridge.current?.interact();
      setFsm((state) => onClick(state));
    }

    function onGlobalMove(e: MouseEvent): void {
      lastPointer.current = { x: e.clientX, y: e.clientY };
      moveDrag({ x: e.clientX, y: e.clientY });
    }

    function onGlobalUp(): void {
      finishDrag();
    }

    function onGlobalCancel(pointerId?: number): void {
      const session = drag.current;
      if (!session) return;
      if (pointerId !== undefined && session.pointerId !== pointerId) return;
      drag.current = null;
      bridge.current?.setDragging(false);
      setPos({ ...posRef.current });
    }

    window.addEventListener('mousemove', onGlobalMove);
    window.addEventListener('mouseup', onGlobalUp);
    function onGlobalPointerMove(e: PointerEvent): void {
      if (drag.current?.pointerId !== e.pointerId) return;
      lastPointer.current = { x: e.clientX, y: e.clientY };
      moveDrag({ x: e.clientX, y: e.clientY });
    }

    function onGlobalPointerUp(e: PointerEvent): void {
      finishDrag(e.pointerId);
    }

    function onGlobalPointerCancel(e: PointerEvent): void {
      onGlobalCancel(e.pointerId);
    }

    function onWindowBlur(): void {
      onGlobalCancel();
    }

    window.addEventListener('pointermove', onGlobalPointerMove);
    window.addEventListener('pointerup', onGlobalPointerUp);
    window.addEventListener('pointercancel', onGlobalPointerCancel);
    window.addEventListener('blur', onWindowBlur);
    return () => {
      window.removeEventListener('mousemove', onGlobalMove);
      window.removeEventListener('mouseup', onGlobalUp);
      window.removeEventListener('pointermove', onGlobalPointerMove);
      window.removeEventListener('pointerup', onGlobalPointerUp);
      window.removeEventListener('pointercancel', onGlobalPointerCancel);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, []);

  function onPenguinPointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    if (e.button === 2) return;
    e.preventDefault();
    drag.current = null;
    bridge.current?.setDragging(false);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = beginDragSession({ x: e.clientX, y: e.clientY }, posRef.current, e.pointerId);
    applyHoverMenu(reduceHoverMenu(hoverMenu.current, { type: 'force-close' }));
  }

  function releasePointerCaptureSafely(target: HTMLDivElement, pointerId: number): void {
    if (target.hasPointerCapture?.(pointerId)) target.releasePointerCapture?.(pointerId);
  }

  function onPenguinPointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    lastPointer.current = { x: e.clientX, y: e.clientY };
    const session = drag.current;
    if (!session?.pointerDown || session.pointerId !== e.pointerId) return;

    const next = updateDragSessionForPointerMove(session, { x: e.clientX, y: e.clientY }, DRAG_THRESHOLD);
    if (!session.dragging && next.dragging) {
      bridge.current?.setDragging(true);
      setFsm((state) => onDragStart(state));
    }
    drag.current = next;
    if (next.dragging) writePosition(positionFromPointer({ x: e.clientX, y: e.clientY }, next), true);
  }

  function onPenguinPointerUp(e: React.PointerEvent<HTMLDivElement>): void {
    const finished = finishDragSession(drag.current, e.pointerId);
    drag.current = finished.session;
    releasePointerCaptureSafely(e.currentTarget, e.pointerId);
    if (!finished.result) return;
    bridge.current?.setDragging(false);
    setPos({ ...posRef.current });

    if (finished.result.wasDrag) {
      setFsm((state) => onDragEnd(state));
      return;
    }

    void bridge.current?.interact();
    setFsm((state) => onClick(state));
  }

  function onPenguinPointerCancel(e: React.PointerEvent<HTMLDivElement>): void {
    const session = drag.current;
    if (session?.pointerId !== e.pointerId) return;
    drag.current = null;
    bridge.current?.setDragging(false);
    releasePointerCaptureSafely(e.currentTarget, e.pointerId);
    setPos({ ...posRef.current });
  }

  function onPenguinContextMenu(e: React.MouseEvent<HTMLDivElement>): void {
    e.preventDefault();
    e.stopPropagation();
    drag.current = null;
    bridge.current?.setDragging(false);
    applyHoverMenu(reduceHoverMenu(hoverMenu.current, { type: 'force-open' }));
  }

  function onAnimComplete(): void {
    setFsm((state) => completeFsmAnimation(state));
  }

  function onPick(action: MenuPick | 'close'): void {
    applyHoverMenu(reduceHoverMenu(hoverMenu.current, { type: 'picked' }));
    if (action === 'close') return;
    const panel = consolePanelForMenuAction(action);
    if (panel) void (bridge.current?.openConsolePanel?.(panel) ?? bridge.current?.toggleConsole());
    else void bridge.current?.toggleConsole();

    if (action === 'work') {
      void bridge.current?.work();
      setFsm((state) => onMenu(state, action));
      return;
    }
    if (action === 'learn') {
      void bridge.current?.learn();
      setFsm((state) => onMenu(state, action));
      return;
    }

    setFsm((state) => onMenu(state, action));
  }

  const isActionPlaying = fsm.kind === 'Feed' || fsm.kind === 'Clean' || fsm.kind === 'Interact'
    || fsm.kind === 'Question' || fsm.kind === 'LevelUp' || fsm.kind === 'Concern'
    || fsm.kind === 'Dying' || fsm.kind === 'Revive' || fsm.kind === 'Dead';

  const currentStage = stageOf(saveRef.current?.state.level ?? 1);
  const sourceAsset = sourceAssetForStageFrame(saveRef.current, fsm);

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <div
        ref={penguinDivRef}
        onPointerDown={onPenguinPointerDown}
        onPointerMove={onPenguinPointerMove}
        onPointerUp={onPenguinPointerUp}
        onPointerCancel={onPenguinPointerCancel}
        onLostPointerCapture={onPenguinPointerCancel}
        onContextMenu={onPenguinContextMenu}
        style={{
          position: 'absolute',
          left: pos.x,
          top: pos.y,
          width: PENGUIN_W,
          height: PENGUIN_H,
          transform: 'translate(-50%, -50%)',
          cursor: 'grab',
          pointerEvents: 'auto',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          zIndex: 2,
        }}
      >
        <PenguinSprite
          animName={animForFsm(fsm, currentStage)}
          sourceAsset={sourceAsset}
          width={PENGUIN_W}
          height={PENGUIN_H}
          getSourceAsset={bridge.current?.getSourceAsset}
          onComplete={onAnimComplete}
        />
      </div>

      {menuOpen && !isActionPlaying && (
        <div
          style={{
            position: 'absolute',
            left: pos.x,
            top: pos.y,
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'auto',
            zIndex: 1,
            width: HOVER_MENU_MAX_RADIUS * 2,
            height: HOVER_MENU_MAX_RADIUS * 2,
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <RadialMenu onPick={onPick} />
        </div>
      )}
    </div>
  );
}
