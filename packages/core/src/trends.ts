import type { Measure } from './measure.js';
import { isTimeDiscipline } from './norms.js';

/** Résultat principal d'un essai (temps, distance ou hauteur) avec sa marge. */
export interface ResultPoint {
  id: string;
  /** AAAA-MM-JJ */
  date: string;
  value: number;
  margin: number;
}

export interface TrendSummary {
  count: number;
  personalBest?: ResultPoint;
  seasonBest?: ResultPoint;
  /** Moyenne des N derniers résultats. */
  rollingMean?: number;
  /** Variation moyenne par mois (même unité que le résultat), régression linéaire. */
  slopePerMonth?: number;
  direction: 'mieux' | 'moins' | 'stable' | 'insuffisant';
}

const better = (discipline: string, a: number, b: number) => (isTimeDiscipline(discipline) ? a < b : a > b);

const monthsBetween = (a: string, b: string) => (Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / (30.4375 * 86400_000);

/**
 * Références personnelles et tendance. La tendance n'est « mieux » ou « moins » que si le changement
 * estimé sur la période dépasse la marge d'erreur moyenne des mesures (même règle que les flèches des rapports).
 */
export function summarize(discipline: string, points: readonly ResultPoint[], seasonYear: number, window = 3): TrendSummary {
  const pts = [...points].filter((p) => Number.isFinite(p.value)).sort((a, b) => a.date.localeCompare(b.date));
  const out: TrendSummary = { count: pts.length, direction: 'insuffisant' };
  if (!pts.length) return out;
  const best = (list: ResultPoint[]) => list.reduce((b, p) => (better(discipline, p.value, b.value) ? p : b));
  out.personalBest = best(pts);
  const season = pts.filter((p) => p.date.startsWith(String(seasonYear)));
  if (season.length) out.seasonBest = best(season);
  const last = pts.slice(-window);
  out.rollingMean = last.reduce((s, p) => s + p.value, 0) / last.length;
  const span = pts.length >= 3 ? monthsBetween(pts[0]!.date, pts[pts.length - 1]!.date) : 0;
  if (pts.length >= 3 && span > 0) {
    const t = pts.map((p) => monthsBetween(pts[0]!.date, p.date));
    const tm = t.reduce((s, v) => s + v, 0) / t.length;
    const vm = pts.reduce((s, p) => s + p.value, 0) / pts.length;
    const stt = t.reduce((s, v) => s + (v - tm) ** 2, 0);
    if (stt > 0) {
      const slope = t.reduce((s, v, i) => s + (v - tm) * (pts[i]!.value - vm), 0) / stt;
      out.slopePerMonth = slope;
      const change = slope * span;
      const meanMargin = pts.reduce((s, p) => s + p.margin, 0) / pts.length;
      if (Math.abs(change) <= 2 * meanMargin) out.direction = 'stable';
      else out.direction = (isTimeDiscipline(discipline) ? change < 0 : change > 0) ? 'mieux' : 'moins';
    }
  }
  return out;
}

export const asPoint = (id: string, date: string, m: Measure): ResultPoint => ({ id, date, value: m.value, margin: m.margin });
