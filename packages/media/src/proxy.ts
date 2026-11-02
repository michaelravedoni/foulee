import { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output, QUALITY_LOW } from 'mediabunny';

export interface ProxyOptions {
  /** Grand côté maximal du proxy (défaut 960 px). */
  maxSide?: number;
  onProgress?: (progress: number) => void;
}

/**
 * Crée un proxy basse résolution (H.264, sans son) qui conserve toutes les
 * images et leurs horodatages : la lecture fluide utilise le proxy, la mesure
 * image par image utilise toujours l'original.
 * Renvoie null si l'appareil ne sait pas encoder.
 */
export async function createProxy(blob: Blob, opts: ProxyOptions = {}): Promise<Blob | null> {
  const maxSide = opts.maxSide ?? 960;
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return null;
    const [w, h] = await Promise.all([track.getDisplayWidth(), track.getDisplayHeight()]);
    const scale = Math.min(1, maxSide / Math.max(w, h));
    const width = Math.round((w * scale) / 2) * 2;
    const height = Math.round((h * scale) / 2) * 2;
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
    const conversion = await Conversion.init({
      input,
      output,
      tracks: 'primary',
      video: { width, height, fit: 'fill', codec: 'avc', bitrate: QUALITY_LOW, forceTranscode: true },
      audio: { discard: true },
      showWarnings: false,
    });
    if (!conversion.isValid) return null;
    if (opts.onProgress) conversion.onProgress = (p) => opts.onProgress?.(p);
    await conversion.execute();
    const buffer = output.target.buffer;
    return buffer ? new Blob([buffer], { type: 'video/mp4' }) : null;
  } finally {
    input.dispose();
  }
}
