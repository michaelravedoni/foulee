import type { MarkedEvent } from './model.js';
/** Source de temps : une chronologie complète, ou seulement les repères d'un essai (historique). */
export interface TimeSource {
  timeOf(frame: number): number;
  durationOf(frame: number): number;
}

/** Source de temps reconstruite à partir des repères (temps média enregistrés) et de la cadence nominale. */
export function timeSourceFromEvents(events: readonly MarkedEvent[], fps: number): TimeSource {
  const byFrame = new Map(events.map((e) => [e.frame, e.time] as const));
  return {
    timeOf: (f) => byFrame.get(f) ?? f / fps,
    durationOf: () => 1 / fps,
  };
}
import type { Measure } from './measure.js';
import type { TrialSpec } from './trialspec.js';

export type CheckLevel = 'info' | 'alerte';
export interface Check {
  level: CheckLevel;
  message: string;
}

export interface SplitRow {
  from: MarkedEvent;
  to: MarkedEvent;
  /** Positions en mètres depuis le départ. */
  fromM: number;
  toM: number;
  /** Temps de la section, temps cumulé depuis le départ (s, temps réel). */
  segment: Measure;
  cumulative: Measure;
  speed: Measure;
}

export interface SprintProfile {
  vmax: Measure;
  tau: Measure;
  /** Force relative F0 = Vmax / tau (N/kg) et puissance relative Pmax = F0·Vmax/4 (W/kg). */
  f0: number;
  pmax: number;
  /** Écart quadratique moyen du modèle aux points (m). */
  rmse: number;
  points: number;
}

export interface StepRow {
  from: MarkedEvent;
  to: MarkedEvent;
  time: Measure;
  frequency: Measure;
  /** Longueur du pas (m) si la position des deux appuis est connue. */
  length?: Measure;
}

export interface ContactRow {
  on: MarkedEvent;
  off: MarkedEvent;
  contact: Measure;
  flight?: Measure;
  /** Vrai si la cadence permet de se fier au temps de contact. */
  reliable: boolean;
}

export interface SprintAnalysis {
  splits: SplitRow[];
  /** Temps total mesuré du départ au dernier repère positionné. */
  total?: Measure;
  profile?: SprintProfile;
  steps: StepRow[];
  contacts: ContactRow[];
  checks: Check[];
}

/** Marge sur la position d'un appui lue à l'écran, en mètres (pointage). */
export const FOOT_POSITION_MARGIN_M = 0.05;

export function timeMargin(tl: TimeSource, a: number, b: number, scale: number): number {
  return ((tl.durationOf(a) + tl.durationOf(b)) / 2) * scale;
}

/** Positions utilisables : départ à 0 m, arrivée à la distance de l'épreuve si non précisée. */
function positioned(events: readonly MarkedEvent[], spec: TrialSpec): MarkedEvent[] {
  const sorted = [...events].sort((a, b) => a.frame - b.frame);
  const out: MarkedEvent[] = [];
  for (const e of sorted) {
    if (e.type === 'depart') out.push({ ...e, position: 0 });
    else if (e.type === 'arrivee') out.push({ ...e, position: e.position ?? spec.distance });
    else if ((e.type === 'passage' || e.type === 'haie') && e.position !== undefined) out.push(e);
  }
  return out;
}

export function analyzeSprint(spec: TrialSpec, events: readonly MarkedEvent[], tl: TimeSource, timeScale: number, fps: number): SprintAnalysis {
  const checks: Check[] = [];
  const pts = positioned(events, spec);
  const start = pts.find((p) => p.type === 'depart');
  if (!start) checks.push({ level: 'alerte', message: 'Aucun départ marqué : les temps cumulés sont impossibles.' });
  if (!pts.some((p) => p.type === 'arrivee')) checks.push({ level: 'info', message: 'Pas d’arrivée marquée : le temps total n’est pas calculé.' });

  const splits: SplitRow[] = [];
  const t0 = start ? tl.timeOf(start.frame) : 0;
  for (let i = 1; i < pts.length; i++) {
    const from = pts[i - 1]!;
    const to = pts[i]!;
    const fromM = from.position!;
    const toM = to.position!;
    if (toM <= fromM) {
      checks.push({ level: 'alerte', message: `Positions incohérentes : ${toM} m suit ${fromM} m.` });
      continue;
    }
    const seg = (tl.timeOf(to.frame) - tl.timeOf(from.frame)) * timeScale;
    const segMargin = timeMargin(tl, from.frame, to.frame, timeScale);
    const cum = start ? (tl.timeOf(to.frame) - t0) * timeScale : NaN;
    const cumMargin = start ? timeMargin(tl, start.frame, to.frame, timeScale) : NaN;
    const meters = toM - fromM;
    const v = meters / seg;
    const vMargin = v * (segMargin / seg);
    splits.push({
      from,
      to,
      fromM,
      toM,
      segment: { value: seg, margin: segMargin },
      cumulative: { value: cum, margin: cumMargin },
      speed: { value: v, margin: vMargin },
    });
    const [lo, hi] = spec.plausible.speed;
    if (v < lo || v > hi) checks.push({ level: 'alerte', message: `Vitesse improbable (${v.toFixed(1)} m/s) entre ${fromM} m et ${toM} m : vérifie les repères.` });
  }
  const last = splits[splits.length - 1];
  const total = last && start ? { value: last.cumulative.value, margin: last.cumulative.margin } : undefined;
  if (last && last.toM !== spec.distance) checks.push({ level: 'info', message: `Dernier repère à ${last.toM} m (épreuve : ${spec.distance} m).` });

  const profile = total && splits.length >= 3 ? fitProfile(splits) : undefined;
  if (splits.length > 0 && splits.length < 3) checks.push({ level: 'info', message: 'Il faut au moins 4 repères (départ compris) pour ajuster le profil Vmax / tau.' });

  const { steps, contacts } = analyzeStrides(spec, events, tl, timeScale, fps, checks);
  return { splits, ...(total ? { total } : {}), ...(profile ? { profile } : {}), steps, contacts, checks };
}

// ——— Profil Vmax / tau ———

/** d(t) = Vmax · (t − τ · (1 − e^(−t/τ))) pour une accélération v(t) = Vmax · (1 − e^(−t/τ)). */
export function modelDistance(vmax: number, tau: number, t: number): number {
  return vmax * (t - tau * (1 - Math.exp(-t / tau)));
}

interface Sample {
  t: number;
  d: number;
}

function fitFor(tau: number, s: Sample[]): { vmax: number; sse: number } {
  let num = 0;
  let den = 0;
  for (const p of s) {
    const f = p.t - tau * (1 - Math.exp(-p.t / tau));
    num += p.d * f;
    den += f * f;
  }
  const vmax = den > 0 ? num / den : 0;
  let sse = 0;
  for (const p of s) sse += (p.d - modelDistance(vmax, tau, p.t)) ** 2;
  return { vmax, sse };
}

/** Ajuste Vmax et τ sur les temps cumulés ; marges à 2 écarts-types (jacobienne du modèle). */
export function fitVmaxTau(samples: Sample[]): SprintProfile | undefined {
  const s = samples.filter((p) => p.t > 0 && p.d > 0);
  if (s.length < 3) return undefined;
  let bestTau = 1;
  let best = Infinity;
  for (let tau = 0.2; tau <= 5; tau += 0.01) {
    const { sse } = fitFor(tau, s);
    if (sse < best) {
      best = sse;
      bestTau = tau;
    }
  }
  const { vmax, sse } = fitFor(bestTau, s);
  const n = s.length;
  const sigma2 = n > 2 ? sse / (n - 2) : NaN;
  // Jacobienne [∂d/∂Vmax, ∂d/∂τ]
  const h = 1e-4;
  let a = 0;
  let b = 0;
  let c = 0;
  for (const p of s) {
    const j1 = p.t - bestTau * (1 - Math.exp(-p.t / bestTau));
    const j2 = (modelDistance(vmax, bestTau + h, p.t) - modelDistance(vmax, bestTau - h, p.t)) / (2 * h);
    a += j1 * j1;
    b += j1 * j2;
    c += j2 * j2;
  }
  const det = a * c - b * b;
  const varV = det > 1e-12 ? (sigma2 * c) / det : NaN;
  const varT = det > 1e-12 ? (sigma2 * a) / det : NaN;
  const vMargin = 2 * Math.sqrt(varV);
  const tMargin = 2 * Math.sqrt(varT);
  const f0 = vmax / bestTau;
  return {
    vmax: { value: vmax, margin: vMargin },
    tau: { value: bestTau, margin: tMargin },
    f0,
    pmax: (f0 * vmax) / 4,
    rmse: Math.sqrt(sse / n),
    points: n,
  };
}

function fitProfile(splits: SplitRow[]): SprintProfile | undefined {
  const samples = splits.filter((r) => Number.isFinite(r.cumulative.value)).map((r) => ({ t: r.cumulative.value, d: r.toM }));
  return fitVmaxTau(samples);
}

// ——— Foulées ———

export function analyzeStrides(
  spec: Pick<TrialSpec, 'plausible' | 'contactMinFps'>,
  events: readonly MarkedEvent[],
  tl: TimeSource,
  scale: number,
  fps: number,
  checks: Check[],
): { steps: StepRow[]; contacts: ContactRow[] } {
  const sorted = [...events].sort((a, b) => a.frame - b.frame);
  const on = sorted.filter((e) => e.type === 'appui');
  const off = sorted.filter((e) => e.type === 'decollage');
  const steps: StepRow[] = [];
  for (let i = 1; i < on.length; i++) {
    const from = on[i - 1]!;
    const to = on[i]!;
    const time = (tl.timeOf(to.frame) - tl.timeOf(from.frame)) * scale;
    const margin = timeMargin(tl, from.frame, to.frame, scale);
    if (!(time > 0)) continue;
    const freq = 1 / time;
    const row: StepRow = { from, to, time: { value: time, margin }, frequency: { value: freq, margin: freq * (margin / time) } };
    if (from.position !== undefined && to.position !== undefined) {
      row.length = { value: to.position - from.position, margin: FOOT_POSITION_MARGIN_M * Math.SQRT2 };
    }
    steps.push(row);
    const [lo, hi] = spec.plausible.stepHz;
    if (freq < lo || freq > hi) checks.push({ level: 'alerte', message: `Fréquence de pas improbable (${freq.toFixed(1)} Hz) entre les appuis aux images ${from.frame} et ${to.frame}.` });
  }

  const reliable = fps >= spec.contactMinFps;
  const contacts: ContactRow[] = [];
  for (let i = 0; i < on.length; i++) {
    const a = on[i]!;
    const nextOn = on[i + 1];
    const o = off.find((x) => x.frame > a.frame && x.side === a.side && (!nextOn || x.frame < nextOn.frame));
    if (!o) continue;
    const contact = (tl.timeOf(o.frame) - tl.timeOf(a.frame)) * scale;
    const margin = timeMargin(tl, a.frame, o.frame, scale);
    const row: ContactRow = { on: a, off: o, contact: { value: contact, margin }, reliable };
    if (nextOn) {
      row.flight = { value: (tl.timeOf(nextOn.frame) - tl.timeOf(o.frame)) * scale, margin: timeMargin(tl, o.frame, nextOn.frame, scale) };
    }
    contacts.push(row);
    const ms = contact * 1000;
    const [lo, hi] = spec.plausible.contactMs;
    if (ms < lo || ms > hi) checks.push({ level: 'alerte', message: `Temps de contact improbable (${ms.toFixed(0)} ms) à l’image ${a.frame}.` });
  }
  if (contacts.length && !reliable) {
    checks.push({ level: 'info', message: `À ${Math.round(fps)} i/s, le temps de contact est trop incertain (minimum ${spec.contactMinFps} i/s) : à lire avec prudence.` });
  }
  return { steps, contacts };
}
