import { POSE_MODEL_URL, createMediaPipeEstimator, type PoseEstimator } from '@foulee/media';

let pending: Promise<PoseEstimator> | null = null;

/** Un seul moteur pour toute l'application ; chargé à la première utilisation. */
export function getPoseEstimator(onStatus?: (m: string) => void): Promise<PoseEstimator> {
  pending ??= createMediaPipeEstimator({
    wasmBase: `${import.meta.env.BASE_URL}mediapipe/wasm`,
    modelUrl: POSE_MODEL_URL,
    ...(onStatus ? { onStatus } : {}),
  }).catch((e) => {
    pending = null; // permet de réessayer
    throw e;
  });
  return pending;
}
