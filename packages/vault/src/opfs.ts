import { assertKey, toBlob, type StorageProvider } from './provider.js';

/**
 * Fournisseur OPFS (Origin Private File System), disponible sur Safari/iOS,
 * Chrome/Android et ordinateur. Les gros fichiers sont écrits en flux : via
 * `createWritable` quand il existe, sinon dans un Worker avec
 * `createSyncAccessHandle` (seule méthode d'écriture sur certains Safari).
 */
export class OpfsProvider implements StorageProvider {
  readonly name = 'navigateur (OPFS)';
  private rootPromise: Promise<FileSystemDirectoryHandle> | undefined;

  constructor(private readonly baseDir = 'foulee-vault') {}

  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.storage && typeof navigator.storage.getDirectory === 'function';
  }

  private root(): Promise<FileSystemDirectoryHandle> {
    this.rootPromise ??= navigator.storage
      .getDirectory()
      .then((r) => r.getDirectoryHandle(this.baseDir, { create: true }));
    return this.rootPromise;
  }

  private async dir(parts: string[], create: boolean): Promise<FileSystemDirectoryHandle | null> {
    let d = await this.root();
    for (const p of parts) {
      try {
        d = await d.getDirectoryHandle(p, { create });
      } catch (e) {
        if (!create && isNotFound(e)) return null;
        throw e;
      }
    }
    return d;
  }

  private async fileHandle(key: string, create: boolean): Promise<FileSystemFileHandle | null> {
    const parts = assertKey(key);
    const name = parts.pop()!;
    const d = await this.dir(parts, create);
    if (!d) return null;
    try {
      return await d.getFileHandle(name, { create });
    } catch (e) {
      if (!create && isNotFound(e)) return null;
      throw e;
    }
  }

  async read(key: string): Promise<Blob | null> {
    const fh = await this.fileHandle(key, false);
    return fh ? fh.getFile() : null;
  }

  async write(key: string, data: Blob | string | Uint8Array): Promise<void> {
    const blob = toBlob(data);
    const fh = await this.fileHandle(key, true);
    if (!fh) throw new Error(`Impossible de créer ${key}`);
    if ('createWritable' in fh && typeof fh.createWritable === 'function') {
      const w = await fh.createWritable();
      await blob.stream().pipeTo(w);
      return;
    }
    await writeViaWorker(this.baseDir, assertKey(key), blob);
  }

  async list(prefix = ''): Promise<string[]> {
    const out: string[] = [];
    const parts = prefix.split('/').filter(Boolean);
    // Le préfixe désigne un dossier (« trials/ ») ou un début de nom.
    const dirParts = prefix.endsWith('/') ? parts : parts.slice(0, -1);
    const d = await this.dir(dirParts, false);
    if (!d) return out;
    await walk(d, dirParts.length ? dirParts.join('/') + '/' : '', out);
    return out.filter((k) => k.startsWith(prefix)).sort();
  }

  async delete(key: string): Promise<void> {
    const parts = assertKey(key);
    const name = parts.pop()!;
    const d = await this.dir(parts, false);
    if (!d) return;
    try {
      await d.removeEntry(name);
    } catch (e) {
      if (!isNotFound(e)) throw e;
    }
  }

  async exists(key: string): Promise<boolean> {
    return (await this.fileHandle(key, false)) !== null;
  }
}

async function walk(d: FileSystemDirectoryHandle, path: string, out: string[]): Promise<void> {
  // `entries()` est disponible partout où OPFS l'est, mais pas encore dans lib.dom.
  const iter = (d as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries();
  for await (const [name, handle] of iter) {
    if (handle.kind === 'file') out.push(path + name);
    else await walk(handle as FileSystemDirectoryHandle, path + name + '/', out);
  }
}

function isNotFound(e: unknown): boolean {
  return e instanceof DOMException && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError');
}

let worker: Worker | undefined;
let seq = 0;
const pending = new Map<number, { resolve: () => void; reject: (e: Error) => void }>();

function writeViaWorker(baseDir: string, parts: string[], blob: Blob): Promise<void> {
  worker ??= createWorker();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker!.postMessage({ id, baseDir, parts, blob });
  });
}

function createWorker(): Worker {
  const w = new Worker(new URL('./opfs-writer.worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (ev: MessageEvent<{ id: number; error?: string }>) => {
    const p = pending.get(ev.data.id);
    if (!p) return;
    pending.delete(ev.data.id);
    if (ev.data.error) p.reject(new Error(ev.data.error));
    else p.resolve();
  };
  return w;
}
