import { useState } from 'react';
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

export type { MenuPick } from './radialMenuGeometry';

const MENU_LABELS: Record<MenuPick | 'close', string> = {
  feed: '喂食',
  clean: '洗澡',
  heal: '医疗',
  work: '打工',
  learn: '学习',
  map: '地图',
  status: '状态',
  close: '关闭',
};

export function RadialMenu({
  onPick,
}: {
  onPick: (action: MenuPick | 'close') => void;
}): React.ReactElement {
  const [hover, setHover] = useState(-1);

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
            <text
              x={x}
              y={y + 13}
              textAnchor="middle"
              fontSize={12}
              fill="#5a3a10"
              fontWeight="bold"
              style={{ pointerEvents: 'none' }}
            >
              {MENU_LABELS[segment.action]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
