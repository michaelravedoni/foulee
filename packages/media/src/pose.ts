import type { FrameTimeline, Landmark, PoseSample } from '@foulee/core';
import type { FrameImage } from './frame-source.js';

/** Moteur d'estimation de pose : interchangeable (MediaPipe aujourd'hui, un autre modèle demain). */
export interface PoseEstimator {
  readonly name: string;
  /** Pose d'une image ; `timeMs` doit croître d'un appel à l'autre. Null si personne n'est détecté. */
  estimate(image: FrameImage, timeMs: number): Promise<Landmark[] | null>;
  dispose(): void;
}

export interface MediaPipeOptions {
  /** Dossier des fichiers WebAssembly de MediaPipe (servis par l'application). */
  wasmBase: string;
  /** Fichier du modèle (.task). Téléchargé une fois puis gardé dans le cache du navigateur. */
  modelUrl: string;
  onStatus?: (message: string) => void;
}

export const POSE_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task';
const CACHE = 'foulee-models';

/** Télécharge le modèle une seule fois (cache du navigateur), avec progression. */
export async function loadModelBytes(url: string, onStatus?: (m: string) => void): Promise<Uint8Array> {
  const cache = typeof caches !== 'undefined' ? await caches.open(CACHE).catch(() => null) : null;
  let res = cache ? await cache.match(url) : undefined;
  if (!res) {
    onStatus?.('Téléchargement du modèle (6 Mo, une seule fois)…');
    const net = await fetch(url);
    if (!net.ok) throw new Error(`modèle indisponible (${net.status})`);
    if (cache) await cache.put(url, net.clone()).catch(() => undefined);
    res = net;
  }
  return new Uint8Array(await res.arrayBuffer());
}

export async function createMediaPipeEstimator(opts: MediaPipeOptions): Promise<PoseEstimator> {
  opts.onStatus?.('Chargement du moteur…');
  const [{ FilesetResolver, PoseLandmarker }, bytes] = await Promise.all([import('@mediapipe/tasks-vision'), loadModelBytes(opts.modelUrl, opts.onStatus)]);
  const vision = await FilesetResolver.forVisionTasks(opts.wasmBase);
  opts.onStatus?.('Préparation du modèle…');
  const make = (delegate: 'GPU' | 'CPU') =>
    PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetBuffer: bytes, delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.4,
      minPosePresenceConfidence: 0.4,
      minTrackingConfidence: 0.4,
    });
  let landmarker;
  let delegate = 'GPU';
  try {
    landmarker = await make('GPU');
  } catch {
    delegate = 'CPU';
    landmarker = await make('CPU');
  }
  let last = 0;
  return {
    name: `MediaPipe BlazePose lite (${delegate})`,
    async estimate(image, timeMs) {
      last = Math.max(last + 1, Math.round(timeMs));
      const r = landmarker.detectForVideo(image as ImageBitmap | HTMLCanvasElement, last);
      const pts = r.landmarks[0];
      return pts ? pts.map((p) => ({ x: p.x, y: p.y, v: p.visibility ?? 0 })) : null;
    },
    dispose() {
      landmarker.close();
    },
  };
}

export interface PoseRunOptions {
  from: number;
  to: number;
  /** Une image sur `step`. */
  step: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

/** Estime la pose sur une plage d'images (séquentiel, pour que le suivi temporel du modèle serve). */
export async function estimatePoses(
  estimator: PoseEstimator,
  grab: (frame: number) => Promise<FrameImage | null | undefined>,
  timeline: FrameTimeline,
  opts: PoseRunOptions,
): Promise<PoseSample[]> {
  const frames: number[] = [];
  for (let f = opts.from; f <= opts.to; f += opts.step) frames.push(f);
  const out: PoseSample[] = [];
  for (let i = 0; i < frames.length; i++) {
    if (opts.signal?.aborted) break;
    const f = frames[i]!;
    const img = await grab(f);
    if (!img) continue;
    const time = timeline.timeOf(f);
    const lm = await estimator.estimate(img, time * 1000);
    out.push({ frame: f, time, lm });
    opts.onProgress?.(i + 1, frames.length);
  }
  return out;
}
