import { describe, expect, it } from 'vitest';
import { createRufflePublicPath } from './OriginalSwfPlayer';

describe('Ruffle public path', () => {
  it('uses the npm package path in dev mode', () => {
    expect(createRufflePublicPath({
      isDev: true,
      moduleUrl: 'http://localhost:5173/src/renderer-mqpet/src/OriginalSwfPlayer.tsx',
    })).toBe('http://localhost:5173/node_modules/@ruffle-rs/ruffle/');
  });

  it('uses the copied renderer ruffle directory in production', () => {
    expect(createRufflePublicPath({
      isDev: false,
      moduleUrl: 'file:///D:/teamflow-desktop-v2/out/renderer/assets/mqpet.js',
    })).toBe('file:///D:/teamflow-desktop-v2/out/renderer/ruffle/');
  });
});
