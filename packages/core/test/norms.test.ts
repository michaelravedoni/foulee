import { describe, expect, it } from 'vitest';
import { NormError, categoryFor, fitVmaxTau, parseNormTable, rateAgainst, summarize, type NormTable } from '../src/index.js';

/** Tableau FICTIF, uniquement pour tester le code : Foulée n'embarque aucune vraie norme. */
const raw = {
  schema: 'norms@1',
  id: 'essai',
  title: 'Tableau fictif de test',
  source: { name: 'Test', season: '2099' },
  categories: [
    { id: 'u16', label: 'U16', minAge: 14, maxAge: 15 },
    { id: 'u18', label: 'U18', minAge: 16, maxAge: 17 },
  ],
  entries: [
    { discipline: '100m', category: 'u16', sex: 'M', levels: [{ label: 'B', value: 13 }, { label: 'A', value: 12 }, { label: 'Élite', value: 11.5 }] },
    { discipline: 'longueur', category: 'u16', sex: 'M', levels: [{ label: 'B', value: 5 }, { label: 'A', value: 6 }] },
  ],
};
const table = (): NormTable => parseNormTable(JSON.parse(JSON.stringify(raw)));

describe('tableaux de normes', () => {
  it('accepte un tableau valide', () => {
    expect(table().entries).toHaveLength(2);
    expect(table().verified).toBeUndefined();
  });
  it('refuse avec des messages lisibles', () => {
    expect(() => parseNormTable(null)).toThrow(NormError);
    expect(() => parseNormTable({ ...raw, schema: 'x' })).toThrow(/schema/);
    expect(() => parseNormTable({ ...raw, source: undefined })).toThrow(/source/);
    expect(() => parseNormTable({ ...raw, entries: [{ ...raw.entries[0], category: 'zz' }] })).toThrow(/absente/);
    expect(() => parseNormTable({ ...raw, entries: [{ ...raw.entries[0], sex: 'X' }] })).toThrow(/sex/);
    expect(() => parseNormTable({ ...raw, entries: [{ ...raw.entries[0], levels: [{ label: 'a', value: -1 }] }] })).toThrow(/positif/);
  });
  it('catégorie = âge atteint dans l’année de la saison', () => {
    expect(categoryFor(table(), '2010-12-31', 2025)?.id).toBe('u16');
    expect(categoryFor(table(), '2008-01-01', 2025)?.id).toBe('u18');
    expect(categoryFor(table(), '1990-01-01', 2025)).toBeUndefined();
    expect(categoryFor(table(), undefined, 2025)).toBeUndefined();
  });
  it('temps : plus petit = meilleur, niveau suivant et écart', () => {
    const t = table();
    const c = t.categories[0]!;
    const r = rateAgainst(t, '100m', 'M', c, 12.4, 0.05)!;
    expect(r.reached?.label).toBe('B');
    expect(r.next?.level.label).toBe('A');
    expect(r.next?.gap).toBeCloseTo(0.4);
    expect(r.uncertain).toBe(false);
    expect(rateAgainst(t, '100m', 'M', c, 11.4, 0.05)!.next).toBeNull();
    expect(rateAgainst(t, '100m', 'M', c, 14, 0.05)!.reached).toBeNull();
  });
  it('distance : plus grand = meilleur', () => {
    const t = table();
    const r = rateAgainst(t, 'longueur', 'M', t.categories[0]!, 5.5, 0.02)!;
    expect(r.reached?.label).toBe('B');
    expect(r.next?.gap).toBeCloseTo(0.5);
  });
  it('signale un résultat dont le niveau dépend de la marge', () => {
    const t = table();
    expect(rateAgainst(t, '100m', 'M', t.categories[0]!, 12.02, 0.05)!.uncertain).toBe(true);
  });
  it('aucune ligne pour cette épreuve ou ce sexe → indéfini', () => {
    const t = table();
    expect(rateAgainst(t, '100m', 'F', t.categories[0]!, 12, 0.05)).toBeUndefined();
    expect(rateAgainst(t, '200m', 'M', t.categories[0]!, 25, 0.05)).toBeUndefined();
  });
});

describe('tendances', () => {
  const pt = (id: string, date: string, value: number, margin = 0.02) => ({ id, date, value, margin });
  it('records, moyenne glissante, sens (temps)', () => {
    const s = summarize('100m', [pt('a', '2024-10-01', 12.8), pt('b', '2025-01-01', 12.6), pt('c', '2025-04-01', 12.4), pt('d', '2025-07-01', 12.2)], 2025);
    expect(s.personalBest?.id).toBe('d');
    expect(s.seasonBest?.id).toBe('d');
    expect(s.rollingMean).toBeCloseTo((12.6 + 12.4 + 12.2) / 3);
    expect(s.direction).toBe('mieux');
    expect(s.slopePerMonth!).toBeLessThan(0);
  });
  it('distance : sens inverse', () => {
    const s = summarize('longueur', [pt('a', '2025-01-01', 5, 0.02), pt('b', '2025-03-01', 4.7, 0.02), pt('c', '2025-05-01', 4.4, 0.02)], 2025);
    expect(s.direction).toBe('moins');
    expect(s.personalBest?.id).toBe('a');
  });
  it('stable si le changement reste dans la marge, insuffisant avec moins de 3 résultats', () => {
    expect(summarize('100m', [pt('a', '2025-01-01', 12.5, 0.2), pt('b', '2025-02-01', 12.48, 0.2), pt('c', '2025-03-01', 12.52, 0.2)], 2025).direction).toBe('stable');
    expect(summarize('100m', [pt('a', '2025-01-01', 12.5), pt('b', '2025-02-01', 12.4)], 2025).direction).toBe('insuffisant');
    expect(summarize('100m', [], 2025).count).toBe(0);
  });
});

describe('modèle Vmax/τ sur des temps de référence', () => {
  // Temps intermédiaires tous les 10 m (finale du 100 m, Berlin 2009), recopiés de mémoire d'après le rapport
  // biomécanique de l'IAAF : à contrôler à la source. Le test ne vérifie que la plausibilité de l'ajustement
  // (ordres de grandeur connus d'un sprinteur d'élite), pas la valeur exacte des temps.
  const cumulative = [1.89, 2.88, 3.78, 4.64, 5.47, 6.29, 7.1, 7.92, 8.75, 9.58];
  it('ajuste un profil plausible et un écart faible', () => {
    const reaction = 0.146;
    const p = fitVmaxTau(cumulative.map((t, i) => ({ t: t - reaction, d: (i + 1) * 10 })))!;
    expect(p.vmax.value).toBeGreaterThan(11);
    expect(p.vmax.value).toBeLessThan(13.5);
    expect(p.tau.value).toBeGreaterThan(0.6);
    expect(p.tau.value).toBeLessThan(1.8);
    expect(p.rmse).toBeLessThan(0.6);
  });
});
