export function fitSpriteIntoBox(
  sprite: { width: number; height: number },
  box: { width: number; height: number },
): { width: number; height: number } {
  if (sprite.width <= 0 || sprite.height <= 0) return { width: box.width, height: box.height };
  const scale = Math.min(box.width / sprite.width, box.height / sprite.height);
  return {
    width: Math.round(sprite.width * scale),
    height: Math.round(sprite.height * scale),
  };
}

export function fitSpriteAtStableScale(
  sprite: { width: number; height: number },
  box: { width: number; height: number },
  referenceHeight: number,
): { width: number; height: number } {
  if (sprite.width <= 0 || sprite.height <= 0) return { width: box.width, height: box.height };
  const scale = box.height / referenceHeight;
  return {
    width: Math.round(sprite.width * scale),
    height: Math.round(sprite.height * scale),
  };
}

const MQPET_CANONICAL_HEIGHT = 77;

export function fitMqpetSpriteAtDesktopScale(
  sprite: { width: number; height: number },
  box: { width: number; height: number },
): { width: number; height: number } | undefined {
  if (sprite.width <= 0 || sprite.height <= 0) return undefined;
  return fitSpriteAtStableScale(sprite, box, MQPET_CANONICAL_HEIGHT);
}
