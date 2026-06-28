import { describe, expect, it } from 'vitest';
import { MQ_ITEMS } from './mqpet-catalog';

describe('MQPet catalog source items', () => {
  it('keeps the extracted Medicine item available for the medical menu', () => {
    const medicine = MQ_ITEMS.filter((item) => item.main === 'Feeding' && item.sub === 'Medicine');
    expect(medicine).toEqual([
      expect.objectContaining({
        id: '眼药水',
        name: '眼药水',
        addHealth: 5,
        unlockLevel: 1,
      }),
    ]);
  });
});
