/// <reference lib="webworker" />
import { createProxy } from './proxy.js';

self.onmessage = async (ev: MessageEvent<{ id: number; blob: Blob; maxSide?: number }>) => {
  const { id, blob, maxSide } = ev.data;
  try {
    const proxy = await createProxy(blob, {
      maxSide,
      onProgress: (p) => self.postMessage({ id, progress: p }),
    });
    self.postMessage({ id, done: true, proxy });
  } catch (e) {
    self.postMessage({ id, done: true, error: e instanceof Error ? e.message : String(e) });
  }
};
