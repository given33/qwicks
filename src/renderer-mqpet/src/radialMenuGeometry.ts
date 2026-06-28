export type MenuPick = 'feed' | 'clean' | 'heal' | 'work' | 'learn' | 'map' | 'status';
export type MenuAction = MenuPick | 'close';

export interface MenuSegment {
  label: string;
  icon: string;
  action: MenuAction;
  color: string;
  sourcePath: string;
}

export const MENU_SEGMENTS: MenuSegment[] = [
  { label: '喂食', icon: 'F', action: 'feed', color: '#8bc34a', sourcePath: 'Menu/ditu01.png' },
  { label: '洗澡', icon: 'B', action: 'clean', color: '#4fc3f7', sourcePath: 'Menu/ditu02.png' },
  { label: '医疗', icon: 'M', action: 'heal', color: '#f06292', sourcePath: 'Menu/ditu03.png' },
  { label: '打工', icon: 'W', action: 'work', color: '#ffb74d', sourcePath: 'Menu/ditu04.png' },
  { label: '学习', icon: 'L', action: 'learn', color: '#9575cd', sourcePath: 'Menu/ditu05.png' },
  { label: '地图', icon: 'P', action: 'map', color: '#4db6ac', sourcePath: 'Menu/ditu06.png' },
  { label: '状态', icon: 'S', action: 'status', color: '#7986cb', sourcePath: 'Menu/ditu07.png' },
  { label: '关闭', icon: 'X', action: 'close', color: '#e57373', sourcePath: 'Menu/ditu09.png' },
];

export const MENU_TOTAL = MENU_SEGMENTS.length;
export const SEGMENT_ANGLE_DEG = 360 / MENU_TOTAL;
export const MENU_INNER_RADIUS = 54;
export const MENU_OUTER_RADIUS = 132;
export const MENU_SIZE = 320;
export const MENU_CENTER = MENU_SIZE / 2;

export function segmentAngles(index: number): { start: number; end: number; mid: number } {
  const midDeg = 90 - index * SEGMENT_ANGLE_DEG;
  const half = SEGMENT_ANGLE_DEG / 2;
  return {
    start: (midDeg + half) * Math.PI / 180,
    end: (midDeg - half) * Math.PI / 180,
    mid: midDeg * Math.PI / 180,
  };
}

export function pointToMenuSegment(dx: number, dy: number): number {
  const distance = Math.hypot(dx, dy);
  if (distance < MENU_INNER_RADIUS || distance > MENU_OUTER_RADIUS) return -1;

  let mathDeg = -Math.atan2(dy, dx) * 180 / Math.PI;
  if (mathDeg < 0) mathDeg += 360;
  const index = Math.round((90 - mathDeg) / SEGMENT_ANGLE_DEG);
  return ((index % MENU_TOTAL) + MENU_TOTAL) % MENU_TOTAL;
}

export function segmentPath(index: number): string {
  const { start, end } = segmentAngles(index);
  const x0i = MENU_CENTER + MENU_INNER_RADIUS * Math.cos(start);
  const y0i = MENU_CENTER - MENU_INNER_RADIUS * Math.sin(start);
  const x1i = MENU_CENTER + MENU_INNER_RADIUS * Math.cos(end);
  const y1i = MENU_CENTER - MENU_INNER_RADIUS * Math.sin(end);
  const x0o = MENU_CENTER + MENU_OUTER_RADIUS * Math.cos(start);
  const y0o = MENU_CENTER - MENU_OUTER_RADIUS * Math.sin(start);
  const x1o = MENU_CENTER + MENU_OUTER_RADIUS * Math.cos(end);
  const y1o = MENU_CENTER - MENU_OUTER_RADIUS * Math.sin(end);

  return [
    `M ${x0i} ${y0i}`,
    `L ${x0o} ${y0o}`,
    `A ${MENU_OUTER_RADIUS} ${MENU_OUTER_RADIUS} 0 0 1 ${x1o} ${y1o}`,
    `L ${x1i} ${y1i}`,
    `A ${MENU_INNER_RADIUS} ${MENU_INNER_RADIUS} 0 0 0 ${x0i} ${y0i}`,
    'Z',
  ].join(' ');
}
