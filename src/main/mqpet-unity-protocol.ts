import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';

export const MQPET_UNITY_PROTOCOL = 'qwicks-mqpet-unity';
const MQPET_UNITY_PROTOCOL_HOST = 'local';
const ALLOWED_ROOT_SEGMENTS = new Set(['Build', 'StreamingAssets']);

type ProtocolRequestLike = { url: string };
type ProtocolApiLike = {
  registerSchemesAsPrivileged: (schemes: Array<{
    scheme: string;
    privileges: {
      standard: boolean;
      secure: boolean;
      supportFetchAPI: boolean;
      corsEnabled: boolean;
      stream: boolean;
    };
  }>) => void;
  isProtocolHandled?: (scheme: string) => boolean;
  handle: (
    scheme: string,
    handler: (request: ProtocolRequestLike) => Promise<Response> | Response,
  ) => void;
};

function normalizeResourceSegments(resourcePath: string): string[] | null {
  const trimmed = resourcePath.replace(/^[\\/]+/, '');
  const segments = trimmed.split(/[\\/]+/).filter(Boolean);
  if (segments.length === 0) return null;
  if (!ALLOWED_ROOT_SEGMENTS.has(segments[0])) return null;
  for (const segment of segments) {
    if (segment === '.' || segment === '..' || segment.includes('/') || segment.includes('\\')) return null;
  }
  return segments;
}

function encodeResourcePath(segments: string[], trailingSlash: boolean): string {
  return `${segments.map((segment) => encodeURIComponent(segment)).join('/')}${trailingSlash ? '/' : ''}`;
}

export function createMqpetUnityResourceUrl(resourcePath: string): string {
  const segments = normalizeResourceSegments(resourcePath);
  if (!segments) throw new Error(`Invalid MQPet Unity resource path: ${resourcePath}`);
  const trailingSlash = /[\\/]$/.test(resourcePath);
  return `${MQPET_UNITY_PROTOCOL}://${MQPET_UNITY_PROTOCOL_HOST}/${encodeResourcePath(segments, trailingSlash)}`;
}

function decodeProtocolSegments(url: URL): string[] | null {
  const rawSegments = url.pathname.split('/').filter(Boolean);
  if (rawSegments.length === 0) return null;
  const segments: string[] = [];
  for (const rawSegment of rawSegments) {
    let decoded = '';
    try {
      decoded = decodeURIComponent(rawSegment);
    } catch {
      return null;
    }
    if (decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\')) return null;
    segments.push(decoded);
  }
  if (!ALLOWED_ROOT_SEGMENTS.has(segments[0])) return null;
  return segments;
}

function isInsideRoot(root: string, filePath: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedFile = resolve(filePath);
  return resolvedFile === resolvedRoot || resolvedFile.startsWith(`${resolvedRoot}${sep}`);
}

export function resolveMqpetUnityProtocolPath(root: string, requestUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${MQPET_UNITY_PROTOCOL}:` || url.hostname !== MQPET_UNITY_PROTOCOL_HOST) return null;

  const segments = decodeProtocolSegments(url);
  if (!segments) return null;

  const filePath = join(resolve(root), ...segments);
  return isInsideRoot(root, filePath) ? filePath : null;
}

function contentTypeForPath(filePath: string): string {
  const name = basename(filePath).toLowerCase();
  if (name.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (name.endsWith('.wasm')) return 'application/wasm';
  if (name.endsWith('.json')) return 'application/json; charset=utf-8';
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  if (name.endsWith('.mp3')) return 'audio/mpeg';
  if (name.endsWith('.wav')) return 'audio/wav';
  if (name.endsWith('.ogg')) return 'audio/ogg';
  return 'application/octet-stream';
}

function response(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
    },
  });
}

export function registerMqpetUnityProtocolScheme(protocolApi: ProtocolApiLike): void {
  protocolApi.registerSchemesAsPrivileged([{
    scheme: MQPET_UNITY_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  }]);
}

export function registerMqpetUnityProtocolHandler(input: {
  protocol: ProtocolApiLike;
  resolveRoot: () => string;
  log?: (message: string, detail?: unknown) => void;
}): void {
  if (input.protocol.isProtocolHandled?.(MQPET_UNITY_PROTOCOL)) return;

  input.protocol.handle(MQPET_UNITY_PROTOCOL, async (request) => {
    const filePath = resolveMqpetUnityProtocolPath(input.resolveRoot(), request.url);
    if (!filePath) return response(404, 'MQPet Unity resource not found');

    try {
      const info = await stat(filePath);
      if (!info.isFile()) return response(404, 'MQPet Unity resource not found');
      const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
      return new Response(stream, {
        headers: {
          'content-type': contentTypeForPath(filePath),
          'content-length': String(info.size),
          'access-control-allow-origin': '*',
          'cross-origin-resource-policy': 'cross-origin',
        },
      });
    } catch (error) {
      input.log?.('failed to serve Unity WebGL resource', {
        url: request.url,
        message: error instanceof Error ? error.message : String(error),
      });
      return response(404, 'MQPet Unity resource not found');
    }
  });
}
