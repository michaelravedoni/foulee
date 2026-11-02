import type { DisciplineId } from './disciplines.js';

/** Définition d'un événement attendu dans un saut : le gabarit de marquage. */
export interface JumpEventDef {
  type: string;
  label: string;
  required: boolean;
  /** Où placer le repère (aide affichée dans l'interface). */
  hint: string;
  sided?: boolean;
  /** Ce que représente le champ « position » de ce repère, s'il y en a un. */
  position?: 'distance' | 'hauteur';
}

export interface JumpSpec {
  id: Extract<DisciplineId, 'longueur' | 'triple' | 'hauteur' | 'perche'>;
  label: string;
  /** Événements dans l'ordre attendu. */
  events: JumpEventDef[];
  /** Noms des phases aériennes dans l'ordre (triple saut : trois). */
  flightPhases: string[];
  /** Nombre d'appuis au sol après l'élan (appel compris). */
  contactCount: number;
  contactMinFps: number;
  /** Garde-fous de plausibilité, à valider avec des entraîneurs. */
  plausible: {
    contactMs: [number, number];
    flightS: [number, number];
    stepHz: [number, number];
    speed: [number, number];
  };
  dataVersion: string;
}

const COMMON = { contactMinFps: 120, dataVersion: '2026.1' };
const APPROACH = { stepHz: [2.5, 5.5] as [number, number], speed: [3, 13] as [number, number] };

export const JUMP_SPECS: JumpSpec[] = [
  {
    id: 'longueur',
    label: 'Longueur',
    flightPhases: ['Vol'],
    contactCount: 1,
    events: [
      { type: 'appui', label: 'Appuis de l’élan', required: false, hint: 'Chaque appui des derniers pas avant la planche (G / D).', sided: true, position: 'distance' },
      { type: 'appel', label: 'Appel', required: true, hint: 'Première image où le pied touche la planche.', sided: true, position: 'distance' },
      { type: 'decollage', label: 'Décollage', required: true, hint: 'Première image sans contact du pied d’appel.', sided: true },
      { type: 'reception', label: 'Réception', required: true, hint: 'Premier contact avec le sable.', position: 'distance' },
    ],
    plausible: { contactMs: [80, 200], flightS: [0.4, 1.5], ...APPROACH },
    ...COMMON,
  },
  {
    id: 'triple',
    label: 'Triple saut',
    flightPhases: ['Saut d’élan', 'Foulée bondissante', 'Saut'],
    contactCount: 3,
    events: [
      { type: 'appui', label: 'Appuis de l’élan', required: false, hint: 'Les derniers pas avant la planche (G / D).', sided: true, position: 'distance' },
      { type: 'appel', label: 'Appel', required: true, hint: 'Pied sur la planche.', sided: true, position: 'distance' },
      { type: 'decollage', label: 'Décollage (3 fois)', required: true, hint: 'Après l’appel, puis après chaque réception du saut d’élan et de la foulée.', sided: true },
      { type: 'appui', label: 'Appuis intermédiaires', required: true, hint: 'Réception du saut d’élan, puis de la foulée bondissante.', sided: true, position: 'distance' },
      { type: 'reception', label: 'Réception', required: true, hint: 'Premier contact avec le sable.', position: 'distance' },
    ],
    plausible: { contactMs: [80, 220], flightS: [0.3, 1.2], ...APPROACH },
    ...COMMON,
  },
  {
    id: 'hauteur',
    label: 'Hauteur',
    flightPhases: ['Montée'],
    contactCount: 1,
    events: [
      { type: 'appui', label: 'Appuis de l’élan', required: false, hint: 'Les derniers appuis avant l’appel (G / D).', sided: true, position: 'distance' },
      { type: 'appel', label: 'Appel', required: true, hint: 'Pied d’appel au sol.', sided: true },
      { type: 'decollage', label: 'Décollage', required: true, hint: 'Pied d’appel qui quitte le sol.', sided: true },
      { type: 'sommet', label: 'Sommet', required: true, hint: 'Image où le centre de gravité est le plus haut (souvent à la barre).' },
      { type: 'barre', label: 'Passage de la barre', required: false, hint: 'Position = hauteur de la barre en mètres.', position: 'hauteur' },
      { type: 'reception', label: 'Réception', required: false, hint: 'Contact avec le tapis.' },
    ],
    plausible: { contactMs: [110, 260], flightS: [0.25, 0.9], ...APPROACH },
    ...COMMON,
  },
  {
    id: 'perche',
    label: 'Perche',
    flightPhases: ['Sur la perche'],
    contactCount: 1,
    events: [
      { type: 'appui', label: 'Appuis de l’élan', required: false, hint: 'Les derniers appuis avant la pose (G / D).', sided: true, position: 'distance' },
      { type: 'planter', label: 'Pose de la perche', required: true, hint: 'Image où la perche touche le fond du butoir.' },
      { type: 'appel', label: 'Appel', required: true, hint: 'Dernier appui au sol.', sided: true },
      { type: 'decollage', label: 'Décollage', required: true, hint: 'Pied qui quitte le sol.', sided: true },
      { type: 'lacher', label: 'Lâcher de la perche', required: true, hint: 'Image où les mains quittent la perche.' },
      { type: 'sommet', label: 'Sommet', required: true, hint: 'Centre de gravité au plus haut.' },
      { type: 'barre', label: 'Passage de la barre', required: false, hint: 'Position = hauteur de la barre en mètres.', position: 'hauteur' },
      { type: 'reception', label: 'Réception', required: false, hint: 'Contact avec le tapis.' },
    ],
    plausible: { contactMs: [80, 220], flightS: [0.5, 2.5], stepHz: [2.5, 5.5], speed: [3, 12] },
    ...COMMON,
  },
];

export function jumpSpecFor(discipline: string): JumpSpec | undefined {
  return JUMP_SPECS.find((s) => s.id === discipline);
}
