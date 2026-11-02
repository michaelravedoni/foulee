/// <reference lib="webworker" />
/** Écriture en flux dans OPFS avec createSyncAccessHandle (repli Safari). */

interface SyncHandle {
  truncate(size: number): void;
  write(buffer: BufferSource, opts: { at: number }): number;
  flush(): void;
  close(): void;
}

self.onmessage = async (ev: MessageEvent<{ id: number; baseDir: string; parts: string[]; blob: Blob }>) => {
  const { id, baseDir, parts, blob } = ev.data;
  try {
    let d = await (await navigator.storage.getDirectory()).getDirectoryHandle(baseDir, { create: true });
    const names = [...parts];
    const file = names.pop()!;
    for (const p of names) d = await d.getDirectoryHandle(p, { create: true });
    const fh = await d.getFileHandle(file, { create: true });
    const access = await (fh as unknown as { createSyncAccessHandle(): Promise<SyncHandle> }).createSyncAccessHandle();
    try {
      access.truncate(0);
      let at = 0;
      const reader = blob.stream().getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        at += access.write(value, { at });
      }
      access.flush();
    } finally {
      access.close();
    }
    self.postMessage({ id });
  } catch (e) {
    self.postMessage({ id, error: e instanceof Error ? e.message : String(e) });
  }
};
