import { describe, expect, it } from 'vitest';
import { FrameTimeline, analyzeSprint, fitVmaxTau, modelDistance, specFor, type MarkedEvent } from '../src/index.js';

const FPS = 240;
const tl = new FrameTimeline(Array.from({ length: 4000 }, (_, i) => i / FPS));
let n = 0;
const ev = (type: string, t: number, extra: Partial<MarkedEvent> = {}): MarkedEvent => {
  const frame = Math.round(t * FPS);
  return { id: `e${n++}`, type, frame, time: frame / FPS, source: 'manuel', confidence: 1, ...extra };
};

/** Temps auquel le modèle atteint la distance d (bissection). */
function timeAt(d: number, vmax: number, tau: number): number {
  let lo = 0;
  let hi = 30;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (modelDistance(vmax, tau, mid) < d) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function reference100(vmax = 11.6, tau = 1.25, start = 0.5): MarkedEvent[] {
  const events = [ev('depart', start)];
  for (let d = 10; d < 100; d += 10) events.push(ev('passage', start + timeAt(d, vmax, tau), { position: d }));
  events.push(ev('arrivee', start + timeAt(100, vmax, tau)));
  return events;
}

describe('spécifications', () => {
  it('100 m haies : 10 haies puis l’arrivée', () => {
    const s = specFor('100mh')!;
    expect(s.splitPoints).toHaveLength(11);
    expect(s.splitPoints[0]).toBe(13);
    expect(s.splitPoints[9]).toBeCloseTo(89.5, 6);
    expect(s.splitPoints[10]).toBe(100);
    expect(specFor('110mh')!.splitPoints[0]).toBeCloseTo(13.72, 6);
    expect(specFor('longueur')).toBeUndefined();
  });
});

describe('100 m de référence', () => {
  const spec = specFor('100m')!;
  const a = analyzeSprint(spec, reference100(), tl, 1, FPS);

  it('produit un tableau de splits complet avec marges', () => {
    expect(a.splits).toHaveLength(10);
    for (const r of a.splits) {
      expect(r.segment.margin).toBeLessThanOrEqual(1 / FPS + 1e-9);
      expect(r.speed.value).toBeGreaterThan(5);
    }
    const t100 = timeAt(100, 11.6, 1.25);
    expect(a.total!.value).toBeCloseTo(t100, 1);
    expect(Math.abs(a.total!.value - t100)).toBeLessThan(2 / FPS);
    expect(a.checks.filter((c) => c.level === 'alerte')).toHaveLength(0);
  });

  it('retrouve Vmax et tau du modèle dans leurs marges', () => {
    const p = a.profile!;
    expect(Math.abs(p.vmax.value - 11.6)).toBeLessThan(0.3);
    expect(Math.abs(p.tau.value - 1.25)).toBeLessThan(0.3);
    expect(p.f0).toBeCloseTo(p.vmax.value / p.tau.value, 6);
    expect(p.pmax).toBeCloseTo((p.f0 * p.vmax.value) / 4, 6);
    expect(p.vmax.margin).toBeGreaterThan(0);
  });
});

describe('contrôles', () => {
  const spec = specFor('100m')!;
  it('signale un départ manquant', () => {
    const a = analyzeSprint(spec, reference100().slice(1), tl, 1, FPS);
    expect(a.checks.some((c) => c.level === 'alerte' && /départ/.test(c.message))).toBe(true);
  });
  it('signale des positions incohérentes et des vitesses absurdes', () => {
    const a = analyzeSprint(spec, [ev('depart', 0.5), ev('passage', 1.0, { position: 30 }), ev('passage', 2.0, { position: 20 })], tl, 1, FPS);
    expect(a.checks.some((c) => /incohérentes/.test(c.message))).toBe(true);
    const b = analyzeSprint(spec, [ev('depart', 0.5), ev('passage', 0.7, { position: 30 })], tl, 1, FPS);
    expect(b.checks.some((c) => /improbable/.test(c.message))).toBe(true);
  });
  it('ne tente pas de profil avec trop peu de repères', () => {
    const a = analyzeSprint(spec, [ev('depart', 0.5), ev('arrivee', 11)], tl, 1, FPS);
    expect(a.profile).toBeUndefined();
    expect(fitVmaxTau([{ t: 1, d: 5 }])).toBeUndefined();
  });
});

describe('foulées', () => {
  const spec = specFor('100m')!;
  it('pas, fréquence, contact et vol avec marges', () => {
    // pas toutes les 0,2 s, contact de 0,1 s
    const events: MarkedEvent[] = [];
    for (let i = 0; i < 6; i++) {
      const side = i % 2 === 0 ? 'G' : 'D';
      events.push(ev('appui', 1 + i * 0.2, { side, position: 10 + i * 2 }));
      events.push(ev('decollage', 1.1 + i * 0.2, { side }));
    }
    const a = analyzeSprint(spec, events, tl, 1, FPS);
    expect(a.steps).toHaveLength(5);
    expect(a.steps[0]!.frequency.value).toBeCloseTo(5, 1);
    expect(a.steps[0]!.length!.value).toBeCloseTo(2, 6);
    expect(a.contacts).toHaveLength(6);
    expect(a.contacts[0]!.contact.value).toBeCloseTo(0.1, 2);
    expect(a.contacts[0]!.flight!.value).toBeCloseTo(0.1, 2);
    expect(a.contacts[0]!.reliable).toBe(true);
  });
  it('marque le temps de contact peu fiable à faible cadence', () => {
    const slow = new FrameTimeline(Array.from({ length: 600 }, (_, i) => i / 60));
    const events = [
      { id: 'a', type: 'appui', side: 'G' as const, frame: 60, time: 1, source: 'manuel' as const, confidence: 1 },
      { id: 'b', type: 'decollage', side: 'G' as const, frame: 66, time: 1.1, source: 'manuel' as const, confidence: 1 },
    ];
    const a = analyzeSprint(spec, events, slow, 1, 60);
    expect(a.contacts[0]!.reliable).toBe(false);
    expect(a.checks.some((c) => /trop incertain/.test(c.message))).toBe(true);
  });
});
