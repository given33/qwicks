import {
  ORIGINAL_QQPET_UI_ASSETS,
  ORIGINAL_QQPET_UI_INDEX_META,
  type OriginalQqpetUiDomain,
  type OriginalQqpetUiIndexEntry,
} from './mqpet-original-ui-index';

export { ORIGINAL_QQPET_UI_INDEX_META };
export type MqPetOriginalUiDomain = OriginalQqpetUiDomain;
export type MqPetOriginalUiAssetRef = OriginalQqpetUiIndexEntry;

const SOURCE_PATH_RE = /^(Menu|stateInfo|windowTip|img_res|music)\/[A-Za-z0-9_.~/-]+$/;
const SORT_OPTIONS = { numeric: true, sensitivity: 'base' } as const;

function compareAssets(left: MqPetOriginalUiAssetRef, right: MqPetOriginalUiAssetRef): number {
  return left.sourcePath.localeCompare(right.sourcePath, 'en', SORT_OPTIONS);
}

function isSafeIndexedPath(sourcePath: string): boolean {
  if (!SOURCE_PATH_RE.test(sourcePath)) return false;
  if (sourcePath.includes('..')) return false;
  if (sourcePath.includes('//')) return false;
  return true;
}

const UI_ASSETS = [...ORIGINAL_QQPET_UI_ASSETS].sort(compareAssets);
const UI_ASSET_BY_SOURCE_PATH = new Map(
  UI_ASSETS
    .filter((asset) => isSafeIndexedPath(asset.sourcePath))
    .map((asset) => [asset.sourcePath, asset]),
);

export function listOriginalUiAssets(): MqPetOriginalUiAssetRef[] {
  return UI_ASSETS.slice();
}

export function originalUiAssetsForDomain(domain: MqPetOriginalUiDomain): MqPetOriginalUiAssetRef[] {
  return UI_ASSETS.filter((asset) => asset.domain === domain);
}

export function findOriginalUiAsset(sourcePath: string): MqPetOriginalUiAssetRef | null {
  if (!isSafeIndexedPath(sourcePath)) return null;
  return UI_ASSET_BY_SOURCE_PATH.get(sourcePath) ?? null;
}
