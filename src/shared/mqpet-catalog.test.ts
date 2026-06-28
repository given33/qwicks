import { describe, expect, it } from 'vitest';
import { MQ_ITEM_BY_ID, MQ_ITEMS } from './mqpet-catalog';

describe('MQPet catalog source import', () => {
  it('loads the GB18030 helper goods and wash catalog without mojibake', () => {
    expect(MQ_ITEMS.length).toBeGreaterThanOrEqual(820);

    expect(MQ_ITEM_BY_ID['goods:1']).toEqual(expect.objectContaining({
      name: '炸虾盖饭',
      main: 'Feeding',
      sub: 'Food',
      price: 100,
      addHunger: 1800,
      sourceIndex: 1,
      originalSource: 'ConfigGoods',
    }));
    expect(MQ_ITEM_BY_ID['wash:6']).toEqual(expect.objectContaining({
      name: '妙味香皂',
      main: 'Feeding',
      sub: 'Daily',
      price: 30,
      addCleanliness: 1080,
      sourceIndex: 6,
      originalSource: 'ConfigWash',
    }));

    expect(MQ_ITEMS.some((item) => /[�鐪缁瀵鍠]/.test(item.name))).toBe(false);
  });

  it('keeps Config stat triples and Unity medicine items available to QWicks', () => {
    expect(MQ_ITEM_BY_ID['goods:52']).toEqual(expect.objectContaining({
      name: '星云薯条',
      addHunger: 1800,
      addStressResistance: 10,
      addIntelligence: 0,
      addCharm: 0,
    }));
    expect(MQ_ITEM_BY_ID['goods:524']).toEqual(expect.objectContaining({
      name: '深海鱼油',
      addHunger: 1080,
      addStressResistance: 0,
      addIntelligence: 20,
      addCharm: 0,
    }));
    expect(MQ_ITEM_BY_ID['unity:眼药水']).toEqual(expect.objectContaining({
      name: '眼药水',
      main: 'Feeding',
      sub: 'Medicine',
      addHealth: 5,
      originalSource: 'UnityItemData',
    }));
    expect(MQ_ITEM_BY_ID['unity:经验丹']).toEqual(expect.objectContaining({
      name: '经验丹',
      addGrowth: 10,
    }));
  });
});
