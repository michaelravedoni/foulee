import { describe, expect, it } from 'vitest';
import { FrameTimeline, analyzeSprint, modelDistance, specFor, type MarkedEvent } from '@foulee/core';
import { buildAthleteReport, buildCoachReport, csvHistory, csvTrial, pdfText, renderPdf, trendOf, type ReportInput } from '../src/index.js';

const FPS = 240;
const tl = new FrameTimeline(Array.from({ length: 4000 }, (_, i) => i / FPS));
const spec = specFor('100m')!;
let n = 0;
const ev = (type: string, t: number, extra: Partial<MarkedEvent> = {}): MarkedEvent => {
  const frame = Math.round(t * FPS);
  return { id: `e${n++}`, type, frame, time: frame / FPS, source: 'manuel', confidence: 1, ...extra };
};
function timeAt(d: number, vmax: number, tau: number): number {
  let lo = 0;
  let hi = 30;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (modelDistance(vmax, tau, mid) < d) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
function events(vmax: number, tau: number, withSteps = true): MarkedEvent[] {
  const e = [ev('depart', 0.5)];
  for (let d = 10; d < 100; d += 10) e.push(ev('passage', 0.5 + timeAt(d, vmax, tau), { position: d }));
  e.push(ev('arrivee', 0.5 + timeAt(100, vmax, tau)));
  if (withSteps) {
    for (let i = 0; i < 6; i++) {
      const side = i % 2 ? 'D' : 'G';
      e.push(ev('appui', 4 + i * 0.2, { side, position: 30 + i * 2 }), ev('decollage', 4.1 + i * 0.2, { side }));
    }
  }
  return e;
}
const analyse = (ev: MarkedEvent[]) => analyzeSprint(spec, ev, tl, 1, FPS);

function input(overrides: Partial<ReportInput> = {}): ReportInput {
  return {
    athleteName: 'Léa Rey',
    disciplineLabel: '100 m',
    distance: 100,
    date: '2026-03-12',
    place: 'Stade de Sion',
    weather: '12 °C, vent de face',
    trialNumber: 3,
    notes: 'Bon départ, relâchement tardif.',
    nominalFps: FPS,
    specDataVersion: spec.dataVersion,
    analysis: analyse(events(11.6, 1.25)),
    history: [
      { id: 'a', label: '5 mars · essai 1', date: '2026-03-05', analysis: analyse(events(11.2, 1.5, false)) },
      { id: 'b', label: '5 mars · essai 2', date: '2026-03-05', analysis: analyse(events(11.3, 1.4, false)) },
    ],
    images: [],
    generatedAt: '2026-03-12T10:00:00Z',
    ...overrides,
  };
}

describe('contenu', () => {
  it('compare au dernier essai avec des flèches seulement hors marge', () => {
    expect(trendOf({ value: 11, margin: 0.01 }, { value: 11.2, margin: 0.01 }, true)).toBe('mieux');
    expect(trendOf({ value: 11.2, margin: 0.01 }, { value: 11, margin: 0.01 }, true)).toBe('moins');
    expect(trendOf({ value: 11.005, margin: 0.01 }, { value: 11, margin: 0.01 }, true)).toBe('egal');
  });

  it('le rapport athlète annonce ce qui va bien, avec 3 chiffres', () => {
    const doc = buildAthleteReport(input());
    const stats = doc.blocks.find((b) => b.t === 'stats');
    expect(stats && stats.t === 'stats' && stats.items.length).toBeGreaterThanOrEqual(2);
    const good = doc.blocks.find((b) => b.t === 'bullets' && b.tone === 'good');
    expect(good && good.t === 'bullets' && good.items.join(' ')).toMatch(/gagné/);
    expect(doc.title).toBe('Léa Rey · 100 m');
  });

  it('sans historique ni repères, ne plante pas et le dit', () => {
    const empty = input({ history: [], analysis: analyse([]) });
    const doc = buildAthleteReport(empty);
    expect(JSON.stringify(doc)).toMatch(/Pose le départ/);
    expect(() => buildCoachReport(empty)).not.toThrow();
  });

  it('le rapport coach contient protocole, splits, historique, annexes', () => {
    const doc = buildCoachReport(input());
    const titles = doc.blocks.filter((b) => b.t === 'h2').map((b) => (b as { text: string }).text);
    for (const t of ['Protocole', 'Résultats', 'Historique et comparaisons', 'Annexe : méthode', 'Annexe : glossaire']) expect(titles).toContain(t);
    expect(doc.blocks.some((b) => b.t === 'bars')).toBe(true);
    expect(JSON.stringify(doc)).toMatch(/Meilleur virtuel/);
  });

  it('remplace les caractères hors latin-1', () => {
    expect(pdfText('τ ≤ 3 → ok — “x”')).toBe('tau <= 3 -> ok - "x"');
    expect(pdfText('é à ± °')).toBe('é à ± °');
  });
});

describe('PDF et CSV', () => {
  it('produit deux PDF valides, l’athlète en 2 pages au plus', async () => {
    const athlete = await renderPdf(buildAthleteReport(input()));
    const coach = await renderPdf(buildCoachReport(input()));
    for (const bytes of [athlete, coach]) expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    const pages = (b: Uint8Array) => (new TextDecoder('latin1').decode(b).match(/\/Type\s*\/Page\b/g) ?? []).length;
    expect(pages(athlete)).toBeLessThanOrEqual(2);
    expect(pages(coach)).toBeGreaterThanOrEqual(1);
    expect(coach.length).toBeGreaterThan(athlete.length / 2);
  });

  it('exporte un CSV à la française', () => {
    const csv = csvTrial(input());
    expect(csv).toContain('Splits');
    expect(csv).toContain(';');
    expect(csv.split('\r\n').some((l) => /^0,00;10,00;/.test(l))).toBe(true);
    const hist = csvHistory(input());
    expect(hist.split('\r\n').filter(Boolean)).toHaveLength(4);
  });
});
