import type { DisciplineId } from './disciplines.js';
import type { JumpEventDef } from './jumpspec.js';

/** Gabarit de lancer : événements attendus et garde-fous de plausibilité (à valider avec des entraîneurs). */
export interface ThrowSpec {
  id: Extract<DisciplineId, 'poids' | 'disque' | 'javelot' | 'marteau'>;
  label: string;
  /** Événements dans l'ordre attendu. */
  events: JumpEventDef[];
  plausible: {
    /** Vitesse de l'engin au lâcher (m/s). */
    releaseSpeed: [number, number];
    /** Angle de lâcher par rapport à l'horizontale (°). */
    releaseAngle: [number, number];
    /** Durée d'un tour de marteau (s). */
    turnS?: [number, number];
  };
  /** Nombre d'images après le lâcher utilisées pour ajuster la vitesse de l'engin. */
  releaseWindow: number;
  dataVersion: string;
}

const COMMON = { releaseWindow: 4, dataVersion: '2026.1' };
const release: JumpEventDef = { type: 'lacher', label: 'Lâcher', required: true, hint: 'Première image où l’engin a quitté la main.' };
const impact: JumpEventDef = { type: 'impact', label: 'Chute de l’engin', required: false, hint: 'Image du premier contact avec le sol. Position = distance mesurée (m).', position: 'distance' };

export const THROW_SPECS: ThrowSpec[] = [
  {
    id: 'poids',
    label: 'Poids',
    events: [
      { type: 'puissance', label: 'Position de puissance', required: true, hint: 'Engin au cou, poids sur la jambe arrière, avant la poussée.' },
      { type: 'blocage', label: 'Blocage', required: false, hint: 'Pied avant posé contre le butoir.' },
      { ...release, hint: 'Première image où l’engin a quitté la main. Position = hauteur de l’engin au lâcher (m), facultatif.', position: 'hauteur' },
      impact,
    ],
    plausible: { releaseSpeed: [6, 16], releaseAngle: [25, 50] },
    ...COMMON,
  },
  {
    id: 'disque',
    label: 'Disque',
    events: [
      { type: 'rotation', label: 'Début de rotation', required: true, hint: 'Première image du déplacement dans le cercle.' },
      { type: 'appui', label: 'Double appui', required: false, hint: 'Les deux pieds au sol avant le lâcher.', sided: true },
      { ...release, position: 'hauteur', hint: 'Première image où le disque a quitté la main. Position = hauteur (m), facultatif.' },
      impact,
    ],
    plausible: { releaseSpeed: [14, 30], releaseAngle: [25, 50] },
    ...COMMON,
  },
  {
    id: 'javelot',
    label: 'Javelot',
    events: [
      { type: 'pascroises', label: 'Début des pas croisés', required: true, hint: 'Premier pas croisé.' },
      { type: 'blocage', label: 'Blocage', required: true, hint: 'Pied avant (jambe de blocage) posé.' },
      { ...release, position: 'hauteur', hint: 'Première image où le javelot a quitté la main. Position = hauteur (m), facultatif.' },
      impact,
    ],
    plausible: { releaseSpeed: [18, 36], releaseAngle: [20, 50] },
    ...COMMON,
  },
  {
    id: 'marteau',
    label: 'Marteau',
    events: [
      { type: 'tour', label: 'Début de tour', required: true, hint: 'Une fois par tour, toujours au même point du tour (par exemple le point haut côté caméra).' },
      { type: 'pointbas', label: 'Point bas', required: false, hint: 'Image où le marteau est au plus bas.' },
      { ...release, position: 'hauteur', hint: 'Première image où le marteau a quitté la main. Position = hauteur (m), facultatif.' },
      impact,
    ],
    plausible: { releaseSpeed: [18, 32], releaseAngle: [30, 55], turnS: [0.4, 2.2] },
    ...COMMON,
  },
];

export function throwSpecFor(discipline: string): ThrowSpec | undefined {
  return THROW_SPECS.find((s) => s.id === discipline);
}
