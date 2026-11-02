import { describe, expect, it } from 'vitest';
import { FrameTimeline, analyzeJump, jumpSpecFor, type MarkedEvent } from '../src/index.js';

const FPS = 240;
const tl = new FrameTimeline(Array.from({ length: 4000 }, (_, i) => i / FPS));
let n = 0;
const ev = (type: string, t: number, extra: Partial<MarkedEvent> = {}): MarkedEvent => {
  const frame = Math.round(t * FPS);
  return { id: `e${n++}`, type, frame, time: frame / FPS, source: 'manuel', confidence: 1, ...extra };
};
const run = (id: string, events: MarkedEvent[], fps = FPS) => analyzeJump(jumpSpecFor(id)!, events, tl, 1, fps);
const m = (a: ReturnType<typeof run>, id: string) => a.metrics.find((x) => x.id === id);

describe('saut en longueur', () => {
  const events = [
    ev('appui', 1.0, { side: 'G', position: -3.4 }),
    ev('decollage', 1.1, { side: 'G' }),
    ev('appui', 1.2, { side: 'D', position: -1.7 }),
    ev('decollage', 1.3, { side: 'D' }),
    ev('appel', 1.4, { side: 'G', position: 0 }),
    ev('decollage', 1.5, { side: 'G' }),
    ev('reception', 2.1, { position: 6.2 }),
  ];
  const a = run('longueur', events);

  it('calcule longueur, vol et appel', () => {
    expect(a.missing).toEqual([]);
    expect(a.length?.value).toBeCloseTo(6.2, 5);
    expect(m(a, 'temps-vol')?.value.value).toBeCloseTo(0.6, 2);
    expect(m(a, 'contact-appel')?.value.value).toBeCloseTo(0.1, 2);
    expect(m(a, 'vitesse-approche')?.value.value).toBeCloseTo(1.7 / 0.2, 1);
  });

  it('donne des estimations balistiques indicatives', () => {
    const rise = m(a, 'montee')!;
    expect(rise.indicative).toBe(true);
    expect(rise.value.value).toBeCloseTo((9.81 * 0.36) / 8, 2);
    expect(m(a, 'angle')?.value.value).toBeGreaterThan(5);
  });

  it('signale les repères manquants', () => {
    const b = run('longueur', events.filter((e) => e.type !== 'reception'));
    expect(b.missing).toEqual(['Réception']);
    expect(b.length).toBeUndefined();
  });

  it('prévient quand la cadence est trop basse', () => {
    const b = run('longueur', events, 60);
    expect(m(b, 'contact-appel')?.reliable).toBe(false);
  });

  it('alerte sur une vitesse improbable', () => {
    const slow = [ev('appui', 1.0, { position: -0.5 }), ev('appel', 1.4, { position: 0 }), ev('decollage', 1.5), ev('reception', 2.1, { position: 5 })];
    expect(run('longueur', slow).checks.some((c) => c.message.includes('Vitesse'))).toBe(true);
  });
});

describe('triple saut', () => {
  const events = [
    ev('appel', 1.0, { side: 'G', position: 0 }),
    ev('decollage', 1.1, { side: 'G' }),
    ev('appui', 1.5, { side: 'G', position: 3.0 }),
    ev('decollage', 1.62, { side: 'G' }),
    ev('appui', 2.0, { side: 'D', position: 5.5 }),
    ev('decollage', 2.14, { side: 'D' }),
    ev('reception', 2.6, { position: 8.0 }),
  ];
  it('décrit trois phases avec distances et parts', () => {
    const a = run('triple', events);
    expect(a.missing).toEqual([]);
    expect(a.phases).toHaveLength(3);
    expect(a.phases.map((p) => p.distance?.value)).toEqual([3, 2.5, 2.5]);
    expect(a.phases[0]!.share).toBeCloseTo(0.375, 3);
    expect(a.length?.value).toBe(8);
    expect(a.phases[1]!.label).toBe('Foulée bondissante');
  });
  it('exige trois décollages', () => {
    const a = run('triple', events.slice(0, 4));
    expect(a.missing.length).toBeGreaterThan(0);
  });
});

describe('hauteur et perche', () => {
  it('hauteur : temps au sommet, montée et barre', () => {
    const a = run('hauteur', [
      ev('appel', 1.0, { side: 'G' }),
      ev('decollage', 1.15, { side: 'G' }),
      ev('sommet', 1.55),
      ev('barre', 1.55, { position: 1.9 }),
      ev('reception', 2.0),
    ]);
    expect(a.missing).toEqual([]);
    expect(m(a, 'temps-sommet')?.value.value).toBeCloseTo(0.4, 2);
    expect(m(a, 'montee')?.value.value).toBeCloseTo(0.5 * 9.81 * 0.16, 1);
    expect(m(a, 'barre')?.value.value).toBe(1.9);
    expect(m(a, 'sommet-reception')).toBeDefined();
  });
  it('perche : phases pose, perche, vol', () => {
    const a = run('perche', [
      ev('planter', 1.0),
      ev('appel', 1.1, { side: 'G' }),
      ev('decollage', 1.2, { side: 'G' }),
      ev('lacher', 1.9),
      ev('sommet', 2.3),
    ]);
    expect(a.missing).toEqual([]);
    expect(m(a, 'pose-appel')?.value.value).toBeCloseTo(0.1, 2);
    expect(m(a, 'phase-perche')?.value.value).toBeCloseTo(0.8, 2);
    expect(m(a, 'montee-lacher')?.value.value).toBeCloseTo(0.5 * 9.81 * 0.16, 1);
  });
  it('sans appel : seulement la liste des manquants', () => {
    const a = run('hauteur', []);
    expect(a.metrics).toEqual([]);
    expect(a.missing).toContain('Appel');
  });
});
