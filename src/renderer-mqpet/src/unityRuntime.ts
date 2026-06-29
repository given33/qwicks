import type { MqpetConsolePanelRequest } from '@shared/mqpet-console-panel';
import type { MqpetUnityBuildStatus } from '@shared/mqpet-unity-build';
import { consolePanelForMenuAction, type MqPetSourceMenuAction } from '@shared/mqpet-source-assets';

export type MqpetRuntimeKind = 'unity-webgl' | 'fallback-react';
export type MqpetStageView = MqpetRuntimeKind | 'loading';

export interface UnityLoaderConfig {
  dataUrl: string;
  frameworkUrl: string;
  codeUrl: string;
  streamingAssetsUrl: string;
  companyName: string;
  productName: string;
  productVersion: string;
}

export interface UnityBridgeTarget {
  qwicksMqpetUnityBridge?: QwicksMqpetUnityBridge;
}

export interface QwicksMqpetBridge {
  reportBBox: (bbox: { x: number; y: number; w: number; h: number } | null) => void;
  setDragging: (dragging: boolean) => void;
  openConsolePanel?: (request: MqpetConsolePanelRequest) => Promise<unknown> | unknown;
  toggleConsole?: () => Promise<unknown> | unknown;
  log?: (msg: string) => void;
}

export type UnityMenuPanel = 'bag' | 'shop' | 'status' | MqPetSourceMenuAction;

export interface QwicksMqpetUnityBridge {
  reportBBox: (bbox: { x: number; y: number; width: number; height: number } | null) => void;
  setDragging: (dragging: boolean) => void;
  openMenu: (panel?: UnityMenuPanel) => void;
  log: (message: string) => void;
}

export interface UnityMenuCommandTarget {
  SendMessage?: (gameObjectName: string, methodName: string, value?: string) => void;
}

const MENU_PANEL: Record<'bag' | 'shop' | 'status', MqpetConsolePanelRequest> = {
  bag: { tab: 'inventory' },
  shop: { tab: 'shop' },
  status: { tab: 'status' },
};

function panelRequestForUnityMenu(panel: UnityMenuPanel): MqpetConsolePanelRequest | null {
  if (panel === 'bag' || panel === 'shop' || panel === 'status') return MENU_PANEL[panel];
  return consolePanelForMenuAction(panel);
}

export function selectMqpetRuntime(build: MqpetUnityBuildStatus | null | undefined): MqpetRuntimeKind {
  return build?.available ? 'unity-webgl' : 'fallback-react';
}

export function selectMqpetStageView(
  build: MqpetUnityBuildStatus | null | undefined,
  loadError: string | null | undefined,
): MqpetStageView {
  if (loadError) return 'fallback-react';
  if (!build) return 'loading';
  return selectMqpetRuntime(build);
}

export function describeUnityFallbackReason(reason: MqpetUnityBuildStatus | unknown): string {
  if (reason && typeof reason === 'object' && 'available' in reason) {
    const build = reason as MqpetUnityBuildStatus;
    if (build.available) return '[mqpet-unity] using Unity WebGL runtime';
    if (build.reason === 'missing-files') {
      return [
        `[mqpet-unity] falling back to React pet: missing Unity WebGL files in ${build.root}:`,
        build.missingFiles.join(', '),
      ].join(' ');
    }
    return [
      `[mqpet-unity] falling back to React pet: multiple Unity loader files in ${build.root}:`,
      build.loaderFiles.join(', '),
    ].join(' ');
  }

  const message = reason instanceof Error ? reason.message : String(reason);
  return `[mqpet-unity] falling back to React pet: ${message}`;
}

export function createUnityLoaderConfig(build: Extract<MqpetUnityBuildStatus, { available: true }>): UnityLoaderConfig {
  return {
    dataUrl: build.dataUrl,
    frameworkUrl: build.frameworkUrl,
    codeUrl: build.codeUrl,
    streamingAssetsUrl: build.streamingAssetsUrl,
    companyName: 'QWicks',
    productName: 'QQPet',
    productVersion: '0.2.0',
  };
}

export function sendUnityMenuAction(
  unityInstance: UnityMenuCommandTarget | null | undefined,
  action: UnityMenuPanel,
): boolean {
  if (typeof unityInstance?.SendMessage !== 'function') return false;

  try {
    unityInstance.SendMessage('QwicksMqpetWebGLBridge', 'HandleQwicksMenuAction', action);
    return true;
  } catch {
    return false;
  }
}

export function installUnityBridge(target: UnityBridgeTarget, bridge: QwicksMqpetBridge): QwicksMqpetUnityBridge {
  const unityBridge: QwicksMqpetUnityBridge = {
    reportBBox: (bbox) => {
      bridge.reportBBox(bbox ? { x: bbox.x, y: bbox.y, w: bbox.width, h: bbox.height } : null);
    },
    setDragging: (dragging) => {
      bridge.setDragging(Boolean(dragging));
    },
    openMenu: (panel) => {
      const request = panel ? panelRequestForUnityMenu(panel) : null;
      if (request && bridge.openConsolePanel) {
        void bridge.openConsolePanel(request);
        return;
      }
      void bridge.toggleConsole?.();
    },
    log: (message) => {
      bridge.log?.(`[unity] ${message}`);
    },
  };
  target.qwicksMqpetUnityBridge = unityBridge;
  return unityBridge;
}
