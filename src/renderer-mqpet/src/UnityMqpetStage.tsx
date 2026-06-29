import { useEffect, useRef, useState } from 'react';
import type { MqpetUnityBuildStatus } from '@shared/mqpet-unity-build';
import type { MqpetConsolePanelRequest } from '@shared/mqpet-console-panel';
import { consolePanelForMenuAction } from '@shared/mqpet-source-assets';
import { MqpetStage } from './MqpetStage';
import { RadialMenu, type MenuPick } from './RadialMenu';
import { createHoverMenuState, hoverMenuInteractiveBBox, HOVER_MENU_MAX_RADIUS, reduceHoverMenu, type HoverMenuState } from './hoverMenu';
import {
  createUnityLoaderConfig,
  installUnityBridge,
  sendUnityMenuAction,
  selectMqpetRuntime,
  type UnityLoaderConfig,
} from './unityRuntime';
import { useFrameLoop } from './useFrameLoop';

type UnityInstance = {
  Quit?: () => Promise<void>;
  SendMessage?: (gameObjectName: string, methodName: string, value?: string) => void;
};

type CreateUnityInstance = (
  canvas: HTMLCanvasElement,
  config: UnityLoaderConfig,
) => Promise<UnityInstance>;

type Bridge = {
  reportBBox: (bbox: { x: number; y: number; w: number; h: number } | null) => void;
  setDragging: (dragging: boolean) => void;
  getUnityBuild?: () => Promise<MqpetUnityBuildStatus>;
  getSourceAsset?: (sourcePath: string) => Promise<ArrayBuffer | null>;
  openConsolePanel?: (request: MqpetConsolePanelRequest) => Promise<unknown>;
  toggleConsole?: () => Promise<unknown>;
  log?: (msg: string) => void;
};

type UnityWindow = Window & {
  createUnityInstance?: CreateUnityInstance;
};

function getBridge(): Bridge | null {
  return typeof window !== 'undefined' ? (window as unknown as { mqpet?: Bridge }).mqpet ?? null : null;
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-mqpet-unity-loader="${src}"]`);
    if (existing) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.mqpetUnityLoader = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load Unity QQPet loader: ${src}`));
    document.head.appendChild(script);
  });
}

export function UnityMqpetStage(): React.ReactElement {
  const bridge = useRef(getBridge());
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const unityInstance = useRef<UnityInstance | null>(null);
  const [build, setBuild] = useState<MqpetUnityBuildStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const petBBox = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  const hoverMenu = useRef<HoverMenuState>(createHoverMenuState());

  function fallbackBBox(): { x: number; y: number; w: number; h: number } {
    const w = 90;
    const h = 101;
    return {
      x: Math.max(12, window.innerWidth * 0.5 - w / 2),
      y: Math.max(12, window.innerHeight * 0.68 - h / 2),
      w,
      h,
    };
  }

  function menuCenter(): { x: number; y: number } {
    const bbox = petBBox.current ?? fallbackBBox();
    return {
      x: bbox.x + bbox.w / 2,
      y: bbox.y + bbox.h / 2,
    };
  }

  function applyHoverMenu(next: HoverMenuState): void {
    hoverMenu.current = next;
    setMenuOpen(next.open);
    reportInteractiveBBox(next.open);
  }

  function reportInteractiveBBox(open = menuOpen): void {
    const bbox = petBBox.current ?? fallbackBBox();
    const center = menuCenter();
    bridge.current?.reportBBox(hoverMenuInteractiveBBox({
      center,
      width: bbox.w,
      height: bbox.h,
      open,
    }));
  }

  function distanceToPet(pointer: { x: number; y: number }): number {
    const center = menuCenter();
    return Math.hypot(pointer.x - center.x, pointer.y - center.y);
  }

  useFrameLoop((dt) => {
    const pointer = lastPointer.current;
    if (!pointer || selectMqpetRuntime(build) !== 'unity-webgl') return;
    applyHoverMenu(reduceHoverMenu(hoverMenu.current, {
      type: 'pointer-distance',
      distance: distanceToPet(pointer),
      dtMs: dt,
    }));
  });

  useEffect(() => {
    let cancelled = false;
    if (!bridge.current?.getUnityBuild) {
      setBuild({
        available: false,
        root: '',
        reason: 'missing-files',
        missingFiles: ['Build/QQPet.loader.js'],
      });
      return;
    }

    void bridge.current.getUnityBuild()
      .then((next) => {
        if (!cancelled) setBuild(next);
      })
      .catch((error) => {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : String(error);
          bridge.current?.log?.(`[mqpet-unity] getUnityBuild failed: ${message}`);
          setLoadError(message);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!build?.available || !canvasRef.current) return;
    let cancelled = false;

    installUnityBridge(window as unknown as { qwicksMqpetUnityBridge?: undefined }, {
      reportBBox: (bbox) => {
        petBBox.current = bbox;
        reportInteractiveBBox();
      },
      setDragging: bridge.current?.setDragging ?? (() => undefined),
      openConsolePanel: bridge.current?.openConsolePanel,
      toggleConsole: bridge.current?.toggleConsole,
    });
    reportInteractiveBBox();

    void loadScript(build.loaderUrl)
      .then(async () => {
        if (cancelled) return;
        const createUnityInstance = (window as UnityWindow).createUnityInstance;
        if (!createUnityInstance) throw new Error('Unity loader did not expose createUnityInstance');
        unityInstance.current = await createUnityInstance(canvasRef.current as HTMLCanvasElement, createUnityLoaderConfig(build));
      })
      .catch((error) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        bridge.current?.log?.(`[mqpet-unity] loader failed: ${message}`);
        setLoadError(message);
      });

    return () => {
      cancelled = true;
      void unityInstance.current?.Quit?.();
      unityInstance.current = null;
      bridge.current?.setDragging(false);
      bridge.current?.reportBBox(null);
    };
  }, [build]);

  if (loadError || selectMqpetRuntime(build) === 'fallback-react') {
    return <MqpetStage />;
  }

  function onPointerMove(e: React.PointerEvent): void {
    lastPointer.current = { x: e.clientX, y: e.clientY };
  }

  function onContextMenu(e: React.MouseEvent): void {
    e.preventDefault();
    lastPointer.current = { x: e.clientX, y: e.clientY };
    applyHoverMenu(reduceHoverMenu(hoverMenu.current, { type: 'force-open' }));
  }

  function onPick(action: MenuPick | 'close'): void {
    applyHoverMenu(reduceHoverMenu(hoverMenu.current, { type: 'picked' }));
    if (action === 'close') return;
    if (sendUnityMenuAction(unityInstance.current, action)) return;

    const panel = consolePanelForMenuAction(action);
    if (panel) void (bridge.current?.openConsolePanel?.(panel) ?? bridge.current?.toggleConsole?.());
    else void bridge.current?.toggleConsole?.();
  }

  const center = menuCenter();

  return (
    <div
      onPointerMove={onPointerMove}
      onContextMenu={onContextMenu}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'auto' }}
    >
      <canvas
        ref={canvasRef}
        id="mqpet-unity-canvas"
        style={{
          width: '100vw',
          height: '100vh',
          display: 'block',
          background: 'transparent',
        }}
      />
      {menuOpen && (
        <div
          style={{
            position: 'absolute',
            left: center.x,
            top: center.y,
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'auto',
            width: HOVER_MENU_MAX_RADIUS * 2,
            height: HOVER_MENU_MAX_RADIUS * 2,
            display: 'grid',
            placeItems: 'center',
            zIndex: 2,
          }}
        >
          <RadialMenu onPick={onPick} getSourceAsset={bridge.current?.getSourceAsset} />
        </div>
      )}
    </div>
  );
}
