/**
 * Pose du corps : 33 points (convention MediaPipe / BlazePose), coordonnées normalisées
 * dans l'image (0-1, y vers le bas). L'interface est indépendante du modèle : on peut
 * changer de moteur sans toucher au reste.
 */
export interface Landmark {
  x: number;
  y: number;
  /** Visibilité estimée (0-1). */
  v: number;
}

export const LM = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFootIndex: 31,
  rightFootIndex: 32,
} as const;

/** Squelette dessiné par l'application : paires de points reliés. */
export const SKELETON: readonly (readonly [number, number])[] = [
  [11, 12], [11, 23], [12, 24], [23, 24],
  [11, 13], [13, 15], [12, 14], [14, 16],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31],
  [24, 26], [26, 28], [28, 30], [30, 32], [28, 32],
];

/** Pose détectée sur une image (null si personne n'est trouvé). */
export interface PoseSample {
  frame: number;
  /** Instant de l'image (s). */
  time: number;
  lm: Landmark[] | null;
}

/** Distance entre deux points en coordonnées normalisées corrigées du format de l'image. */
export function lmDistance(a: Landmark, b: Landmark, aspect: number): number {
  return Math.hypot((a.x - b.x) * aspect, a.y - b.y);
}

/** Angle (°) du segment a→b par rapport à la verticale (0 = vertical, positif vers la droite de l'image). */
export function segmentTilt(a: Landmark, b: Landmark, aspect: number): number {
  return (Math.atan2((b.x - a.x) * aspect, b.y - a.y) * 180) / Math.PI;
}
