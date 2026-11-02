/**
 * Interface unique de stockage. Toute la logique du coffre passe par elle :
 * navigateur (OPFS), mémoire (tests), puis disque, WebDAV, S3, archive ZIP.
 * Une clé est un chemin relatif avec des « / » (ex. « athletes/ath_x.json »).
 */
export interface StorageProvider {
  readonly name: string;
  read(key: string): Promise<Blob | null>;
  write(key: string, data: Blob | string | Uint8Array): Promise<void>;
  /** Liste récursive des clés commençant par `prefix` (ex. « trials/ »). */
  list(prefix?: string): Promise<string[]>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

export class InvalidKeyError extends Error {
  constructor(key: string) {
    super(`Clé de stockage invalide : « ${key} »`);
    this.name = 'InvalidKeyError';
  }
}

export function assertKey(key: string): string[] {
  const parts = key.split('/');
  if (!key || key.startsWith('/') || parts.some((p) => p === '' || p === '.' || p === '..' || p.includes('\\')))
    throw new InvalidKeyError(key);
  return parts;
}

export function toBlob(data: Blob | string | Uint8Array, type = ''): Blob {
  if (data instanceof Blob) return data;
  if (typeof data === 'string') return new Blob([data], { type: type || 'application/json' });
  return new Blob([data as Uint8Array<ArrayBuffer>], { type });
}

/** Fournisseur en mémoire : tests et essais rapides. */
export class MemoryProvider implements StorageProvider {
  readonly name = 'mémoire';
  private readonly files = new Map<string, Blob>();

  async read(key: string): Promise<Blob | null> {
    assertKey(key);
    return this.files.get(key) ?? null;
  }
  async write(key: string, data: Blob | string | Uint8Array): Promise<void> {
    assertKey(key);
    this.files.set(key, toBlob(data));
  }
  async list(prefix = ''): Promise<string[]> {
    return [...this.files.keys()].filter((k) => k.startsWith(prefix)).sort();
  }
  async delete(key: string): Promise<void> {
    assertKey(key);
    this.files.delete(key);
  }
  async exists(key: string): Promise<boolean> {
    assertKey(key);
    return this.files.has(key);
  }
}

export class StorageTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`Le stockage ne répond pas (${label}, plus de ${Math.round(ms / 1000)} s).`);
    this.name = 'StorageTimeoutError';
  }
}

/** Rejette si l'opération de stockage ne répond pas : mieux qu'un écran bloqué. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new StorageTimeoutError(label, ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
