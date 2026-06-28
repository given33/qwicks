import { MQ_ITEMS } from './mqpet-catalog-generated';

export type MqMainCategory = 'Feeding' | 'Function' | 'DressUp';
export type MqSubCategory = 'Food' | 'Daily' | 'Medicine' | 'Other' | 'Toy' | 'Stats' | 'Background' | 'Props';
export type MqItemOriginalSource = 'ConfigGoods' | 'ConfigWash' | 'UnityItemData';

export interface MqItem {
  id: string;
  name: string;
  main: MqMainCategory;
  sub: MqSubCategory;
  price: number;
  addHunger: number;
  addCleanliness: number;
  addHealth: number;
  addMood: number;
  addStressResistance: number;
  addIntelligence: number;
  addCharm: number;
  addGrowth: number;
  buffDuration: number;
  unlockLevel: number;
  sourceIndex?: number;
  originalSource: MqItemOriginalSource;
  iconAssetId?: string;
  iconSourcePath?: string;
  activeIconAssetId?: string;
  activeIconSourcePath?: string;
  description?: string;
}

export { MQ_ITEMS };

export const MQ_ITEM_BY_ID: Record<string, MqItem> = Object.fromEntries(MQ_ITEMS.map((i) => [i.id, i]));
