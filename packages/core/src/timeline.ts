/**
 * Chronologie exacte des images d'une vidéo, construite à partir des
 * horodatages réels (en secondes) lus dans le conteneur. Une vidéo à cadence
 * variable (ralentis iPhone) est représentée telle quelle.
 */
export class FrameTimeline {
  readonly times: Float64Array;
  readonly nominalFps: number;
  readonly variable: boolean;
  /** Durée de la dernière image (s). */
  readonly lastFrameDuration: number;

  constructor(timestamps: ArrayLike<number>, lastFrameDuration?: number) {
    const sorted = Float64Array.from(timestamps).sort();
    // Supprime les doublons éventuels (paquets à horodatage identique).
    const unique: number[] = [];
    for (const t of sorted) {
      const prev = unique[unique.length - 1];
      if (prev === undefined || t - prev > 1e-7) unique.push(t);
    }
    this.times = Float64Array.from(unique);
    const deltas: number[] = [];
    for (let i = 1; i < this.times.length; i++) deltas.push(this.times[i]! - this.times[i - 1]!);
    const median = medianOf(deltas);
    this.nominalFps = median > 0 ? roundFps(1 / median) : 30;
    this.variable = deltas.length > 2 && deltas.some((d) => Math.abs(d - median) > median * 0.25);
    this.lastFrameDuration = lastFrameDuration ?? (median > 0 ? median : 1 / 30);
  }

  /** Chronologie théorique à cadence constante (repli quand le conteneur est illisible). */
  static uniform(fps: number, durationS: number, start = 0): FrameTimeline {
    const count = Math.max(1, Math.floor(durationS * fps + 1e-6));
    const times = new Float64Array(count);
    for (let i = 0; i < count; i++) times[i] = start + i / fps;
    return new FrameTimeline(times, 1 / fps);
  }

  get frameCount(): number {
    return this.times.length;
  }

  get start(): number {
    return this.times[0] ?? 0;
  }

  get end(): number {
    return (this.times[this.times.length - 1] ?? 0) + this.lastFrameDuration;
  }

  get duration(): number {
    return this.end - this.start;
  }

  clamp(frame: number): number {
    return Math.min(Math.max(0, Math.round(frame)), Math.max(0, this.frameCount - 1));
  }

  timeOf(frame: number): number {
    return this.times[this.clamp(frame)] ?? 0;
  }

  /** Durée d'affichage de l'image (s). */
  durationOf(frame: number): number {
    const i = this.clamp(frame);
    const next = this.times[i + 1];
    return next !== undefined ? next - this.times[i]! : this.lastFrameDuration;
  }

  /** Image affichée à l'instant t : la dernière dont l'horodatage est ≤ t. */
  frameAt(t: number): number {
    const times = this.times;
    if (times.length === 0) return 0;
    let lo = 0;
    let hi = times.length - 1;
    if (t < times[0]! + 1e-6) return 0;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (times[mid]! <= t + 1e-6) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** Image dont l'horodatage est le plus proche de t. */
  nearestFrame(t: number): number {
    const i = this.frameAt(t);
    const next = this.times[i + 1];
    if (next !== undefined && next - t < t - this.times[i]!) return i + 1;
    return i;
  }
}

function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Arrondit aux cadences usuelles (29,97 → 29,97 ; 59,94 ; 120 ; 240…). */
export function roundFps(fps: number): number {
  const common = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 90, 100, 119.88, 120, 180, 200, 239.76, 240, 480, 960];
  let best: number | undefined;
  for (const c of common) {
    const err = Math.abs(fps - c) / c;
    if (err < 0.004 && (best === undefined || err < Math.abs(fps - best) / best)) best = c;
  }
  if (best !== undefined) return best;
  return Math.round(fps * 100) / 100;
}

/**
 * Facteur à appliquer aux durées média pour obtenir des durées réelles.
 * Exemple : fichier à 30 i/s filmé à 240 i/s → facteur 30/240 = 0,125.
 */
export function realTimeScale(fileFps: number, captureFps?: number): number {
  if (!captureFps || captureFps <= 0 || fileFps <= 0) return 1;
  return fileFps / captureFps;
}

/** Marge d'erreur d'un instant pointé : ± une image, en millisecondes réelles. */
export function frameUncertaintyMs(fps: number): number {
  return fps > 0 ? 1000 / fps : NaN;
}
