/**
 * Tables de normes par catégorie (références de niveau). Foulée n'embarque AUCUNE valeur de norme :
 * le coach importe un tableau qu'il a vérifié à la source (Swiss Athletics ou autre). Chaque tableau
 * porte sa provenance et son état de vérification, affichés partout où il sert.
 */
export const NORMS_SCHEMA = 'norms@1';

export interface NormCategory {
  id: string;
  label: string;
  /** Âge atteint dans l'année de la saison (règle d'athlétisme) : bornes incluses. */
  minAge: number;
  maxAge: number;
}

export interface NormLevel {
  label: string;
  /** Valeur seuil à atteindre (secondes pour un temps, mètres pour une distance ou une hauteur). */
  value: number;
}

export interface NormEntry {
  discipline: string;
  /** Identifiant de catégorie (voir `categories`). */
  category: string;
  sex: 'F' | 'M';
  /** Niveaux du moins exigeant au plus exigeant. */
  levels: NormLevel[];
}

export interface NormTable {
  schema: typeof NORMS_SCHEMA;
  id: string;
  title: string;
  source: { name: string; url?: string; season: string; retrievedAt?: string };
  /** Renseigné par le coach quand il a contrôlé les valeurs à la source officielle. */
  verified?: { by: string; at: string };
  categories: NormCategory[];
  entries: NormEntry[];
}

export class NormError extends Error {}

const fail = (msg: string): never => {
  throw new NormError(msg);
};
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, name: string): string => (typeof v === 'string' && v.trim() ? v.trim() : fail(`« ${name} » est obligatoire (texte).`));
const num = (v: unknown, name: string): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fail(`« ${name} » doit être un nombre positif.`));

/** Valide un tableau de normes importé ; lève une NormError au message lisible. */
export function parseNormTable(raw: unknown): NormTable {
  if (!isObj(raw)) return fail('Le fichier n’est pas un tableau de normes (objet JSON attendu).');
  if (raw.schema !== NORMS_SCHEMA) fail(`Format inconnu : « schema » doit valoir « ${NORMS_SCHEMA} ».`);
  const id = str(raw.id, 'id');
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) fail('« id » : minuscules, chiffres, tirets (64 caractères au plus).');
  const src = isObj(raw.source) ? raw.source : fail('« source » est obligatoire (nom, saison).');
  const source: NormTable['source'] = { name: str(src.name, 'source.name'), season: str(src.season, 'source.season') };
  if (typeof src.url === 'string' && src.url) source.url = src.url;
  if (typeof src.retrievedAt === 'string' && src.retrievedAt) source.retrievedAt = src.retrievedAt;
  const catsRaw = Array.isArray(raw.categories) && raw.categories.length ? raw.categories : fail('« categories » : au moins une catégorie.');
  const categories: NormCategory[] = (catsRaw as unknown[]).map((c, i) => {
    const o = isObj(c) ? c : fail(`categories[${i}] : objet attendu.`);
    const minAge = num(o.minAge, `categories[${i}].minAge`);
    const maxAge = num(o.maxAge, `categories[${i}].maxAge`);
    if (maxAge < minAge) fail(`categories[${i}] : maxAge < minAge.`);
    return { id: str(o.id, `categories[${i}].id`), label: str(o.label, `categories[${i}].label`), minAge, maxAge };
  });
  if (new Set(categories.map((c) => c.id)).size !== categories.length) fail('« categories » : identifiants en double.');
  const entRaw = Array.isArray(raw.entries) && raw.entries.length ? raw.entries : fail('« entries » : au moins une ligne.');
  const entries: NormEntry[] = (entRaw as unknown[]).map((e, i) => {
    const o = isObj(e) ? e : fail(`entries[${i}] : objet attendu.`);
    const category = str(o.category, `entries[${i}].category`);
    if (!categories.some((c) => c.id === category)) fail(`entries[${i}] : catégorie « ${category} » absente de « categories ».`);
    if (o.sex !== 'F' && o.sex !== 'M') fail(`entries[${i}].sex doit valoir « F » ou « M ».`);
    const lv = Array.isArray(o.levels) && o.levels.length ? o.levels : fail(`entries[${i}].levels : au moins un niveau.`);
    const levels = (lv as unknown[]).map((l, j) => {
      const lo = isObj(l) ? l : fail(`entries[${i}].levels[${j}] : objet attendu.`);
      return { label: str(lo.label, `entries[${i}].levels[${j}].label`), value: num(lo.value, `entries[${i}].levels[${j}].value`) };
    });
    return { discipline: str(o.discipline, `entries[${i}].discipline`), category, sex: o.sex as 'F' | 'M', levels };
  });
  const table: NormTable = { schema: NORMS_SCHEMA, id, title: str(raw.title, 'title'), source, categories, entries };
  if (isObj(raw.verified)) table.verified = { by: str(raw.verified.by, 'verified.by'), at: str(raw.verified.at, 'verified.at') };
  return table;
}

/** Catégorie d'un athlète pour une saison : âge atteint dans l'année (année de la saison − année de naissance). */
export function categoryFor(table: NormTable, birthDate: string | undefined, seasonYear: number): NormCategory | undefined {
  const y = Number(birthDate?.slice(0, 4));
  if (!Number.isFinite(y) || y < 1900) return undefined;
  const age = seasonYear - y;
  return table.categories.find((c) => age >= c.minAge && age <= c.maxAge);
}

/** Disciplines dont le résultat est un temps (plus petit = meilleur). */
export const TIME_DISCIPLINES = new Set(['100m', '200m', '400m', '100mh', '110mh', '400mh']);
export const isTimeDiscipline = (d: string) => TIME_DISCIPLINES.has(d);

export interface NormRating {
  entry: NormEntry;
  category: NormCategory;
  /** Plus haut niveau atteint (null si aucun). */
  reached: NormLevel | null;
  /** Niveau suivant et écart restant (valeur absolue, même unité). */
  next: { level: NormLevel; gap: number } | null;
  /** Vrai si le niveau dépend de la marge d'erreur de la mesure (le seuil est dans l'intervalle). */
  uncertain: boolean;
}

/**
 * Compare un résultat à la norme de l'athlète. Pour un temps, un niveau est atteint si `valeur ≤ seuil` ;
 * sinon `valeur ≥ seuil`. Si le seuil tombe dans l'intervalle valeur ± marge, le résultat est signalé incertain.
 */
export function rateAgainst(
  table: NormTable,
  discipline: string,
  sex: 'F' | 'M',
  category: NormCategory,
  value: number,
  margin: number,
): NormRating | undefined {
  const entry = table.entries.find((e) => e.discipline === discipline && e.sex === sex && e.category === category.id);
  if (!entry) return undefined;
  const lowerBetter = isTimeDiscipline(discipline);
  const ok = (v: number, thr: number) => (lowerBetter ? v <= thr : v >= thr);
  const levels = [...entry.levels].sort((a, b) => (lowerBetter ? b.value - a.value : a.value - b.value)); // du moins au plus exigeant
  let reachedIdx = -1;
  levels.forEach((l, i) => {
    if (ok(value, l.value)) reachedIdx = i;
  });
  const reached = reachedIdx >= 0 ? levels[reachedIdx]! : null;
  const nextLevel = levels[reachedIdx + 1];
  const edge = (l: NormLevel | undefined) => (l ? Math.abs(value - l.value) <= margin : false);
  return {
    entry,
    category,
    reached,
    next: nextLevel ? { level: nextLevel, gap: Math.abs(nextLevel.value - value) } : null,
    uncertain: edge(reached ?? undefined) || edge(nextLevel),
  };
}
