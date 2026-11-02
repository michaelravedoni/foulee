import { ALL_FORMATS, BlobSource, EncodedPacketSink, Input, type InputVideoTrack } from 'mediabunny';
import { FrameTimeline } from '@foulee/core';

export interface ProbedVideo {
  input: Input;
  track: InputVideoTrack;
  timeline: FrameTimeline;
  /** Dimensions d'affichage (rotation appliquée). */
  width: number;
  height: number;
  rotation: number;
  codec: string | null;
  /** Le navigateur sait-il décoder cette piste avec WebCodecs ? */
  canDecode: boolean;
  durationS: number;
  mime: string;
}

export class UnsupportedVideoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedVideoError';
  }
}

/**
 * Lit le conteneur (MP4, MOV, WebM…) et construit la chronologie exacte des
 * images à partir des horodatages des paquets, sans décoder la vidéo.
 */
export async function probeVideo(blob: Blob): Promise<ProbedVideo> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  let track: InputVideoTrack | null;
  try {
    track = await input.getPrimaryVideoTrack();
  } catch (e) {
    input.dispose();
    throw new UnsupportedVideoError(`Format de fichier non reconnu (${e instanceof Error ? e.message : String(e)})`);
  }
  if (!track) {
    input.dispose();
    throw new UnsupportedVideoError('Aucune piste vidéo dans ce fichier.');
  }
  const [width, height, rotation, codec, canDecode, mime] = await Promise.all([
    track.getDisplayWidth(),
    track.getDisplayHeight(),
    track.getRotation(),
    track.getCodec(),
    track.canDecode().catch(() => false),
    input.getMimeType().catch(() => blob.type || 'video/mp4'),
  ]);
  const sink = new EncodedPacketSink(track);
  const times: number[] = [];
  let lastDuration: number | undefined;
  for await (const packet of sink.packets(undefined, undefined, { metadataOnly: true })) {
    times.push(packet.timestamp);
    lastDuration = packet.duration > 0 ? packet.duration : lastDuration;
  }
  if (times.length === 0) {
    input.dispose();
    throw new UnsupportedVideoError('La piste vidéo ne contient aucune image.');
  }
  const timeline = new FrameTimeline(times, lastDuration);
  return {
    input,
    track,
    timeline,
    width,
    height,
    rotation,
    codec,
    canDecode,
    durationS: timeline.duration,
    mime,
  };
}
