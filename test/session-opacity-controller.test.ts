import { describe, expect, it } from 'vitest';
import { OPACITY_MAX, OPACITY_MIN, SessionOpacityController } from '../src/state/session-opacity-controller';

describe('SessionOpacityController', () => {
  it('adjusts in 0.02 session steps and resets to the configured baseline', () => {
    const opacity = new SessionOpacityController();
    expect(opacity.effective(0.08)).toBe(0.08);
    expect(opacity.increase(0.08)).toBe(0.1);
    expect(opacity.increase(0.08)).toBe(0.12);
    expect(opacity.decrease(0.08)).toBe(0.1);
    opacity.reset();
    expect(opacity.effective(0.08)).toBe(0.08);
  });

  it('clamps temporary values without persisting them into a new controller', () => {
    const opacity = new SessionOpacityController();
    for (let index = 0; index < 30; index += 1) opacity.increase(0.08);
    expect(opacity.effective(0.08)).toBe(OPACITY_MAX);
    for (let index = 0; index < 30; index += 1) opacity.decrease(0.08);
    expect(opacity.effective(0.08)).toBe(OPACITY_MIN);
    expect(new SessionOpacityController().effective(0.08)).toBe(0.08);
  });
});
