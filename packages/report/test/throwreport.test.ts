import { describe, expect, it } from 'vitest';
import { FrameTimeline, analyzeThrow, throwSpecFor, type Calibration, type MarkedEvent } from '@foulee/core';
import { buildThrowAthleteReport, buildThrowCoachReport, csvThrow, csvThrowHistory, renderPdf, type ThrowReportInput } from '../src/index.js';

const FPS = 240;
const tl = new FrameTimeline(Array.from({ length: 4000 }, (_, i) => i / FPS));
const cal: Calibration = { a: { x: 0, y: 0 }, b: { x: 500, y: 0 }, meters: 5, clickErrorPx: 2 };
const ev = (type: string, t: number, extra: Partial<MarkedEvent> = {}): MarkedEvent => ({ id: type + t, type, frame: Math.round(t * FPS), time: t, source: 'manuel', confidence: 1, ...extra });
const traj = (v: number) => ({
  id: 't', label: 'Engin', color: '#f00',
  points: Array.from({ length: 5 }, (_, i) => ({ frame: 240 + i, x: 100 + (v * 0.8 * i * 100) / FPS, y: 600 - ((v * 0.6 * i) / FPS - 0.5 * 9.81 * (i / FPS) ** 2) * 100 })),
});
const analysis = (v: number, d: number) => analyzeThrow(throwSpecFor('poids')!, [ev('puissance', 0.5), ev('lacher', 1.0), ev('impact', 2, { position: d })], [traj(v)], cal, tl, 1);
const input = (): ThrowReportInput => ({
  athleteName: 'Léa Rey', disciplineLabel: 'Poids', throwId: 'poids', date: '2026-03-12', trialNumber: 1, notes: '', nominalFps: FPS,
  specDataVersion: '2026.1', analysis: analysis(12, 14.2), history: [{ id: 'h', label: 'essai 0', date: '2026-03-12', analysis: analysis(10, 12.1) }], images: [], generatedAt: '2026-03-12T10:00:00Z',
});

describe('rapports de lancer', () => {
  it('athlète : distance avec tendance', () => {
    const doc = buildThrowAthleteReport(input());
    const stats = doc.blocks.find((b) => b.t === 'stats');
    expect(stats && stats.t === 'stats' && stats.items[0]?.trend).toBe('mieux');
  });
  it('coach, CSV et PDF', async () => {
    const i = input();
    expect(csvThrow(i)).toContain('Vitesse au lâcher');
    expect(csvThrowHistory(i).split('\r\n').length).toBeGreaterThan(3);
    const pdf = await renderPdf(buildThrowCoachReport(i));
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe('%PDF-');
  });
});
