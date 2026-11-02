import { frNumber } from '@foulee/core';
import type { ThrowReportInput } from './throwreport.js';

const q = (v: string | number) => {
  const s = typeof v === 'number' ? String(v).replace('.', ',') : v;
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const line = (...cells: (string | number)[]) => cells.map(q).join(';');
const n = (v: number, d = 3) => (Number.isFinite(v) ? frNumber(v, d).replace('−', '-') : '');

export function csvThrow(input: ThrowReportInput): string {
  const a = input.analysis;
  const out = [line('Athlète', input.athleteName), line('Épreuve', input.disciplineLabel), line('Date', input.date), line('Essai', input.trialNumber), line('Cadence (i/s)', n(input.nominalFps, 0))];
  out.push('', line('Mesures'), line('Mesure', 'Valeur', 'Marge', 'Unité', 'Indicatif'));
  for (const m of a.metrics) out.push(line(m.label, n(m.value.value, m.digits + 1), n(m.value.margin, m.digits + 2), m.unit, m.indicative ? 'oui' : 'non'));
  if (a.phases.length) {
    out.push('', line('Phases'), line('Phase', 'Durée (s)', 'Marge (s)'));
    for (const p of a.phases) out.push(line(p.label, n(p.duration.value), n(p.duration.margin)));
  }
  return out.join('\r\n') + '\r\n';
}

export function csvThrowHistory(input: ThrowReportInput): string {
  const rows = [...input.history, { id: 'cur', label: `${input.date} · essai ${input.trialNumber} (celui-ci)`, date: input.date, analysis: input.analysis }];
  const out = [line('Essai', 'Date', 'Distance saisie (m)', 'Vitesse de lâcher (m/s)', 'Angle de lâcher (°)')];
  for (const r of rows) {
    const v = r.analysis.metrics.find((m) => m.id === 'vitesse-lacher');
    const g = r.analysis.metrics.find((m) => m.id === 'angle-lacher');
    out.push(line(r.label, r.date, r.analysis.distance ? n(r.analysis.distance.value, 2) : '', v ? n(v.value.value, 1) : '', g ? n(g.value.value, 0) : ''));
  }
  return out.join('\r\n') + '\r\n';
}
