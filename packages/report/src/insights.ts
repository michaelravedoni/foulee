import { frNumber, type Measure, type SplitRow } from '@foulee/core';
import type { HistoryTrial, ReportInput, Trend } from './doc.js';

/** Écart de vitesse entre la dernière section et la plus rapide au-delà duquel on signale une perte (valeur à valider). */
export const LATE_DROP_RATIO = 0.04;

export interface Insights {
  good: string[];
  work: string[];
  cues: string[];
  /** Termes du glossaire à imprimer. */
  terms: string[];
}

export function trendOf(cur: Measure, ref: Measure, lowerIsBetter: boolean): Trend {
  const d = cur.value - ref.value;
  const m = Math.hypot(cur.margin || 0, ref.margin || 0);
  if (!Number.isFinite(d) || Math.abs(d) <= m) return 'egal';
  return (d < 0) === lowerIsBetter ? 'mieux' : 'moins';
}

export function previousOf(input: ReportInput): HistoryTrial | undefined {
  return [...input.history].reverse().find((h) => h.analysis.total);
}

export function bestOf(input: ReportInput): HistoryTrial | undefined {
  return input.history.filter((h) => h.analysis.total).sort((a, b) => a.analysis.total!.value - b.analysis.total!.value)[0];
}

export function topSpeed(rows: readonly SplitRow[]): SplitRow | undefined {
  return rows.reduce<SplitRow | undefined>((m, r) => (!m || r.speed.value > m.speed.value ? r : m), undefined);
}

const sectionKey = (r: SplitRow) => `${r.fromM}-${r.toM}`;
const sec = (v: number) => `${frNumber(Math.abs(v), 2)} s`;
const range = (r: SplitRow) => `${frNumber(r.fromM, 0)}-${frNumber(r.toM, 0)} m`;

export function computeInsights(input: ReportInput): Insights {
  const good: string[] = [];
  const work: string[] = [];
  const cues: string[] = [];
  const terms = new Set<string>(['split']);
  const a = input.analysis;
  const prev = previousOf(input);
  const best = bestOf(input);

  if (a.total && prev?.analysis.total) {
    const t = trendOf(a.total, prev.analysis.total, true);
    const d = a.total.value - prev.analysis.total.value;
    if (t === 'mieux') good.push(`Tu as gagné ${sec(d)} par rapport à ton essai précédent (${prev.label}).`);
    else if (t === 'moins') work.push(`Tu es ${sec(d)} plus lent que ton essai précédent (${prev.label}).`);
    else good.push('Ton temps est stable par rapport à ton essai précédent (écart dans la marge de mesure).');
    terms.add('marge');
  }
  if (a.total && best && a.total.value < best.analysis.total!.value - Math.hypot(a.total.margin, best.analysis.total!.margin)) {
    good.push('C’est ton meilleur essai de la série enregistrée.');
  }

  if (prev) {
    const before = new Map(prev.analysis.splits.map((r) => [sectionKey(r), r] as const));
    let gain: { r: SplitRow; d: number } | undefined;
    let loss: { r: SplitRow; d: number } | undefined;
    for (const r of a.splits) {
      const p = before.get(sectionKey(r));
      if (!p) continue;
      const d = r.segment.value - p.segment.value;
      const m = Math.hypot(r.segment.margin, p.segment.margin);
      if (d < -m && (!gain || d < gain.d)) gain = { r, d };
      if (d > m && (!loss || d > loss.d)) loss = { r, d };
    }
    if (gain) good.push(`Section ${range(gain.r)} plus rapide de ${sec(gain.d)} qu’à l’essai précédent.`);
    if (loss) {
      work.push(`Section ${range(loss.r)} plus lente de ${sec(loss.d)} qu’à l’essai précédent.`);
      if (loss.r.fromM === 0 || loss.r.fromM <= a.splits[0]!.fromM) cues.push('depart');
    }
  }

  const top = topSpeed(a.splits);
  const last = a.splits[a.splits.length - 1];
  if (top && last && a.splits.length >= 3 && top.speed.value > 0) {
    const drop = (top.speed.value - last.speed.value) / top.speed.value;
    if (drop >= LATE_DROP_RATIO && last !== top) {
      work.push(`Tu perds ${frNumber(drop * 100, 0)} % de vitesse sur la dernière section (${range(last)}) par rapport à ton meilleur passage.`);
      cues.push('maintien');
    }
  }

  const p = a.profile;
  const pp = prev?.analysis.profile;
  if (p && pp) {
    terms.add('vmax');
    if (trendOf(p.vmax, pp.vmax, false) === 'mieux') good.push(`Ta vitesse maximale estimée progresse (${frNumber(p.vmax.value, 1)} m/s).`);
  }
  if (top) good.push(`Ton passage le plus rapide : ${range(top)}, à ${frNumber(top.speed.value, 1)} m/s.`);
  if (!good.length) good.push('Essai analysé et enregistré : il servira de référence pour mesurer tes progrès.');
  if (a.steps.length) terms.add('frequence');
  if (a.contacts.length) {
    terms.add('contact');
    terms.add('vol');
  }
  return { good, work, cues: [...new Set(cues)], terms: [...terms] };
}

export const CUES: Record<string, string> = {
  depart: 'Pour les premiers mètres : reste bas, pousse fort et allonge progressivement la poussée avant de te redresser.',
  maintien: 'Pour la fin de course : garde le buste haut et les épaules relâchées ; travaille des courses lancées à vitesse maximale sur 20 à 30 m.',
};
