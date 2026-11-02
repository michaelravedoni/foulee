import type { SplitRow } from './sprint.js';
import type { Measure } from './measure.js';

export interface VirtualBest {
  /** Somme des meilleurs temps de section, parmi les essais fournis. */
  total: Measure;
  /** Meilleur temps par section et index de l'essai qui le détient. */
  sections: { fromM: number; toM: number; seconds: Measure; source: number }[];
}

const key = (r: SplitRow) => `${r.fromM}-${r.toM}`;

/**
 * « Meilleur virtuel » : combine le meilleur temps de chaque section parmi
 * plusieurs essais. Les sections sont celles du dernier essai de la liste ; un
 * essai ne compte que s'il a exactement cette section (mêmes bornes en mètres).
 * Renvoie undefined s'il n'y a pas assez d'essais comparables.
 */
export function virtualBest(trials: readonly (readonly SplitRow[])[]): VirtualBest | undefined {
  const ref = trials[trials.length - 1];
  if (!ref || ref.length === 0 || trials.length < 2) return undefined;
  const sections: VirtualBest['sections'] = [];
  for (const row of ref) {
    let best: { seconds: Measure; source: number } | undefined;
    trials.forEach((t, i) => {
      const r = t.find((x) => key(x) === key(row));
      if (r && Number.isFinite(r.segment.value) && (!best || r.segment.value < best.seconds.value)) best = { seconds: r.segment, source: i };
    });
    if (!best) return undefined;
    sections.push({ fromM: row.fromM, toM: row.toM, seconds: best.seconds, source: best.source });
  }
  const total = sections.reduce((a, s) => a + s.seconds.value, 0);
  const margin = Math.sqrt(sections.reduce((a, s) => a + s.seconds.margin ** 2, 0));
  return { total: { value: total, margin }, sections };
}
