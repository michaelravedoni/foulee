import { trackTemplate, type Gray, type TrackPoint } from '@foulee/core';
import type { FrameImage } from './frame-source.js';

/** Convertit une image en niveaux de gris, réduite à `maxSide` pour rester rapide. */
export function toGray(img: FrameImage, maxSide = 960): Gray & { scale: number } {
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const data = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; i < data.length; i++, j += 4) data[i] = (rgba[j]! * 77 + rgba[j + 1]! * 150 + rgba[j + 2]! * 29) >> 8;
  return { width: w, height: h, data, scale };
}

export interface FollowOptions {
  toFrame: number;
  /** Largeur de la vidéo (px) : les points sont exprimés dans ce repère. */
  videoWidth: number;
  /** Score minimal pour continuer (0-1). */
  minScore?: number;
  signal?: AbortSignal;
  onProgress?: (frame: number) => void;
}

export interface FollowResult {
  points: TrackPoint[];
  /** Raison de l'arrêt. */
  stopped: 'fin' | 'perdu' | 'bord' | 'annule';
  lastScore: number;
}

/**
 * Suit un point image par image à partir de `start`, par corrélation de motif.
 * Le motif est renouvelé à chaque image (suit les changements d'aspect) ; le suivi s'arrête
 * quand la corrélation tombe sous `minScore` plutôt que d'inventer une position.
 */
export async function followPoint(
  grab: (frame: number) => Promise<FrameImage | null | undefined>,
  start: TrackPoint,
  opts: FollowOptions,
): Promise<FollowResult> {
  const minScore = opts.minScore ?? 0.55;
  const first = await grab(start.frame);
  if (!first) return { points: [], stopped: 'perdu', lastScore: 0 };
  let prev = toGray(first);
  const k = prev.scale * (first.width / opts.videoWidth);
  let x = start.x * k;
  let y = start.y * k;
  const points: TrackPoint[] = [];
  let lastScore = 1;
  const dir = opts.toFrame >= start.frame ? 1 : -1;
  for (let f = start.frame + dir; dir > 0 ? f <= opts.toFrame : f >= opts.toFrame; f += dir) {
    if (opts.signal?.aborted) return { points, stopped: 'annule', lastScore };
    const img = await grab(f);
    if (!img) break;
    const next = toGray(img);
    const r = trackTemplate(prev, next, x, y, { half: Math.max(6, Math.round(next.width / 120)), search: Math.max(10, Math.round(next.width / 45)) });
    if (!r) return { points, stopped: 'bord', lastScore };
    if (r.score < minScore) return { points, stopped: 'perdu', lastScore: r.score };
    lastScore = r.score;
    x = r.x;
    y = r.y;
    points.push({ frame: f, x: x / k, y: y / k });
    prev = next;
    opts.onProgress?.(f);
  }
  return { points, stopped: 'fin', lastScore };
}
