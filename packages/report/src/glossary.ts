export interface GlossaryEntry {
  id: string;
  term: string;
  definition: string;
}

/** Glossaire pédagogique. Chaque rapport n'imprime que les termes qu'il utilise. */
export const GLOSSARY: GlossaryEntry[] = [
  { id: 'split', term: 'Split (temps de section)', definition: 'Temps mis pour parcourir une partie de la course, par exemple entre 30 m et 40 m.' },
  { id: 'cumule', term: 'Temps cumulé', definition: 'Temps écoulé depuis le départ jusqu’à un repère.' },
  { id: 'vmax', term: 'Vmax', definition: 'Vitesse maximale que l’athlète peut atteindre, estimée par le modèle d’accélération.' },
  { id: 'tau', term: 'tau (τ)', definition: 'Durée caractéristique de l’accélération : plus tau est petit, plus l’athlète atteint vite sa vitesse maximale.' },
  { id: 'f0', term: 'F0', definition: 'Force relative au départ (Vmax / tau), en newtons par kilo. Indique la capacité à accélérer.' },
  { id: 'pmax', term: 'Pmax', definition: 'Puissance relative maximale (F0 × Vmax / 4), en watts par kilo.' },
  { id: 'frequence', term: 'Fréquence de pas', definition: 'Nombre de pas par seconde. Elle varie avec la vitesse et la longueur de pas.' },
  { id: 'contact', term: 'Temps de contact', definition: 'Durée pendant laquelle le pied reste au sol. Fiable seulement avec une vidéo à haute cadence.' },
  { id: 'vol', term: 'Temps de vol', definition: 'Durée entre le décollage d’un pied et l’appui du suivant.' },
  { id: 'marge', term: 'Marge d’erreur (±)', definition: 'Écart possible lié à la vidéo : une image au plus pour un temps, le pointage et l’étalon pour une distance.' },
  { id: 'etalon', term: 'Étalon', definition: 'Segment de longueur connue dans l’image, qui sert à convertir les pixels en mètres.' },
];

export function glossaryFor(ids: readonly string[]): GlossaryEntry[] {
  return GLOSSARY.filter((g) => ids.includes(g.id));
}
