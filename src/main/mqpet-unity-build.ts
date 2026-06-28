import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  MQPET_UNITY_BUILD_DIR,
  MQPET_UNITY_DEFAULT_BUILD_STEM,
  MQPET_UNITY_WEBGL_ENV,
  REQUIRED_MQPET_UNITY_BUILD_EXTENSIONS,
  REQUIRED_MQPET_UNITY_BUILD_FILES,
  type MqpetUnityBuildFile,
  type MqpetUnityBuildStatus,
} from '../shared/mqpet-unity-build';

export {
  MQPET_UNITY_BUILD_DIR,
  MQPET_UNITY_DEFAULT_BUILD_STEM,
  MQPET_UNITY_WEBGL_ENV,
  REQUIRED_MQPET_UNITY_BUILD_EXTENSIONS,
  REQUIRED_MQPET_UNITY_BUILD_FILES,
  type MqpetUnityBuildFile,
  type MqpetUnityBuildStatus,
} from '../shared/mqpet-unity-build';

export interface ResolveMqpetUnityBuildOptions {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  userDataPath: string;
}

function fileUrl(path: string): string {
  return pathToFileURL(path).toString();
}

function buildRoot(options: ResolveMqpetUnityBuildOptions): string {
  const fromEnv = options.env?.[MQPET_UNITY_WEBGL_ENV]?.trim();
  if (fromEnv) return fromEnv;
  return join(options.userDataPath, 'mqpet', 'unity-webgl');
}

function buildFile(stem: string, extension: typeof REQUIRED_MQPET_UNITY_BUILD_EXTENSIONS[number]): MqpetUnityBuildFile {
  return `${MQPET_UNITY_BUILD_DIR}/${stem}.${extension}`;
}

function requiredBuildFiles(stem: string): MqpetUnityBuildFile[] {
  return REQUIRED_MQPET_UNITY_BUILD_EXTENSIONS.map((extension) => buildFile(stem, extension));
}

function listLoaderFiles(root: string): MqpetUnityBuildFile[] {
  try {
    return readdirSync(join(root, MQPET_UNITY_BUILD_DIR), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.loader.js'))
      .map((entry) => `${MQPET_UNITY_BUILD_DIR}/${entry.name}` as MqpetUnityBuildFile)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function stemFromLoaderFile(file: MqpetUnityBuildFile): string {
  return file.slice(`${MQPET_UNITY_BUILD_DIR}/`.length, -'.loader.js'.length);
}

function detectBuildStem(root: string): { stem: string } | { ambiguousLoaderFiles: MqpetUnityBuildFile[] } | null {
  const loaderFiles = listLoaderFiles(root);
  const preferred = buildFile(MQPET_UNITY_DEFAULT_BUILD_STEM, 'loader.js');
  if (loaderFiles.includes(preferred)) return { stem: MQPET_UNITY_DEFAULT_BUILD_STEM };
  if (loaderFiles.length === 1) return { stem: stemFromLoaderFile(loaderFiles[0]) };
  if (loaderFiles.length > 1) return { ambiguousLoaderFiles: loaderFiles };
  return null;
}

export function resolveMqpetUnityBuild(options: ResolveMqpetUnityBuildOptions): MqpetUnityBuildStatus {
  const root = buildRoot(options);
  const detected = detectBuildStem(root);
  if (detected && 'ambiguousLoaderFiles' in detected) {
    return {
      available: false,
      root,
      reason: 'ambiguous-loader',
      loaderFiles: detected.ambiguousLoaderFiles,
    };
  }

  const stem = detected?.stem ?? MQPET_UNITY_DEFAULT_BUILD_STEM;
  const requiredFiles = detected ? requiredBuildFiles(stem) : [...REQUIRED_MQPET_UNITY_BUILD_FILES];
  const missingFiles = requiredFiles.filter((file) => !existsSync(join(root, file)));
  if (missingFiles.length > 0) {
    return {
      available: false,
      root,
      reason: 'missing-files',
      missingFiles,
    };
  }

  return {
    available: true,
    root,
    buildBaseUrl: `${fileUrl(join(root, MQPET_UNITY_BUILD_DIR))}/`,
    loaderUrl: fileUrl(join(root, buildFile(stem, 'loader.js'))),
    dataUrl: fileUrl(join(root, buildFile(stem, 'data'))),
    frameworkUrl: fileUrl(join(root, buildFile(stem, 'framework.js'))),
    codeUrl: fileUrl(join(root, buildFile(stem, 'wasm'))),
    streamingAssetsUrl: `${fileUrl(join(root, 'StreamingAssets'))}/`,
  };
}
