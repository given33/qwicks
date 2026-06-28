#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const QWICKS_MQPET_WEBGL_BUILD_SCRIPT = `using System;
using System.IO;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEngine;

public static class QwicksMqpetWebGLBuild
{
    private const string DefaultBuildDirectory = "QwicksMqpetWebGL";

    public static void Build()
    {
        string outputPath = ResolveOutputPath();
        Directory.CreateDirectory(outputPath);

        PlayerSettings.productName = "QQPet";
        PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Disabled;
        PlayerSettings.WebGL.decompressionFallback = true;

        BuildPlayerOptions options = new BuildPlayerOptions
        {
            scenes = FindEnabledScenes(),
            locationPathName = outputPath,
            target = BuildTarget.WebGL,
            options = BuildOptions.None
        };

        BuildReport report = BuildPipeline.BuildPlayer(options);
        if (report.summary.result != BuildResult.Succeeded)
        {
            throw new Exception($"QWicks MQPet WebGL build failed: {report.summary.result}");
        }

        Debug.Log($"QWicks MQPet WebGL build written to: {outputPath}");
    }

    private static string ResolveOutputPath()
    {
        string fromEnvironment = Environment.GetEnvironmentVariable("QWICKS_MQPET_UNITY_WEBGL_DIR");
        if (!string.IsNullOrWhiteSpace(fromEnvironment))
        {
            return Path.GetFullPath(fromEnvironment);
        }

        string projectRoot = Directory.GetParent(Application.dataPath)?.FullName ?? Directory.GetCurrentDirectory();
        return Path.Combine(projectRoot, DefaultBuildDirectory);
    }

    private static string[] FindEnabledScenes()
    {
        return Array.ConvertAll(
            Array.FindAll(EditorBuildSettings.scenes, scene => scene.enabled),
            scene => scene.path
        );
    }
}
`;

export function syncUnityWebGLBuildScript(projectRoot) {
  const root = resolve(projectRoot);
  const editorDir = join(root, 'Assets', 'Editor');
  const editorScriptPath = join(editorDir, 'QwicksMqpetWebGLBuild.cs');

  mkdirSync(editorDir, { recursive: true });
  writeFileSync(editorScriptPath, QWICKS_MQPET_WEBGL_BUILD_SCRIPT, 'utf8');
  return { editorScriptPath };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const projectRoot = process.argv[2] || 'C:/Users/given/Desktop/QQpet_extracted/ExportedProject';
  const result = syncUnityWebGLBuildScript(projectRoot);
  console.log(`Wrote ${result.editorScriptPath}`);
}
