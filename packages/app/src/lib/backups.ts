import {
  DirectoryProvider,
  EncryptedProvider,
  S3Provider,
  WebDavProvider,
  type StorageProvider,
} from '@foulee/vault';

export type BackupKind = 'webdav' | 'dir' | 's3';

export interface BackupTarget {
  id: string;
  kind: BackupKind;
  label: string;
  encrypted: boolean;
  lastBackupAt?: string;
  /** WebDAV */
  url?: string;
  username?: string;
  password?: string;
  /** S3 */
  endpoint?: string;
  region?: string;
  bucket?: string;
  prefix?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

const KEY = 'foulee.backups.v1';

export function loadTargets(): BackupTarget[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as BackupTarget[]) : [];
  } catch {
    return [];
  }
}
export function saveTargets(list: BackupTarget[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // stockage indisponible : la configuration ne sera pas conservée
  }
}

// Les poignées de dossier ne se sérialisent pas en JSON : elles vivent dans IndexedDB.
const DB = 'foulee-handles';
function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('h');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function putHandle(id: string, handle: FileSystemDirectoryHandle): Promise<void> {
  const d = await db();
  await new Promise<void>((res, rej) => {
    const tx = d.transaction('h', 'readwrite');
    tx.objectStore('h').put(handle, id);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function getHandle(id: string): Promise<FileSystemDirectoryHandle | undefined> {
  const d = await db();
  return new Promise((res, rej) => {
    const r = d.transaction('h').objectStore('h').get(id);
    r.onsuccess = () => res(r.result as FileSystemDirectoryHandle | undefined);
    r.onerror = () => rej(r.error);
  });
}
export async function deleteHandle(id: string): Promise<void> {
  const d = await db();
  await new Promise<void>((res) => {
    const tx = d.transaction('h', 'readwrite');
    tx.objectStore('h').delete(id);
    tx.oncomplete = () => res();
    tx.onerror = () => res();
  });
}

/** Fournisseur brut (sans chiffrement) pour une destination. */
export async function rawProvider(t: BackupTarget): Promise<StorageProvider> {
  if (t.kind === 'webdav') {
    if (!t.url) throw new Error('Adresse WebDAV manquante.');
    return new WebDavProvider({ url: t.url, ...(t.username ? { username: t.username, password: t.password ?? '' } : {}) });
  }
  if (t.kind === 's3') {
    if (!t.bucket || !t.region || !t.accessKeyId || !t.secretAccessKey) throw new Error('Configuration S3 incomplète.');
    return new S3Provider({
      region: t.region,
      bucket: t.bucket,
      accessKeyId: t.accessKeyId,
      secretAccessKey: t.secretAccessKey,
      ...(t.endpoint ? { endpoint: t.endpoint } : {}),
      ...(t.prefix ? { prefix: t.prefix } : {}),
    });
  }
  const handle = await getHandle(t.id);
  if (!handle) throw new Error('Dossier introuvable : choisis-le à nouveau.');
  const p = new DirectoryProvider(handle);
  if (!(await p.ensurePermission())) throw new Error('Autorisation refusée pour ce dossier.');
  return p;
}

/** Fournisseur prêt à l'emploi : chiffré si la destination l'est (phrase secrète requise). */
export async function openTarget(t: BackupTarget, passphrase: string, create: boolean): Promise<StorageProvider> {
  const raw = await rawProvider(t);
  if (!t.encrypted) return raw;
  return EncryptedProvider.open(raw, passphrase, { createIfMissing: create });
}
