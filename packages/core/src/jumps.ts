import type { MarkedEvent } from './model.js';
import type { Measure } from './measure.js';
import {
  FOOT_POSITION_MARGIN_M,
  analyzeStrides,
  timeMargin,
  type Check,
  type ContactRow,
  type StepRow,
  type TimeSource,
} from './sprint.js';
import type { JumpSpec } from './jumpspec.js';

/** Accélération de la pesanteur (m/s²). */
export const G = 9.81;

export interface JumpMetric {
  id: string;
  label: string;
  value: Measure;
  unit: string;
  digits: number;
  /** Estimation balistique ou modèle : à lire comme un ordre de grandeur. */
  indicative?: boolean;
  /** Faux si la cadence est trop basse pour se fier à la valeur. */
  reliable?: boolean;
  note?: string;
}

export interface JumpPhase {
  label: string;
  contact?: Measure;
  flight?: Measure;
  /** Distance couverte par la phase (m), si les positions sont connues. */
  distance?: Measure;
  /** Part de la distance totale (0–1). */
  share?: number;
}

export interface JumpAnalysis {
  metrics: JumpMetric[];
  phases: JumpPhase[];
  /** Foulées d'élan (avant l'appel). */
  steps: StepRow[];
  /** Contacts d'élan (avant l'appel). */
  contacts: ContactRow[];
  checks: Check[];
  /** Événements obligatoires qui manquent. */
  missing: string[];
  /** Longueur du saut (appel → réception) quand les positions sont connues. */
  length?: Measure;
}

const ground = ['appel', 'appui'];

function seconds(tl: TimeSource, a: MarkedEvent, b: MarkedEvent, scale: number): Measure {
  return { value: (tl.timeOf(b.frame) - tl.timeOf(a.frame)) * scale, margin: timeMargin(tl, a.frame, b.frame, scale) };
}

/** h = ½·g·t² : montée d'un point lancé vers le haut, jusqu'à son sommet après t. */
function riseFromApex(t: Measure): Measure {
  return { value: 0.5 * G * t.value ** 2, margin: G * t.value * t.margin };
}

/** h = g·T²/8 : montée du centre de gravité pour un vol de durée T (départ et arrivée à la même hauteur). */
function riseFromFlight(T: Measure): Measure {
  return { value: (G * T.value ** 2) / 8, margin: (G * T.value * T.margin) / 4 };
}

export function analyzeJump(spec: JumpSpec, events: readonly MarkedEvent[], tl: TimeSource, timeScale: number, fps: number): JumpAnalysis {
  const sorted = [...events].sort((a, b) => a.frame - b.frame);
  const checks: Check[] = [];
  const metrics: JumpMetric[] = [];
  const reliable = fps >= spec.contactMinFps;
  const take = sorted.find((e) => e.type === 'appel');
  const count = (type: string, after?: number) => sorted.filter((e) => e.type === type && (after === undefined || e.frame > after)).length;

  // Événements obligatoires manquants.
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const d of spec.events) {
    if (!d.required || seen.has(d.type)) continue;
    seen.add(d.type);
    const need = spec.id === 'triple' && d.type === 'decollage' ? 3 : spec.id === 'triple' && d.type === 'appui' ? 2 : 1;
    const have = d.type === 'appui' ? count('appui', take?.frame) : count(d.type);
    if (have < need) missing.push(need > 1 ? `${d.label.replace(/ \(3 fois\)/, '')} (${have}/${need})` : d.label);
  }

  if (!take) return { metrics, phases: [], steps: [], contacts: [], checks, missing };

  // Élan : tout ce qui précède l'appel.
  const approach = sorted.filter((e) => e.frame < take.frame);
  const { steps, contacts } = analyzeStrides(spec, approach, tl, timeScale, fps, checks);

  // Vitesse d'approche : deux derniers repères positionnés avant ou à l'appel.
  const pos = [...approach.filter((e) => e.type === 'appui' && e.position !== undefined), ...(take.position !== undefined ? [take] : [])];
  if (pos.length >= 2) {
    const a = pos[pos.length - 2]!;
    const b = pos[pos.length - 1]!;
    const t = seconds(tl, a, b, timeScale);
    const d = (b.position as number) - (a.position as number);
    if (t.value > 0 && d > 0) {
      const v = d / t.value;
      const rel = Math.hypot((FOOT_POSITION_MARGIN_M * Math.SQRT2) / d, t.margin / t.value);
      metrics.push({ id: 'vitesse-approche', label: 'Vitesse d’approche', value: { value: v, margin: v * rel }, unit: 'm/s', digits: 1, note: 'Sur les deux derniers appuis positionnés.' });
      const [lo, hi] = spec.plausible.speed;
      if (v < lo || v > hi) checks.push({ level: 'alerte', message: `Vitesse d’approche improbable (${v.toFixed(1)} m/s).` });
    }
  }

  // Chaîne après l'appel : contacts (appel/appui → décollage) et vols (décollage → appui/réception).
  const chain = sorted.filter((e) => e.frame >= take.frame && (ground.includes(e.type) || e.type === 'decollage' || e.type === 'reception'));
  const phases: JumpPhase[] = [];
  const landings: MarkedEvent[] = []; // points de contact suivant chaque vol
  const takeoffs: MarkedEvent[] = [];
  let i = 0;
  let phaseIndex = 0;
  while (i < chain.length) {
    const on = chain[i]!;
    if (!ground.includes(on.type)) {
      i++;
      continue;
    }
    const off = chain.slice(i + 1).find((e) => e.type === 'decollage');
    if (!off) break;
    const next = chain.find((e) => e.frame > off.frame && (ground.includes(e.type) || e.type === 'reception'));
    const phase: JumpPhase = { label: spec.flightPhases[phaseIndex] ?? `Phase ${phaseIndex + 1}`, contact: seconds(tl, on, off, timeScale) };
    const ms = phase.contact!.value * 1000;
    const [clo, chi] = spec.plausible.contactMs;
    if (ms < clo || ms > chi) checks.push({ level: 'alerte', message: `Temps de contact improbable (${ms.toFixed(0)} ms) à l’image ${on.frame}.` });
    takeoffs.push(off);
    if (next) {
      phase.flight = seconds(tl, off, next, timeScale);
      const fs = phase.flight.value;
      const [flo, fhi] = spec.plausible.flightS;
      if ((spec.id === 'longueur' || spec.id === 'triple') && (fs < flo || fs > fhi)) {
        checks.push({ level: 'alerte', message: `Durée de vol improbable (${fs.toFixed(2)} s) après l’image ${off.frame}.` });
      }
      if (on.position !== undefined && next.position !== undefined) {
        phase.distance = { value: next.position - on.position, margin: FOOT_POSITION_MARGIN_M * Math.SQRT2 };
      }
      landings.push(next);
    }
    phases.push(phase);
    phaseIndex++;
    i = next ? chain.indexOf(next) : chain.length;
    if (next?.type === 'reception') break;
  }

  const take1 = phases[0];
  if (take1?.contact) {
    metrics.push({ id: 'contact-appel', label: 'Temps d’appel', value: take1.contact, unit: 's', digits: 3, reliable, note: reliable ? undefined : `Cadence trop basse (minimum ${spec.contactMinFps} i/s).` });
  }
  if (!reliable && phases.length) {
    checks.push({ level: 'info', message: `À ${Math.round(fps)} i/s, le temps d’appel est trop incertain (minimum ${spec.contactMinFps} i/s) : à lire avec prudence.` });
  }

  // Longueur du saut et part de chaque phase.
  const reception = sorted.find((e) => e.type === 'reception' && e.frame > take.frame);
  let length: Measure | undefined;
  if (reception && take.position !== undefined && reception.position !== undefined && (spec.id === 'longueur' || spec.id === 'triple')) {
    length = { value: reception.position - take.position, margin: FOOT_POSITION_MARGIN_M * Math.SQRT2 };
    metrics.push({ id: 'longueur', label: spec.id === 'triple' ? 'Distance des trois sauts' : 'Longueur du saut', value: length, unit: 'm', digits: 2, note: 'De la planche à la réception (hors perte à la planche).' });
    if (length.value > 0) for (const p of phases) if (p.distance) p.share = p.distance.value / length.value;
  }

  const air = phases.map((p) => p.flight).filter((x): x is Measure => !!x);

  if (spec.id === 'longueur' || spec.id === 'triple') {
    if (air.length) {
      const total = air.reduce((s, m) => ({ value: s.value + m.value, margin: s.margin + m.margin }), { value: 0, margin: 0 });
      metrics.push({ id: 'temps-vol', label: spec.id === 'triple' ? 'Temps de vol cumulé' : 'Temps de vol', value: total, unit: 's', digits: 2 });
    }
    const first = air[0];
    if (first && spec.id === 'longueur') {
      metrics.push({ id: 'montee', label: 'Montée du centre de gravité', value: riseFromFlight(first), unit: 'm', digits: 2, indicative: true, note: 'Estimation balistique (vol symétrique).' });
      const vy: Measure = { value: (G * first.value) / 2, margin: (G * first.margin) / 2 };
      metrics.push({ id: 'vy', label: 'Vitesse verticale à l’envol', value: vy, unit: 'm/s', digits: 1, indicative: true });
      if (length && first.value > 0) {
        const vx = length.value / first.value;
        const angle = (Math.atan2(vy.value, vx) * 180) / Math.PI;
        metrics.push({ id: 'angle', label: 'Angle d’envol', value: { value: angle, margin: Math.min(10, angle * (2 * (first.margin / first.value) + 0.05)) }, unit: '°', digits: 0, indicative: true, note: 'Longueur ÷ temps de vol pour la vitesse horizontale.' });
      }
    }
  }

  if (spec.id === 'hauteur' || spec.id === 'perche') {
    const off = takeoffs[0];
    const apex = sorted.find((e) => e.type === 'sommet' && e.frame > (off?.frame ?? take.frame));
    if (off && apex) {
      const t = seconds(tl, off, apex, timeScale);
      if (t.value > 0) {
        metrics.push({ id: 'temps-sommet', label: spec.id === 'perche' ? 'Décollage → sommet' : 'Temps jusqu’au sommet', value: t, unit: 's', digits: 2 });
        if (spec.id === 'hauteur') {
          metrics.push({ id: 'montee', label: 'Montée du centre de gravité', value: riseFromApex(t), unit: 'm', digits: 2, indicative: true, note: 'Estimation balistique à partir du décollage.' });
          metrics.push({ id: 'vy', label: 'Vitesse verticale au décollage', value: { value: G * t.value, margin: G * t.margin }, unit: 'm/s', digits: 1, indicative: true });
          const [flo, fhi] = [0.15, 1.0];
          if (t.value < flo || t.value > fhi) checks.push({ level: 'alerte', message: `Durée jusqu’au sommet improbable (${t.value.toFixed(2)} s).` });
        }
      }
    }
    if (spec.id === 'perche') {
      const plant = sorted.find((e) => e.type === 'planter');
      const release = sorted.find((e) => e.type === 'lacher');
      if (plant) {
        const t = seconds(tl, plant, take, timeScale);
        if (t.value > 0) metrics.push({ id: 'pose-appel', label: 'Pose → appel', value: t, unit: 's', digits: 2 });
      }
      if (release) {
        const t = seconds(tl, take, release, timeScale);
        if (t.value > 0) metrics.push({ id: 'phase-perche', label: 'Appel → lâcher', value: t, unit: 's', digits: 2, note: 'Temps passé sur la perche.' });
        if (apex) {
          const up = seconds(tl, release, apex, timeScale);
          if (up.value > 0) {
            metrics.push({ id: 'lacher-sommet', label: 'Lâcher → sommet', value: up, unit: 's', digits: 2 });
            metrics.push({ id: 'montee-lacher', label: 'Montée après le lâcher', value: riseFromApex(up), unit: 'm', digits: 2, indicative: true, note: 'Estimation balistique à partir du lâcher.' });
          }
        }
      }
    }
    if (apex && reception) {
      const t = seconds(tl, apex, reception, timeScale);
      if (t.value > 0) metrics.push({ id: 'sommet-reception', label: 'Sommet → réception', value: t, unit: 's', digits: 2 });
    }
    const bar = sorted.find((e) => e.type === 'barre' && e.position !== undefined);
    if (bar) {
      metrics.push({ id: 'barre', label: 'Hauteur de la barre', value: { value: bar.position as number, margin: FOOT_POSITION_MARGIN_M }, unit: 'm', digits: 2, note: 'Valeur saisie.' });
    }
  }

  if (spec.id === 'triple' && phases.length < 3 && take) {
    checks.push({ level: 'info', message: 'Triple saut : il faut trois appuis (appel + deux réceptions) et trois décollages pour décrire les trois phases.' });
  }

  return { metrics, phases, steps, contacts, checks, missing, ...(length ? { length } : {}) };
}
