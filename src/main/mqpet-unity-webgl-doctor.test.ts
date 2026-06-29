import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type DoctorModule = {
  defaultDoctorOutputDir: (env: NodeJS.ProcessEnv, target?: 'development' | 'bundled') => string;
  diagnoseUnityWebGLExport: (options: {
    env?: NodeJS.ProcessEnv;
    projectRoot: string;
    outputDir: string;
  }) => {
    ready: boolean;
    checks: Array<{ id: string; ok: boolean; message: string }>;
    summary: string;
  };
};

function makeUnityProject(root: string): void {
  mkdirSync(join(root, 'Assets'), { recursive: true });
  mkdirSync(join(root, 'ProjectSettings'), { recursive: true });
}

function writeUnityBuild(root: string): void {
  mkdirSync(join(root, 'Build'), { recursive: true });
  writeFileSync(join(root, 'Build', 'QQPet.loader.js'), 'loader');
  writeFileSync(join(root, 'Build', 'QQPet.framework.js'), 'framework');
  writeFileSync(join(root, 'Build', 'QQPet.wasm'), 'wasm');
  writeFileSync(join(root, 'Build', 'QQPet.data'), 'data');
}

describe('doctor-unity-webgl', () => {
  it('can diagnose the release-bundled WebGL output directory', async () => {
    const modulePath = new URL('../../tools/mqpet-source/doctor-unity-webgl.mjs', import.meta.url).href;
    const { defaultDoctorOutputDir } = await import(`${modulePath}?bundled-output-${Date.now()}`) as DoctorModule;

    expect(defaultDoctorOutputDir(process.env, 'bundled').replace(/\\/g, '/')).toMatch(
      /resources\/mqpet\/unity-webgl$/,
    );
  });

  it('reports the missing Unity Editor and incomplete WebGL export without throwing', async () => {
    const modulePath = new URL('../../tools/mqpet-source/doctor-unity-webgl.mjs', import.meta.url).href;
    const { diagnoseUnityWebGLExport } = await import(modulePath) as DoctorModule;
    const root = join(tmpdir(), `qwicks-mqpet-doctor-missing-${process.pid}-${Date.now()}`);
    const projectRoot = join(root, 'ExportedProject');
    const outputDir = join(root, 'unity-webgl');
    makeUnityProject(projectRoot);

    try {
      const result = diagnoseUnityWebGLExport({
        env: {
          ProgramFiles: join(root, 'Program Files'),
          APPDATA: join(root, 'AppData', 'Roaming'),
        } as NodeJS.ProcessEnv,
        projectRoot,
        outputDir,
      });

      expect(result.ready).toBe(false);
      expect(result.checks.find((check) => check.id === 'unity-editor')).toMatchObject({
        ok: false,
        message: expect.stringContaining('Unity Editor not found'),
      });
      expect(result.checks.find((check) => check.id === 'webgl-build')).toMatchObject({
        ok: false,
        message: expect.stringContaining('Missing files'),
      });
      expect(result.summary).toContain('not ready');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports ready when Unity Editor, project, and WebGL output are present', async () => {
    const modulePath = new URL('../../tools/mqpet-source/doctor-unity-webgl.mjs', import.meta.url).href;
    const { diagnoseUnityWebGLExport } = await import(`${modulePath}?ready-${Date.now()}`) as DoctorModule;
    const root = join(tmpdir(), `qwicks-mqpet-doctor-ready-${process.pid}-${Date.now()}`);
    const projectRoot = join(root, 'ExportedProject');
    const outputDir = join(root, 'unity-webgl');
    const unityEditor = join(root, 'Editor', 'Unity.exe');
    makeUnityProject(projectRoot);
    writeUnityBuild(outputDir);
    mkdirSync(join(root, 'Data', 'PlaybackEngines', 'WebGLSupport'), { recursive: true });
    mkdirSync(join(root, 'Editor'), { recursive: true });
    writeFileSync(unityEditor, '');

    try {
      const result = diagnoseUnityWebGLExport({
        env: {
          UNITY_EDITOR: unityEditor,
          APPDATA: join(root, 'AppData', 'Roaming'),
        } as NodeJS.ProcessEnv,
        projectRoot,
        outputDir,
      });

      expect(result.ready).toBe(true);
      expect(result.checks.every((check) => check.ok)).toBe(true);
      expect(result.summary).toContain('ready');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
