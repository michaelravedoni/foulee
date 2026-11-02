/** Génère le proxy dans un Web Worker pour ne pas bloquer l'interface. */
let worker: Worker | undefined;
let seq = 0;
const jobs = new Map<number, { resolve: (b: Blob | null) => void; reject: (e: Error) => void; onProgress?: (p: number) => void }>();

export function canCreateProxy(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof Worker !== 'undefined';
}

export function createProxyInWorker(blob: Blob, onProgress?: (p: number) => void, maxSide?: number): Promise<Blob | null> {
  if (!worker) {
    worker = new Worker(new URL('./proxy.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<{ id: number; progress?: number; done?: boolean; proxy?: Blob | null; error?: string }>) => {
      const job = jobs.get(ev.data.id);
      if (!job) return;
      if (ev.data.progress !== undefined && !ev.data.done) {
        job.onProgress?.(ev.data.progress);
        return;
      }
      jobs.delete(ev.data.id);
      if (ev.data.error) job.reject(new Error(ev.data.error));
      else job.resolve(ev.data.proxy ?? null);
    };
  }
  const id = ++seq;
  return new Promise((resolve, reject) => {
    jobs.set(id, { resolve, reject, onProgress });
    worker!.postMessage({ id, blob, maxSide });
  });
}
