import type { Calibration, MarkedEvent, Trajectory } from './model.js';
import { calibrationRelError, pixelsPerMeter, type Measure } from './measure.js';
import { G, type JumpMetric } from './jumps.js';
import { timeMargin, type Check, type TimeSource } from './sprint.js';
import type { ThrowSpec } from './throwspec.js';

export interface ThrowPhase {
  label: string;
  /** Durée entre deux repères consécutifs (s). */
  duration: Measure;
  from: MarkedEvent;
  to: MarkedEvent;
}

export interface ThrowRelease {
  speed: Measure;
  /** Angle au-dessus de l'horizontale (°). */
  angle: Measure;
  points: number;
  trajectoryLabel: string;
}

export interface ThrowAnalysis {
  metrics: JumpMetric[];
  phases: ThrowPhase[];
  release?: ThrowRelease;
  checks: Check[];
  missing: string[];
  /** Distance saisie (position du repère « chute de l'engin »). */
  distance?: Measure;
}

const seconds = (tl: TimeSource, a: MarkedEvent, b: MarkedEvent, scale: number): Measure => ({
  value: (tl.timeOf(b.frame) - tl.timeOf(a.frame)) * scale,
  margin: timeMargin(tl, a.frame, b.frame, scale),
});

/**
 * Vitesse et angle de l'engin au lâcher, par régression linéaire sur les premiers points pointés
 * après le lâcher. La vitesse verticale est ramenée à l'instant du lâcher (correction de la pesanteur).
 */
export function releaseFromTrajectory(
  points: readonly { frame: number; x: number; y: number }[],
  releaseFrame: number,
  cal: Calibration,
  tl: TimeSource,
  scale: number,
  window: number,
): Omit<ThrowRelease, 'trajectoryLabel'> | undefined {
  const pts = points.filter((p) => p.frame >= releaseFrame).sort((a, b) => a.frame - b.frame).slice(0, window);
  if (pts.length < 2) return undefined;
  const ppm = pixelsPerMeter(cal);
  const t = pts.map((p) => tl.timeOf(p.frame) * scale);
  const tMean = t.reduce((s, v) => s + v, 0) / t.length;
  const stt = t.reduce((s, v) => s + (v - tMean) ** 2, 0);
  if (!(stt > 0)) return undefined;
  const slope = (vals: number[]) => {
    const m = vals.reduce((s, v) => s + v, 0) / vals.length;
    return vals.reduce((s, v, i) => s + (t[i]! - tMean) * (v - m), 0) / stt;
  };
  const vx = slope(pts.map((p) => p.x / ppm));
  const vyUp = -slope(pts.map((p) => p.y / ppm)) + G * (tMean - tl.timeOf(releaseFrame) * scale);
  const speed = Math.hypot(vx, vyUp);
  if (!(speed > 0)) return undefined;
  const sigma = cal.clickErrorPx / ppm / Math.sqrt(stt);
  const speedMargin = Math.hypot(sigma, speed * calibrationRelError(cal));
  const angle = (Math.atan2(vyUp, Math.abs(vx)) * 180) / Math.PI;
  const angleMargin = Math.min(45, ((sigma / speed) * 180) / Math.PI);
  return { speed: { value: speed, margin: speedMargin }, angle: { value: angle, margin: angleMargin }, points: pts.length };
}

export function analyzeThrow(
  spec: ThrowSpec,
  events: readonly MarkedEvent[],
  trajectories: readonly Trajectory[],
  calibration: Calibration | undefined,
  tl: TimeSource,
  timeScale: number,
): ThrowAnalysis {
  const sorted = [...events].sort((a, b) => a.frame - b.frame);
  const checks: Check[] = [];
  const metrics: JumpMetric[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const d of spec.events) {
    if (!d.required || seen.has(d.type)) continue;
    seen.add(d.type);
    if (!sorted.some((e) => e.type === d.type)) missing.push(d.label);
  }

  // Durées entre repères consécutifs du gabarit (hors marteau : les tours sont traités à part).
  const types = new Set(spec.events.map((e) => e.type));
  const inSpec = sorted.filter((e) => types.has(e.type) && e.type !== 'impact' && e.type !== 'pointbas');
  const phases: ThrowPhase[] = [];
  const turns = spec.id === 'marteau' ? inSpec.filter((e) => e.type === 'tour') : [];
  const release = sorted.find((e) => e.type === 'lacher');
  if (spec.id === 'marteau') {
    const ends = [...turns.slice(1), ...(release && turns.length && release.frame > turns[turns.length - 1]!.frame ? [release] : [])];
    turns.forEach((from, i) => {
      const to = ends[i];
      if (to) phases.push({ label: `Tour ${i + 1}`, from, to, duration: seconds(tl, from, to, timeScale) });
    });
    const [lo, hi] = spec.plausible.turnS ?? [0, Infinity];
    for (const p of phases) if (p.duration.value < lo || p.duration.value > hi) checks.push({ level: 'alerte', message: `Durée de ${p.label.toLowerCase()} improbable (${p.duration.value.toFixed(2)} s).` });
    if (phases.length) {
      const mean = phases.reduce((s, p) => s + p.duration.value, 0) / phases.length;
      metrics.push({ id: 'tours', label: 'Nombre de tours', value: { value: phases.length, margin: 0 }, unit: '', digits: 0 });
      metrics.push({ id: 'tour-moyen', label: 'Durée moyenne d’un tour', value: { value: mean, margin: phases.reduce((s, p) => s + p.duration.margin, 0) / phases.length }, unit: 's', digits: 2 });
    }
    if (phases.length >= 2) {
      const first = phases[0]!.duration;
      const last = phases[phases.length - 1]!.duration;
      metrics.push({ id: 'gain-tours', label: 'Accélération (premier − dernier tour)', value: { value: first.value - last.value, margin: first.margin + last.margin }, unit: 's', digits: 2, note: 'Positif : les tours accélèrent.' });
    }
  } else {
    for (let i = 1; i < inSpec.length; i++) {
      const from = inSpec[i - 1]!;
      const to = inSpec[i]!;
      if (from.type === to.type) continue;
      const label = `${spec.events.find((d) => d.type === from.type)?.label ?? from.type} → ${spec.events.find((d) => d.type === to.type)?.label ?? to.type}`;
      phases.push({ label, from, to, duration: seconds(tl, from, to, timeScale) });
    }
  }

  // Ordre attendu : le lâcher doit suivre les repères qui le précèdent dans le gabarit.
  if (release) {
    const idx = (t: string) => spec.events.findIndex((d) => d.type === t);
    for (const e of sorted) {
      if (e.type !== 'lacher' && idx(e.type) >= 0 && idx(e.type) < idx('lacher') && e.frame > release.frame) {
        checks.push({ level: 'alerte', message: `« ${spec.events[idx(e.type)]!.label} » est placé après le lâcher (image ${e.frame}).` });
        break;
      }
    }
  }

  // Lâcher : vitesse et angle de l'engin d'après la trajectoire pointée.
  let rel: ThrowRelease | undefined;
  if (release) {
    if (!calibration) {
      checks.push({ level: 'info', message: 'Sans étalon, la vitesse et l’angle de lâcher ne peuvent pas être calculés : trace un étalon dans l’onglet Mesures.' });
    } else {
      const best = [...trajectories]
        .map((t) => ({ t, n: t.points.filter((p) => p.frame >= release.frame).length }))
        .sort((a, b) => b.n - a.n)[0];
      if (!best || best.n < 2) {
        checks.push({ level: 'info', message: 'Pointe l’engin sur au moins 3 images à partir du lâcher (onglet Mesures, outil Trajectoire) pour obtenir sa vitesse et son angle.' });
      } else {
        const r = releaseFromTrajectory(best.t.points, release.frame, calibration, tl, timeScale, spec.releaseWindow);
        if (r) {
          rel = { ...r, trajectoryLabel: best.t.label };
          metrics.push({ id: 'vitesse-lacher', label: 'Vitesse au lâcher', value: r.speed, unit: 'm/s', digits: 1, note: `${r.points} points après le lâcher.` });
          metrics.push({ id: 'angle-lacher', label: 'Angle de lâcher', value: r.angle, unit: '°', digits: 0, note: 'Dans le plan de l’image : exact seulement si la caméra est perpendiculaire à la trajectoire.' });
          if (r.points < 3) checks.push({ level: 'info', message: 'Seulement 2 points après le lâcher : la vitesse et l’angle sont très incertains.' });
          const [slo, shi] = spec.plausible.releaseSpeed;
          const [alo, ahi] = spec.plausible.releaseAngle;
          if (r.speed.value < slo || r.speed.value > shi) checks.push({ level: 'alerte', message: `Vitesse de lâcher improbable (${r.speed.value.toFixed(1)} m/s).` });
          if (r.angle.value < alo || r.angle.value > ahi) checks.push({ level: 'alerte', message: `Angle de lâcher inhabituel (${r.angle.value.toFixed(0)}°).` });
          if (release.position !== undefined && (spec.id === 'poids' || spec.id === 'marteau')) {
            const h = release.position;
            const th = (r.angle.value * Math.PI) / 180;
            const v = r.speed.value;
            const range = ((v * Math.cos(th)) / G) * (v * Math.sin(th) + Math.sqrt((v * Math.sin(th)) ** 2 + 2 * G * h));
            const dr = ((range * 2 * r.speed.margin) / v) * 1.5; // la portée varie en v² : marge relative doublée
            metrics.push({ id: 'portee', label: 'Portée depuis le lâcher', value: { value: range, margin: dr }, unit: 'm', digits: 1, indicative: true, note: 'Sans résistance de l’air, depuis le point de lâcher (pas depuis le cercle).' });
          }
        }
      }
    }
  }

  const impact = sorted.find((e) => e.type === 'impact' && e.position !== undefined);
  let distance: Measure | undefined;
  if (impact) {
    distance = { value: impact.position as number, margin: 0.01 };
    metrics.push({ id: 'distance', label: 'Distance saisie', value: distance, unit: 'm', digits: 2, note: 'Valeur saisie : ne remplace pas la mesure officielle.' });
  }
  if (release && impact) {
    const t = seconds(tl, release, impact, timeScale);
    if (t.value > 0) metrics.push({ id: 'temps-vol', label: 'Temps de vol de l’engin', value: t, unit: 's', digits: 2 });
  }

  return { metrics, phases, ...(rel ? { release: rel } : {}), checks, missing, ...(distance ? { distance } : {}) };
}
