import { describe, expect, it, vi } from 'vitest';
import type { MqpetUnityBuildStatus } from '@shared/mqpet-unity-build';
import { defaultSave } from '@shared/mqpet-state';
import {
  createUnityLoaderConfig,
  describeUnityFallbackReason,
  installUnityBridge,
  selectMqpetStageView,
  selectMqpetRuntime,
  sendUnityMenuAction,
  sendUnityPetState,
  type UnityBridgeTarget,
} from './unityRuntime';

const availableBuild: MqpetUnityBuildStatus = {
  available: true,
  root: 'C:/QWicks/mqpet/unity-webgl',
  buildBaseUrl: 'qwicks-mqpet-unity://local/Build/',
  loaderUrl: 'qwicks-mqpet-unity://local/Build/QQPet.loader.js',
  dataUrl: 'qwicks-mqpet-unity://local/Build/QQPet.data',
  frameworkUrl: 'qwicks-mqpet-unity://local/Build/QQPet.framework.js',
  codeUrl: 'qwicks-mqpet-unity://local/Build/QQPet.wasm',
  streamingAssetsUrl: 'qwicks-mqpet-unity://local/StreamingAssets/',
};

describe('MQPet Unity runtime selection', () => {
  it('selects Unity only when the WebGL build is available', () => {
    expect(selectMqpetRuntime(availableBuild)).toBe('unity-webgl');
    expect(selectMqpetRuntime({
      available: false,
      root: 'C:/missing',
      reason: 'missing-files',
      missingFiles: ['Build/QQPet.wasm'],
    })).toBe('fallback-react');
  });

  it('keeps the Unity stage blank while build status is still loading', () => {
    expect(selectMqpetStageView(null, null)).toBe('loading');
    expect(selectMqpetStageView(undefined, null)).toBe('loading');
  });

  it('falls back only after a missing build or loader failure is known', () => {
    expect(selectMqpetStageView({
      available: false,
      root: 'C:/missing',
      reason: 'missing-files',
      missingFiles: ['Build/QQPet.loader.js'],
    }, null)).toBe('fallback-react');
    expect(selectMqpetStageView(availableBuild, 'Unity loader did not expose createUnityInstance')).toBe('fallback-react');
    expect(selectMqpetStageView(availableBuild, null)).toBe('unity-webgl');
  });

  it('creates the Unity loader config from the resolved build status', () => {
    expect(createUnityLoaderConfig(availableBuild)).toEqual({
      dataUrl: availableBuild.dataUrl,
      frameworkUrl: availableBuild.frameworkUrl,
      codeUrl: availableBuild.codeUrl,
      streamingAssetsUrl: availableBuild.streamingAssetsUrl,
      companyName: 'QWicks',
      productName: 'QQPet',
      productVersion: '0.2.0',
    });
  });

  it('describes missing Unity WebGL files for renderer diagnostics', () => {
    expect(describeUnityFallbackReason({
      available: false,
      root: 'D:/QWicksData/mqpet/unity-webgl',
      reason: 'missing-files',
      missingFiles: [
        'Build/QQPet.framework.js',
        'Build/QQPet.wasm',
      ],
    })).toBe(
      '[mqpet-unity] falling back to React pet: missing Unity WebGL files in D:/QWicksData/mqpet/unity-webgl: Build/QQPet.framework.js, Build/QQPet.wasm',
    );
  });

  it('describes ambiguous Unity loader files for renderer diagnostics', () => {
    expect(describeUnityFallbackReason({
      available: false,
      root: 'D:/QWicksData/mqpet/unity-webgl',
      reason: 'ambiguous-loader',
      loaderFiles: [
        'Build/PetDesktop.loader.js',
        'Build/QQPetWebGL.loader.js',
      ],
    })).toBe(
      '[mqpet-unity] falling back to React pet: multiple Unity loader files in D:/QWicksData/mqpet/unity-webgl: Build/PetDesktop.loader.js, Build/QQPetWebGL.loader.js',
    );
  });

  it('describes runtime Unity loader failures for renderer diagnostics', () => {
    expect(describeUnityFallbackReason(new Error('Unity loader did not expose createUnityInstance'))).toBe(
      '[mqpet-unity] falling back to React pet: Unity loader did not expose createUnityInstance',
    );
  });
});

describe('MQPet Unity bridge', () => {
  it('sends QWicks menu actions into the Unity WebGL bridge object', () => {
    const SendMessage = vi.fn();

    expect(sendUnityMenuAction({ SendMessage }, 'heal')).toBe(true);

    expect(SendMessage).toHaveBeenCalledWith(
      'QwicksMqpetWebGLBridge',
      'HandleQwicksMenuAction',
      'heal',
    );
  });

  it('falls back when the Unity instance cannot receive menu commands', () => {
    expect(sendUnityMenuAction(null, 'feed')).toBe(false);
    expect(sendUnityMenuAction({}, 'feed')).toBe(false);
  });

  it('sends the QWicks pet save snapshot into the Unity WebGL bridge object', () => {
    const SendMessage = vi.fn();
    const save = defaultSave(1_700_000_000_000);

    expect(sendUnityPetState({ SendMessage }, save)).toBe(true);

    expect(SendMessage).toHaveBeenCalledWith(
      'QwicksMqpetWebGLBridge',
      'HandleQwicksPetState',
      JSON.stringify(save),
    );
  });

  it('falls back when the Unity instance cannot receive pet state snapshots', () => {
    expect(sendUnityPetState(null, defaultSave())).toBe(false);
    expect(sendUnityPetState({}, defaultSave())).toBe(false);
    expect(sendUnityPetState({
      SendMessage: () => {
        throw new Error('Unity object missing');
      },
    }, defaultSave())).toBe(false);
  });

  it('forwards Unity hit boxes, dragging, and menu requests to the QWicks bridge', () => {
    const target: UnityBridgeTarget = {};
    const reportBBox = vi.fn();
    const setDragging = vi.fn();
    const openConsolePanel = vi.fn();
    const toggleConsole = vi.fn();
    const syncUnityState = vi.fn();
    const log = vi.fn();

    installUnityBridge(target, {
      reportBBox,
      setDragging,
      openConsolePanel,
      toggleConsole,
      syncUnityState,
      log,
    });

    const bridge = target.qwicksMqpetUnityBridge as {
      reportBBox: (bbox: { x: number; y: number; width: number; height: number }) => void;
      setDragging: (dragging: boolean) => void;
      openMenu: (panel?: 'bag' | 'shop' | 'status' | 'feed' | 'clean' | 'heal' | 'work' | 'learn' | 'map') => void;
      reportPetState: (payload: string) => void;
      log: (message: string) => void;
    };

    const unityStatePayload = '{"state":{"gold":250}}';
    bridge.reportBBox({ x: 10, y: 20, width: 30, height: 40 });
    bridge.setDragging(true);
    bridge.openMenu('bag');
    bridge.openMenu('feed');
    bridge.openMenu('heal');
    bridge.reportPetState(unityStatePayload);
    bridge.log('ready');
    bridge.openMenu();

    expect(reportBBox).toHaveBeenCalledWith({ x: 10, y: 20, w: 30, h: 40 });
    expect(setDragging).toHaveBeenCalledWith(true);
    expect(openConsolePanel).toHaveBeenCalledWith({ tab: 'inventory' });
    expect(openConsolePanel).toHaveBeenCalledWith({ tab: 'inventory', main: 'Feeding', sub: 'Food' });
    expect(openConsolePanel).toHaveBeenCalledWith({ tab: 'inventory', main: 'Feeding', sub: 'Medicine' });
    expect(syncUnityState).toHaveBeenCalledWith(unityStatePayload);
    expect(log).toHaveBeenCalledWith('[unity] ready');
    expect(toggleConsole).toHaveBeenCalledTimes(1);
  });
});
