import type { DisciplineFamily, DisciplineId } from './disciplines.js';

/**
 * Spécification d'une épreuve : données déclaratives validées par le moteur
 * (`sprint.ts`). Les valeurs de règlement sont versionnées ; les seuils de
 * plausibilité sont des garde-fous à valider avec des entraîneurs.
 */
export interface TrialSpec {
  id: DisciplineId;
  label: string;
  family: DisciplineFamily;
  /** Spécification dont celle-ci hérite (composition plutôt que copie). */
  parent?: DisciplineId | 'sprint';
  /** Distance de course (m). */
  distance: number;
  /** Positions de passage proposées (m depuis le départ), arrivée comprise. */
  splitPoints: number[];
  /** Haies : position de la première, espacement, nombre. */
  hurdles?: { first: number; spacing: number; count: number };
  /** Cadence minimale pour que le temps de contact soit fiable. */
  contactMinFps: number;
  plausible: {
    /** Temps de contact au sol (ms). */
    contactMs: [number, number];
    /** Fréquence de pas (Hz). */
    stepHz: [number, number];
    /** Vitesse sur une section (m/s). */
    speed: [number, number];
  };
  /** Version des données de règlement. */
  dataVersion: string;
}

const SPRINT_BASE = {
  contactMinFps: 120,
  plausible: { contactMs: [60, 250] as [number, number], stepHz: [2.5, 5.5] as [number, number], speed: [0.5, 13] as [number, number] },
  dataVersion: '2026.1',
};

function every(step: number, total: number): number[] {
  const out: number[] = [];
  for (let d = step; d <= total + 1e-9; d += step) out.push(Math.round(d * 100) / 100);
  return out;
}

function hurdlePoints(h: { first: number; spacing: number; count: number }, total: number): number[] {
  const pts = Array.from({ length: h.count }, (_, i) => Math.round((h.first + h.spacing * i) * 100) / 100);
  return [...pts, total];
}

export const TRIAL_SPECS: TrialSpec[] = [
  { id: '100m', label: '100 m', family: 'sprint', parent: 'sprint', distance: 100, splitPoints: every(10, 100), ...SPRINT_BASE },
  { id: '200m', label: '200 m', family: 'sprint', parent: 'sprint', distance: 200, splitPoints: every(50, 200), ...SPRINT_BASE },
  { id: '400m', label: '400 m', family: 'sprint', parent: 'sprint', distance: 400, splitPoints: every(100, 400), ...SPRINT_BASE },
  { id: '100mh', label: '100 m haies', family: 'haies', parent: 'sprint', distance: 100, hurdles: { first: 13, spacing: 8.5, count: 10 }, splitPoints: hurdlePoints({ first: 13, spacing: 8.5, count: 10 }, 100), ...SPRINT_BASE },
  { id: '110mh', label: '110 m haies', family: 'haies', parent: 'sprint', distance: 110, hurdles: { first: 13.72, spacing: 9.14, count: 10 }, splitPoints: hurdlePoints({ first: 13.72, spacing: 9.14, count: 10 }, 110), ...SPRINT_BASE },
  { id: '400mh', label: '400 m haies', family: 'haies', parent: 'sprint', distance: 400, hurdles: { first: 45, spacing: 35, count: 10 }, splitPoints: hurdlePoints({ first: 45, spacing: 35, count: 10 }, 400), ...SPRINT_BASE },
];

export function specFor(discipline: string): TrialSpec | undefined {
  return TRIAL_SPECS.find((s) => s.id === discipline);
}
