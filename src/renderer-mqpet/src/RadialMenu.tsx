import { useEffect, useMemo, useState } from 'react';
import {
  MENU_CENTER,
  MENU_INNER_RADIUS,
  MENU_OUTER_RADIUS,
  MENU_SEGMENTS,
  MENU_SIZE,
  pointToMenuSegment,
  segmentAngles,
  segmentPath,
  type MenuPick,
} from './radialMenuGeometry';
import { createOriginalAssetObjectUrl, type GetOriginalAsset } from './originalAssetUrl';

export type { MenuPick } from './radialMenuGeometry';

export function RadialMenu({
  onPick,
  getSourceAsset,
}: {
  onPick: (action: MenuPick | 'close') => void;
  getSourceAsset?: GetOriginalAsset;
}): React.ReactElement {
  const [hover, setHover] = useState(-1);
  const [sourceUrls, setSourceUrls] = useState<Record<string, string>>({});
  const sourcePaths = useMemo(() => MENU_SEGMENTS.map((segment) => segment.sourcePath), []);

  useEffect(() => {
    let cancelled = false;
    const createdUrls: string[] = [];

    async function load(): Promise<void> {
      if (!getSourceAsset) return;
      const entries = await Promise.all(sourcePaths.map(async (sourcePath) => {
        const url = await createOriginalAssetObjectUrl(sourcePath, getSourceAsset);
        if (url) createdUrls.push(url);
        return [sourcePath, url] as const;
      }));
      if (cancelled) return;
      setSourceUrls(Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry[1]))));
    }

    void load();
    return () => {
      cancelled = true;
      for (const url of createdUrls) URL.revokeObjectURL(url);
    };
  }, [getSourceAsset, sourcePaths]);

  function handleMove(e: React.PointerEvent<SVGSVGElement>): void {
    const rect = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    setHover(pointToMenuSegment(dx, dy));
  }

  function handleLeave(): void {
    setHover(-1);
  }

  function handleUp(): void {
    if (hover < 0) return;
    onPick(MENU_SEGMENTS[hover].action);
  }

  return (
    <svg
      width={MENU_SIZE}
      height={MENU_SIZE}
      viewBox={`0 0 ${MENU_SIZE} ${MENU_SIZE}`}
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
      onPointerUp={handleUp}
      style={{ display: 'block', pointerEvents: 'auto', cursor: 'pointer' }}
      aria-label="MQPet menu"
    >
      {MENU_SEGMENTS.map((segment, index) => {
        const isHover = hover === index;
        const { mid } = segmentAngles(index);
        const labelRadius = (MENU_INNER_RADIUS + MENU_OUTER_RADIUS) / 2;
        const x = MENU_CENTER + labelRadius * Math.cos(mid);
        const y = MENU_CENTER - labelRadius * Math.sin(mid);
        const sourceUrl = sourceUrls[segment.sourcePath];

        return (
          <g key={segment.action}>
            <path
              d={segmentPath(index)}
              fill={isHover ? segment.color : 'rgba(255, 255, 255, 0.92)'}
              stroke="#c98a2b"
              strokeWidth={2}
              style={{
                filter: isHover ? 'brightness(1.12) drop-shadow(0 0 4px rgba(0,0,0,0.3))' : 'none',
              }}
            />
            {sourceUrl ? (
              <image
                href={sourceUrl}
                x={x - 10}
                y={y - 24}
                width={20}
                height={20}
                preserveAspectRatio="xMidYMid meet"
                opacity={isHover ? 1 : 0.92}
                style={{ pointerEvents: 'none' }}
              />
            ) : (
              <text
                x={x}
                y={y - 6}
                textAnchor="middle"
                fontSize={18}
                fontWeight="700"
                fill="#5a3a10"
                style={{ pointerEvents: 'none' }}
              >
                {segment.icon}
              </text>
            )}
            <text
              x={x}
              y={y + 13}
              textAnchor="middle"
              fontSize={12}
              fill="#5a3a10"
              fontWeight="bold"
              style={{ pointerEvents: 'none' }}
            >
              {segment.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
