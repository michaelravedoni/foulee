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
  // Canvas dédié, présent dans la page (certains navigateurs, dont Safari, refusent WebGL sur un canvas hors écran).
  const makeCanvas = () => {
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    c.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;pointer-events:none';
    c.setAttribute('aria-hidden', 'true');
    document.body.appendChild(c);
    return c;
  };
  const canvases: HTMLCanvasElement[] = [];
  const make = (delegate: 'GPU' | 'CPU') => {
    const canvas = makeCanvas();
    canvases.push(canvas);
    return PoseLandmarker.createFromOptions(vision, {
      canvas,
      baseOptions: { modelAssetBuffer: bytes, delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.4,
      minPosePresenceConfidence: 0.4,
      minTrackingConfidence: 0.4,
    });
  };
  // Le mode GPU peut sembler démarrer puis échouer à la première image (contexte WebGL absent ou refusé,
  // fréquent sur iPad et certains navigateurs) : on le vérifie sur une image d'essai, sinon on passe au processeur.
  const probe = (lm: Awaited<ReturnType<typeof make>>, ts: number) => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    c.getContext('2d')!.fillRect(0, 0, 64, 64);
    lm.detectForVideo(c, ts);
  };
  let landmarker: Awaited<ReturnType<typeof make>> | undefined;
  let delegate = 'CPU';
  try {
    const gpu = await make('GPU');
    try {
      probe(gpu, 1);
      landmarker = gpu;
      delegate = 'GPU';
    } catch {
      gpu.close();
    }
  } catch {
    // pas de GPU : on passe au processeur
  }
  landmarker ??= await make('CPU');
  try {
    probe(landmarker, 2);
  } catch (e) {
    landmarker.close();
    throw new Error(
      /activeTexture|WebGL|context/i.test(String(e))
        ? 'le calcul graphique (WebGL) est indisponible ou refusé dans ce navigateur. Essaie Chrome ou Edge sur ordinateur, ou ferme d’autres onglets.'
        : String(e),
    );
  }
  let last = 2;
  const detect = (image: FrameImage) => {
    const r = landmarker!.detectForVideo(image as ImageBitmap | HTMLCanvasElement, last);
    const pts = r.landmarks[0];
    return pts ? pts.map((p) => ({ x: p.x, y: p.y, v: p.visibility ?? 0 })) : null;
  };
  return {
    get name() {
      return `MediaPipe BlazePose lite (${delegate})`;
    },
    async estimate(image, timeMs) {
      last = Math.max(last + 1, Math.round(timeMs));
      try {
        return detect(image);
      } catch (e) {
        if (delegate !== 'GPU') throw e;
        // Le contexte GPU a été perdu en cours d'analyse : on reprend sur le processeur.
        landmarker!.close();
        landmarker = await make('CPU');
        delegate = 'CPU';
        last = Math.max(last + 1, Math.round(timeMs));
        return detect(image);
      }
    },
    dispose() {
      landmarker?.close();
      for (const c of canvases) c.remove();
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
