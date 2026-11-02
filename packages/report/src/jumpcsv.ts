import { frNumber, type JumpAnalysis } from '@foulee/core';
import type { JumpHistoryTrial, JumpReportInput } from './jumpreport.js';
import { jumpResult } from './jumpreport.js';

const q = (v: string | number) => {
  const s = typeof v === 'number' ? String(v).replace('.', ',') : v;
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const line = (...cells: (string | number)[]) => cells.map(q).join(';');
const n = (v: number, d = 3) => (Number.isFinite(v) ? frNumber(v, d).replace('−', '-') : '');

/** Export tableur d'un saut : mesures, phases, foulées d'élan. */
export function csvJump(input: JumpReportInput): string {
  const a: JumpAnalysis = input.analysis;
  const out: string[] = [];
  out.push(line('Athlète', input.athleteName), line('Épreuve', input.disciplineLabel), line('Date', input.date), line('Essai', input.trialNumber), line('Cadence (i/s)', n(input.nominalFps, 0)));
  out.push('', line('Mesures'), line('Mesure', 'Valeur', 'Marge', 'Unité', 'Indicatif', 'Fiable'));
  for (const m of a.metrics) out.push(line(m.label, n(m.value.value, m.digits + 1), n(m.value.margin, m.digits + 2), m.unit, m.indicative ? 'oui' : 'non', m.reliable === false ? 'non' : 'oui'));
  if (a.phases.length) {
    out.push('', line('Phases'), line('Phase', 'Contact (ms)', 'Vol (s)', 'Distance (m)', 'Part (%)'));
    for (const p of a.phases) out.push(line(p.label, p.contact ? n(p.contact.value * 1000, 1) : '', p.flight ? n(p.flight.value, 3) : '', p.distance ? n(p.distance.value, 2) : '', p.share !== undefined ? n(p.share * 100, 1) : ''));
  }
  if (a.steps.length) {
    out.push('', line('Pas d’élan'), line('N°', 'Durée (s)', 'Fréquence (Hz)', 'Longueur (m)'));
    a.steps.forEach((s, i) => out.push(line(i + 1, n(s.time.value), n(s.frequency.value, 2), s.length ? n(s.length.value, 2) : '')));
  }
  return out.join('\r\n') + '\r\n';
}

/** Récapitulatif des essais d'un athlète dans un saut. */
export function csvJumpHistory(input: JumpReportInput): string {
  const rows: JumpHistoryTrial[] = [...input.history, { id: 'cur', label: `${input.date} · essai ${input.trialNumber} (celui-ci)`, date: input.date, analysis: input.analysis }];
  const out = [line('Essai', 'Date', 'Résultat (m)', 'Marge (m)', 'Vitesse d’approche (m/s)')];
  for (const r of rows) {
    const res = jumpResult(r.analysis, input.jump);
    const sp = r.analysis.metrics.find((m) => m.id === 'vitesse-approche');
    out.push(line(r.label, r.date, res ? n(res.value.value, 2) : '', res ? n(res.value.margin, 2) : '', sp ? n(sp.value.value, 1) : ''));
  }
  return out.join('\r\n') + '\r\n';
}
