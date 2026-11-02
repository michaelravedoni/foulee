/** Image en niveaux de gris, pour le suivi de motif. */
export interface Gray {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array | Float32Array;
}

export interface TrackResult {
  x: number;
  y: number;
  /** Corrélation normalisée (-1 à 1). En dessous de ~0,5 le motif est perdu. */
  score: number;
}

export interface TrackOptions {
  /** Demi-côté du motif suivi (px de l'image grise). */
  half?: number;
  /** Demi-côté de la zone de recherche autour de la position précédente. */
  search?: number;
}

/** Corrélation croisée normalisée du motif de `a` en (ax, ay) avec celui de `b` en (bx, by). */
function ncc(a: Gray, ax: number, ay: number, b: Gray, bx: number, by: number, half: number): number {
  let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  const n = (2 * half + 1) ** 2;
  for (let dy = -half; dy <= half; dy++) {
    const ra = (ay + dy) * a.width + ax;
    const rb = (by + dy) * b.width + bx;
    for (let dx = -half; dx <= half; dx++) {
      const va = a.data[ra + dx]!;
      const vb = b.data[rb + dx]!;
      sa += va; sb += vb; saa += va * va; sbb += vb * vb; sab += va * vb;
    }
  }
  const cov = sab - (sa * sb) / n;
  const va = saa - (sa * sa) / n;
  const vb = sbb - (sb * sb) / n;
  if (va < 1e-6 || vb < 1e-6) return 0;
  return cov / Math.sqrt(va * vb);
}

/**
 * Retrouve dans `next` le motif centré en (x, y) dans `prev`. Recherche entière puis
 * affinage sous-pixel par parabole. Renvoie null si le motif sort de l'image.
 */
export function trackTemplate(prev: Gray, next: Gray, x: number, y: number, options: TrackOptions = {}): TrackResult | null {
  const half = options.half ?? 8;
  const search = options.search ?? 14;
  const px = Math.round(x);
  const py = Math.round(y);
  const margin = half + 1;
  if (px < margin || py < margin || px >= prev.width - margin || py >= prev.height - margin) return null;
  let best = { x: px, y: py, s: -2 };
  const scores = new Map<string, number>();
  for (let dy = -search; dy <= search; dy++) {
    const cy = py + dy;
    if (cy < margin || cy >= next.height - margin) continue;
    for (let dx = -search; dx <= search; dx++) {
      const cx = px + dx;
      if (cx < margin || cx >= next.width - margin) continue;
      const s = ncc(prev, px, py, next, cx, cy, half);
      scores.set(`${cx},${cy}`, s);
      if (s > best.s) best = { x: cx, y: cy, s };
    }
  }
  if (best.s < -1) return null;
  const sub = (m: number, c: number, p: number) => {
    const d = m - 2 * c + p;
    return Math.abs(d) < 1e-9 ? 0 : Math.max(-0.5, Math.min(0.5, (0.5 * (m - p)) / d));
  };
  const l = scores.get(`${best.x - 1},${best.y}`);
  const r = scores.get(`${best.x + 1},${best.y}`);
  const u = scores.get(`${best.x},${best.y - 1}`);
  const d = scores.get(`${best.x},${best.y + 1}`);
  return {
    x: best.x + (l !== undefined && r !== undefined ? sub(l, best.s, r) : 0),
    y: best.y + (u !== undefined && d !== undefined ? sub(u, best.s, d) : 0),
    score: best.s,
  };
}
