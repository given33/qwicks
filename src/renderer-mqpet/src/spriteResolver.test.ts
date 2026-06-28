import { describe, expect, it } from 'vitest';
import { createMqpetSpriteBaseUrl, createStaticSpriteResolver, preloadSpriteNames } from './spriteResolver';

describe('createStaticSpriteResolver', () => {
  it('builds encoded URLs without a sprite manifest or importer table', async () => {
    const resolver = createStaticSpriteResolver('/sprites/');

    await expect(resolver.resolve('a b.png')).resolves.toBe('/sprites/a%20b.png');
    expect(resolver.peek('a b.png')).toBe('/sprites/a%20b.png');
  });

  it('can preload only the requested startup frames', async () => {
    const loaded: string[] = [];
    const resolver = createStaticSpriteResolver('/sprites/', {
      load: async (url) => {
        loaded.push(url);
      },
    });

    await preloadSpriteNames(resolver, ['idle.png', 'idle.png']);
    expect(loaded).toEqual(['/sprites/idle.png']);
  });
});

describe('createMqpetSpriteBaseUrl', () => {
  it('uses Vite file-serving URLs for dev sprites', () => {
    expect(
      createMqpetSpriteBaseUrl({
        isDev: true,
        moduleUrl: 'http://localhost:5173/@fs/D:/teamflow-desktop-v2/src/renderer-mqpet/src/PenguinSprite.tsx',
      }),
    ).toBe('http://localhost:5173/@fs/D:/teamflow-desktop-v2/src/asset/img/mqpet/sprites/');
  });

  it('uses copied sprite assets in packaged renderers', () => {
    expect(
      createMqpetSpriteBaseUrl({
        isDev: false,
        moduleUrl: 'file:///D:/teamflow-desktop-v2/out/renderer/assets/mqpet.js',
      }),
    ).toBe('./assets/mqpet-sprites/');
  });
});
