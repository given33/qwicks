import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { findOriginalUiAsset } from '../shared/mqpet-original-ui-assets';

const MQPET_SOURCE_ROOT = resolve('C:/Users/given/Desktop/pet');
const MQPET_ACTION_ROOT = resolve(MQPET_SOURCE_ROOT, 'Action');

function isInsideActionRoot(filePath: string): boolean {
  return filePath === MQPET_ACTION_ROOT || filePath.startsWith(`${MQPET_ACTION_ROOT}${sep}`);
}

export function resolveMqpetSourceAssetPath(sourcePath: string): string | null {
  const isActionAsset = sourcePath.startsWith('Action/') && sourcePath.toLowerCase().endsWith('.swf');
  const isOriginalUiAsset = findOriginalUiAsset(sourcePath) !== null;
  if (!isActionAsset && !isOriginalUiAsset) return null;

  const resolved = resolve(MQPET_SOURCE_ROOT, sourcePath.replace(/\//g, sep));
  if (isActionAsset && !isInsideActionRoot(resolved)) return null;
  if (isOriginalUiAsset && !isInsideSourceRoot(resolved)) return null;
  return resolved;
}

function isInsideSourceRoot(filePath: string): boolean {
  return filePath === MQPET_SOURCE_ROOT || filePath.startsWith(`${MQPET_SOURCE_ROOT}${sep}`);
}

export async function readMqpetSourceAsset(sourcePath: string): Promise<ArrayBuffer | null> {
  const resolved = resolveMqpetSourceAssetPath(sourcePath);
  if (!resolved) return null;
  const buffer = await readFile(resolved);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}
