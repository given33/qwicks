import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createMqpetUnityResourceUrl,
  registerMqpetUnityProtocolHandler,
  resolveMqpetUnityProtocolPath,
} from './mqpet-unity-protocol';

describe('MQPet Unity resource protocol', () => {
  it('creates stable internal URLs for Unity WebGL resources', () => {
    expect(createMqpetUnityResourceUrl('Build/QQPet.loader.js')).toBe(
      'qwicks-mqpet-unity://local/Build/QQPet.loader.js',
    );
    expect(createMqpetUnityResourceUrl('StreamingAssets/catalog data.json')).toBe(
      'qwicks-mqpet-unity://local/StreamingAssets/catalog%20data.json',
    );
  });

  it('resolves Build and StreamingAssets URLs inside the configured Unity export root', () => {
    const root = resolve('D:/QWicksData/mqpet/unity-webgl');

    expect(resolveMqpetUnityProtocolPath(root, 'qwicks-mqpet-unity://local/Build/QQPet.wasm')).toBe(
      join(root, 'Build', 'QQPet.wasm'),
    );
    expect(resolveMqpetUnityProtocolPath(root, 'qwicks-mqpet-unity://local/StreamingAssets/items.json')).toBe(
      join(root, 'StreamingAssets', 'items.json'),
    );
  });

  it('rejects non-Unity URLs and traversal attempts', () => {
    const root = resolve('D:/QWicksData/mqpet/unity-webgl');

    expect(resolveMqpetUnityProtocolPath(root, 'file:///D:/QWicksData/mqpet/unity-webgl/Build/QQPet.wasm')).toBeNull();
    expect(resolveMqpetUnityProtocolPath(root, 'qwicks-mqpet-unity://other/Build/QQPet.wasm')).toBeNull();
    expect(resolveMqpetUnityProtocolPath(root, 'qwicks-mqpet-unity://local/../settings.json')).toBeNull();
    expect(resolveMqpetUnityProtocolPath(root, 'qwicks-mqpet-unity://local/Build/%2E%2E/settings.json')).toBeNull();
    expect(resolveMqpetUnityProtocolPath(root, 'qwicks-mqpet-unity://local/ProjectSettings/ProjectVersion.txt')).toBeNull();
  });

  it('serves Unity files with WebGL-friendly CORS headers', async () => {
    const root = join(tmpdir(), `qwicks-mqpet-unity-protocol-${process.pid}-${Date.now()}`);
    mkdirSync(join(root, 'Build'), { recursive: true });
    writeFileSync(join(root, 'Build', 'QQPet.wasm'), 'wasm');

    const captured: {
      handler?: (request: { url: string }) => Promise<Response> | Response;
    } = {};
    registerMqpetUnityProtocolHandler({
      protocol: {
        registerSchemesAsPrivileged: () => undefined,
        isProtocolHandled: () => false,
        handle: (_scheme, nextHandler) => {
          captured.handler = nextHandler;
        },
      },
      resolveRoot: () => root,
    });

    try {
      if (!captured.handler) throw new Error('protocol handler was not registered');
      const handle = captured.handler;
      const result = await handle({ url: 'qwicks-mqpet-unity://local/Build/QQPet.wasm' });

      expect(result?.status).toBe(200);
      expect(result?.headers.get('content-type')).toBe('application/wasm');
      expect(result?.headers.get('access-control-allow-origin')).toBe('*');
      expect(result?.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
