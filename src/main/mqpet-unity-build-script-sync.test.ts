import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type SyncModule = {
  syncUnityWebGLBuildScript: (projectRoot: string) => { editorScriptPath: string };
};

describe('syncUnityWebGLBuildScript', () => {
  it('writes an Editor batchmode build script into a Unity project', async () => {
    const modulePath = new URL('../../tools/mqpet-source/sync-unity-webgl-build-script.mjs', import.meta.url).href;
    const { syncUnityWebGLBuildScript } = await import(modulePath) as SyncModule;
    const projectRoot = join(tmpdir(), `qwicks-mqpet-unity-build-script-${process.pid}-${Date.now()}`);
    mkdirSync(join(projectRoot, 'Assets'), { recursive: true });

    try {
      const result = syncUnityWebGLBuildScript(projectRoot);

      expect(result.editorScriptPath).toBe(join(projectRoot, 'Assets', 'Editor', 'QwicksMqpetWebGLBuild.cs'));
      const script = readFileSync(result.editorScriptPath, 'utf8');
      expect(script).toContain('public static class QwicksMqpetWebGLBuild');
      expect(script).toContain('public static void Build()');
      expect(script).toContain('BuildTarget.WebGL');
      expect(script).toContain('PlayerSettings.productName = "QQPet"');
      expect(script).toContain('BuildPipeline.BuildPlayer');
      expect(script).toContain('QWICKS_MQPET_UNITY_WEBGL_DIR');
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
