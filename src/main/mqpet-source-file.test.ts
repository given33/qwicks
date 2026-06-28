import { describe, expect, it } from 'vitest';
import { resolveMqpetSourceAssetPath } from './mqpet-source-file';

describe('MQPet source file resolver', () => {
  it('resolves original QQPet action assets under the allowed pet source root', () => {
    expect(resolveMqpetSourceAssetPath('Action/GG/Egg/Stand.swf')).toBe(
      'C:\\Users\\given\\Desktop\\pet\\Action\\GG\\Egg\\Stand.swf',
    );
  });

  it('rejects non-action paths and traversal attempts', () => {
    expect(resolveMqpetSourceAssetPath('Menu/foo.swf')).toBeNull();
    expect(resolveMqpetSourceAssetPath('../QQpet/QQpet2.exe')).toBeNull();
    expect(resolveMqpetSourceAssetPath('Action/../../QQpet/QQpet2.exe')).toBeNull();
    expect(resolveMqpetSourceAssetPath('Action/GG/Egg/Stand.png')).toBeNull();
  });

  it('resolves indexed original QQPet UI and audio assets under the allowed pet source root', () => {
    expect(resolveMqpetSourceAssetPath('Menu/ditu00.png')).toBe('C:\\Users\\given\\Desktop\\pet\\Menu\\ditu00.png');
    expect(resolveMqpetSourceAssetPath('stateInfo/close_normal.png')).toBe(
      'C:\\Users\\given\\Desktop\\pet\\stateInfo\\close_normal.png',
    );
    expect(resolveMqpetSourceAssetPath('windowTip/alert/bg.png')).toBe(
      'C:\\Users\\given\\Desktop\\pet\\windowTip\\alert\\bg.png',
    );
    expect(resolveMqpetSourceAssetPath('img_res/food/100010031.gif')).toBe(
      'C:\\Users\\given\\Desktop\\pet\\img_res\\food\\100010031.gif',
    );
    expect(resolveMqpetSourceAssetPath('music/main01.mp3')).toBe(
      'C:\\Users\\given\\Desktop\\pet\\music\\main01.mp3',
    );
  });

  it('rejects unindexed UI paths and traversal attempts', () => {
    expect(resolveMqpetSourceAssetPath('Menu/missing.png')).toBeNull();
    expect(resolveMqpetSourceAssetPath('img_res/food/../../Action/GG/Egg/Stand.swf')).toBeNull();
    expect(resolveMqpetSourceAssetPath('music/../../QQpet/QQpet2.exe')).toBeNull();
    expect(resolveMqpetSourceAssetPath('smallGame/foo.swf')).toBeNull();
  });
});
