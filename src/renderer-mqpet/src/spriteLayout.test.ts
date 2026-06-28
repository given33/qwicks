import { describe, expect, it } from 'vitest';
import { fitMqpetSpriteAtDesktopScale, fitSpriteAtStableScale, fitSpriteIntoBox } from './spriteLayout';

describe('MQPet sprite layout', () => {
  it('keeps tiny animation frames centered inside the same stage box', () => {
    expect(fitSpriteIntoBox({ width: 22, height: 19 }, { width: 128, height: 144 })).toEqual({
      width: 128,
      height: 111,
    });
  });

  it('contains wide frames without overflowing the stage box', () => {
    expect(fitSpriteIntoBox({ width: 140, height: 100 }, { width: 128, height: 144 })).toEqual({
      width: 128,
      height: 91,
    });
  });

  it('contains tall frames without overflowing the stage box', () => {
    expect(fitSpriteIntoBox({ width: 80, height: 140 }, { width: 128, height: 144 })).toEqual({
      width: 82,
      height: 144,
    });
  });
});

describe('MQPet stable sprite layout', () => {
  it('keeps frames at the same pixel scale instead of fitting each frame independently', () => {
    const referenceHeight = 77;
    expect(fitSpriteAtStableScale({ width: 59, height: 77 }, { width: 90, height: 101 }, referenceHeight)).toEqual({
      width: 77,
      height: 101,
    });
    expect(fitSpriteAtStableScale({ width: 91, height: 78 }, { width: 90, height: 101 }, referenceHeight)).toEqual({
      width: 119,
      height: 102,
    });
  });

  it('falls back to the stage box before the frame natural size is known', () => {
    expect(fitSpriteAtStableScale({ width: 0, height: 0 }, { width: 90, height: 101 }, 77)).toEqual({
      width: 90,
      height: 101,
    });
  });

  it('keeps different animations on the same desktop pixel scale', () => {
    expect(fitMqpetSpriteAtDesktopScale({ width: 59, height: 77 }, { width: 90, height: 101 })).toEqual({
      width: 77,
      height: 101,
    });

    expect(fitMqpetSpriteAtDesktopScale({ width: 112, height: 59 }, { width: 90, height: 101 })).toEqual({
      width: 147,
      height: 77,
    });
  });

  it('does not synthesize a full-size frame before the natural sprite size is known', () => {
    expect(fitMqpetSpriteAtDesktopScale({ width: 0, height: 0 }, { width: 90, height: 101 })).toBeUndefined();
  });
});
