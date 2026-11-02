import type { MarkedEvent } from './model.js';
import type { FrameTimeline } from './timeline.js';

export type KinogramMode = { mode: 'events'; types?: readonly string[] } | { mode: 'even'; count: number };

/**
 * Choisit les images d'un kinogramme : soit celles des repères marqués
 * (semi-manuel), soit des images régulières entre le premier et le dernier repère
 * (ou sur toute la vidéo s'il y a moins de deux repères).
 */
export function kinogramFrames(events: readonly MarkedEvent[], tl: FrameTimeline, spec: KinogramMode): number[] {
  if (spec.mode === 'events') {
    const frames = events.filter((e) => !spec.types || spec.types.includes(e.type)).map((e) => tl.clamp(e.frame));
    return [...new Set(frames)].sort((a, b) => a - b);
  }
  const count = Math.max(1, Math.round(spec.count));
  const frames = events.map((e) => e.frame).sort((a, b) => a - b);
  const from = frames.length >= 2 ? frames[0]! : 0;
  const to = frames.length >= 2 ? frames[frames.length - 1]! : tl.frameCount - 1;
  if (count === 1) return [tl.clamp(Math.round((from + to) / 2))];
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(tl.clamp(Math.round(from + ((to - from) * i) / (count - 1))));
  return [...new Set(out)];
}

/** Disposition en grille : colonnes et lignes pour `n` images. */
export function gridLayout(n: number, maxCols = 4): { cols: number; rows: number } {
  const cols = Math.max(1, Math.min(maxCols, n));
  return { cols, rows: Math.max(1, Math.ceil(n / cols)) };
}
