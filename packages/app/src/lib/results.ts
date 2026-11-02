import {
  analyzeJump,
  analyzeSprint,
  analyzeThrow,
  jumpSpecFor,
  realTimeScale,
  specFor,
  throwSpecFor,
  timeSourceFromEvents,
  asPoint,
  categoryFor,
  rateAgainst,
  isTimeDiscipline,
  type Analysis,
  type MediaInfo,
  type ResultPoint,
  type Trial,
} from '@foulee/core';
import { analysisOf, mediaOf, state } from '../store/data';

/** Résultat principal d'un essai (temps, longueur ou distance) avec sa marge, ou rien si les repères manquent. */
export function resultOf(trial: Trial, analysis: Analysis, media: MediaInfo | undefined, fallbackFps?: number): { value: number; margin: number } | undefined {
  const fps = media?.nominalFps ?? fallbackFps;
  if (!fps) return undefined;
  const ev = analysis.events;
  const ts = () => timeSourceFromEvents(ev, fps);
  const scale = realTimeScale(fps, trial.captureFps);
  const sp = specFor(trial.discipline);
  if (sp && ev.length >= 2) return analyzeSprint(sp, ev, ts(), scale, fps).total;
  const js = jumpSpecFor(trial.discipline);
  if (js && ev.length >= 2) return analyzeJump(js, ev, ts(), scale, fps).length;
  const th = throwSpecFor(trial.discipline);
  if (th && ev.length >= 1) return analyzeThrow(th, ev, analysis.trajectories ?? [], analysis.calibration, ts(), scale).distance;
  return undefined;
}

export const formatResult = (discipline: string, v: number, digits = 2) => `${v.toFixed(digits).replace('.', ',')} ${isTimeDiscipline(discipline) ? 's' : 'm'}`;

/** Résultats datés de tous les essais d'un athlète pour une épreuve (essais à la corbeille exclus). */
export function resultsOfAthlete(trials: readonly Trial[], discipline: string): ResultPoint[] {
  const out: ResultPoint[] = [];
  for (const t of trials) {
    if (t.discipline !== discipline || t.deletedAt) continue;
    const r = resultOf(t, analysisOf(t.id), mediaOf(t));
    if (!r || !(r.value > 0)) continue;
    out.push(asPoint(t.id, state.sessions.get(t.sessionId)?.date ?? t.createdAt.slice(0, 10), r));
  }
  return out;
}

/** Lignes « Références » d'un rapport : comparaison aux tableaux de normes importés, avec la source et l'état de vérification. */
export function normRefs(trial: Trial, analysis: Analysis, fallbackFps?: number): string[] {
  const r = resultOf(trial, analysis, mediaOf(trial), fallbackFps);
  const a = state.athletes.get(trial.athleteId);
  if (!r || !a?.sex) return [];
  const year = Number((state.sessions.get(trial.sessionId)?.date ?? trial.createdAt).slice(0, 4));
  const fmt = (v: number) => formatResult(trial.discipline, v);
  return state.norms.flatMap((table) => {
    const cat = categoryFor(table, a.birthDate, year);
    const rating = cat ? rateAgainst(table, trial.discipline, a.sex!, cat, r.value, r.margin) : undefined;
    if (!cat || !rating) return [];
    const level = rating.reached ? `niveau atteint : ${rating.reached.label} (${fmt(rating.reached.value)})` : 'aucun niveau atteint';
    const next = rating.next ? `, prochain : ${rating.next.level.label} (${fmt(rating.next.level.value)}), à ${fmt(rating.next.gap)}` : '';
    const unsure = rating.uncertain ? ' Trop proche d’un seuil pour trancher vu la marge de mesure.' : '';
    const prov = `${table.source.name}, saison ${table.source.season}${table.verified ? `, vérifié par ${table.verified.by} le ${table.verified.at}` : ', valeurs NON vérifiées à la source'}`;
    return [`${cat.label} · ${level}${next}.${unsure} (${prov}). Indicatif.`];
  });
}
