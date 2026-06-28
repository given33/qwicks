import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function makeRoot(name: string): string {
  const root = join(tmpdir(), `qwicks-mqpet-check-${process.pid}-${Date.now()}-${name}`);
  mkdirSync(join(root, 'Build'), { recursive: true });
  return root;
}

function writeUnityBuild(root: string, stem: string): void {
  writeFileSync(join(root, 'Build', `${stem}.loader.js`), 'loader');
  writeFileSync(join(root, 'Build', `${stem}.framework.js`), 'framework');
  writeFileSync(join(root, 'Build', `${stem}.wasm`), 'wasm');
  writeFileSync(join(root, 'Build', `${stem}.data`), 'data');
}

describe('check-unity-webgl-build', () => {
  it('accepts a complete Unity WebGL build with a non-QQPet stem', () => {
    const root = makeRoot('alternate-stem');
    writeUnityBuild(root, 'QQPetWebGL');

    try {
      const output = execFileSync(
        process.execPath,
        ['tools/mqpet-source/check-unity-webgl-build.mjs', root],
        { cwd: process.cwd(), encoding: 'utf8' },
      );

      expect(output).toContain(`QQPet Unity WebGL build is ready: ${root}`);
      expect(output).toContain('QQPetWebGL.loader.js');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
