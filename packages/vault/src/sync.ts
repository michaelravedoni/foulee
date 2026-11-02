import { ENCRYPTION_KEY } from './crypto.js';
import { MANIFEST_KEY } from './layout.js';
import type { StorageProvider } from './provider.js';

export interface SyncProgress {
  done: number;
  total: number;
  key: string;
}

export interface SyncOptions {
  onProgress?: (p: SyncProgress) => void;
  signal?: AbortSignal;
  /** Écrase le manifeste de destination (restauration sur un nouvel appareil). */
  adoptManifest?: boolean;
  /** Supprime de la destination les fichiers absents de la source. */
  deleteExtra?: boolean;
}

export interface SyncReport {
  copied: number;
  skipped: number;
  deleted: number;
  bytes: number;
  errors: { key: string; message: string }[];
}

export class VaultMismatchError extends Error {
  constructor() {
    super('Cet emplacement contient un autre coffre (identifiant différent).');
    this.name = 'VaultMismatchError';
  }
}

async function vaultId(p: StorageProvider): Promise<string | null> {
  const b = await p.read(MANIFEST_KEY);
  if (!b) return null;
  try {
    return (JSON.parse(await b.text()) as { vaultId?: string }).vaultId ?? null;
  } catch {
    return null;
  }
}

function updatedAtOf(text: string): number {
  try {
    const t = Date.parse((JSON.parse(text) as { updatedAt?: string }).updatedAt ?? '');
    return Number.isFinite(t) ? t : NaN;
  } catch {
    return NaN;
  }
}

/** Les médias et proxys portent leur empreinte dans leur nom : s'ils existent, ils sont identiques. */
const isImmutable = (key: string) => key.startsWith('media/') && !key.endsWith('.json') ? true : key.startsWith('proxies/');

/**
 * Copie de `from` vers `to` tout ce qui manque ou est plus récent (champ `updatedAt` des fichiers JSON).
 * Refuse de mélanger deux coffres différents, sauf `adoptManifest`.
 */
export async function syncProviders(from: StorageProvider, to: StorageProvider, options: SyncOptions = {}): Promise<SyncReport> {
  const report: SyncReport = { copied: 0, skipped: 0, deleted: 0, bytes: 0, errors: [] };
  const [srcId, dstId] = await Promise.all([vaultId(from), vaultId(to)]);
  if (srcId && dstId && srcId !== dstId && !options.adoptManifest) throw new VaultMismatchError();

  const keys = (await from.list()).filter((k) => k !== ENCRYPTION_KEY);
  const existing = new Set(await to.list());
  let done = 0;
  for (const key of keys) {
    if (options.signal?.aborted) throw new DOMException('Synchronisation annulée', 'AbortError');
    options.onProgress?.({ done, total: keys.length, key });
    try {
      let copy = !existing.has(key);
      if (!copy && key === MANIFEST_KEY) copy = !!options.adoptManifest && srcId !== dstId;
      else if (!copy && !isImmutable(key) && key.endsWith('.json')) {
        const [a, b] = await Promise.all([from.read(key), to.read(key)]);
        if (a && b) {
          const [ta, tb] = await Promise.all([a.text(), b.text()]);
          if (ta !== tb) {
            const [ua, ub] = [updatedAtOf(ta), updatedAtOf(tb)];
            copy = Number.isNaN(ub) || (!Number.isNaN(ua) && ua > ub);
          }
        }
      }
      if (copy) {
        const blob = await from.read(key);
        if (blob) {
          await to.write(key, blob);
          report.copied++;
          report.bytes += blob.size;
        }
      } else report.skipped++;
    } catch (e) {
      report.errors.push({ key, message: e instanceof Error ? e.message : String(e) });
    }
    done++;
  }
  if (options.deleteExtra) {
    const keep = new Set(keys);
    for (const key of existing) {
      if (key === ENCRYPTION_KEY || keep.has(key)) continue;
      try {
        await to.delete(key);
        report.deleted++;
      } catch (e) {
        report.errors.push({ key, message: e instanceof Error ? e.message : String(e) });
      }
    }
  }
  options.onProgress?.({ done, total: keys.length, key: '' });
  return report;
}

/**
 * Miroir : chaque écriture va au fournisseur principal, puis est recopiée en arrière-plan sur les miroirs.
 * Une panne d'un miroir n'empêche jamais d'écrire en local ; les fichiers en attente sont retentés par `flush()`.
 */
export class MirrorProvider implements StorageProvider {
  readonly name: string;
  private readonly pending = new Map<string, 'write' | 'delete'>();
  private running: Promise<void> | null = null;
  lastError = '';

  constructor(
    private readonly primary: StorageProvider,
    private readonly mirrors: StorageProvider[],
    private readonly onChange?: () => void,
  ) {
    this.name = primary.name;
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  read(key: string) {
    return this.primary.read(key);
  }
  list(prefix?: string) {
    return this.primary.list(prefix);
  }
  exists(key: string) {
    return this.primary.exists(key);
  }
  async write(key: string, data: Blob | string | Uint8Array): Promise<void> {
    await this.primary.write(key, data);
    this.pending.set(key, 'write');
    this.kick();
  }
  async delete(key: string): Promise<void> {
    await this.primary.delete(key);
    this.pending.set(key, 'delete');
    this.kick();
  }

  private kick(): void {
    this.onChange?.();
    this.running ??= this.drain().finally(() => {
      this.running = null;
      this.onChange?.();
    });
  }

  private async drain(): Promise<void> {
    for (const [key, op] of [...this.pending]) {
      try {
        const blob = op === 'write' ? await this.primary.read(key) : null;
        for (const m of this.mirrors) {
          if (blob) await m.write(key, blob);
          else await m.delete(key);
        }
        if (this.pending.get(key) === op) this.pending.delete(key);
        this.lastError = '';
      } catch (e) {
        this.lastError = e instanceof Error ? e.message : String(e);
        return; // on réessaiera au prochain flush
      }
    }
  }

  /** Réessaie les copies en attente ; résout quand la file est vide ou bloquée. */
  async flush(): Promise<void> {
    if (this.pending.size) this.kick();
    await this.running;
  }
}
