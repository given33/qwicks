#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkUnityWebGLBuild } from './check-unity-webgl-build.mjs';
import {
  defaultBundledUnityWebGLOutputDir,
  defaultQwicksUnityWebGLOutputDir,
  findUnityEditor,
} from './export-unity-webgl.mjs';

const DEFAULT_PROJECT_ROOT = 'C:/Users/given/Desktop/QQpet_extracted/ExportedProject';
const UNITY_VERSION_HINT = '2022.3.53f1c1';

function check(id, ok, message) {
  return { id, ok, message };
}

function isUnityProject(projectRoot) {
  return existsSync(join(projectRoot, 'Assets')) && existsSync(join(projectRoot, 'ProjectSettings'));
}

function webglSupportPathForEditor(unityEditor) {
  return resolve(dirname(unityEditor), '..', 'Data', 'PlaybackEngines', 'WebGLSupport');
}

function messageForBuild(result) {
  if (result.ok) return `Unity WebGL build is ready at ${result.root} (${result.stem}.loader.js).`;
  if (result.reason === 'ambiguous-loader') {
    return `Multiple Unity loader files found: ${result.loaderFiles.join(', ')}.`;
  }
  return `Missing files: ${result.missingFiles.join(', ')}.`;
}

export function defaultDoctorOutputDir(env = process.env, target = 'development') {
  return target === 'bundled'
    ? defaultBundledUnityWebGLOutputDir()
    : defaultQwicksUnityWebGLOutputDir(env);
}

export function diagnoseUnityWebGLExport(options = {}) {
  const env = options.env || process.env;
  const projectRoot = resolve(options.projectRoot || DEFAULT_PROJECT_ROOT);
  const outputDir = resolve(
    options.outputDir
      || env.QWICKS_MQPET_UNITY_WEBGL_DIR
      || defaultDoctorOutputDir(env, options.target),
  );
  const unityEditor = findUnityEditor(env);
  const build = checkUnityWebGLBuild(outputDir);
  const checks = [
    check(
      'unity-editor',
      Boolean(unityEditor),
      unityEditor
        ? `Unity Editor found: ${unityEditor}`
        : `Unity Editor not found. Install Unity ${UNITY_VERSION_HINT} or set UNITY_EDITOR.`,
    ),
    check(
      'webgl-support',
      Boolean(unityEditor && existsSync(webglSupportPathForEditor(unityEditor))),
      unityEditor
        ? `WebGL Build Support ${existsSync(webglSupportPathForEditor(unityEditor)) ? 'found' : 'not found'}: ${webglSupportPathForEditor(unityEditor)}`
        : 'WebGL Build Support cannot be checked until Unity Editor is found.',
    ),
    check(
      'unity-project',
      isUnityProject(projectRoot),
      isUnityProject(projectRoot)
        ? `Unity project found: ${projectRoot}`
        : `Unity project root is incomplete or missing Assets/ProjectSettings: ${projectRoot}`,
    ),
    check('webgl-build', build.ok, messageForBuild(build)),
  ];
  const ready = checks.every((item) => item.ok);
  return {
    ready,
    projectRoot,
    outputDir,
    unityEditor,
    checks,
    summary: ready
      ? 'QWicks QQPet Unity WebGL export is ready for runtime verification.'
      : 'QWicks QQPet Unity WebGL export is not ready yet.',
  };
}

function printDiagnostic(result) {
  console.log(result.summary);
  console.log(`Project: ${result.projectRoot}`);
  console.log(`Output: ${result.outputDir}`);
  for (const item of result.checks) {
    console.log(`${item.ok ? '[ok]' : '[missing]'} ${item.id}: ${item.message}`);
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const bundled = process.argv.includes('--bundled');
  const args = process.argv.slice(2).filter((arg) => arg !== '--bundled');
  const result = diagnoseUnityWebGLExport({
    projectRoot: args[0],
    outputDir: args[1],
    target: bundled ? 'bundled' : 'development',
  });
  printDiagnostic(result);
  process.exit(result.ready ? 0 : 1);
}
