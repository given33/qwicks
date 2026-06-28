export interface SpriteResolver {
  resolve(sprite: string): Promise<string | undefined>;
  peek(sprite: string): string | undefined;
}

export interface StaticSpriteResolverOptions {
  load?: (url: string) => Promise<void>;
}

export interface MqpetSpriteBaseUrlOptions {
  isDev: boolean;
  moduleUrl: string;
}

function joinSpriteUrl(baseUrl: string, sprite: string): string {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${normalizedBase}${encodeURIComponent(sprite)}`;
}

function defaultImagePreload(url: string): Promise<void> {
  if (typeof Image === 'undefined') return Promise.resolve();
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => resolve();
    image.src = url;
  });
}

export function createStaticSpriteResolver(
  baseUrl: string,
  options: StaticSpriteResolverOptions = {},
): SpriteResolver {
  const cache = new Map<string, string>();
  const pending = new Map<string, Promise<string | undefined>>();
  const load = options.load ?? defaultImagePreload;

  return {
    peek(sprite: string): string | undefined {
      return cache.get(sprite);
    },
    resolve(sprite: string): Promise<string | undefined> {
      const cached = cache.get(sprite);
      if (cached) return Promise.resolve(cached);

      const existing = pending.get(sprite);
      if (existing) return existing;

      const url = joinSpriteUrl(baseUrl, sprite);
      const task = load(url)
        .then(() => {
          cache.set(sprite, url);
          return url;
        })
        .finally(() => pending.delete(sprite));
      pending.set(sprite, task);
      return task;
    },
  };
}

export function createMqpetSpriteBaseUrl(options: MqpetSpriteBaseUrlOptions): string {
  if (!options.isDev) return './assets/mqpet-sprites/';

  return new URL('../../asset/img/mqpet/sprites/', options.moduleUrl).href;
}

export async function preloadSpriteNames(resolver: SpriteResolver, sprites: string[]): Promise<void> {
  await Promise.all(Array.from(new Set(sprites)).map((sprite) => resolver.resolve(sprite)));
}
