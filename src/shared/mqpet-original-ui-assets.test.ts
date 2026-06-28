import { describe, expect, it } from 'vitest';
import {
  ORIGINAL_QQPET_UI_INDEX_META,
  findOriginalUiAsset,
  listOriginalUiAssets,
  originalUiAssetsForDomain,
} from './mqpet-original-ui-assets';

describe('MQPet original UI asset index', () => {
  it('indexes original menu, status, window tip, item art, and music resources', () => {
    expect(ORIGINAL_QQPET_UI_INDEX_META.totalAssets).toBeGreaterThan(1000);
    expect(findOriginalUiAsset('Menu/ditu00.png')).toMatchObject({
      domain: 'Menu',
      sourcePath: 'Menu/ditu00.png',
      format: 'png',
    });
    expect(findOriginalUiAsset('stateInfo/close_normal.png')).toMatchObject({
      domain: 'stateInfo',
      format: 'png',
    });
    expect(findOriginalUiAsset('windowTip/alert/bg.png')).toMatchObject({
      domain: 'windowTip',
      format: 'png',
    });
    expect(findOriginalUiAsset('img_res/food/100010031.gif')).toMatchObject({
      domain: 'img_res',
      subdomain: 'food',
      format: 'gif',
    });
    expect(findOriginalUiAsset('music/main01.mp3')).toMatchObject({
      domain: 'music',
      format: 'mp3',
    });
  });

  it('groups assets by original source domain', () => {
    expect(originalUiAssetsForDomain('Menu')).toHaveLength(25);
    expect(originalUiAssetsForDomain('music').map((asset) => asset.sourcePath)).toEqual(['music/main01.mp3']);
    expect(originalUiAssetsForDomain('img_res').some((asset) => asset.subdomain === 'medicine')).toBe(true);
  });

  it('returns stable sorted asset lists without exposing mutable index state', () => {
    const first = listOriginalUiAssets();
    const second = listOriginalUiAssets();
    expect(first).not.toBe(second);
    expect(first[0]?.sourcePath.localeCompare(first[1]?.sourcePath ?? '', 'en', { numeric: true })).toBeLessThanOrEqual(0);
  });

  it('does not resolve unindexed or unsafe paths', () => {
    expect(findOriginalUiAsset('Action/GG/Egg/Stand.swf')).toBeNull();
    expect(findOriginalUiAsset('../QQpet/QQpet2.exe')).toBeNull();
    expect(findOriginalUiAsset('img_res/../../QQpet/QQpet2.exe')).toBeNull();
  });
});
