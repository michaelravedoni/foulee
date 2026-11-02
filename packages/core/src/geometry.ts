import type { Annotation, Point } from './model.js';

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Angle ABC (sommet B) en degrés, entre 0 et 180. */
export function angleAt(a: Point, b: Point, c: Point): number {
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const n = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
  if (n === 0) return NaN;
  const cos = Math.min(1, Math.max(-1, (v1.x * v2.x + v1.y * v2.y) / n));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** Les deux branches d'une pointe de flèche à l'extrémité `to`. */
export function arrowHead(from: Point, to: Point, size: number): [Point, Point] {
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  const spread = Math.PI / 7;
  return [
    { x: to.x - size * Math.cos(ang - spread), y: to.y - size * Math.sin(ang - spread) },
    { x: to.x - size * Math.cos(ang + spread), y: to.y - size * Math.sin(ang + spread) },
  ];
}

/** Simplifie un tracé à main levée (Ramer–Douglas–Peucker). */
export function simplifyPath(points: Point[], tolerance: number): Point[] {
  if (points.length <= 2) return points.slice();
  const first = points[0]!;
  const last = points[points.length - 1]!;
  let maxDist = -1;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = pointSegmentDistance(points[i]!, first, last);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }
  if (maxDist <= tolerance) return [first, last];
  const left = simplifyPath(points.slice(0, index + 1), tolerance);
  const right = simplifyPath(points.slice(index), tolerance);
  return [...left.slice(0, -1), ...right];
}

export function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/** Une annotation est-elle visible à l'image `frame` ? */
export function isAnnotationVisible(a: Annotation, frame: number): boolean {
  if (a.holdFrames === null) return true;
  return frame >= a.frame && frame <= a.frame + a.holdFrames;
}

/** Distance minimale d'un point à une annotation (pour la sélection / gomme). */
export function hitDistance(a: Annotation, p: Point): number {
  const pts = a.points;
  if (pts.length === 0) return Infinity;
  if (a.kind === 'cercle' && pts.length >= 2) {
    const r = distance(pts[0]!, pts[1]!);
    return Math.abs(distance(pts[0]!, p) - r);
  }
  if (a.kind === 'rectangle' && pts.length >= 2) {
    const [p0, p1] = [pts[0]!, pts[1]!];
    const c = [p0, { x: p1.x, y: p0.y }, p1, { x: p0.x, y: p1.y }];
    return Math.min(...c.map((q, i) => pointSegmentDistance(p, q, c[(i + 1) % 4]!)));
  }
  if (pts.length === 1) return distance(pts[0]!, p);
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) best = Math.min(best, pointSegmentDistance(p, pts[i - 1]!, pts[i]!));
  return best;
}
