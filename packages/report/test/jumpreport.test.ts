import { describe, expect, it } from 'vitest';
import { FrameTimeline, analyzeJump, jumpSpecFor, type MarkedEvent } from '@foulee/core';
import { buildJumpAthleteReport, buildJumpCoachReport, csvJump, csvJumpHistory, renderPdf, type JumpReportInput } from '../src/index.js';

const FPS = 240;
const tl = new FrameTimeline(Array.from({ length: 4000 }, (_, i) => i / FPS));
let n = 0;
const ev = (type: string, t: number, extra: Partial<MarkedEvent> = {}): MarkedEvent => {
  const frame = Math.round(t * FPS);
  return { id: `e${n++}`, type, frame, time: frame / FPS, source: 'manuel', confidence: 1, ...extra };
};
const longueur = (len: number) =>
  analyzeJump(jumpSpecFor('longueur')!, [
    ev('appui', 1.0, { side: 'G', position: -3.4 }),
    ev('appel', 1.2, { side: 'D', position: 0 }),
    ev('decollage', 1.3, { side: 'D' }),
    ev('reception', 1.9, { position: len }),
  ], tl, 1, FPS);

const input = (len: number, history: JumpReportInput['history'] = []): JumpReportInput => ({
  athleteName: 'Léa Rey', disciplineLabel: 'Longueur', jump: 'longueur', date: '2026-03-12', trialNumber: 2, notes: '', nominalFps: FPS,
  specDataVersion: '2026.1', analysis: longueur(len), history, images: [], generatedAt: '2026-03-12T10:00:00Z',
});

describe('rapports de saut', () => {
  it('rapport athlète : résultat et tendance', () => {
    const doc = buildJumpAthleteReport(input(6.4, [{ id: 'h', label: 'essai 1', date: '2026-03-12', analysis: longueur(6.0) }]));
    const stats = doc.blocks.find((b) => b.t === 'stats');
    expect(stats && stats.t === 'stats' && stats.items[0]?.value).toBe('6,40 m');
    expect(stats && stats.t === 'stats' && stats.items[0]?.trend).toBe('mieux');
  });
  it('rapport coach complet + CSV + PDF', async () => {
    const i = input(6.4, [{ id: 'h', label: 'essai 1', date: '2026-03-12', analysis: longueur(6.0) }]);
    const doc = buildJumpCoachReport(i);
    expect(doc.blocks.some((b) => b.t === 'table')).toBe(true);
    expect(csvJump(i)).toContain('Longueur du saut');
    expect(csvJumpHistory(i).split('\r\n').length).toBeGreaterThan(3);
    const pdf = await renderPdf(doc);
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe('%PDF-');
  });
  it('sans repères : message d’aide', () => {
    const i = { ...input(6.4), analysis: analyzeJump(jumpSpecFor('longueur')!, [], tl, 1, FPS) };
    expect(buildJumpAthleteReport(i).blocks.some((b) => b.t === 'p')).toBe(true);
  });
});
