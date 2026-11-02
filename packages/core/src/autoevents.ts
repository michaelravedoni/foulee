import { LM, type Landmark, type PoseSample } from './pose.js';

/** Repère proposé par l'automatisme : à valider par le coach avant de devenir un événement. */
export interface SuggestedEvent {
  type: 'appui' | 'decollage';
  side: 'G' | 'D';
  frame: number;
  time: number;
  /** 0-1 : netteté du contact et visibilité du pied. */
  confidence: number;
}

export interface FootOptions {
  /** Fenêtre (s) sur laquelle on évalue le point haut et le point bas du pied. */
  windowS?: number;
  /** Fraction de la course verticale du pied considérée « au sol » (en bas). */
  groundFraction?: number;
  /** Durée minimale d'un contact (s). */
  minContactS?: number;
  /** Visibilité minimale du pied. */
  minVisibility?: number;
}

const DEFAULTS: Required<FootOptions> = { windowS: 0.5, groundFraction: 0.3, minContactS: 0.04, minVisibility: 0.4 };

function foot(lm: Landmark[] | null, side: 'G' | 'D'): { y: number; v: number } | null {
  if (!lm) return null;
  const ids = side === 'G' ? [LM.leftAnkle, LM.leftHeel, LM.leftFootIndex] : [LM.rightAnkle, LM.rightHeel, LM.rightFootIndex];
  const pts = ids.map((i) => lm[i]).filter((p): p is Landmark => !!p);
  if (!pts.length) return null;
  return { y: pts.reduce((s, p) => s + p.y, 0) / pts.length, v: Math.min(...pts.map((p) => p.v)) };
}

/**
 * Appuis et décollages d'après la hauteur de chaque pied dans l'image.
 * Un pied est « au sol » quand il est dans le bas de sa course locale (fenêtre glissante) ;
 * le début de cette phase est l'appui, la fin le décollage. Les phases trop courtes sont ignorées.
 * Caméra fixe ou panoramique : seule la hauteur dans l'image compte.
 */
export function suggestFootEvents(samples: readonly PoseSample[], options: FootOptions = {}): SuggestedEvent[] {
  const o = { ...DEFAULTS, ...options };
  const out: SuggestedEvent[] = [];
  const s = [...samples].sort((a, b) => a.frame - b.frame);
  if (s.length < 5) return out;
  const dt = (s[s.length - 1]!.time - s[0]!.time) / (s.length - 1 || 1);
  const half = Math.max(2, Math.round(o.windowS / 2 / Math.max(dt, 1e-6)));
  for (const side of ['G', 'D'] as const) {
    const raw = s.map((p) => foot(p.lm, side));
    // Lissage sur 3 points (valeurs manquantes conservées).
    const y: (number | null)[] = raw.map((r, i) => {
      if (!r || r.v < o.minVisibility) return null;
      const nb = [raw[i - 1], r, raw[i + 1]].filter((q): q is { y: number; v: number } => !!q && q.v >= o.minVisibility);
      return nb.reduce((a, q) => a + q.y, 0) / nb.length;
    });
    const ground: boolean[] = y.map((v, i) => {
      if (v === null) return false;
      let lo = Infinity;
      let hi = -Infinity;
      for (let j = Math.max(0, i - half); j <= Math.min(y.length - 1, i + half); j++) {
        const w = y[j];
        if (w === null || w === undefined) continue;
        if (w < lo) lo = w;
        if (w > hi) hi = w;
      }
      // Sans mouvement du pied dans la fenêtre, aucune phase de vol n'est observable.
      if (hi - lo < 0.02) return false;
      return v >= hi - (hi - lo) * o.groundFraction;
    });
    let i = 0;
    while (i < ground.length) {
      if (!ground[i]) {
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < ground.length && ground[j + 1]) j++;
      const dur = s[j]!.time - s[i]!.time + dt;
      // Un contact coupé par le début ou la fin de la vidéo n'a pas de borne fiable.
      const startsInside = i > 0;
      const endsInside = j < ground.length - 1;
      if (dur >= o.minContactS) {
        const vis = Math.min(...raw.slice(i, j + 1).map((r) => r?.v ?? 0));
        const conf = Math.max(0.1, Math.min(1, vis));
        if (startsInside) out.push({ type: 'appui', side, frame: s[i]!.frame, time: s[i]!.time, confidence: conf });
        if (endsInside) out.push({ type: 'decollage', side, frame: s[j + 1]!.frame, time: s[j + 1]!.time, confidence: conf });
      }
      i = j + 1;
    }
  }
  return out.sort((a, b) => a.frame - b.frame);
}
