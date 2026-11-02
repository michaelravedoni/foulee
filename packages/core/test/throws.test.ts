import { describe, expect, it } from 'vitest';
import { FrameTimeline, analyzeThrow, throwSpecFor, type Calibration, type MarkedEvent, type Trajectory } from '../src/index.js';

const FPS = 240;
const tl = new FrameTimeline(Array.from({ length: 4000 }, (_, i) => i / FPS));
let n = 0;
const ev = (type: string, t: number, extra: Partial<MarkedEvent> = {}): MarkedEvent => {
  const frame = Math.round(t * FPS);
  return { id: `e${n++}`, type, frame, time: frame / FPS, source: 'manuel', confidence: 1, ...extra };
};
const cal: Calibration = { a: { x: 0, y: 0 }, b: { x: 500, y: 0 }, meters: 5, clickErrorPx: 2 }; // 100 px/m

/** Engin lancé à v m/s, angle deg : positions pixel image par image après le lâcher. */
function flight(v: number, deg: number, releaseFrame: number, count: number): Trajectory {
  const vx = v * Math.cos((deg * Math.PI) / 180);
  const vy = v * Math.sin((deg * Math.PI) / 180);
  const points = Array.from({ length: count }, (_, i) => {
    const t = i / FPS;
    return { frame: releaseFrame + i, x: 200 + vx * t * 100, y: 600 - (vy * t - 0.5 * 9.81 * t * t) * 100 };
  });
  return { id: 'trj_1', label: 'Poids', color: '#f00', points };
}

describe('lancers', () => {
  it('retrouve la vitesse et l’angle de lâcher avec la correction de pesanteur', () => {
    const release = ev('lacher', 1.0, { position: 2 });
    const a = analyzeThrow(throwSpecFor('poids')!, [ev('puissance', 0.5), release, ev('impact', 2.2, { position: 17.4 })], [flight(12, 38, release.frame, 6)], cal, tl, 1);
    expect(a.missing).toEqual([]);
    expect(a.release?.speed.value).toBeCloseTo(12, 0);
    expect(a.release?.angle.value).toBeCloseTo(38, 0);
    expect(a.release!.speed.margin).toBeGreaterThan(0);
    expect(a.distance?.value).toBe(17.4);
    const range = a.metrics.find((m) => m.id === 'portee')!;
    expect(range.indicative).toBe(true);
    expect(range.value.value).toBeGreaterThan(14);
    expect(a.checks.filter((c) => c.level === 'alerte')).toEqual([]);
  });

  it('demande un étalon et des points quand ils manquent', () => {
    const rel = ev('lacher', 1.0);
    const spec = throwSpecFor('javelot')!;
    expect(analyzeThrow(spec, [rel], [], undefined, tl, 1).checks[0]?.message).toMatch(/étalon/);
    expect(analyzeThrow(spec, [rel], [], cal, tl, 1).checks[0]?.message).toMatch(/Pointe l’engin/);
    expect(analyzeThrow(spec, [rel], [], cal, tl, 1).missing).toEqual(['Début des pas croisés', 'Blocage']);
  });

  it('alerte sur une vitesse de lâcher improbable', () => {
    const rel = ev('lacher', 1.0);
    const a = analyzeThrow(throwSpecFor('disque')!, [ev('rotation', 0.5), rel], [flight(5, 35, rel.frame, 5)], cal, tl, 1);
    expect(a.checks.some((c) => c.message.includes('Vitesse'))).toBe(true);
  });

  it('marteau : durée des tours et accélération', () => {
    const a = analyzeThrow(throwSpecFor('marteau')!, [ev('tour', 0.0), ev('tour', 1.0), ev('tour', 1.8), ev('tour', 2.5), ev('lacher', 3.1)], [], cal, tl, 1);
    expect(a.phases.map((p) => Math.round(p.duration.value * 10) / 10)).toEqual([1.0, 0.8, 0.7, 0.6]);
    expect(a.metrics.find((m) => m.id === 'tours')?.value.value).toBe(4);
    expect(a.metrics.find((m) => m.id === 'gain-tours')?.value.value).toBeCloseTo(0.4, 2);
  });

  it('signale un repère placé après le lâcher', () => {
    const a = analyzeThrow(throwSpecFor('poids')!, [ev('lacher', 1.0), ev('puissance', 1.5)], [], cal, tl, 1);
    expect(a.checks.some((c) => c.message.includes('après le lâcher'))).toBe(true);
  });
});
