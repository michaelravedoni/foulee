/**
 * Types d'événements génériques de la phase 1. Les spécifications d'épreuves
 * (phase 3) ajouteront des types propres à chaque épreuve, avec contraintes
 * d'ordre et phases.
 */
export const BASIC_EVENT_TYPES = [
  { id: 'depart', label: 'Départ', key: 'd', sided: false },
  { id: 'appui', label: 'Appui', key: 'a', sided: true },
  { id: 'decollage', label: 'Décollage', key: 'z', sided: true },
  { id: 'haie', label: 'Haie', key: 'h', sided: false },
  { id: 'passage', label: 'Passage repère', key: 'p', sided: false },
  { id: 'appel', label: 'Appel', key: 'c', sided: true },
  { id: 'lacher', label: 'Lâcher', key: 'l', sided: false },
  { id: 'arrivee', label: 'Arrivée', key: 'r', sided: false },
  { id: 'repere', label: 'Repère libre', key: 'm', sided: false },
] as const;

export type BasicEventType = (typeof BASIC_EVENT_TYPES)[number]['id'];

export function eventLabel(type: string, side?: 'G' | 'D'): string {
  const base = BASIC_EVENT_TYPES.find((t) => t.id === type)?.label ?? type;
  return side ? `${base} ${side}` : base;
}
