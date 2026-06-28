import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOriginalAssetObjectUrl } from './originalAssetUrl';

describe('createOriginalAssetObjectUrl', () => {
  const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mqpet-test');

  afterEach(() => {
    createObjectUrl.mockClear();
  });

  it('loads original source bytes and wraps them as typed blob URLs', async () => {
    const getAsset = vi.fn(async () => new Uint8Array([1, 2, 3]).buffer);

    await expect(createOriginalAssetObjectUrl('Menu/ditu00.png', getAsset)).resolves.toBe('blob:mqpet-test');

    expect(getAsset).toHaveBeenCalledWith('Menu/ditu00.png');
    const blob = createObjectUrl.mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe('image/png');
  });

  it('infers image and audio MIME types from source file extensions without a manifest lookup', async () => {
    const getAsset = vi.fn(async () => new Uint8Array([1]).buffer);

    await createOriginalAssetObjectUrl('img_res/food/100010031.gif', getAsset);
    await createOriginalAssetObjectUrl('music/main01.mp3', getAsset);

    expect((createObjectUrl.mock.calls[0]?.[0] as Blob).type).toBe('image/gif');
    expect((createObjectUrl.mock.calls[1]?.[0] as Blob).type).toBe('audio/mpeg');
  });

  it('returns null when the bridge cannot read the source asset', async () => {
    await expect(createOriginalAssetObjectUrl('Menu/missing.png', async () => null)).resolves.toBeNull();
  });
});
