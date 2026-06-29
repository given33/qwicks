import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

type ExportModule = {
  buildUnityBatchmodeArgs: (options: {
    unityEditor: string;
    projectRoot: string;
    outputDir: string;
    logFile: string;
  }) => string[];
  exportUnityWebGL: (options: {
    unityEditor: string;
    projectRoot: string;
    outputDir: string;
    logFile?: string;
    runCommand: (command: string, args: string[], options: { env: NodeJS.ProcessEnv }) => void;
  }) => { outputDir: string };
};

describe('export-unity-webgl', () => {
  it('builds Unity batchmode args for the QWicks QQPet WebGL builder', async () => {
    const modulePath = new URL('../../tools/mqpet-source/export-unity-webgl.mjs', import.meta.url).href;
    const { buildUnityBatchmodeArgs } = await import(modulePath) as ExportModule;

    expect(buildUnityBatchmodeArgs({
      unityEditor: 'C:/Unity/Editor/Unity.exe',
      projectRoot: 'C:/Users/given/Desktop/QQpet_extracted/ExportedProject',
      outputDir: 'D:/QWicksData/mqpet/unity-webgl',
      logFile: 'D:/QWicksData/mqpet/unity-webgl/unity-build.log',
    })).toEqual([
      '-batchmode',
      '-quit',
      '-nographics',
      '-projectPath',
      'C:/Users/given/Desktop/QQpet_extracted/ExportedProject',
      '-executeMethod',
      'QwicksMqpetWebGLBuild.Build',
      '-logFile',
      'D:/QWicksData/mqpet/unity-webgl/unity-build.log',
    ]);
  });

  it('syncs QWicks bridge files, runs Unity, and verifies the exported build', async () => {
    const modulePath = new URL('../../tools/mqpet-source/export-unity-webgl.mjs', import.meta.url).href;
    const { exportUnityWebGL } = await import(modulePath) as ExportModule;
    const projectRoot = join(tmpdir(), `qwicks-mqpet-export-${process.pid}-${Date.now()}`);
    const outputDir = join(projectRoot, 'QwicksMqpetWebGL');
    const unityEditor = join(projectRoot, 'Unity.exe');
    const runCommand = vi.fn((command: string, args: string[]) => {
      expect(command).toBe(unityEditor);
      expect(args).toContain('-executeMethod');
      expect(args).toContain('QwicksMqpetWebGLBuild.Build');
      mkdirSync(join(outputDir, 'Build'), { recursive: true });
      writeFileSync(join(outputDir, 'Build', 'QQPet.loader.js'), 'loader');
      writeFileSync(join(outputDir, 'Build', 'QQPet.framework.js'), 'framework');
      writeFileSync(join(outputDir, 'Build', 'QQPet.wasm'), 'wasm');
      writeFileSync(join(outputDir, 'Build', 'QQPet.data'), 'data');
    });

    mkdirSync(join(projectRoot, 'Assets', 'Scripts', 'Assembly-CSharp'), { recursive: true });
    mkdirSync(join(projectRoot, 'ProjectSettings'), { recursive: true });
    writeFileSync(join(projectRoot, 'Assets', 'Scripts', 'Assembly-CSharp', 'TransparentWindow.cs'), [
      'using System;',
      'using UnityEngine;',
      'public class TransparentWindow : MonoBehaviour',
      '{',
      '\tprivate IntPtr hWnd;',
      '\tprivate bool isStartupAnimating;',
      '\tprivate bool isDragging;',
      '\tprivate bool isWindowMoved;',
      '\tprivate bool isDead;',
      '\tprivate bool isActionPlaying;',
      '\tprivate bool is2DProject;',
      '\tprivate float currentIdleTime;',
      '\tprivate int petLayer;',
      '\tprivate GameObject qqObject;',
      '\tprivate GameObject enterObject;',
      '\tprivate void Update()',
      '\t{',
      '\t\thWnd = FindWindow(null, Application.productName);',
      '\t\tif (hWnd == IntPtr.Zero || Camera.main == null)',
      '\t\t{',
      '\t\t\treturn;',
      '\t\t}',
      '\t\tif (isStartupAnimating)',
      '\t\t{',
      '\t\t\treturn;',
      '\t\t}',
      '\t}',
      '\tprivate void SetClickThrough(bool enabled) {}',
      '\tprivate IntPtr FindWindow(object a, string b) => IntPtr.Zero;',
      '\tprivate void PlayRandomInteraction() {}',
      '\tprivate void PlayQuestionAnimation() {}',
      '}',
    ].join('\n'));

    try {
      const result = exportUnityWebGL({
        unityEditor,
        projectRoot,
        outputDir,
        runCommand,
      });

      expect(result.outputDir).toBe(outputDir);
      expect(runCommand).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
