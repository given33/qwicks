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
});
