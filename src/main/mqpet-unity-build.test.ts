import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REQUIRED_MQPET_UNITY_BUILD_FILES,
  resolveMqpetUnityBuild,
} from './mqpet-unity-build';

function makeBuildDir(name: string): string {
  const root = join(tmpdir(), `qwicks-mqpet-unity-${process.pid}-${Date.now()}-${name}`);
  mkdirSync(join(root, 'Build'), { recursive: true });
  return root;
}

function writeRequiredBuildFiles(root: string): void {
  for (const file of REQUIRED_MQPET_UNITY_BUILD_FILES) {
    writeFileSync(join(root, file), `mock ${file}`);
  }
}

function writeUnityBuildFiles(root: string, stem: string): void {
  writeFileSync(join(root, 'Build', `${stem}.loader.js`), 'loader');
  writeFileSync(join(root, 'Build', `${stem}.framework.js`), 'framework');
  writeFileSync(join(root, 'Build', `${stem}.wasm`), 'wasm');
  writeFileSync(join(root, 'Build', `${stem}.data`), 'data');
}

describe('resolveMqpetUnityBuild', () => {
  it('uses an explicit environment directory and returns renderer-safe file URLs', () => {
    const root = makeBuildDir('env path 中文');
    writeRequiredBuildFiles(root);

    const result = resolveMqpetUnityBuild({
      env: { QWICKS_MQPET_UNITY_WEBGL_DIR: root },
      userDataPath: join(root, 'unused-user-data'),
    });

    expect(result.available).toBe(true);
    if (!result.available) throw new Error(result.reason);
    expect(result.root).toBe(root);
    expect(result.loaderUrl).toBe('qwicks-mqpet-unity://local/Build/QQPet.loader.js');
    expect(result.dataUrl).toBe('qwicks-mqpet-unity://local/Build/QQPet.data');
    expect(result.frameworkUrl).toBe('qwicks-mqpet-unity://local/Build/QQPet.framework.js');
    expect(result.codeUrl).toBe('qwicks-mqpet-unity://local/Build/QQPet.wasm');
    expect(result.streamingAssetsUrl).toBe('qwicks-mqpet-unity://local/StreamingAssets/');
    expect(result.loaderUrl).toContain('QQPet.loader.js');
    expect(result.loaderUrl).not.toContain('\\');
    expect(result.buildBaseUrl).toBe('qwicks-mqpet-unity://local/Build/');
  });

  it('falls back to the QWicks userData unity-webgl directory when no env override is set', () => {
    const userDataPath = makeBuildDir('userdata');
    const root = join(userDataPath, 'mqpet', 'unity-webgl');
    mkdirSync(join(root, 'Build'), { recursive: true });
    writeRequiredBuildFiles(root);

    const result = resolveMqpetUnityBuild({
      env: {},
      userDataPath,
    });

    expect(result.available).toBe(true);
    if (!result.available) throw new Error(result.reason);
    expect(result.root).toBe(root);
  });

  it('detects the Unity build stem from the loader file instead of requiring QQPet', () => {
    const root = makeBuildDir('alternate-stem');
    writeUnityBuildFiles(root, 'QQPetWebGL');

    const result = resolveMqpetUnityBuild({
      env: { QWICKS_MQPET_UNITY_WEBGL_DIR: root },
      userDataPath: join(root, 'unused-user-data'),
    });

    expect(result.available).toBe(true);
    if (!result.available) throw new Error(result.reason);
    expect(result.loaderUrl).toContain('QQPetWebGL.loader.js');
    expect(result.dataUrl).toContain('QQPetWebGL.data');
    expect(result.frameworkUrl).toContain('QQPetWebGL.framework.js');
    expect(result.codeUrl).toContain('QQPetWebGL.wasm');
  });

  it('reports every missing required WebGL file without throwing', () => {
    const root = makeBuildDir('missing');
    writeFileSync(join(root, 'Build', 'QQPet.loader.js'), 'loader');

    const result = resolveMqpetUnityBuild({
      env: { QWICKS_MQPET_UNITY_WEBGL_DIR: root },
      userDataPath: join(root, 'unused-user-data'),
    });

    expect(result.available).toBe(false);
    if (result.available) throw new Error('expected missing build');
    expect(result.reason).toBe('missing-files');
    if (result.reason !== 'missing-files') throw new Error(result.reason);
    expect(result.root).toBe(root);
    expect(result.missingFiles).toEqual([
      'Build/QQPet.framework.js',
      'Build/QQPet.wasm',
      'Build/QQPet.data',
    ]);
  });

  it('reports matching missing files for the detected Unity build stem', () => {
    const root = makeBuildDir('alternate-missing');
    writeFileSync(join(root, 'Build', 'PetDesktop.loader.js'), 'loader');

    const result = resolveMqpetUnityBuild({
      env: { QWICKS_MQPET_UNITY_WEBGL_DIR: root },
      userDataPath: join(root, 'unused-user-data'),
    });

    expect(result.available).toBe(false);
    if (result.available) throw new Error('expected missing build');
    expect(result.reason).toBe('missing-files');
    if (result.reason !== 'missing-files') throw new Error(result.reason);
    expect(result.missingFiles).toEqual([
      'Build/PetDesktop.framework.js',
      'Build/PetDesktop.wasm',
      'Build/PetDesktop.data',
    ]);
  });

  it('does not guess when multiple non-default Unity loader files are present', () => {
    const root = makeBuildDir('ambiguous-loader');
    writeFileSync(join(root, 'Build', 'PetDesktop.loader.js'), 'loader');
    writeFileSync(join(root, 'Build', 'QQPetWebGL.loader.js'), 'loader');

    const result = resolveMqpetUnityBuild({
      env: { QWICKS_MQPET_UNITY_WEBGL_DIR: root },
      userDataPath: join(root, 'unused-user-data'),
    });

    expect(result.available).toBe(false);
    if (result.available) throw new Error('expected ambiguous build');
    expect(result.reason).toBe('ambiguous-loader');
    if (result.reason !== 'ambiguous-loader') throw new Error(result.reason);
    expect(result.loaderFiles).toEqual([
      'Build/PetDesktop.loader.js',
      'Build/QQPetWebGL.loader.js',
    ]);
  });
});
