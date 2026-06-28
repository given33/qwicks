import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function cspDirective(name: string): string[] {
  const html = readFileSync(resolve('src/renderer/mqpet.html'), 'utf8');
  const csp = html.match(/Content-Security-Policy"[\s\S]*?content="([^"]+)"/)?.[1] ?? '';
  const directive = csp.match(new RegExp(`${name}\\s+([^;]+)`))?.[1] ?? '';
  return directive.split(/\s+/).filter(Boolean);
}

describe('MQPet renderer content security policy', () => {
  it('allows local Unity WebGL loader, wasm/data, worker, image, and media files', () => {
    expect(cspDirective('default-src')).toContain('file:');
    expect(cspDirective('script-src')).toContain('file:');
    expect(cspDirective('worker-src')).toContain('file:');
    expect(cspDirective('connect-src')).toContain('file:');
    expect(cspDirective('img-src')).toContain('file:');
    expect(cspDirective('media-src')).toContain('file:');
  });
});
