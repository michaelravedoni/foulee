/**
 * Logique pure de la lecture : quand afficher une image, laquelle sauter.
 * Les temps sont en secondes (média) et en millisecondes (horloge murale).
 */

export const MIN_RATE = 0.05;
export const MAX_RATE = 4;
export const RATES = [0.05, 0.1, 0.25, 0.5, 1, 2] as const;

export function clampRate(rate: number): number {
  return Math.min(MAX_RATE, Math.max(MIN_RATE, rate));
}

/** Vitesse suivante / précédente dans la liste des vitesses proposées. */
export function stepRate(rate: number, direction: 1 | -1): number {
  const list = RATES as readonly number[];
  let i = list.findIndex((r) => r >= rate - 1e-9);
  if (i < 0) i = list.length - 1;
  if (direction === 1 && Math.abs((list[i] ?? 0) - rate) < 1e-9) i++;
  else if (direction === -1) i--;
  return list[Math.min(list.length - 1, Math.max(0, i))]!;
}

/** Instant mural (ms) où l'image d'horodatage `ts` doit apparaître. */
export function dueTime(wallStartMs: number, mediaStartS: number, ts: number, rate: number): number {
  return wallStartMs + ((ts - mediaStartS) / rate) * 1000;
}

export interface DropState {
  /** Instant mural de la dernière image affichée (ms). */
  lastShownMs: number;
}

/**
 * Faut-il sauter cette image parce que le décodage a pris du retard ?
 * On saute les images en retard de plus d'une durée d'affichage, mais jamais
 * plus de `maxGapMs` d'affilée : l'écran ne reste pas figé.
 */
export function shouldDrop(nowMs: number, dueMs: number, frameDurationMs: number, state: DropState, maxGapMs = 120): boolean {
  const late = nowMs - dueMs;
  if (late <= Math.max(frameDurationMs, 8)) return false;
  return nowMs - state.lastShownMs < maxGapMs;
}

export interface LoopRange {
  a: number;
  b: number;
}

/** Image de fin effective d'une lecture (borne de boucle ou dernière image). */
export function endFrameOf(loop: LoopRange | null, lastFrame: number): number {
  return loop ? Math.min(loop.b, lastFrame) : lastFrame;
}

/** Normalise une boucle (A < B, bornes dans la vidéo) ; null si incomplète. */
export function normalizeLoop(a: number | null, b: number | null, lastFrame: number): LoopRange | null {
  if (a === null || b === null) return null;
  const lo = Math.max(0, Math.min(a, b));
  const hi = Math.min(lastFrame, Math.max(a, b));
  return hi > lo ? { a: lo, b: hi } : null;
}
