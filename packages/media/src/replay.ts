import { BufferTarget, EncodedPacket, EncodedVideoPacketSource, Mp4OutputFormat, Output } from 'mediabunny';

/**
 * Replay différé (module coach-loop) : la caméra filme en continu, l'image
 * est encodée en mémoire (WebCodecs, quelques Mo par minute) et jusqu'à trois
 * vues la rediffusent avec un retard réglable. Les N dernières secondes
 * peuvent être enregistrées comme essai.
 * Sans encodeur vidéo, repli sur un tampon d'images réduites.
 */

interface Entry {
  seq: number;
  /** µs depuis le début de la capture */
  ts: number;
  key: boolean;
  data: Uint8Array;
  duration: number;
}

interface View {
  canvas: HTMLCanvasElement;
  delay: number;
  decoder: VideoDecoder | null;
  nextSeq: number;
  needsReset: boolean;
  /** Dernière image affichée (µs) */
  shownTs: number;
}

export interface ReplayOptions {
  fps?: number;
  /** Largeur de capture (la hauteur suit le format de la caméra). */
  width?: number;
  /** Retard maximal à conserver (s). */
  maxDelay?: number;
}

export interface ReplayStatus {
  mode: 'encode' | 'images';
  bufferedSeconds: number;
  bufferBytes: number;
}

const CODECS: { config: string; short: 'avc' | 'vp8' | 'vp9' }[] = [
  { config: 'avc1.42E01F', short: 'avc' },
  { config: 'vp8', short: 'vp8' },
  { config: 'vp09.00.10.08', short: 'vp9' },
];

export class DelayedReplay {
  readonly fps: number;
  readonly maxDelay: number;
  private width: number;
  private height = 0;
  private readonly capture = document.createElement('canvas');
  private readonly views: View[] = [];
  private entries: Entry[] = [];
  private bitmaps: { ts: number; bmp: ImageBitmap }[] = [];
  private encoder: VideoEncoder | null = null;
  private codec: (typeof CODECS)[number] | null = null;
  private decoderConfig: VideoDecoderConfig | null = null;
  private startTime = 0;
  private frameNo = 0;
  private seq = 0;
  private timer: number | undefined;
  private raf: number | undefined;
  private running = false;
  mode: 'encode' | 'images' = 'encode';

  constructor(
    private readonly live: HTMLVideoElement,
    opts: ReplayOptions = {},
  ) {
    this.fps = opts.fps ?? 30;
    this.width = opts.width ?? 960;
    this.maxDelay = opts.maxDelay ?? 30;
  }

  async start(): Promise<void> {
    const vw = this.live.videoWidth || 1280;
    const vh = this.live.videoHeight || 720;
    this.width = Math.min(this.width, vw);
    this.width -= this.width % 2;
    this.height = Math.round((this.width * vh) / vw / 2) * 2;
    this.capture.width = this.width;
    this.capture.height = this.height;
    await this.setupEncoder();
    this.startTime = performance.now();
    this.running = true;
    this.timer = window.setInterval(() => this.grab(), 1000 / (this.mode === 'encode' ? this.fps : Math.min(this.fps, 15)));
    const loop = () => {
      if (!this.running) return;
      this.render();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private async setupEncoder(): Promise<void> {
    if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined') {
      this.mode = 'images';
      return;
    }
    for (const c of CODECS) {
      const config: VideoEncoderConfig = {
        codec: c.config,
        width: this.width,
        height: this.height,
        bitrate: 2_500_000,
        framerate: this.fps,
        latencyMode: 'realtime',
        ...(c.short === 'avc' ? { avc: { format: 'avc' as const } } : {}),
      };
      try {
        const support = await VideoEncoder.isConfigSupported(config);
        if (!support.supported) continue;
        const dec = await VideoDecoder.isConfigSupported({ codec: c.config, codedWidth: this.width, codedHeight: this.height });
        if (!dec.supported) continue;
        this.codec = c;
        this.encoder = new VideoEncoder({
          output: (chunk, meta) => this.onChunk(chunk, meta),
          error: () => {
            this.mode = 'images';
            this.encoder = null;
          },
        });
        this.encoder.configure(config);
        this.mode = 'encode';
        return;
      } catch {
        // essaie le codec suivant
      }
    }
    this.mode = 'images';
  }

  private grab(): void {
    if (!this.running || this.live.readyState < 2) return;
    const ctx = this.capture.getContext('2d')!;
    ctx.drawImage(this.live, 0, 0, this.width, this.height);
    const ts = Math.round((performance.now() - this.startTime) * 1000);
    if (this.mode === 'encode' && this.encoder) {
      if (this.encoder.encodeQueueSize > 4) return; // appareil trop lent : on saute une image
      const frame = new VideoFrame(this.capture, { timestamp: ts, duration: Math.round(1e6 / this.fps) });
      this.encoder.encode(frame, { keyFrame: this.frameNo++ % this.fps === 0 });
      frame.close();
    } else {
      void createImageBitmap(this.capture, { resizeWidth: Math.min(640, this.width), resizeQuality: 'low' }).then((bmp) => {
        this.bitmaps.push({ ts, bmp });
        const cutoff = ts - (this.maxDelay + 1) * 1e6;
        while (this.bitmaps.length && this.bitmaps[0]!.ts < cutoff) this.bitmaps.shift()!.bmp.close();
      });
    }
  }

  private onChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): void {
    if (meta?.decoderConfig) this.decoderConfig = meta.decoderConfig;
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    this.entries.push({ seq: this.seq++, ts: chunk.timestamp, key: chunk.type === 'key', data, duration: chunk.duration ?? 0 });
    // Élague en gardant toujours une image clé au début du tampon.
    const cutoff = chunk.timestamp - (this.maxDelay + 2) * 1e6;
    let firstKeep = 0;
    for (let i = 1; i < this.entries.length; i++) {
      const e = this.entries[i]!;
      if (e.ts > cutoff) break;
      if (e.key) firstKeep = i;
    }
    if (firstKeep > 0) this.entries.splice(0, firstKeep);
  }

  addView(canvas: HTMLCanvasElement, delay: number): void {
    canvas.width = this.width || 960;
    canvas.height = this.height || 540;
    this.views.push({ canvas, delay, decoder: null, nextSeq: -1, needsReset: true, shownTs: -1 });
  }

  removeView(canvas: HTMLCanvasElement): void {
    const i = this.views.findIndex((v) => v.canvas === canvas);
    if (i < 0) return;
    const [v] = this.views.splice(i, 1);
    if (v?.decoder && v.decoder.state !== 'closed') v.decoder.close();
  }

  setDelay(canvas: HTMLCanvasElement, delay: number): void {
    const v = this.views.find((x) => x.canvas === canvas);
    if (!v) return;
    v.delay = delay;
    v.needsReset = true;
  }

  private nowTs(): number {
    return (performance.now() - this.startTime) * 1000;
  }

  private render(): void {
    const now = this.nowTs();
    for (const v of this.views) {
      if (v.canvas.width !== this.width && this.width) {
        v.canvas.width = this.width;
        v.canvas.height = this.height;
      }
      const target = now - v.delay * 1e6;
      if (target < 0) continue;
      if (this.mode === 'images') this.renderBitmap(v, target);
      else this.renderDecoded(v, target);
    }
  }

  private renderBitmap(v: View, target: number): void {
    let best: ImageBitmap | null = null;
    for (const b of this.bitmaps) {
      if (b.ts <= target) best = b.bmp;
      else break;
    }
    if (best) v.canvas.getContext('2d')!.drawImage(best, 0, 0, v.canvas.width, v.canvas.height);
  }

  private renderDecoded(v: View, target: number): void {
    if (!this.decoderConfig || this.entries.length === 0) return;
    const first = this.entries[0]!.seq;
    if (v.needsReset || !v.decoder || v.decoder.state === 'closed' || v.nextSeq < first) {
      // Repart de la dernière image clé avant la cible.
      let start = -1;
      for (const e of this.entries) {
        if (e.ts > target) break;
        if (e.key) start = e.seq;
      }
      if (start < 0) return;
      if (v.decoder && v.decoder.state !== 'closed') v.decoder.close();
      const ctx = v.canvas.getContext('2d')!;
      v.decoder = new VideoDecoder({
        output: (frame) => {
          ctx.drawImage(frame, 0, 0, v.canvas.width, v.canvas.height);
          v.shownTs = frame.timestamp;
          frame.close();
        },
        error: () => {
          v.needsReset = true;
        },
      });
      v.decoder.configure(this.decoderConfig);
      v.nextSeq = start;
      v.needsReset = false;
    }
    const dec = v.decoder!;
    for (let i = v.nextSeq - first; i < this.entries.length; i++) {
      const e = this.entries[i]!;
      if (e.ts > target) break;
      dec.decode(new EncodedVideoChunk({ type: e.key ? 'key' : 'delta', timestamp: e.ts, duration: e.duration, data: e.data }));
      v.nextSeq = e.seq + 1;
    }
  }

  status(): ReplayStatus {
    const list = this.mode === 'encode' ? this.entries.map((e) => e.ts) : this.bitmaps.map((b) => b.ts);
    const span = list.length > 1 ? (list[list.length - 1]! - list[0]!) / 1e6 : 0;
    const bytes =
      this.mode === 'encode' ? this.entries.reduce((s, e) => s + e.data.byteLength, 0) : this.bitmaps.length * Math.min(640, this.width) * 360 * 4;
    return { mode: this.mode, bufferedSeconds: span, bufferBytes: bytes };
  }

  get canSave(): boolean {
    return this.mode === 'encode' && !!this.decoderConfig && !!this.codec;
  }

  /** Enregistre les `seconds` dernières secondes en MP4 (null si impossible). */
  async saveLast(seconds: number): Promise<Blob | null> {
    if (!this.canSave || this.entries.length === 0) return null;
    await this.encoder?.flush().catch(() => undefined);
    const end = this.entries[this.entries.length - 1]!.ts;
    const from = end - seconds * 1e6;
    let startIdx = 0;
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i]!;
      if (e.ts > from) break;
      if (e.key) startIdx = i;
    }
    const slice = this.entries.slice(startIdx);
    const base = slice[0]!.ts;
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
    const source = new EncodedVideoPacketSource(this.codec!.short);
    output.addVideoTrack(source, { frameRate: this.fps });
    await output.start();
    let first = true;
    for (const e of slice) {
      const packet = new EncodedPacket(e.data, e.key ? 'key' : 'delta', (e.ts - base) / 1e6, e.duration / 1e6);
      await source.add(packet, first ? { decoderConfig: this.decoderConfig! } : undefined);
      first = false;
    }
    await output.finalize();
    const buf = output.target.buffer;
    return buf ? new Blob([buf], { type: 'video/mp4' }) : null;
  }

  stop(): void {
    this.running = false;
    if (this.timer !== undefined) clearInterval(this.timer);
    if (this.raf !== undefined) cancelAnimationFrame(this.raf);
    if (this.encoder && this.encoder.state !== 'closed') this.encoder.close();
    for (const v of this.views) if (v.decoder && v.decoder.state !== 'closed') v.decoder.close();
    for (const b of this.bitmaps) b.bmp.close();
    this.bitmaps = [];
    this.entries = [];
  }
}
