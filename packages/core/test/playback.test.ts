import { describe, expect, it } from 'vitest';
import { clampRate, dueTime, endFrameOf, normalizeLoop, shouldDrop, stepRate } from '../src/index.js';

describe('lecture', () => {
  it('passe d’une vitesse à l’autre', () => {
    expect(stepRate(0.25, 1)).toBe(0.5);
    expect(stepRate(0.25, -1)).toBe(0.1);
    expect(stepRate(2, 1)).toBe(2);
    expect(stepRate(0.05, -1)).toBe(0.05);
    expect(stepRate(0.3, 1)).toBe(0.5);
    expect(stepRate(0.3, -1)).toBe(0.25);
  });
  it('borne la vitesse', () => {
    expect(clampRate(0.001)).toBe(0.05);
    expect(clampRate(99)).toBe(4);
  });
  it('calcule l’instant d’affichage selon la vitesse', () => {
    expect(dueTime(1000, 2, 2.5, 1)).toBe(1500);
    expect(dueTime(1000, 2, 2.5, 0.25)).toBe(3000);
    expect(dueTime(1000, 2, 2.5, 2)).toBe(1250);
  });
  it('saute les images en retard, sans figer l’écran', () => {
    const s = { lastShownMs: 1000 };
    expect(shouldDrop(1010, 1000, 33, s)).toBe(false);
    expect(shouldDrop(1100, 1000, 33, s)).toBe(true);
    expect(shouldDrop(1300, 1000, 33, { lastShownMs: 1000 })).toBe(false); // trop longtemps sans image : on affiche
  });
  it('normalise les boucles', () => {
    expect(normalizeLoop(10, 5, 100)).toEqual({ a: 5, b: 10 });
    expect(normalizeLoop(10, null, 100)).toBeNull();
    expect(normalizeLoop(5, 5, 100)).toBeNull();
    expect(normalizeLoop(5, 500, 100)).toEqual({ a: 5, b: 100 });
    expect(endFrameOf(null, 99)).toBe(99);
    expect(endFrameOf({ a: 1, b: 40 }, 99)).toBe(40);
  });
});
