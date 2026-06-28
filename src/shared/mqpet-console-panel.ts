import type { MqMainCategory, MqSubCategory } from './mqpet-catalog';
import type { MqpetActivityMode } from './mqpet-activity';

export type MqpetConsoleTab = 'status' | 'inventory' | 'shop' | 'activity' | 'map';

export interface MqpetConsolePanelRequest {
  tab: MqpetConsoleTab;
  main?: MqMainCategory;
  sub?: MqSubCategory;
  mode?: MqpetActivityMode;
}

const SUBS: Record<MqMainCategory, MqSubCategory[]> = {
  Feeding: ['Food', 'Daily', 'Medicine'],
  Function: ['Toy', 'Stats'],
  DressUp: ['Background', 'Props'],
};

function isTab(value: unknown): value is MqpetConsoleTab {
  return value === 'status' || value === 'inventory' || value === 'shop' || value === 'activity' || value === 'map';
}

function isMain(value: unknown): value is MqMainCategory {
  return value === 'Feeding' || value === 'Function' || value === 'DressUp';
}

export function normalizeConsolePanelRequest(raw: unknown): MqpetConsolePanelRequest {
  if (!raw || typeof raw !== 'object') return { tab: 'status' };
  const input = raw as Partial<MqpetConsolePanelRequest>;
  if (!isTab(input.tab)) return { tab: 'status' };
  if (input.tab === 'activity') {
    if (input.mode !== 'work' && input.mode !== 'learn') return { tab: 'status' };
    return { tab: 'activity', mode: input.mode };
  }
  if (input.tab === 'map') return { tab: 'map' };
  if (input.tab !== 'inventory' && input.tab !== 'shop') return { tab: input.tab };
  if (!isMain(input.main)) return { tab: input.tab };
  const sub = input.sub;
  if (typeof sub !== 'string' || !SUBS[input.main].includes(sub as MqSubCategory)) {
    return { tab: 'status' };
  }
  return { tab: input.tab, main: input.main, sub: sub as MqSubCategory };
}
