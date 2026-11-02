/** Vitesse du son dans l'air (m/s), à ~20 °C. */
export const SPEED_OF_SOUND = 343;

/** Retard du son entre le pistolet et le micro, en secondes. */
export function soundDelaySeconds(distanceM: number, speed = SPEED_OF_SOUND): number {
  return distanceM > 0 ? distanceM / speed : 0;
}

/** Enveloppe de crête : le plus grand |échantillon| de chaque pas de `hopS` secondes. */
export function peakEnvelope(samples: ArrayLike<number>, sampleRate: number, hopS: number): Float32Array {
  const hop = Math.max(1, Math.round(sampleRate * hopS));
  const out = new Float32Array(Math.ceil(samples.length / hop));
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]!);
    const k = Math.floor(i / hop);
    if (v > out[k]!) out[k] = v;
  }
  return out;
}

export interface SoundOnset {
  /** Début du son, en secondes (même repère que `startS`). */
  time: number;
  /** Niveau de crête (0–1). */
  peak: number;
  /** Rapport crête / seuil : plus il est grand, plus la détection est sûre. */
  ratio: number;
}

export interface OnsetOptions {
  /** Nombre d'écarts-types de bruit au-dessus de la médiane. */
  k?: number;
  /** Séparation minimale entre deux sons (s). */
  refractoryS?: number;
  maxCount?: number;
  /** En dessous, l'enregistrement est jugé silencieux. */
  minPeak?: number;
}

function median(values: ArrayLike<number>): number {
  const a = Array.from(values).sort((x, y) => x - y);
  return a.length ? a[Math.floor(a.length / 2)]! : 0;
}

/**
 * Détecte les attaques sonores (coup de pistolet, claquement de clap) dans une
 * enveloppe de crête. Le seuil s'adapte au bruit de fond ; les candidats sont
 * triés du plus fort au plus faible.
 */
export function detectOnsets(env: ArrayLike<number>, hopS: number, startS = 0, options: OnsetOptions = {}): SoundOnset[] {
  const { k = 8, refractoryS = 0.5, maxCount = 5, minPeak = 0.02 } = options;
  const n = env.length;
  if (n === 0) return [];
  let max = 0;
  for (let i = 0; i < n; i++) if (env[i]! > max) max = env[i]!;
  if (max < minPeak) return [];
  const base = median(env);
  const mad = Math.max(1e-4, median(Array.from(env, (v) => Math.abs(v - base))) * 1.4826);
  const threshold = base + Math.max(k * mad, 0.15 * max);
  const quiet = base + 2 * mad;
  const gap = Math.max(1, Math.round(refractoryS / hopS));

  const onsets: SoundOnset[] = [];
  let i = 0;
  while (i < n) {
    if (env[i]! <= threshold) {
      i++;
      continue;
    }
    let first = i;
    let peak = env[i]!;
    let last = i;
    let j = i + 1;
    while (j < n && j - last <= gap) {
      if (env[j]! > threshold) {
        last = j;
        if (env[j]! > peak) peak = env[j]!;
      }
      j++;
    }
    while (first > 0 && env[first - 1]! > quiet) first--;
    onsets.push({ time: startS + first * hopS, peak, ratio: peak / threshold });
    i = last + 1;
  }
  return onsets.sort((a, b) => b.peak - a.peak).slice(0, maxCount);
}
