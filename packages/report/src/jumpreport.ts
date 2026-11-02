import { calibrationRelError, formatMeasure, frNumber, pixelsPerMeter, type Calibration, type JumpAnalysis, type JumpMetric, type Measure } from '@foulee/core';
import type { Block, ReportDoc, ReportImage, Trend } from './doc.js';
import { dateFr } from './build.js';
import { trendOf } from './insights.js';

export interface JumpHistoryTrial {
  id: string;
  label: string;
  date: string;
  analysis: JumpAnalysis;
}

export interface JumpReportInput {
  athleteName: string;
  disciplineLabel: string;
  /** 'longueur' | 'triple' | 'hauteur' | 'perche' */
  jump: string;
  date: string;
  place?: string;
  weather?: string;
  trialNumber: number;
  notes: string;
  /** Lignes « Références » (normes comparées, avec leur source) ; vide = section omise. */
  refs?: string[];
  officialResult?: string;
  nominalFps: number;
  captureFps?: number;
  calibration?: Calibration;
  specDataVersion: string;
  analysis: JumpAnalysis;
  history: JumpHistoryTrial[];
  images: ReportImage[];
  generatedAt: string;
}

const fmt = (m: Measure, unit: string, minDigits = 0) => formatMeasure(m, unit, frNumber, minDigits);
const metricText = (m: JumpMetric) => `${frNumber(m.value.value, m.digits)} ${m.unit}`;
const metricFull = (m: JumpMetric) => `${frNumber(m.value.value, m.digits)} ± ${frNumber(m.value.margin, m.digits + 1)} ${m.unit}`;
const find = (a: JumpAnalysis, id: string) => a.metrics.find((m) => m.id === id);

/** Résultat principal : longueur (longueur, triple) ou hauteur de barre (hauteur, perche). */
export function jumpResult(a: JumpAnalysis, jump: string): { label: string; value: Measure; unit: string; higherIsBetter: true } | undefined {
  if (jump === 'longueur' || jump === 'triple') {
    return a.length ? { label: jump === 'triple' ? 'Distance' : 'Longueur', value: a.length, unit: 'm', higherIsBetter: true } : undefined;
  }
  const bar = find(a, 'barre');
  return bar ? { label: 'Barre', value: bar.value, unit: 'm', higherIsBetter: true } : undefined;
}

function head(input: JumpReportInput, kind: string): Pick<ReportDoc, 'title' | 'subtitle' | 'footer'> {
  return {
    title: `${input.athleteName} · ${input.disciplineLabel}`,
    subtitle: `${kind} · ${dateFr(input.date)}${input.place ? ` · ${input.place}` : ''} · essai ${input.trialNumber}`,
    footer: `Foulée · généré le ${dateFr(input.generatedAt)} · mesures indicatives`,
  };
}

function previous(input: JumpReportInput): JumpHistoryTrial | undefined {
  return input.history[input.history.length - 1];
}

/** Points forts et points de travail, déduits des seules mesures disponibles. */
function jumpInsights(input: JumpReportInput): { good: string[]; work: string[]; cue?: string } {
  const a = input.analysis;
  const good: string[] = [];
  const work: string[] = [];
  const res = jumpResult(a, input.jump);
  const prevRes = previous(input) ? jumpResult(previous(input)!.analysis, input.jump) : undefined;
  if (res && prevRes) {
    const t = trendOf(res.value, prevRes.value, false);
    if (t === 'mieux') good.push(`${res.label} meilleure que l’essai précédent (${frNumber(res.value.value, 2)} m contre ${frNumber(prevRes.value.value, 2)} m).`);
    if (t === 'moins') work.push(`${res.label} en retrait par rapport à l’essai précédent (${frNumber(res.value.value, 2)} m contre ${frNumber(prevRes.value.value, 2)} m).`);
  }
  const speed = find(a, 'vitesse-approche');
  const prevSpeed = previous(input) ? find(previous(input)!.analysis, 'vitesse-approche') : undefined;
  if (speed) {
    if (prevSpeed && trendOf(speed.value, prevSpeed.value, false) === 'mieux') good.push(`Vitesse d’approche en hausse (${frNumber(speed.value.value, 1)} m/s).`);
    else good.push(`Vitesse d’approche mesurée : ${frNumber(speed.value.value, 1)} m/s.`);
  }
  const contact = find(a, 'contact-appel');
  if (contact && contact.reliable !== false) good.push(`Temps d’appel : ${frNumber(contact.value.value * 1000, 0)} ms.`);
  if (a.phases.length === 3) {
    const shares = a.phases.map((p) => p.share);
    if (shares.every((s): s is number => s !== undefined)) {
      good.push(`Répartition des trois sauts : ${shares.map((s) => `${frNumber(s * 100, 0)} %`).join(' · ')}.`);
    }
  }
  if (a.missing.length) work.push(`Repères à compléter dans l’application : ${a.missing.join(', ')}.`);
  if (!good.length) good.push('Place les repères du saut dans l’application pour obtenir tes mesures.');
  const cue = input.jump === 'longueur' ? 'Garde la vitesse jusqu’à la planche : un appel rapide et actif est plus utile qu’un appel appuyé.'
    : input.jump === 'triple' ? 'Cherche trois phases équilibrées : ne perds pas de vitesse entre le saut d’élan et la foulée.'
    : input.jump === 'hauteur' ? 'Courbe ton élan sans perdre de vitesse, puis appelle vertical.'
    : 'Reste grand sur la perche : le lâcher tardif donne plus de montée.';
  return { good, work, cue };
}

/** Rapport athlète des sauts : court, simple. */
export function buildJumpAthleteReport(input: JumpReportInput): ReportDoc {
  const a = input.analysis;
  const blocks: Block[] = [];
  const ins = jumpInsights(input);
  const prev = previous(input);
  if (input.images.length) blocks.push({ t: 'images', items: input.images.slice(0, 3) });

  const stats: Extract<Block, { t: 'stats' }>['items'] = [];
  const res = jumpResult(a, input.jump);
  if (res) {
    const pr = prev ? jumpResult(prev.analysis, input.jump) : undefined;
    const trend: Trend | undefined = pr ? trendOf(res.value, pr.value, false) : undefined;
    stats.push({ label: res.label, value: `${frNumber(res.value.value, 2)} ${res.unit}`, sub: `± ${frNumber(res.value.margin, 2)} m`, ...(trend ? { trend } : {}) });
  }
  for (const id of ['vitesse-approche', 'contact-appel', 'montee']) {
    const m = find(a, id);
    if (m && (m.reliable ?? true)) stats.push({ label: m.label, value: metricText(m), sub: m.indicative ? 'estimation' : `± ${frNumber(m.value.margin, m.digits + 1)}` });
  }
  if (stats.length) blocks.push({ t: 'stats', items: stats.slice(0, 3) });
  else blocks.push({ t: 'p', text: 'Pose les repères du saut dans l’application pour obtenir tes mesures.', muted: true });

  blocks.push({ t: 'h2', text: 'Ce qui va bien' }, { t: 'bullets', tone: 'good', items: ins.good });
  if (ins.work.length) blocks.push({ t: 'h2', text: 'À travailler' }, { t: 'bullets', tone: 'work', items: ins.work });
  if (ins.cue) blocks.push({ t: 'h2', text: 'Une consigne' }, { t: 'p', text: ins.cue }, { t: 'p', text: 'À adapter avec ton entraîneur.', muted: true });
  blocks.push({ t: 'p', muted: true, text: 'Les chiffres viennent de la vidéo et sont indicatifs. Les montées et les angles sont des estimations calculées à partir du temps de vol.' });
  return { ...head(input, 'Rapport athlète'), blocks };
}

/** Rapport coach des sauts : protocole, phases, métriques, contrôles, historique. */
export function buildJumpCoachReport(input: JumpReportInput): ReportDoc {
  const a = input.analysis;
  const blocks: Block[] = [];
  const protocol: string[][] = [
    ['Épreuve', input.disciplineLabel],
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

  blocks.push({ t: 'h2', text: 'Résultats' });
  const res = jumpResult(a, input.jump);
  const stats: Extract<Block, { t: 'stats' }>['items'] = [];
  if (res) stats.push({ label: res.label, value: `${frNumber(res.value.value, 2)} ${res.unit}`, sub: `± ${frNumber(res.value.margin, 2)} m` });
  for (const id of ['vitesse-approche', 'temps-vol', 'temps-sommet']) {
    const m = find(a, id);
    if (m) stats.push({ label: m.label, value: metricText(m), sub: `± ${frNumber(m.value.margin, m.digits + 1)}` });
  }
  if (stats.length) blocks.push({ t: 'stats', items: stats.slice(0, 3) });
  if (a.metrics.length) {
    blocks.push({
      t: 'table',
      head: ['Mesure', 'Valeur', 'Remarque'],
      rows: a.metrics.map((m) => [
        m.label,
        metricFull(m),
        [m.indicative ? 'indicatif' : '', m.reliable === false ? 'cadence trop faible' : '', m.note ?? ''].filter(Boolean).join(' · '),
      ]),
      widths: [0.34, 0.26, 0.4],
    });
  } else {
    blocks.push({ t: 'p', text: 'Aucune mesure : pose au moins l’appel, le décollage et la réception (ou le sommet).', muted: true });
  }
  if (a.phases.length) {
    blocks.push({
      t: 'table',
      head: ['Phase', 'Contact', 'Vol', 'Distance', 'Part'],
      rows: a.phases.map((p) => [
        p.label,
        p.contact ? fmt({ value: p.contact.value * 1000, margin: p.contact.margin * 1000 }, 'ms') : '-',
        p.flight ? fmt(p.flight, 's') : '-',
        p.distance ? fmt(p.distance, 'm') : '-',
        p.share !== undefined ? `${frNumber(p.share * 100, 0)} %` : '-',
      ]),
      widths: [0.28, 0.2, 0.18, 0.2, 0.14],
    });
  }
  if (a.steps.length) {
    blocks.push({
      t: 'table',
      head: ['Pas d’élan', 'Durée', 'Fréquence', 'Longueur'],
      rows: a.steps.slice(-12).map((s, i) => [String(i + 1), `${frNumber(s.time.value, 3)} ± ${frNumber(s.time.margin, 3)} s`, fmt(s.frequency, 'Hz'), s.length ? fmt(s.length, 'm') : '-']),
      widths: [0.2, 0.32, 0.26, 0.22],
    });
  }
  if (a.missing.length) blocks.push({ t: 'p', text: `Repères manquants : ${a.missing.join(', ')}.`, muted: true });
  if (a.checks.length) blocks.push({ t: 'h2', text: 'Contrôles' }, { t: 'bullets', items: a.checks.map((c) => `${c.level === 'alerte' ? 'Attention : ' : ''}${c.message}`) });

  const hist = input.history.filter((h) => jumpResult(h.analysis, input.jump));
  if (hist.length) {
    blocks.push({ t: 'h2', text: 'Historique' });
    const best = Math.max(...hist.map((h) => jumpResult(h.analysis, input.jump)!.value.value));
    blocks.push({
      t: 'table',
      head: ['Essai', 'Résultat', 'Vitesse d’approche'],
      rows: hist.map((h) => {
        const r = jumpResult(h.analysis, input.jump)!;
        const sp = find(h.analysis, 'vitesse-approche');
        return [`${h.label}${r.value.value === best ? ' (meilleur)' : ''}`, fmt(r.value, 'm', 2), sp ? fmt(sp.value, 'm/s') : '-'];
      }),
      widths: [0.4, 0.3, 0.3],
    });
  }

  if (input.refs?.length) {
    blocks.push({ t: 'h2', text: 'Références' });
    for (const r of input.refs) blocks.push({ t: 'p', text: r });
  }
  blocks.push({ t: 'h2', text: 'Notes et décisions d’entraînement' });
  if (input.notes.trim()) blocks.push({ t: 'p', text: input.notes.trim() });
  blocks.push({ t: 'box', text: 'Décisions :', lines: 4 });

  blocks.push(
    { t: 'h2', text: 'Annexe : méthode' },
    {
      t: 'bullets',
      items: [
        'Les temps sont lus sur les horodatages réels des images ; la marge d’un temps est d’une image au plus.',
        'La longueur est la différence des positions pointées entre l’appel et la réception, dans le plan de l’étalon. Elle ne remplace pas la mesure officielle.',
        'La montée du centre de gravité et l’angle d’envol sont des estimations balistiques (g = 9,81 m/s², vol symétrique) : des ordres de grandeur, pas des mesures.',
        'Le temps d’appel demande au moins 120 i/s. Les seuils de plausibilité sont des garde-fous à valider avec le staff.',
      ],
    },
  );
  return { ...head(input, 'Rapport coach'), blocks };
}
