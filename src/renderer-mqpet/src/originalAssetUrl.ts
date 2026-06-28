export type GetOriginalAsset = (sourcePath: string) => Promise<ArrayBuffer | null>;

const MIME_BY_FORMAT: Record<string, string> = {
  bmp: 'image/bmp',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  mp3: 'audio/mpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  swf: 'application/x-shockwave-flash',
};

function mimeForSourcePath(sourcePath: string): string {
  const ext = sourcePath.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_FORMAT[ext] ?? 'application/octet-stream';
}

export async function createOriginalAssetObjectUrl(
  sourcePath: string,
  getOriginalAsset: GetOriginalAsset | undefined,
): Promise<string | null> {
  if (!getOriginalAsset) return null;
  const data = await getOriginalAsset(sourcePath);
  if (!data) return null;
  return URL.createObjectURL(new Blob([data], { type: mimeForSourcePath(sourcePath) }));
}
