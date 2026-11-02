import { describe, expect, it } from 'vitest';
import { FrameTimeline, frameUncertaintyMs, realTimeScale, roundFps } from '../src/index.js';

describe('FrameTimeline', () => {
  it('trie et déduplique les horodatages (ordre de décodage avec images B)', () => {
    const tl = new FrameTimeline([0, 2 / 30, 1 / 30, 3 / 30, 3 / 30]);
    expect(tl.frameCount).toBe(4);
    expect(tl.timeOf(1)).toBeCloseTo(1 / 30);
    expect(tl.nominalFps).toBe(30);
    expect(tl.variable).toBe(false);
  });

  it('retrouve exactement l’image affichée à un instant', () => {
    const tl = FrameTimeline.uniform(240, 1);
    expect(tl.frameCount).toBe(240);
    for (const i of [0, 1, 17, 120, 239]) {
      expect(tl.frameAt(tl.timeOf(i))).toBe(i);
      expect(tl.frameAt(tl.timeOf(i) + tl.durationOf(i) * 0.6)).toBe(i);
      expect(tl.nearestFrame(tl.timeOf(i) + tl.durationOf(i) * 0.6)).toBe(Math.min(i + 1, 239));
    }
    expect(tl.frameAt(-5)).toBe(0);
    expect(tl.frameAt(99)).toBe(239);
  });

  it('détecte une cadence variable (ralenti iPhone)', () => {
    const times: number[] = [];
    let t = 0;
    for (let i = 0; i < 30; i++) times.push((t += 1 / 30));
    for (let i = 0; i < 120; i++) times.push((t += 1 / 240));
    for (let i = 0; i < 30; i++) times.push((t += 1 / 30));
    const tl = new FrameTimeline(times);
    expect(tl.variable).toBe(true);
    expect(tl.nominalFps).toBe(240);
  });

  it('borne les index', () => {
    const tl = FrameTimeline.uniform(30, 2);
    expect(tl.clamp(-3)).toBe(0);
    expect(tl.clamp(1000)).toBe(59);
    expect(tl.end).toBeCloseTo(2);
  });
});

describe('cadence et incertitude', () => {
  it('arrondit aux cadences usuelles', () => {
    expect(roundFps(29.9701)).toBe(29.97);
    expect(roundFps(239.9)).toBe(240);
    expect(roundFps(47.3)).toBe(47.3);
  });
  it('calcule le facteur temps réel d’un ralenti ré-encodé', () => {
    expect(realTimeScale(30, 240)).toBeCloseTo(0.125);
    expect(realTimeScale(240)).toBe(1);
  });
  it('donne une image de marge selon la cadence', () => {
    expect(frameUncertaintyMs(30)).toBeCloseTo(33.3, 1);
    expect(frameUncertaintyMs(240)).toBeCloseTo(4.17, 2);
  });
});
