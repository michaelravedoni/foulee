import { VideoSampleSink, type InputVideoTrack, type Input, type VideoSample } from 'mediabunny';
import type { FrameTimeline } from '@foulee/core';

/** Image décodée, prête à être dessinée avec drawImage. */
export type FrameImage = ImageBitmap | HTMLCanvasElement;

function closeImage(img: FrameImage): void {
  if ('close' in img) img.close();
}

/**
 * Copie indépendante de la source (les canvas du décodeur sont réutilisés).
 * Certains Safari refusent createImageBitmap sur un canvas hors écran : on
 * recopie alors dans un canvas ordinaire.
 */
async function snapshot(src: CanvasImageSource, width: number, height: number): Promise<FrameImage> {
  try {
    return await createImageBitmap(src as ImageBitmapSource);
  } catch {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    c.getContext('2d')!.drawImage(src, 0, 0, width, height);
    return c;
  }
}

/**
 * Source d'images exactes : renvoie l'image n° i de la vidéo, quelle que soit
 * la méthode (WebCodecs, ou élément <video> + requestVideoFrameCallback).
 */
export interface FrameSource {
  readonly kind: 'webcodecs' | 'video-element';
  readonly timeline: FrameTimeline;
  readonly width: number;
  readonly height: number;
  /** Image n° i ; `null` si une demande plus récente l'a remplacée. */
  getFrame(index: number): Promise<FrameImage | null>;
  dispose(): void;
}

/** Plafond du grand côté des images décodées (mémoire sur iPad). */
const MAX_SIDE = 1920;
/** Nombre d'images gardées en cache (pas arrière instantanés). */
const CACHE_SIZE = 24;
/** Images décodées en plus avant la cible lors d'un saut (quasi gratuites). */
const PREFETCH_BACK = 12;
/** Au-delà de cet écart, on relance le décodage depuis l'image clé. */
const MAX_FORWARD_RUN = 90;

function fitSize(w: number, h: number): { width: number; height: number } {
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  return { width: Math.max(2, Math.round((w * scale) / 2) * 2), height: Math.max(2, Math.round((h * scale) / 2) * 2) };
}

class LruCache {
  private map = new Map<number, FrameImage>();
  constructor(private readonly size: number) {}
  get(k: number): FrameImage | undefined {
    const v = this.map.get(k);
    if (v) {
      this.map.delete(k);
      this.map.set(k, v);
    }
    return v;
  }
  set(k: number, v: FrameImage): void {
    const old = this.map.get(k);
    if (old && old !== v) closeImage(old);
    this.map.delete(k);
    this.map.set(k, v);
    while (this.map.size > this.size) {
      const first = this.map.keys().next().value as number;
      { const f = this.map.get(first); if (f) closeImage(f); }
      this.map.delete(first);
    }
  }
  has(k: number): boolean {
    return this.map.has(k);
  }
  clear(): void {
    for (const v of this.map.values()) closeImage(v);
    this.map.clear();
  }
}

/**
 * Décodage exact via WebCodecs (Mediabunny). Un itérateur avance image par
 * image pour les pas avant ; les sauts et pas arrière relancent le décodage
 * depuis l'image clé et remplissent un cache.
 */
export class WebCodecsFrameSource implements FrameSource {
  readonly kind = 'webcodecs' as const;
  readonly width: number;
  readonly height: number;
  private readonly sink: VideoSampleSink;
  private readonly cache = new LruCache(CACHE_SIZE);
  private iter: AsyncGenerator<VideoSample> | null = null;
  private iterLast = -1;
  private target = -1;
  private busy: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(
    private readonly input: Input,
    track: InputVideoTrack,
    readonly timeline: FrameTimeline,
    displayWidth: number,
    displayHeight: number,
  ) {
    const size = fitSize(displayWidth, displayHeight);
    this.width = size.width;
    this.height = size.height;
    this.sink = new VideoSampleSink(track);
  }

  getFrame(index: number): Promise<FrameImage | null> {
    const i = this.timeline.clamp(index);
    const hit = this.cache.get(i);
    if (hit) {
      this.target = i;
      return Promise.resolve(hit);
    }
    this.target = i;
    const run = this.busy.then(() => this.decodeTo(i));
    this.busy = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async decodeTo(i: number): Promise<FrameImage | null> {
    if (this.disposed) return null;
    if (this.target !== i) return this.cache.get(i) ?? null; // remplacée par une demande plus récente
    const cached = this.cache.get(i);
    if (cached) return cached;
    const continueForward = this.iter && this.iterLast < i && i - this.iterLast <= MAX_FORWARD_RUN;
    if (!continueForward) {
      await this.iter?.return(undefined);
      const start = Math.max(0, i - PREFETCH_BACK);
      this.iter = this.sink.samples(this.timeline.timeOf(start));
      this.iterLast = start - 1;
    }
    while (this.iter) {
      const r = await this.iter.next();
      if (r.done) {
        this.iter = null;
        break;
      }
      const idx = this.timeline.frameAt(r.value.timestamp);
      this.iterLast = idx;
      const sample = r.value;
      let bmp: FrameImage;
      try {
        // Copie dans un canvas ordinaire : ni OffscreenCanvas ni createImageBitmap (capricieux sous Safari).
        const c = document.createElement('canvas');
        c.width = this.width;
        c.height = this.height;
        sample.draw(c.getContext('2d')!, 0, 0, this.width, this.height);
        bmp = c;
      } finally {
        sample.close();
      }
      if (this.disposed) {
        closeImage(bmp);
        return null;
      }
      this.cache.set(idx, bmp);
      if (idx >= i) break;
      // Une demande plus récente vers l'arrière : inutile de continuer.
      if (this.target !== i && this.target < idx) break;
    }
    return this.cache.get(i) ?? this.nearestCached(i);
  }

  private nearestCached(i: number): FrameImage | null {
    for (let d = 1; d < 4; d++) {
      const v = this.cache.get(i - d);
      if (v) return v;
    }
    return null;
  }

  dispose(): void {
    this.disposed = true;
    void this.iter?.return(undefined);
    this.iter = null;
    this.cache.clear();
    this.input.dispose();
  }
}

/**
 * Repli sans WebCodecs : un élément <video> caché est positionné au milieu de
 * l'image voulue, puis on attend que l'image soit réellement présentée
 * (requestVideoFrameCallback) avant de la copier.
 */
export class VideoElementFrameSource implements FrameSource {
  readonly kind = 'video-element' as const;
  readonly width: number;
  readonly height: number;
  private readonly video: HTMLVideoElement;
  private readonly cache = new LruCache(8);
  private busy: Promise<unknown> = Promise.resolve();
  private target = -1;
  private ready: Promise<void>;

  constructor(
    private readonly url: string,
    readonly timeline: FrameTimeline,
    width: number,
    height: number,
  ) {
    const size = fitSize(width, height);
    this.width = size.width;
    this.height = size.height;
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.src = url;
    this.video = v;
    this.ready = new Promise((resolve, reject) => {
      v.addEventListener('loadeddata', () => resolve(), { once: true });
      v.addEventListener('error', () => reject(new Error('Lecture vidéo impossible dans ce navigateur.')), { once: true });
    });
  }

  getFrame(index: number): Promise<FrameImage | null> {
    const i = this.timeline.clamp(index);
    const hit = this.cache.get(i);
    this.target = i;
    if (hit) return Promise.resolve(hit);
    const run = this.busy.then(async () => {
      if (this.target !== i) return null;
      await this.ready;
      const t = this.timeline.timeOf(i) + this.timeline.durationOf(i) / 2;
      await seekPresented(this.video, t);
      const bmp = await snapshot(this.video, this.width, this.height);
      this.cache.set(i, bmp);
      return bmp;
    });
    this.busy = run.catch(() => undefined);
    return run;
  }

  dispose(): void {
    this.cache.clear();
    this.video.removeAttribute('src');
    this.video.load();
    URL.revokeObjectURL(this.url);
  }
}

function seekPresented(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(() => finish());
    video.addEventListener('seeked', () => setTimeout(finish, 'requestVideoFrameCallback' in video ? 150 : 30), { once: true });
    video.currentTime = t;
  });
}
