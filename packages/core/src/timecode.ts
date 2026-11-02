export type TimecodeMode = 'image' | 'ms' | 'hms';

/** Formate un nombre avec la virgule décimale française. */
export function frNumber(value: number, digits = 0): string {
  return value.toFixed(digits).replace('.', ',').replace('-', '−');
}

/** Formate une durée en secondes en h:mm:ss,mmm (ou m:ss,mmm). */
export function formatHms(seconds: number): string {
  const sign = seconds < 0 ? '−' : '';
  let ms = Math.round(Math.abs(seconds) * 1000);
  const h = Math.floor(ms / 3_600_000);
  ms -= h * 3_600_000;
  const m = Math.floor(ms / 60_000);
  ms -= m * 60_000;
  const s = Math.floor(ms / 1000);
  ms -= s * 1000;
  const core = `${String(m).padStart(h > 0 ? 2 : 1, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
  return sign + (h > 0 ? `${h}:${core}` : core);
}

export interface TimecodeInput {
  /** Image courante (index absolu). */
  frame: number;
  /** Image définie comme origine (t = 0). */
  originFrame: number;
  /** Temps média de l'image courante et de l'origine (s). */
  time: number;
  originTime: number;
  /** Facteur temps réel (voir realTimeScale). */
  scale?: number;
}

export function formatTimecode(mode: TimecodeMode, input: TimecodeInput): string {
  const relFrame = input.frame - input.originFrame;
  const relTime = (input.time - input.originTime) * (input.scale ?? 1);
  switch (mode) {
    case 'image':
      return `img ${relFrame < 0 ? '−' : ''}${Math.abs(relFrame)}`;
    case 'ms':
      return `${frNumber(relTime * 1000, 1)} ms`;
    case 'hms':
      return formatHms(relTime);
  }
}
