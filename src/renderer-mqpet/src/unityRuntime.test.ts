import { describe, expect, it, vi } from 'vitest';
import type { MqpetUnityBuildStatus } from '@shared/mqpet-unity-build';
import {
  createUnityLoaderConfig,
  describeUnityFallbackReason,
  installUnityBridge,
  selectMqpetRuntime,
  sendUnityMenuAction,
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

  it('forwards Unity hit boxes, dragging, and menu requests to the QWicks bridge', () => {
    const target: UnityBridgeTarget = {};
    const reportBBox = vi.fn();
    const setDragging = vi.fn();
    const openConsolePanel = vi.fn();
    const toggleConsole = vi.fn();
    const log = vi.fn();

    installUnityBridge(target, {
      reportBBox,
      setDragging,
      openConsolePanel,
      toggleConsole,
      log,
    });

    const bridge = target.qwicksMqpetUnityBridge as {
      reportBBox: (bbox: { x: number; y: number; width: number; height: number }) => void;
      setDragging: (dragging: boolean) => void;
      openMenu: (panel?: 'bag' | 'shop' | 'status' | 'feed' | 'clean' | 'heal' | 'work' | 'learn' | 'map') => void;
      log: (message: string) => void;
    };

    bridge.reportBBox({ x: 10, y: 20, width: 30, height: 40 });
    bridge.setDragging(true);
    bridge.openMenu('bag');
    bridge.openMenu('feed');
    bridge.openMenu('heal');
    bridge.log('ready');
    bridge.openMenu();

    expect(reportBBox).toHaveBeenCalledWith({ x: 10, y: 20, w: 30, h: 40 });
    expect(setDragging).toHaveBeenCalledWith(true);
    expect(openConsolePanel).toHaveBeenCalledWith({ tab: 'inventory' });
    expect(openConsolePanel).toHaveBeenCalledWith({ tab: 'inventory', main: 'Feeding', sub: 'Food' });
    expect(openConsolePanel).toHaveBeenCalledWith({ tab: 'inventory', main: 'Feeding', sub: 'Medicine' });
    expect(log).toHaveBeenCalledWith('[unity] ready');
    expect(toggleConsole).toHaveBeenCalledTimes(1);
  });
});
