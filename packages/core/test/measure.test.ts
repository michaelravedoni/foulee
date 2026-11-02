import { describe, expect, it } from 'vitest';
import {
  FrameTimeline,
  createCalibration,
  measureAngle,
  measureLength,
  pixelsPerMeter,
  sectionSpeed,
  sectionsBetween,
  trajectoryLength,
  trajectorySpeeds,
  formatMeasure,
  type MarkedEvent,
} from '../src/index.js';

const fr = (n: number, d: number) => n.toFixed(d).replace('.', ',');
const timeline = (fps: number, n: number) => new FrameTimeline(Array.from({ length: n }, (_, i) => i / fps));
const ev = (frame: number, time: number, type = 'passage'): MarkedEvent => ({ id: `e${frame}`, type, frame, time, source: 'manuel', confidence: 1 });

describe('étalon et distances', () => {
  const cal = createCalibration({ x: 100, y: 500 }, { x: 1100, y: 500 }, 10)!;

  it('rejette un étalon nul', () => {
    expect(createCalibration({ x: 0, y: 0 }, { x: 0, y: 0 }, 10)).toBeNull();
    expect(createCalibration({ x: 0, y: 0 }, { x: 50, y: 0 }, 0)).toBeNull();
  });

  it('convertit les pixels en mètres', () => {
    expect(pixelsPerMeter(cal)).toBe(100);
    const m = measureLength({ x: 0, y: 0 }, { x: 300, y: 400 }, cal);
    expect(m.value).toBeCloseTo(5, 6);
    expect(m.margin).toBeGreaterThan(0);
    expect(m.margin).toBeLessThan(0.1);
  });

  it('la marge relative diminue quand l’étalon est plus long', () => {
    const short = createCalibration({ x: 0, y: 0 }, { x: 100, y: 0 }, 1)!;
    const long = createCalibration({ x: 0, y: 0 }, { x: 1000, y: 0 }, 10)!;
    const a = measureLength({ x: 0, y: 0 }, { x: 200, y: 0 }, short);
    const b = measureLength({ x: 0, y: 0 }, { x: 2000, y: 0 }, long);
    expect(b.margin / b.value).toBeLessThan(a.margin / a.value);
  });

  it('mesure un angle droit avec une marge', () => {
    const m = measureAngle({ x: 100, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 100 });
    expect(m.value).toBeCloseTo(90, 6);
    expect(m.margin).toBeGreaterThan(1);
    expect(m.margin).toBeLessThan(4);
    expect(measureAngle({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }).margin).toBeNaN();
  });
});

describe('chrono par sections', () => {
  it('un 30 m à 240 i/s est cohérent à ±0,1 s avec un chrono manuel', () => {
    const tl = timeline(240, 2000);
    const sections = sectionsBetween([ev(240, 1, 'arrivee'), ev(120, 0.5, 'depart')], tl);
    expect(sections).toHaveLength(1);
    const s = sections[0]!;
    expect(s.from.frame).toBe(120);
    expect(s.seconds).toBeCloseTo(0.5, 6);
    expect(s.margin).toBeLessThanOrEqual(1 / 240 + 1e-9);
    expect(s.margin).toBeLessThan(0.1);
  });

  it('applique l’échelle de temps des ralentis ré-encodés', () => {
    const tl = timeline(30, 300);
    const [s] = sectionsBetween([ev(30, 1), ev(60, 2)], tl, 0.25);
    expect(s!.seconds).toBeCloseTo(0.25, 6);
  });

  it('calcule la vitesse avec marge propagée', () => {
    const v = sectionSpeed(30, 4, 0.01, 0.05);
    expect(v.value).toBeCloseTo(7.5, 6);
    expect(v.margin).toBeGreaterThan(0.01);
    expect(sectionSpeed(10, 0, 0.01).value).toBeNaN();
  });
});

describe('trajectoires', () => {
  const cal = createCalibration({ x: 0, y: 0 }, { x: 1000, y: 0 }, 10)!;
  const tl = timeline(100, 100);
  const pts = Array.from({ length: 11 }, (_, i) => ({ frame: i, x: i * 10, y: 0 }));

  it('vitesse constante : 10 px / image à 100 i/s, 100 px/m → 10 m/s', () => {
    const speeds = trajectorySpeeds(pts, cal, tl);
    expect(speeds).toHaveLength(9);
    for (const s of speeds) expect(s.speed.value).toBeCloseTo(10, 6);
    expect(trajectoryLength(pts, cal).value).toBeCloseTo(1, 6);
  });
});

describe('affichage', () => {
  it('adapte la précision à la marge', () => {
    expect(formatMeasure({ value: 12.3456, margin: 0.05 }, 'm', fr)).toBe('12,35 ± 0,05 m');
    expect(formatMeasure({ value: 90, margin: 2.3 }, '°', fr, 1)).toBe('90,0 ± 2,3 °');
    expect(formatMeasure({ value: NaN, margin: 0 }, 'm', fr)).toBe('—');
  });
});
