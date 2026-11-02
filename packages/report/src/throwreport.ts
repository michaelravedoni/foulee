import { calibrationRelError, formatMeasure, frNumber, pixelsPerMeter, type Calibration, type JumpMetric, type Measure, type ThrowAnalysis } from '@foulee/core';
import type { Block, ReportDoc, ReportImage } from './doc.js';
import { dateFr } from './build.js';
import { trendOf } from './insights.js';

export interface ThrowHistoryTrial {
  id: string;
  label: string;
  date: string;
  analysis: ThrowAnalysis;
}

export interface ThrowReportInput {
  athleteName: string;
  disciplineLabel: string;
  throwId: string;
  date: string;
  place?: string;
  weather?: string;
  trialNumber: number;
  notes: string;
  officialResult?: string;
  nominalFps: number;
  captureFps?: number;
  calibration?: Calibration;
  specDataVersion: string;
  analysis: ThrowAnalysis;
  history: ThrowHistoryTrial[];
  images: ReportImage[];
  generatedAt: string;
}

const fmt = (m: Measure, unit: string, minDigits = 0) => formatMeasure(m, unit, frNumber, minDigits);
const find = (a: ThrowAnalysis, id: string) => a.metrics.find((m) => m.id === id);
const text = (m: JumpMetric) => `${frNumber(m.value.value, m.digits)}${m.unit ? ' ' + m.unit : ''}`;
const full = (m: JumpMetric) => `${frNumber(m.value.value, m.digits)} ± ${frNumber(m.value.margin, m.digits + 1)}${m.unit ? ' ' + m.unit : ''}`;

function head(input: ThrowReportInput, kind: string): Pick<ReportDoc, 'title' | 'subtitle' | 'footer'> {
  return {
    title: `${input.athleteName} · ${input.disciplineLabel}`,
    subtitle: `${kind} · ${dateFr(input.date)}${input.place ? ` · ${input.place}` : ''} · essai ${input.trialNumber}`,
    footer: `Foulée · généré le ${dateFr(input.generatedAt)} · mesures indicatives`,
  };
}

const CUES: Record<string, string> = {
  poids: 'Cherche un lâcher à vitesse maximale, autour de 35-38° : la vitesse compte plus que l’angle.',
  disque: 'Garde le disque loin du corps pendant la rotation et lâche en fin de poussée.',
  javelot: 'Pose la jambe de blocage tôt et laisse la hanche passer devant avant le lâcher.',
  marteau: 'Accélère à chaque tour : le dernier tour doit être le plus rapide.',
};

export function buildThrowAthleteReport(input: ThrowReportInput): ReportDoc {
  const a = input.analysis;
  const prev = input.history[input.history.length - 1];
  const blocks: Block[] = [];
  if (input.images.length) blocks.push({ t: 'images', items: input.images.slice(0, 3) });
  const stats: Extract<Block, { t: 'stats' }>['items'] = [];
  const dist = a.distance;
  if (dist) {
    const pd = prev?.analysis.distance;
    stats.push({ label: 'Distance', value: `${frNumber(dist.value, 2)} m`, ...(pd ? { trend: trendOf(dist, pd, false) } : {}) });
  }
  for (const id of ['vitesse-lacher', 'angle-lacher', 'tour-moyen']) {
    const m = find(a, id);
    if (m) stats.push({ label: m.label, value: text(m), sub: `± ${frNumber(m.value.margin, m.digits + 1)}` });
  }
  if (stats.length) blocks.push({ t: 'stats', items: stats.slice(0, 3) });
  else blocks.push({ t: 'p', text: 'Pose les repères du lancer et pointe l’engin après le lâcher pour obtenir tes mesures.', muted: true });

  const good: string[] = [];
  const work: string[] = [];
  const speed = find(a, 'vitesse-lacher');
  const pspeed = prev ? find(prev.analysis, 'vitesse-lacher') : undefined;
  if (speed) {
    good.push(`Vitesse de l’engin au lâcher : ${frNumber(speed.value.value, 1)} m/s.`);
    if (pspeed) {
      const t = trendOf(speed.value, pspeed.value, false);
      if (t === 'mieux') good.push('Vitesse de lâcher en hausse par rapport à l’essai précédent.');
      if (t === 'moins') work.push('Vitesse de lâcher en retrait par rapport à l’essai précédent.');
    }
  }
  if (a.missing.length) work.push(`Repères à compléter dans l’application : ${a.missing.join(', ')}.`);
  if (!good.length) good.push('Place les repères du lancer dans l’application pour obtenir tes mesures.');
  blocks.push({ t: 'h2', text: 'Ce qui va bien' }, { t: 'bullets', tone: 'good', items: good });
  if (work.length) blocks.push({ t: 'h2', text: 'À travailler' }, { t: 'bullets', tone: 'work', items: work });
  blocks.push({ t: 'h2', text: 'Une consigne' }, { t: 'p', text: CUES[input.throwId] ?? CUES.poids! }, { t: 'p', text: 'À adapter avec ton entraîneur.', muted: true });
  blocks.push({ t: 'p', muted: true, text: 'Les chiffres viennent de la vidéo et sont indicatifs. La vitesse et l’angle dépendent de la position de la caméra et de l’étalon.' });
  return { ...head(input, 'Rapport athlète'), blocks };
}

export function buildThrowCoachReport(input: ThrowReportInput): ReportDoc {
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
  const stats: Extract<Block, { t: 'stats' }>['items'] = [];
  for (const id of ['distance', 'vitesse-lacher', 'angle-lacher']) {
    const m = find(a, id);
    if (m) stats.push({ label: m.label, value: text(m), sub: `± ${frNumber(m.value.margin, m.digits + 1)}` });
  }
  if (stats.length) blocks.push({ t: 'stats', items: stats.slice(0, 3) });
  if (a.metrics.length) {
    blocks.push({
      t: 'table',
      head: ['Mesure', 'Valeur', 'Remarque'],
      rows: a.metrics.map((m) => [m.label, full(m), [m.indicative ? 'indicatif' : '', m.note ?? ''].filter(Boolean).join(' · ')]),
      widths: [0.34, 0.24, 0.42],
    });
  } else {
    blocks.push({ t: 'p', text: 'Aucune mesure : pose le lâcher, étalonne l’image et pointe l’engin sur les images suivantes.', muted: true });
  }
  if (a.phases.length) {
    blocks.push({ t: 'table', head: ['Phase', 'Durée'], rows: a.phases.map((p) => [p.label, `${frNumber(p.duration.value, 3)} ± ${frNumber(p.duration.margin, 3)} s`]), widths: [0.6, 0.4] });
  }
  if (a.missing.length) blocks.push({ t: 'p', text: `Repères manquants : ${a.missing.join(', ')}.`, muted: true });
  if (a.checks.length) blocks.push({ t: 'h2', text: 'Contrôles' }, { t: 'bullets', items: a.checks.map((c) => `${c.level === 'alerte' ? 'Attention : ' : ''}${c.message}`) });

  const hist = input.history.filter((h) => h.analysis.metrics.length);
  if (hist.length) {
    blocks.push({ t: 'h2', text: 'Historique' });
    blocks.push({
      t: 'table',
      head: ['Essai', 'Distance saisie', 'Vitesse de lâcher', 'Angle'],
      rows: hist.map((h) => {
        const d = h.analysis.distance;
        const v = find(h.analysis, 'vitesse-lacher');
        const g = find(h.analysis, 'angle-lacher');
        return [h.label, d ? fmt(d, 'm', 2) : '-', v ? fmt(v.value, 'm/s') : '-', g ? fmt(g.value, '°') : '-'];
      }),
      widths: [0.34, 0.22, 0.24, 0.2],
    });
  }
  blocks.push({ t: 'h2', text: 'Notes et décisions d’entraînement' });
  if (input.notes.trim()) blocks.push({ t: 'p', text: input.notes.trim() });
  blocks.push({ t: 'box', text: 'Décisions :', lines: 4 });
  blocks.push(
    { t: 'h2', text: 'Annexe : méthode' },
    {
      t: 'bullets',
      items: [
        'La vitesse et l’angle de lâcher viennent d’une régression linéaire sur les premiers points pointés de l’engin après le lâcher ; la vitesse verticale est ramenée à l’instant du lâcher (pesanteur). Les marges combinent le pointage (±2 pixels) et l’étalon.',
        'Les mesures sont dans le plan de l’image : exactes si la caméra est perpendiculaire à la trajectoire, sinon sous-estimées.',
        'La portée estimée est balistique, sans résistance de l’air, depuis le point de lâcher : un ordre de grandeur. La distance est celle qui a été saisie.',
        'Les seuils de plausibilité sont des garde-fous à valider avec le staff.',
      ],
    },
  );
  return { ...head(input, 'Rapport coach'), blocks };
}
