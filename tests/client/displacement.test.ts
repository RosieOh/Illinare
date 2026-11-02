import { describe, expect, it } from 'vitest';
import { sphereDisplacement } from '@/components/glass/displacement';
import { isSlowWindow } from '@/components/shell/useLensBudget';

describe('isSlowWindow', () => {
  it('judges by the typical frame, so one long stall does not turn the lens off', () => {
    expect(isSlowWindow([16, 17, 16, 900, 17, 16, 17])).toBe(false);
    expect(isSlowWindow([70, 80, 65, 75, 90])).toBe(true);
  });

  it('does not judge an empty window', () => {
    expect(isSlowWindow([])).toBe(false);
  });
});

describe('sphereDisplacement', () => {
  it('leaves the middle of the sphere and everything outside it alone', () => {
    expect(sphereDisplacement(0, 0)).toEqual({ x: 0, y: 0 });
    expect(sphereDisplacement(1, 0)).toEqual({ x: 0, y: 0 });
    expect(sphereDisplacement(0.8, 0.8)).toEqual({ x: 0, y: 0 });
  });

  it('pulls from toward the centre, so the glass looks convex', () => {
    const right = sphereDisplacement(0.6, 0);
    expect(right.x).toBeLessThan(0);
    expect(right.y).toBeCloseTo(0, 10);
    const lowerLeft = sphereDisplacement(-0.4, 0.4);
    expect(lowerLeft.x).toBeGreaterThan(0);
    expect(lowerLeft.y).toBeLessThan(0);
  });

  it('bends harder toward the wall and stays inside the map range', () => {
    let previous = 0;
    for (let r = 0.1; r < 1; r += 0.1) {
      const { x, y } = sphereDisplacement(r, 0);
      const magnitude = Math.hypot(x, y);
      expect(magnitude).toBeGreaterThan(previous);
      expect(magnitude).toBeLessThanOrEqual(1);
      previous = magnitude;
    }
  });
});
