import { ALL_FORMATS, AudioBufferSink, BlobSource, Input } from 'mediabunny';
import { detectOnsets, peakEnvelope, soundDelaySeconds, type SoundOnset } from '@foulee/core';

export interface AudioScan {
  onsets: SoundOnset[];
  /** Durée analysée (s). */
  scannedS: number;
}

export class NoAudioError extends Error {
  constructor() {
    super('Cette vidéo n’a pas de piste audio.');
    this.name = 'NoAudioError';
  }
}

/**
 * Lit la piste audio (jusqu'à `maxS` secondes), construit l'enveloppe de crête et
 * renvoie les attaques sonores détectées, la plus forte d'abord. Les temps sont
 * ceux du conteneur, comme ceux des images.
 */
export async function scanAudioOnsets(blob: Blob, opts: { maxS?: number; distanceM?: number } = {}): Promise<AudioScan> {
  const { maxS = 120, distanceM = 0 } = opts;
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new NoAudioError();
    const sink = new AudioBufferSink(track);
    const hopS = 0.002;
    const parts: { start: number; env: Float32Array }[] = [];
    let first = Infinity;
    let end = 0;
    for await (const { buffer, timestamp } of sink.buffers(0, maxS)) {
      const ch = buffer.getChannelData(0);
      parts.push({ start: timestamp, env: peakEnvelope(ch, buffer.sampleRate, hopS) });
      first = Math.min(first, timestamp);
      end = Math.max(end, timestamp + buffer.duration);
    }
    if (!parts.length) throw new NoAudioError();
    const total = Math.ceil((end - first) / hopS) + 1;
    const env = new Float32Array(total);
    for (const p of parts) {
      const offset = Math.round((p.start - first) / hopS);
      for (let i = 0; i < p.env.length && offset + i < total; i++) if (p.env[i]! > env[offset + i]!) env[offset + i] = p.env[i]!;
    }
    const delay = soundDelaySeconds(distanceM);
    const onsets = detectOnsets(env, hopS, first).map((o) => ({ ...o, time: o.time - delay }));
    return { onsets, scannedS: end - first };
  } finally {
    input.dispose();
  }
}
