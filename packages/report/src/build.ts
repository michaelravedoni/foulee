import { frNumber, formatMeasure, pixelsPerMeter, calibrationRelError, virtualBest, type Measure, type SplitRow } from '@foulee/core';
import type { Block, ReportDoc, ReportInput } from './doc.js';
import { GLOSSARY, glossaryFor } from './glossary.js';
import { CUES, bestOf, computeInsights, previousOf, topSpeed, trendOf } from './insights.js';

const fmt = (m: Measure, unit: string, minDigits = 0) => formatMeasure(m, unit, frNumber, minDigits);
const secs = (m: Measure) => (Number.isFinite(m.value) ? `${frNumber(m.value, 3)} ± ${frNumber(m.margin, 3)} s` : '-');

export function dateFr(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return iso;
  const months = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  return `${d} ${months[m - 1]} ${y}`;
}

function head(input: ReportInput, kind: string): Pick<ReportDoc, 'title' | 'subtitle' | 'footer'> {
  return {
    title: `${input.athleteName} · ${input.disciplineLabel}`,
    subtitle: `${kind} · ${dateFr(input.date)}${input.place ? ` · ${input.place}` : ''} · essai ${input.trialNumber}`,
    footer: `Foulée · généré le ${dateFr(input.generatedAt)} · mesures indicatives`,
  };
}

/** Rapport athlète : 1 à 2 pages, ton simple. */
export function buildAthleteReport(input: ReportInput): ReportDoc {
  const ins = computeInsights(input);
  const a = input.analysis;
  const prev = previousOf(input);
  const blocks: Block[] = [];
  if (input.images.length) blocks.push({ t: 'images', items: input.images.slice(0, 3) });

  const stats: Extract<Block, { t: 'stats' }>['items'] = [];
  if (a.total) {
    stats.push({
      label: 'Temps',
      value: `${frNumber(a.total.value, 2)} s`,
      sub: `± ${frNumber(a.total.margin, 3)} s`,
      ...(prev?.analysis.total ? { trend: trendOf(a.total, prev.analysis.total, true) } : {}),
    });
  }
  const top = topSpeed(a.splits);
  if (top) {
    const prevTop = prev ? topSpeed(prev.analysis.splits) : undefined;
    stats.push({
      label: 'Vitesse max mesurée',
      value: `${frNumber(top.speed.value, 1)} m/s`,
      sub: `${frNumber(top.speed.value * 3.6, 0)} km/h`,
      ...(prevTop ? { trend: trendOf(top.speed, prevTop.speed, false) } : {}),
    });
  }
  const first = a.splits[0];
  if (first && first !== top) {
    const prevFirst = prev?.analysis.splits.find((r) => r.fromM === first.fromM && r.toM === first.toM);
    stats.push({
      label: `Départ (${frNumber(first.fromM, 0)}-${frNumber(first.toM, 0)} m)`,
      value: `${frNumber(first.segment.value, 2)} s`,
      sub: `± ${frNumber(first.segment.margin, 3)} s`,
      ...(prevFirst ? { trend: trendOf(first.segment, prevFirst.segment, true) } : {}),
    });
  } else if (a.steps.length) {
    const mean = a.steps.reduce((s, r) => s + r.frequency.value, 0) / a.steps.length;
    stats.push({ label: 'Fréquence de pas', value: `${frNumber(mean, 1)} Hz` });
  }
  if (stats.length) blocks.push({ t: 'stats', items: stats.slice(0, 3) });
  else blocks.push({ t: 'p', text: 'Pose le départ et l’arrivée dans l’application pour obtenir ton temps et tes vitesses.', muted: true });

  blocks.push({ t: 'h2', text: 'Ce qui va bien' }, { t: 'bullets', tone: 'good', items: ins.good });
  if (ins.work.length) blocks.push({ t: 'h2', text: 'À travailler' }, { t: 'bullets', tone: 'work', items: ins.work });
  if (ins.cues.length) {
    blocks.push({ t: 'h2', text: 'Une consigne' });
    for (const c of ins.cues) blocks.push({ t: 'p', text: CUES[c]! });
    blocks.push({ t: 'p', text: 'À adapter avec ton entraîneur.', muted: true });
  }
  blocks.push({
    t: 'p',
    muted: true,
    text: 'Les chiffres viennent de la vidéo et sont indicatifs : chaque temps a une marge d’erreur d’environ une image. Une flèche verte ou rouge n’apparaît que si l’écart dépasse cette marge.',
  });
  return { ...head(input, 'Rapport athlète'), blocks };
}

function splitsTable(rows: readonly SplitRow[]): Block {
  return {
    t: 'table',
    head: ['Section', 'Temps', 'Cumulé', 'Vitesse'],
    rows: rows.map((r) => [`${frNumber(r.fromM, 1)}-${frNumber(r.toM, 1)} m`, secs(r.segment), secs(r.cumulative), fmt(r.speed, 'm/s')]),
    widths: [0.22, 0.28, 0.28, 0.22],
  };
}

/** Rapport coach : complet, avec protocole, tableaux, historique et annexes. */
export function buildCoachReport(input: ReportInput): ReportDoc {
  const ins = computeInsights(input);
  const a = input.analysis;
  const blocks: Block[] = [];

  // Protocole
  const protocol: string[][] = [
    ['Épreuve', `${input.disciplineLabel} (${frNumber(input.distance, 0)} m)`],
    ['Date', dateFr(input.date)],
    ['Lieu', input.place || '-'],
    ['Météo', input.weather || '-'],
    ['Cadence', `${frNumber(input.nominalFps, 0)} i/s dans le fichier${input.captureFps && input.captureFps !== input.nominalFps ? `, ${frNumber(input.captureFps, 0)} i/s à la prise de vue` : ''}`],
    ['Étalon', input.calibration ? `${frNumber(input.calibration.meters, 2)} m = ${frNumber(pixelsPerMeter(input.calibration), 1)} px/m, incertitude ±${frNumber(calibrationRelError(input.calibration) * 100, 1)} %` : 'aucun'],
    ['Résultat officiel', input.officialResult || '-'],
    ['Données d’épreuve', `version ${input.specDataVersion}`],
  ];
  blocks.push({ t: 'h2', text: 'Protocole' }, { t: 'table', head: ['', ''], rows: protocol, widths: [0.28, 0.72] });
  if (input.images.length) blocks.push({ t: 'images', items: input.images.slice(0, 6) });

  // Résultats
  blocks.push({ t: 'h2', text: 'Résultats' });
  const stats: Extract<Block, { t: 'stats' }>['items'] = [];
  if (a.total) stats.push({ label: 'Temps', value: `${frNumber(a.total.value, 3)} s`, sub: `± ${frNumber(a.total.margin, 3)} s` });
  const top = topSpeed(a.splits);
  if (top) stats.push({ label: 'Vitesse max mesurée', value: `${frNumber(top.speed.value, 2)} m/s`, sub: `${range(top)}` });
  if (a.profile) stats.push({ label: 'Vmax estimée', value: `${frNumber(a.profile.vmax.value, 2)} m/s`, sub: `± ${frNumber(a.profile.vmax.margin, 3)}` });
  if (stats.length) blocks.push({ t: 'stats', items: stats.slice(0, 3) });
  if (a.splits.length) {
    blocks.push(splitsTable(a.splits));
    blocks.push({
      t: 'bars',
      title: 'Vitesse par section',
      unit: 'm/s',
      items: a.splits.map((r) => ({ label: `${frNumber(r.toM, 0)} m`, value: r.speed.value, margin: r.speed.margin })),
    });
  } else {
    blocks.push({ t: 'p', text: 'Aucun split : pose le départ et au moins un passage ou l’arrivée.', muted: true });
  }
  if (a.profile) {
    const p = a.profile;
    blocks.push({
      t: 'table',
      head: ['Profil (indicatif)', 'Valeur'],
      rows: [
        ['Vmax', fmt(p.vmax, 'm/s')],
        ['tau', fmt(p.tau, 's')],
        ['F0 (Vmax / tau)', `${frNumber(p.f0, 1)} N/kg`],
        ['Pmax (F0 × Vmax / 4)', `${frNumber(p.pmax, 1)} W/kg`],
        ['Qualité de l’ajustement', `${p.points} points, écart moyen ${frNumber(p.rmse * 100, 0)} cm`],
      ],
      widths: [0.5, 0.5],
    });
  }
  if (a.steps.length) {
    blocks.push({
      t: 'table',
      head: ['Pas', 'Durée', 'Fréquence', 'Longueur'],
      rows: a.steps.slice(0, 40).map((s, i) => [String(i + 1), secs(s.time), fmt(s.frequency, 'Hz'), s.length ? fmt(s.length, 'm') : '-']),
      widths: [0.12, 0.34, 0.28, 0.26],
    });
  }
  if (a.contacts.length) {
    blocks.push({
      t: 'table',
      head: ['Appui', 'Contact', 'Vol', 'Fiabilité'],
      rows: a.contacts.slice(0, 40).map((c) => [
        `${c.on.side ?? ''} img ${c.on.frame}`.trim(),
        fmt({ value: c.contact.value * 1000, margin: c.contact.margin * 1000 }, 'ms'),
        c.flight ? fmt({ value: c.flight.value * 1000, margin: c.flight.margin * 1000 }, 'ms') : '-',
        c.reliable ? 'correcte' : 'cadence trop faible',
      ]),
      widths: [0.22, 0.28, 0.26, 0.24],
    });
  }
  if (a.checks.length) blocks.push({ t: 'h2', text: 'Contrôles' }, { t: 'bullets', items: a.checks.map((c) => `${c.level === 'alerte' ? 'Attention : ' : ''}${c.message}`) });

  // Historique
  const hist = input.history.filter((h) => h.analysis.total);
  if (hist.length) {
    blocks.push({ t: 'h2', text: 'Historique et comparaisons' });
    const best = bestOf(input);
    const prev = previousOf(input);
    const rows = hist.map((h) => {
      const dt = a.total ? h.analysis.total!.value - a.total.value : NaN;
      const vtop = topSpeed(h.analysis.splits);
      return [
        `${h.label}${h === best ? ' (meilleur)' : ''}${h === prev ? ' (précédent)' : ''}`,
        secs(h.analysis.total!),
        vtop ? fmt(vtop.speed, 'm/s') : '-',
        Number.isFinite(dt) ? `${dt >= 0 ? '+' : ''}${frNumber(dt, 3)} s` : '-',
      ];
    });
    blocks.push({ t: 'table', head: ['Essai', 'Temps', 'Vitesse max', 'Écart vs cet essai'], rows, widths: [0.34, 0.26, 0.2, 0.2] });
    const virt = virtualBest([...hist.map((h) => h.analysis.splits), a.splits]);
    if (virt) blocks.push({ t: 'p', text: `Meilleur virtuel (meilleur temps de chaque section parmi ces essais) : ${frNumber(virt.total.value, 3)} ± ${frNumber(virt.total.margin, 3)} s.` });
  }

  // Notes et décisions
  if (input.refs?.length) {
    blocks.push({ t: 'h2', text: 'Références' });
    for (const r of input.refs) blocks.push({ t: 'p', text: r });
  }
  blocks.push({ t: 'h2', text: 'Notes et décisions d’entraînement' });
  if (input.notes.trim()) blocks.push({ t: 'p', text: input.notes.trim() });
  blocks.push({ t: 'box', text: 'Décisions :', lines: 4 });

  // Annexes
  blocks.push(
    { t: 'h2', text: 'Annexe : méthode' },
    {
      t: 'bullets',
      items: [
        'Les temps sont lus sur les horodatages réels des images de la vidéo. Chaque repère est connu à une image près : la marge d’un temps de section est d’une image au plus.',
        'Les distances en mètres sont valables dans le plan de l’étalon (caméra fixe, à peu près perpendiculaire à la piste). La marge combine le pointage (±2 pixels par clic) et l’incertitude de l’étalon.',
        'Le profil Vmax / tau est un modèle mono-exponentiel ajusté par moindres carrés sur les temps cumulés ; les marges sont à 2 écarts-types. Il est indicatif avec peu de repères.',
        'Le temps de contact demande au moins 120 i/s. Les seuils de plausibilité (contrôles) sont des garde-fous à valider avec le staff.',
      ],
    },
    { t: 'h2', text: 'Annexe : glossaire' },
    { t: 'table', head: ['Terme', 'Définition'], rows: glossaryFor([...ins.terms, 'etalon', 'marge']).map((g) => [g.term, g.definition]), widths: [0.28, 0.72] },
  );
  void GLOSSARY;
  return { ...head(input, 'Rapport coach'), blocks };
}

function range(r: SplitRow): string {
  return `${frNumber(r.fromM, 0)}-${frNumber(r.toM, 0)} m`;
}
