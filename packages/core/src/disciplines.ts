/** Épreuves couvertes par Foulée (le moteur de spécifications arrive en phase 3). */
export const DISCIPLINES = [
  { id: '100m', label: '100 m', family: 'sprint' },
  { id: '200m', label: '200 m', family: 'sprint' },
  { id: '400m', label: '400 m', family: 'sprint' },
  { id: '100mh', label: '100 m haies', family: 'haies' },
  { id: '110mh', label: '110 m haies', family: 'haies' },
  { id: '400mh', label: '400 m haies', family: 'haies' },
  { id: 'longueur', label: 'Longueur', family: 'sauts' },
  { id: 'triple', label: 'Triple saut', family: 'sauts' },
  { id: 'hauteur', label: 'Hauteur', family: 'sauts' },
  { id: 'perche', label: 'Perche', family: 'sauts' },
  { id: 'poids', label: 'Poids', family: 'lancers' },
  { id: 'disque', label: 'Disque', family: 'lancers' },
  { id: 'javelot', label: 'Javelot', family: 'lancers' },
  { id: 'marteau', label: 'Marteau', family: 'lancers' },
  { id: 'autre', label: 'Autre / exercice', family: 'autre' },
] as const;

export type DisciplineId = (typeof DISCIPLINES)[number]['id'];
export type DisciplineFamily = (typeof DISCIPLINES)[number]['family'];

export function disciplineLabel(id: string): string {
  return DISCIPLINES.find((d) => d.id === id)?.label ?? id;
}

export function isDisciplineId(value: unknown): value is DisciplineId {
  return typeof value === 'string' && DISCIPLINES.some((d) => d.id === value);
}
