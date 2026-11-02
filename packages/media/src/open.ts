import { FrameTimeline } from '@foulee/core';
import { WebCodecsFrameSource, VideoElementFrameSource, type FrameSource } from './frame-source.js';
import { probeVideo, type ProbedVideo } from './probe.js';

export interface OpenedVideo {
  source: FrameSource;
  /** Informations du conteneur ; absentes si seul le navigateur a pu lire le fichier. */
  probe: Omit<ProbedVideo, 'input' | 'track'> | null;
  /** Vrai si la chronologie est estimée (conteneur illisible). */
  estimated: boolean;
}

export function webCodecsAvailable(): boolean {
  return typeof VideoDecoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

/**
 * Ouvre une vidéo pour la lecture image par image, avec la meilleure méthode
 * disponible : WebCodecs, sinon <video> + requestVideoFrameCallback guidé par
 * les vrais horodatages, sinon une chronologie estimée.
 */
export async function openFrameSource(blob: Blob, opts: { forceFallback?: boolean } = {}): Promise<OpenedVideo> {
  let probed: ProbedVideo | null = null;
  try {
    probed = await probeVideo(blob);
  } catch {
    probed = null;
  }
  if (probed) {
    const { input, track, ...info } = probed;
    if (!opts.forceFallback && probed.canDecode && webCodecsAvailable()) {
      return {
        source: new WebCodecsFrameSource(input, track, probed.timeline, probed.width, probed.height),
        probe: info,
        estimated: false,
      };
    }
    input.dispose();
    const source = new VideoElementFrameSource(URL.createObjectURL(blob), probed.timeline, probed.width, probed.height);
    return { source, probe: info, estimated: false };
  }
  // Dernier recours : le navigateur lit le fichier mais pas notre démuxeur.
  const url = URL.createObjectURL(blob);
  const meta = await readVideoElementMeta(url);
  const timeline = FrameTimeline.uniform(30, meta.duration);
  return { source: new VideoElementFrameSource(url, timeline, meta.width, meta.height), probe: null, estimated: true };
}

function readVideoElementMeta(url: string): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'metadata';
    v.onloadedmetadata = () => resolve({ duration: v.duration, width: v.videoWidth, height: v.videoHeight });
    v.onerror = () => reject(new Error('Ce fichier vidéo n’est pas lisible sur cet appareil.'));
    v.src = url;
  });
}
