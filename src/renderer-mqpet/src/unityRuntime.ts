import type { MqpetConsolePanelRequest } from '@shared/mqpet-console-panel';
import type { MqpetUnityBuildStatus } from '@shared/mqpet-unity-build';
import { consolePanelForMenuAction, type MqPetSourceMenuAction } from '@shared/mqpet-source-assets';

export type MqpetRuntimeKind = 'unity-webgl' | 'fallback-react';

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
