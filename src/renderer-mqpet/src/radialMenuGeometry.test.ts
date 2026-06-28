import { describe, expect, it } from 'vitest';
import { MENU_SEGMENTS, pointToMenuSegment } from './radialMenuGeometry';

describe('MQPet radial menu geometry', () => {
  it('maps the eight visible segment centers to the matching actions', () => {
    expect(MENU_SEGMENTS[pointToMenuSegment(0, -90)]?.action).toBe('feed');
    expect(MENU_SEGMENTS[pointToMenuSegment(64, -64)]?.action).toBe('clean');
    expect(MENU_SEGMENTS[pointToMenuSegment(90, 0)]?.action).toBe('heal');
    expect(MENU_SEGMENTS[pointToMenuSegment(64, 64)]?.action).toBe('work');
    expect(MENU_SEGMENTS[pointToMenuSegment(0, 90)]?.action).toBe('learn');
    expect(MENU_SEGMENTS[pointToMenuSegment(-64, 64)]?.action).toBe('map');
    expect(MENU_SEGMENTS[pointToMenuSegment(-90, 0)]?.action).toBe('status');
    expect(MENU_SEGMENTS[pointToMenuSegment(-64, -64)]?.action).toBe('close');
  });

  it('ignores the center hole so the penguin remains clickable in the middle', () => {
    expect(pointToMenuSegment(0, 0)).toBe(-1);
    expect(pointToMenuSegment(10, -10)).toBe(-1);
  });

  it('ignores coordinates outside the menu ring', () => {
    expect(pointToMenuSegment(0, -160)).toBe(-1);
  });
});
