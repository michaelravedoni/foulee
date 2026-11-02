import type { DisciplineId } from './disciplines.js';

/** Version du schéma des entités, écrite dans chaque fichier JSON du coffre. */
export const SCHEMA = {
  athlete: 'athlete@1',
  session: 'session@1',
  trial: 'trial@1',
  analysis: 'analysis@1',
  media: 'media@1',
} as const;

export type EntityKind = keyof typeof SCHEMA;

/** Champs communs à toutes les entités du coffre. Dates en ISO 8601 (UTC). */
export interface EntityBase {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** Présent si l'entité est dans la corbeille. */
  deletedAt?: string;
}

export interface Athlete extends EntityBase {
  schema: typeof SCHEMA.athlete;
  firstName: string;
  lastName: string;
  /** AAAA-MM-JJ */
  birthDate?: string;
  /** Sexe pour les normes par catégorie (optionnel). */
  sex?: 'F' | 'M';
  tags: string[];
  notes: string;
  favorite: boolean;
}

export type Venue = 'halle' | 'stade' | 'autre';
export type Lighting = 'halle' | 'jour' | 'soir' | 'nuit';
export type Surface = 'synthetique' | 'halle' | 'herbe' | 'route' | 'autre';
export type Shoes = 'pointes' | 'baskets' | 'autre';
export type CameraMode = 'fixe' | 'panoramique';

export interface TrainingSession extends EntityBase {
  schema: typeof SCHEMA.session;
  /** AAAA-MM-JJ */
  date: string;
  title: string;
  place: string;
  venue?: Venue;
  lighting?: Lighting;
  surface?: Surface;
  weather?: string;
  notes: string;
  tags: string[];
  favorite: boolean;
}

export interface Trial extends EntityBase {
  schema: typeof SCHEMA.trial;
  sessionId: string;
  athleteId: string;
  discipline: DisciplineId;
  /** Ordre dans la séance (1, 2, 3…). */
  number: number;
  /** Empreinte SHA-256 de la vidéo originale (clé du média dans le coffre). */
  mediaHash?: string;
  camera?: CameraMode;
  shoes?: Shoes;
  surface?: Surface;
  lighting?: Lighting;
  /**
   * Cadence de prise de vue réelle, si elle diffère de la cadence du fichier
   * (ex. ralenti iPhone ré-encodé à 30 i/s alors qu'il a été filmé à 240 i/s).
   */
  captureFps?: number;
  officialResult?: string;
  tags: string[];
  notes: string;
  favorite: boolean;
}

/** Métadonnées d'un média, stockées à côté du fichier : media/<sha256>.json */
export interface MediaInfo {
  schema: typeof SCHEMA.media;
  hash: string;
  mime: string;
  ext: string;
  size: number;
  originalName: string;
  importedAt: string;
  width: number;
  height: number;
  rotation: number;
  durationS: number;
  codec?: string;
  frameCount: number;
  /** Cadence nominale du fichier (médiane des écarts entre images). */
  nominalFps: number;
  /** Vrai si les écarts entre images varient (ex. ralentis iPhone). */
  variableFrameRate: boolean;
  /** Empreinte du proxy basse résolution, s'il existe. */
  proxyHash?: string;
}

export type EventSource = 'manuel' | 'auto';

/** Événement marqué dans la vidéo (appui, départ, lâcher…). */
export interface MarkedEvent {
  id: string;
  type: string;
  side?: 'G' | 'D';
  frame: number;
  /** Temps média (s) de l'image, pour lecture sans l'application. */
  time: number;
  source: EventSource;
  confidence: number;
  label?: string;
  /** Position le long de la piste, en mètres depuis le départ (saisie par l'utilisateur). */
  position?: number;
}

export type ShapeKind = 'ligne' | 'fleche' | 'main' | 'cercle' | 'rectangle' | 'texte' | 'angle';

export interface Point {
  x: number;
  y: number;
}

/** Dessin. Coordonnées en pixels de l'image vidéo (après rotation). */
export interface Annotation {
  id: string;
  kind: ShapeKind;
  points: Point[];
  text?: string;
  color: string;
  width: number;
  /** Image d'ancrage. */
  frame: number;
  /** Durée d'affichage après l'image d'ancrage, en images ; null = toujours visible. */
  holdFrames: number | null;
}

/** Étalon : segment de longueur connue dans le plan de course (pixels de l'image). */
export interface Calibration {
  a: Point;
  b: Point;
  /** Longueur réelle du segment, en mètres. */
  meters: number;
  /** Incertitude de pointage supposée, en pixels. */
  clickErrorPx: number;
}

/** Position d'un point suivi à une image donnée. */
export interface TrackPoint {
  frame: number;
  x: number;
  y: number;
}

/** Trajectoire pointée à la main, image par image. */
export interface Trajectory {
  id: string;
  label: string;
  color: string;
  points: TrackPoint[];
}

export interface Analysis {
  schema: typeof SCHEMA.analysis;
  trialId: string;
  updatedAt: string;
  /** Image définie comme t = 0 (origine du temps). */
  timeOrigin: number;
  events: MarkedEvent[];
  annotations: Annotation[];
  /** Étalon pour les mesures en mètres (phase 2). Absent = mesures en pixels uniquement. */
  calibration?: Calibration;
  /** Trajectoires pointées (phase 2). */
  trajectories?: Trajectory[];
  /** Calque de dessin verrouillé. */
  locked: boolean;
}

export function nowIso(now: Date = new Date()): string {
  return now.toISOString();
}

export function athleteName(a: Pick<Athlete, 'firstName' | 'lastName'>): string {
  return `${a.firstName} ${a.lastName}`.trim();
}
