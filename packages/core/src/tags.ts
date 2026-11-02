import type { Trial } from './model.js';
import { disciplineLabel } from './disciplines.js';

/** Tags rapides du mode Terrain, posés en un geste. */
export const QUICK_TAGS = ['essai valide', 'faute', 'à revoir', 'meilleur'] as const;

export const SURFACE_LABELS = {
  synthetique: 'Synthétique',
  halle: 'Piste de halle',
  herbe: 'Herbe',
  route: 'Route',
  autre: 'Autre',
} as const;

export const SHOES_LABELS = { pointes: 'Pointes', baskets: 'Baskets', autre: 'Autre' } as const;
export const LIGHTING_LABELS = { halle: 'Halle éclairée', jour: 'Jour', soir: 'Soir', nuit: 'Nuit' } as const;
export const CAMERA_LABELS = { fixe: 'Caméra fixe', panoramique: 'Panoramique' } as const;
export const VENUE_LABELS = { halle: 'Halle', stade: 'Stade', autre: 'Autre' } as const;

/** Normalise un tag libre : minuscules, espaces simplifiés. */
export function normalizeTag(tag: string): string {
  return tag.trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr');
}

export function addTag(tags: readonly string[], tag: string): string[] {
  const t = normalizeTag(tag);
  if (!t || tags.includes(t)) return [...tags];
  return [...tags, t];
}

export function toggleTag(tags: readonly string[], tag: string): string[] {
  const t = normalizeTag(tag);
  return tags.includes(t) ? tags.filter((x) => x !== t) : addTag(tags, t);
}

/** Classe de cadence affichée comme tag automatique. */
export function cadenceTag(fps: number): string {
  if (!(fps > 0)) return 'cadence inconnue';
  if (fps < 45) return '≤ 30 i/s';
  if (fps < 90) return '60 i/s';
  if (fps < 180) return '120 i/s';
  return '240 i/s et +';
}

/**
 * Tags dérivés des champs structurés de l'essai (épreuve, surface, chaussures,
 * éclairage, cadence). Ils ne sont pas stockés : ils sont recalculés.
 */
export function derivedTags(trial: Trial, fps?: number): string[] {
  const out = [disciplineLabel(trial.discipline)];
  if (trial.surface) out.push(SURFACE_LABELS[trial.surface]);
  if (trial.shoes) out.push(SHOES_LABELS[trial.shoes]);
  if (trial.lighting) out.push(LIGHTING_LABELS[trial.lighting]);
  if (trial.camera) out.push(CAMERA_LABELS[trial.camera]);
  const effective = trial.captureFps ?? fps;
  if (effective !== undefined) out.push(cadenceTag(effective));
  return out.map(normalizeTag);
}

export function matchesQuery(haystack: readonly (string | undefined)[], query: string): boolean {
  const q = normalizeSearch(query);
  if (!q) return true;
  const text = normalizeSearch(haystack.filter(Boolean).join(' '));
  return q.split(' ').every((part) => text.includes(part));
}

function normalizeSearch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('fr')
    .replace(/\s+/g, ' ')
    .trim();
}
