#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchTransparentWindowForWebGL } from './patch-transparent-window-webgl.mjs';
import { syncUnityWebGLBridge } from './sync-unity-webgl-bridge.mjs';
import { syncUnityWebGLBuildScript } from './sync-unity-webgl-build-script.mjs';

const DEFAULT_PROJECT_ROOT = 'C:/Users/given/Desktop/QQpet_extracted/ExportedProject';
const UNITY_VERSION_HINT = '2022.3.53f1c1';

export function defaultQwicksUnityWebGLOutputDir(env = process.env) {
  return join(env.APPDATA || process.cwd(), 'QWicks', 'mqpet', 'unity-webgl');
}

export function defaultBundledUnityWebGLOutputDir() {
  return resolve(fileURLToPath(new URL('../../resources/mqpet/unity-webgl', import.meta.url)));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function candidateUnityEditors(env = process.env) {
  const fromEnv = env.UNITY_EDITOR?.trim();
  const programFiles = env.ProgramFiles || 'C:/Program Files';
  const programFilesX86 = env['ProgramFiles(x86)'] || 'C:/Program Files (x86)';
  return unique([
    fromEnv,
    join(programFiles, 'Unity', 'Hub', 'Editor', UNITY_VERSION_HINT, 'Editor', 'Unity.exe'),
    join(programFiles, 'Unity', 'Editor', 'Unity.exe'),
    join(programFilesX86, 'Unity', 'Editor', 'Unity.exe'),
  ]);
}

export function findUnityEditor(env = process.env) {
  for (const candidate of candidateUnityEditors(env)) {
    if (existsSync(candidate)) return candidate;
  }

  const hubEditorRoot = join(env.ProgramFiles || 'C:/Program Files', 'Unity', 'Hub', 'Editor');
  try {
    const versions = readdirSync(hubEditorRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
    for (const version of versions) {
      const candidate = join(hubEditorRoot, version, 'Editor', 'Unity.exe');
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    // Unity Hub is not installed in the default location.
  }

  return null;
}

export function buildUnityBatchmodeArgs(options) {
  return [
    '-batchmode',
    '-quit',
    '-nographics',
    '-projectPath',
    options.projectRoot,
    '-executeMethod',
    'QwicksMqpetWebGLBuild.Build',
    '-logFile',
    options.logFile,
  ];
}

function runVerifier(outputDir) {
  execFileSync(
    process.execPath,
    [fileURLToPath(new URL('./check-unity-webgl-build.mjs', import.meta.url)), outputDir],
    { stdio: 'inherit' },
  );
}

function defaultRunCommand(command, args, options) {
  execFileSync(command, args, {
    stdio: 'inherit',
    env: options.env,
  });
}

function ensureProjectLooksLikeUnity(projectRoot) {
  if (!existsSync(join(projectRoot, 'Assets')) || !existsSync(join(projectRoot, 'ProjectSettings'))) {
    throw new Error(`Not a Unity project root: ${projectRoot}`);
  }
}

export function exportUnityWebGL(options = {}) {
  const projectRoot = resolve(options.projectRoot || DEFAULT_PROJECT_ROOT);
  const outputDir = resolve(
    options.outputDir
      || process.env.QWICKS_MQPET_UNITY_WEBGL_DIR
      || defaultQwicksUnityWebGLOutputDir(),
  );
  const unityEditor = options.unityEditor || findUnityEditor(process.env);
  const logFile = resolve(options.logFile || join(outputDir, 'unity-build.log'));
  const runCommand = options.runCommand || defaultRunCommand;

  if (!unityEditor) {
    throw new Error([
      `Unity Editor not found. Install Unity ${UNITY_VERSION_HINT} with WebGL Build Support,`,
      'or set UNITY_EDITOR to the full Unity.exe path.',
    ].join(' '));
  }

  ensureProjectLooksLikeUnity(projectRoot);
  mkdirSync(outputDir, { recursive: true });

  syncUnityWebGLBridge(projectRoot);
  syncUnityWebGLBuildScript(projectRoot);
  patchTransparentWindowForWebGL(join(projectRoot, 'Assets', 'Scripts', 'Assembly-CSharp', 'TransparentWindow.cs'));

  const env = {
    ...process.env,
    QWICKS_MQPET_UNITY_WEBGL_DIR: outputDir,
  };
  runCommand(unityEditor, buildUnityBatchmodeArgs({
    unityEditor,
    projectRoot,
    outputDir,
    logFile,
  }), { env });
  runVerifier(outputDir);

  return { outputDir };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const outputArg = process.argv[3] === '--bundled'
      ? defaultBundledUnityWebGLOutputDir()
      : process.argv[3];
    const result = exportUnityWebGL({
      projectRoot: process.argv[2],
      outputDir: outputArg,
    });
    console.log(`QWicks MQPet Unity WebGL export ready: ${result.outputDir}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}
