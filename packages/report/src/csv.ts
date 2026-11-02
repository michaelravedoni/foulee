import { frNumber } from '@foulee/core';
import type { ReportInput } from './doc.js';

const q = (v: string | number) => {
  const s = typeof v === 'number' ? String(v).replace('.', ',') : v;
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const line = (...cells: (string | number)[]) => cells.map(q).join(';');
const n = (v: number, d = 3) => (Number.isFinite(v) ? frNumber(v, d).replace('−', '-') : '');

/**
 * Export tableur d'un essai (séparateur « ; », virgule décimale : s'ouvre
 * directement dans Excel en français). Un bloc par tableau, séparés par une ligne vide.
 */
export function csvTrial(input: ReportInput): string {
  const a = input.analysis;
  const out: string[] = [];
  out.push(line('Athlète', input.athleteName), line('Épreuve', input.disciplineLabel), line('Date', input.date), line('Essai', input.trialNumber));
  out.push(line('Cadence (i/s)', n(input.nominalFps, 0)), line('Temps total (s)', a.total ? n(a.total.value) : '', a.total ? `± ${n(a.total.margin)}` : ''));
  out.push('', line('Splits'), line('De (m)', 'À (m)', 'Temps (s)', 'Marge (s)', 'Cumulé (s)', 'Marge cumulé (s)', 'Vitesse (m/s)', 'Marge vitesse (m/s)'));
  for (const r of a.splits) out.push(line(n(r.fromM, 2), n(r.toM, 2), n(r.segment.value), n(r.segment.margin), n(r.cumulative.value), n(r.cumulative.margin), n(r.speed.value, 2), n(r.speed.margin, 2)));
  if (a.profile) {
    out.push('', line('Profil'), line('Vmax (m/s)', n(a.profile.vmax.value, 2), n(a.profile.vmax.margin, 2)), line('tau (s)', n(a.profile.tau.value, 2), n(a.profile.tau.margin, 2)), line('F0 (N/kg)', n(a.profile.f0, 2)), line('Pmax (W/kg)', n(a.profile.pmax, 2)));
  }
  if (a.steps.length) {
    out.push('', line('Pas'), line('N°', 'Image début', 'Image fin', 'Durée (s)', 'Marge (s)', 'Fréquence (Hz)', 'Longueur (m)'));
    a.steps.forEach((s, i) => out.push(line(i + 1, s.from.frame, s.to.frame, n(s.time.value), n(s.time.margin), n(s.frequency.value, 2), s.length ? n(s.length.value, 2) : '')));
  }
  if (a.contacts.length) {
    out.push('', line('Contacts'), line('Côté', 'Image appui', 'Image décollage', 'Contact (ms)', 'Marge (ms)', 'Vol (ms)', 'Fiable'));
    for (const c of a.contacts) out.push(line(c.on.side ?? '', c.on.frame, c.off.frame, n(c.contact.value * 1000, 1), n(c.contact.margin * 1000, 1), c.flight ? n(c.flight.value * 1000, 1) : '', c.reliable ? 'oui' : 'non'));
  }
  return out.join('\r\n') + '\r\n';
}

/** Un tableau récapitulatif des essais d'un athlète dans une épreuve. */
export function csvHistory(input: ReportInput): string {
  const rows = [...input.history, { label: `${input.date} · essai ${input.trialNumber} (celui-ci)`, date: input.date, id: 'cur', analysis: input.analysis }];
  const out = [line('Essai', 'Date', 'Temps (s)', 'Marge (s)', 'Vmax estimée (m/s)', 'tau (s)')];
  for (const r of rows) {
    const t = r.analysis.total;
    const p = r.analysis.profile;
    out.push(line(r.label, r.date, t ? n(t.value) : '', t ? n(t.margin) : '', p ? n(p.vmax.value, 2) : '', p ? n(p.tau.value, 2) : ''));
  }
  return out.join('\r\n') + '\r\n';
}
