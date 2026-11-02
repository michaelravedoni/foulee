import { describe, expect, it } from 'vitest';
import { LM, suggestFootEvents, trackTemplate, type Gray, type Landmark, type PoseSample } from '../src/index.js';

const FPS = 120;

/** Un pied qui alterne vol (monté) et contact (posé), à cadence de pas de 4 Hz. */
function series(frames: number, phase: number, contactShare = 0.4): PoseSample[] {
  return Array.from({ length: frames }, (_, f) => {
    const t = f / FPS;
    const c = (((t * 4 + phase) % 1) + 1) % 1; // 0-1 dans le cycle
    const onGround = c < contactShare;
    const y = onGround ? 0.9 : 0.9 - 0.12 * Math.sin(((c - contactShare) / (1 - contactShare)) * Math.PI);
    const lm: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, v: 0.95 }));
    const other: Landmark = { x: 0.5, y: 0.9, v: 0.95 };
    for (const i of [LM.leftAnkle, LM.leftHeel, LM.leftFootIndex]) lm[i] = { x: 0.5, y, v: 0.95 };
    for (const i of [LM.rightAnkle, LM.rightHeel, LM.rightFootIndex]) lm[i] = other;
    return { frame: f, time: t, lm };
  });
}

describe('appuis automatiques', () => {
  it('retrouve appuis et décollages du pied gauche, à une ou deux images près', () => {
    const s = series(240, 0.5);
    const ev = suggestFootEvents(s).filter((e) => e.side === 'G');
    const on = ev.filter((e) => e.type === 'appui');
    const off = ev.filter((e) => e.type === 'decollage');
    expect(on.length).toBeGreaterThanOrEqual(5);
    expect(off.length).toBeGreaterThanOrEqual(5);
    // Cycle de 30 images : appui aux images 15 + 30k, décollage 12 images plus tard.
    for (const e of on) expect(Math.abs((((e.frame - 15) % 30) + 45) % 30 - 15)).toBeLessThanOrEqual(2);
    for (const e of off) expect(Math.abs((((e.frame - 27) % 30) + 45) % 30 - 15)).toBeLessThanOrEqual(2);
  });
  it('ne propose rien si le pied ne bouge pas', () => {
    expect(suggestFootEvents(series(120, 0.5, 1))).toEqual([]);
  });
  it('ignore un pied invisible', () => {
    const s = series(240, 0.5).map((p) => ({ ...p, lm: p.lm!.map((l) => ({ ...l, v: 0.1 })) }));
    expect(suggestFootEvents(s)).toEqual([]);
  });
});

function blobImage(cx: number, cy: number, w = 120, h = 80): Gray {
  const data = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = Math.hypot(x - cx, y - cy);
    data[y * w + x] = 40 + Math.round(180 * Math.exp(-(d * d) / 18)) + ((x * 7 + y * 13) % 11);
  }
  return { width: w, height: h, data };
}

describe('suivi de motif', () => {
  it('suit un point qui se déplace', () => {
    let x = 30, y = 40;
    let prev = blobImage(x, y);
    for (let i = 0; i < 10; i++) {
      const nx = x + 5, ny = y - 1.5;
      const next = blobImage(nx, ny);
      const r = trackTemplate(prev, next, x, y)!;
      expect(Math.abs(r.x - nx)).toBeLessThan(1.2);
      expect(Math.abs(r.y - ny)).toBeLessThan(1.2);
      expect(r.score).toBeGreaterThan(0.8);
      x = r.x; y = r.y; prev = next;
    }
  });
  it('signale un motif perdu', () => {
    const r = trackTemplate(blobImage(30, 40), blobImage(30, 40, 120, 80).data.fill(100) && { width: 120, height: 80, data: new Uint8ClampedArray(120 * 80).fill(100) }, 30, 40)!;
    expect(r.score).toBeLessThan(0.5);
  });
});
