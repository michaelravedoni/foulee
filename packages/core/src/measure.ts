import { angleAt, distance } from './geometry.js';
import type { Calibration, MarkedEvent, Point, TrackPoint } from './model.js';
import type { FrameTimeline } from './timeline.js';

/** Incertitude de pointage par défaut (pixels de l'image vidéo). */
export const DEFAULT_CLICK_ERROR_PX = 2;

/** Valeur mesurée avec sa marge d'erreur (± même unité). */
export interface Measure {
  value: number;
  margin: number;
}

export function createCalibration(a: Point, b: Point, meters: number, clickErrorPx = DEFAULT_CLICK_ERROR_PX): Calibration | null {
  if (!(meters > 0) || distance(a, b) < 1) return null;
  return { a, b, meters, clickErrorPx };
}

/** Pixels par mètre dans le plan de l'étalon. */
export function pixelsPerMeter(cal: Calibration): number {
  return distance(cal.a, cal.b) / cal.meters;
}

/** Incertitude relative de l'étalon (deux pointés indépendants). */
export function calibrationRelError(cal: Calibration): number {
  return (Math.SQRT2 * cal.clickErrorPx) / distance(cal.a, cal.b);
}

/** Distance entre deux points en mètres, dans le plan de l'étalon, avec marge. */
export function measureLength(p: Point, q: Point, cal: Calibration): Measure {
  const px = distance(p, q);
  const meters = px / pixelsPerMeter(cal);
  const relPoints = px > 0 ? (Math.SQRT2 * cal.clickErrorPx) / px : 1;
  const rel = Math.hypot(relPoints, calibrationRelError(cal));
  return { value: meters, margin: Math.min(meters, meters * rel) };
}

/** Angle ABC en degrés, avec marge liée à l'incertitude de pointage (en pixels). */
export function measureAngle(a: Point, b: Point, c: Point, clickErrorPx = DEFAULT_CLICK_ERROR_PX): Measure {
  const value = angleAt(a, b, c);
  const la = distance(a, b);
  const lc = distance(c, b);
  if (!Number.isFinite(value) || la === 0 || lc === 0) return { value, margin: NaN };
  // Chaque extrémité décale la direction de e/L radians ; le sommet agit sur les deux branches.
  const rad = clickErrorPx * Math.sqrt(2 / la ** 2 + 2 / lc ** 2);
  return { value, margin: (rad * 180) / Math.PI };
}

/** Section chronométrée entre deux événements marqués. */
export interface Section {
  from: MarkedEvent;
  to: MarkedEvent;
  /** Durée en secondes (temps réel, ralenti pris en compte via `timeScale`). */
  seconds: number;
  /** Marge : au plus une image (une demi-image à chaque extrémité). */
  margin: number;
  /** Distance de la section en mètres, si les deux événements ont une position connue. */
  meters?: number;
  speed?: Measure;
}

/**
 * Découpe l'essai en sections entre événements consécutifs, ordonnés par image.
 * `timeScale` convertit le temps du fichier en temps réel (ralentis ré-encodés).
 */
export function sectionsBetween(events: readonly MarkedEvent[], timeline: FrameTimeline, timeScale = 1): Section[] {
  const sorted = [...events].sort((a, b) => a.frame - b.frame);
  const out: Section[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const from = sorted[i - 1]!;
    const to = sorted[i]!;
    const seconds = (timeline.timeOf(to.frame) - timeline.timeOf(from.frame)) * timeScale;
    const half = (timeline.durationOf(from.frame) + timeline.durationOf(to.frame)) / 2;
    out.push({ from, to, seconds, margin: half * timeScale });
  }
  return out;
}

/** Vitesse moyenne d'une section de longueur connue (m/s), avec marge propagée. */
export function sectionSpeed(meters: number, seconds: number, marginSeconds: number, lengthMargin = 0): Measure {
  if (!(seconds > 0)) return { value: NaN, margin: NaN };
  const value = meters / seconds;
  const rel = Math.hypot(marginSeconds / seconds, meters > 0 ? lengthMargin / meters : 0);
  return { value, margin: value * rel };
}

/** Vitesse instantanée le long d'une trajectoire (différences centrées), en m/s. */
export function trajectorySpeeds(
  points: readonly TrackPoint[],
  cal: Calibration,
  timeline: FrameTimeline,
  timeScale = 1,
): { frame: number; speed: Measure }[] {
  const pts = [...points].sort((a, b) => a.frame - b.frame);
  const out: { frame: number; speed: Measure }[] = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1]!;
    const next = pts[i + 1]!;
    const dt = (timeline.timeOf(next.frame) - timeline.timeOf(prev.frame)) * timeScale;
    if (!(dt > 0)) continue;
    const len = measureLength(prev, next, cal);
    const value = len.value / dt;
    // La marge de temps est négligeable devant celle du pointage sur des images voisines.
    const dtMargin = (timeline.durationOf(prev.frame) / 2 + timeline.durationOf(next.frame) / 2) * timeScale;
    const rel = Math.hypot(len.margin / Math.max(len.value, 1e-9), dtMargin / dt);
    out.push({ frame: pts[i]!.frame, speed: { value, margin: value * rel } });
  }
  return out;
}

/** Longueur totale d'une trajectoire en mètres. */
export function trajectoryLength(points: readonly TrackPoint[], cal: Calibration): Measure {
  const pts = [...points].sort((a, b) => a.frame - b.frame);
  let value = 0;
  let variance = 0;
  for (let i = 1; i < pts.length; i++) {
    const m = measureLength(pts[i - 1]!, pts[i]!, cal);
    value += m.value;
    variance += m.margin ** 2;
  }
  return { value, margin: Math.sqrt(variance) };
}

/** Format « 12,34 ± 0,05 » avec une précision adaptée à la marge. */
export function formatMeasure(m: Measure, unit: string, frNumber: (n: number, d: number) => string, minDigits = 0): string {
  if (!Number.isFinite(m.value)) return '—';
  const digits = !Number.isFinite(m.margin) || m.margin <= 0 ? 2 : Math.min(3, Math.max(minDigits, -Math.floor(Math.log10(m.margin))));
  const margin = Number.isFinite(m.margin) ? ` ± ${frNumber(m.margin, digits)}` : '';
  return `${frNumber(m.value, digits)}${margin} ${unit}`;
}
