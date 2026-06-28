#!/usr/bin/env node
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const buildDir = 'Build';
const defaultStem = 'QQPet';
const extensions = ['loader.js', 'framework.js', 'wasm', 'data'];

function buildFile(stem, extension) {
  return `${buildDir}/${stem}.${extension}`;
}

function requiredFiles(stem) {
  return extensions.map((extension) => buildFile(stem, extension));
}

function listLoaderFiles(root) {
  try {
    return readdirSync(join(root, buildDir), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.loader.js'))
      .map((entry) => `${buildDir}/${entry.name}`)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function stemFromLoaderFile(file) {
  return file.slice(`${buildDir}/`.length, -'.loader.js'.length);
}

function detectBuildStem(root) {
  const loaderFiles = listLoaderFiles(root);
  const preferred = buildFile(defaultStem, 'loader.js');
  if (loaderFiles.includes(preferred)) return { stem: defaultStem };
  if (loaderFiles.length === 1) return { stem: stemFromLoaderFile(loaderFiles[0]) };
  if (loaderFiles.length > 1) return { ambiguousLoaderFiles: loaderFiles };
  return null;
}

const envDir = process.env.QWICKS_MQPET_UNITY_WEBGL_DIR?.trim();
const argDir = process.argv[2]?.trim();
const root = resolve(argDir || envDir || join(process.env.APPDATA || process.cwd(), 'QWicks', 'mqpet', 'unity-webgl'));
const detected = detectBuildStem(root);

if (detected?.ambiguousLoaderFiles) {
  console.error(`QQPet Unity WebGL build is ambiguous at: ${root}`);
  console.error('Found multiple Unity loader files:');
  for (const file of detected.ambiguousLoaderFiles) console.error(`- ${file}`);
  console.error('');
  console.error('Keep one WebGL build under Build/ or export with product/build name QQPet.');
  process.exit(1);
}

const stem = detected?.stem || defaultStem;
const required = detected ? requiredFiles(stem) : requiredFiles(defaultStem);
const missing = required.filter((file) => !existsSync(join(root, file)));

if (missing.length > 0) {
  console.error(`QQPet Unity WebGL build is incomplete at: ${root}`);
  console.error('Missing files:');
  for (const file of missing) console.error(`- ${file}`);
  console.error('');
  console.error('Export the Unity project as WebGL and either:');
  console.error('- place the output at QWicks userData/mqpet/unity-webgl, or');
  console.error('- set QWICKS_MQPET_UNITY_WEBGL_DIR to the exported directory.');
  process.exit(1);
}

console.log(`QQPet Unity WebGL build is ready: ${root}`);
console.log(`Unity loader: ${buildFile(stem, 'loader.js')}`);
