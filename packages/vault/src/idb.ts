import { assertKey, toBlob, withTimeout, type StorageProvider } from './provider.js';

/**
 * Fournisseur IndexedDB : repli quand OPFS ne répond pas (certains profils
 * Safari). Un enregistrement par clé, la valeur est le Blob du fichier.
 */
export class IdbProvider implements StorageProvider {
  readonly name = 'navigateur (IndexedDB)';
  private dbPromise: Promise<IDBDatabase> | undefined;

  constructor(
    private readonly dbName = 'foulee-vault-idb',
    private readonly factory: IDBFactory = indexedDB,
  ) {}

  static isSupported(): boolean {
    return typeof indexedDB !== 'undefined';
  }

  private db(): Promise<IDBDatabase> {
    this.dbPromise ??= withTimeout(
      new Promise<IDBDatabase>((resolve, reject) => {
        const req = this.factory.open(this.dbName, 1);
        req.onupgradeneeded = () => req.result.createObjectStore('files');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('Ouverture d’IndexedDB impossible.'));
        req.onblocked = () => reject(new Error('IndexedDB est bloqué par un autre onglet.'));
      }),
      10_000,
      'ouverture d’IndexedDB',
    ).catch((e) => {
      this.dbPromise = undefined;
      throw e;
    });
    return this.dbPromise;
  }

  private async run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>, ms = 30_000): Promise<T> {
    const db = await this.db();
    return withTimeout(
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction('files', mode);
        const req = fn(tx.objectStore('files'));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error ?? req.error);
        tx.onabort = () => reject(tx.error ?? new Error('Transaction IndexedDB annulée.'));
      }),
      ms,
      'IndexedDB',
    );
  }

  async read(key: string): Promise<Blob | null> {
    assertKey(key);
    const v = await this.run<Blob | undefined>('readonly', (s) => s.get(key));
    return v ?? null;
  }

  async write(key: string, data: Blob | string | Uint8Array): Promise<void> {
    assertKey(key);
    const blob = toBlob(data);
    await this.run('readwrite', (s) => s.put(blob, key), 30_000 + blob.size / 1000);
  }

  async list(prefix = ''): Promise<string[]> {
    const range = prefix ? IDBKeyRange.bound(prefix, prefix + '￿') : undefined;
    const keys = await this.run<IDBValidKey[]>('readonly', (s) => s.getAllKeys(range));
    return keys.map(String).sort();
  }

  async delete(key: string): Promise<void> {
    assertKey(key);
    await this.run('readwrite', (s) => s.delete(key));
  }

  async exists(key: string): Promise<boolean> {
    assertKey(key);
    return (await this.run<number>('readonly', (s) => s.count(key))) > 0;
  }
}
