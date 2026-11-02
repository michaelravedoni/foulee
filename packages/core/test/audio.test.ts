import { describe, expect, it } from 'vitest';
import { FrameTimeline, detectOnsets, gridLayout, kinogramFrames, peakEnvelope, soundDelaySeconds, type MarkedEvent } from '../src/index.js';

const SR = 8000;
function signal(seconds: number, bangs: { t: number; amp: number }[], noise = 0.01): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR));
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < out.length; i++) out[i] = rnd() * noise;
  for (const b of bangs) {
    const start = Math.round(b.t * SR);
    for (let i = 0; i < 400 && start + i < out.length; i++) out[start + i] = (out[start + i] ?? 0) + b.amp * Math.exp(-i / 120) * (i % 2 ? -1 : 1);
  }
  return out;
}

describe('détection du départ au son', () => {
  it('retrouve un coup de pistolet à ±5 ms dans le bruit', () => {
    const env = peakEnvelope(signal(6, [{ t: 3.2, amp: 0.9 }]), SR, 0.002);
    const [o] = detectOnsets(env, 0.002);
    expect(o).toBeDefined();
    expect(Math.abs(o!.time - 3.2)).toBeLessThan(0.005);
    expect(o!.ratio).toBeGreaterThan(1);
  });

  it('classe le plus fort en premier et ignore le silence', () => {
    const env = peakEnvelope(signal(8, [{ t: 1, amp: 0.3 }, { t: 5, amp: 0.95 }]), SR, 0.002);
    const onsets = detectOnsets(env, 0.002);
    expect(onsets).toHaveLength(2);
    expect(Math.abs(onsets[0]!.time - 5)).toBeLessThan(0.005);
    expect(detectOnsets(peakEnvelope(signal(3, [], 0.001), SR, 0.002), 0.002)).toEqual([]);
  });

  it('tient compte du décalage de départ et du retard du son', () => {
    const env = peakEnvelope(signal(2, [{ t: 1, amp: 0.8 }]), SR, 0.002);
    expect(detectOnsets(env, 0.002, 10)[0]!.time).toBeCloseTo(11, 2);
    expect(soundDelaySeconds(34.3)).toBeCloseTo(0.1, 6);
    expect(soundDelaySeconds(0)).toBe(0);
  });
});

describe('kinogramme', () => {
  const tl = new FrameTimeline(Array.from({ length: 300 }, (_, i) => i / 120));
  const ev = (frame: number, type = 'appui'): MarkedEvent => ({ id: `e${frame}`, type, frame, time: frame / 120, source: 'manuel', confidence: 1 });

  it('prend les images des repères choisis, sans doublon', () => {
    const events = [ev(50), ev(10, 'depart'), ev(50, 'decollage'), ev(90)];
    expect(kinogramFrames(events, tl, { mode: 'events' })).toEqual([10, 50, 90]);
    expect(kinogramFrames(events, tl, { mode: 'events', types: ['appui'] })).toEqual([50, 90]);
  });

  it('répartit des images régulières entre les repères', () => {
    expect(kinogramFrames([ev(10), ev(110)], tl, { mode: 'even', count: 5 })).toEqual([10, 35, 60, 85, 110]);
    expect(kinogramFrames([], tl, { mode: 'even', count: 3 })).toEqual([0, 150, 299]);
  });

  it('dispose en grille', () => {
    expect(gridLayout(7, 4)).toEqual({ cols: 4, rows: 2 });
    expect(gridLayout(2, 4)).toEqual({ cols: 2, rows: 1 });
  });
});
