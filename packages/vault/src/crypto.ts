import { toBlob, type StorageProvider } from './provider.js';

/**
 * Chiffrement du coffre sur un fournisseur quelconque (disque, WebDAV, S3…).
 * - Contenu : AES-256-GCM, par blocs de 4 Mio (les vidéos ne sont jamais chargées en entier).
 * - Clé : PBKDF2-SHA256 à partir d'une phrase secrète et d'un sel aléatoire stocké en clair.
 * - Les noms de fichiers (chemins) ne sont PAS chiffrés : ils ne contiennent que des identifiants
 *   et des empreintes. Les tailles de fichiers restent visibles.
 * - Chaque bloc est authentifié avec son chemin, son rang et un indicateur « dernier bloc » : un
 *   fichier tronqué, réordonné ou copié sous un autre nom est refusé.
 *
 * Format d'un fichier : « FLE1 » · taille de bloc (u32, gros-boutiste) · [IV 12 o · texte chiffré + étiquette 16 o]…
 */
export const ENCRYPTION_KEY = 'encryption.json';
const MAGIC = new Uint8Array([0x46, 0x4c, 0x45, 0x31]); // « FLE1 »
const DEFAULT_CHUNK = 4 * 1024 * 1024;
export const DEFAULT_ITERATIONS = 600_000;
const IV = 12;
const TAG = 16;

export class WrongPassphraseError extends Error {
  constructor() {
    super('Phrase secrète incorrecte.');
    this.name = 'WrongPassphraseError';
  }
}

export class DecryptionError extends Error {
  constructor(key: string) {
    super(`Fichier chiffré illisible ou altéré : ${key}`);
    this.name = 'DecryptionError';
  }
}

interface EncryptionHeader {
  format: 'foulee-encryption';
  version: 1;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  /** Sel, en base64. */
  salt: string;
  /** « foulee » chiffré : permet de vérifier la phrase sans lire de données. */
  check: string;
}

const enc = new TextEncoder();
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const buf = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: buf(salt), iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

function aad(key: string, index: number, last: boolean): Uint8Array {
  const k = enc.encode(key);
  const out = new Uint8Array(k.length + 5);
  out.set(k);
  new DataView(out.buffer).setUint32(k.length, index);
  out[k.length + 4] = last ? 1 : 0;
  return out;
}

async function encryptChunk(cryptoKey: CryptoKey, plain: Uint8Array, additional: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: buf(additional) }, cryptoKey, buf(plain)));
  const out = new Uint8Array(IV + ct.length);
  out.set(iv);
  out.set(ct, IV);
  return out;
}

export interface EncryptedProviderOptions {
  /** Itérations PBKDF2 pour un nouveau coffre (ignorées si l'en-tête existe). */
  iterations?: number;
  chunkSize?: number;
}

export class EncryptedProvider implements StorageProvider {
  readonly name: string;

  private constructor(
    private readonly inner: StorageProvider,
    private readonly cryptoKey: CryptoKey,
    private readonly chunkSize: number,
  ) {
    this.name = `${inner.name} (chiffré)`;
  }

  /** Le fournisseur contient-il un coffre chiffré ? */
  static async isEncrypted(inner: StorageProvider): Promise<boolean> {
    return inner.exists(ENCRYPTION_KEY);
  }

  /**
   * Ouvre un coffre chiffré avec la phrase secrète. Crée l'en-tête si le fournisseur est vide
   * (`createIfMissing`) ; refuse d'ouvrir comme chiffré un fournisseur qui contient déjà des données en clair.
   */
  static async open(inner: StorageProvider, passphrase: string, options: EncryptedProviderOptions & { createIfMissing?: boolean } = {}): Promise<EncryptedProvider> {
    const chunkSize = options.chunkSize ?? DEFAULT_CHUNK;
    const headerBlob = await inner.read(ENCRYPTION_KEY);
    if (headerBlob) {
      const header = JSON.parse(await headerBlob.text()) as EncryptionHeader;
      if (header.format !== 'foulee-encryption' || header.version !== 1) throw new Error('Format de chiffrement inconnu.');
      const key = await deriveKey(passphrase, unb64(header.salt), header.iterations);
      try {
        const check = unb64(header.check);
        await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf(check.subarray(0, IV)), additionalData: buf(aad('check', 0, true)) }, key, buf(check.subarray(IV)));
      } catch {
        throw new WrongPassphraseError();
      }
      return new EncryptedProvider(inner, key, chunkSize);
    }
    if (!options.createIfMissing) throw new Error('Ce stockage ne contient pas de coffre chiffré.');
    if ((await inner.list()).length > 0) throw new Error('Ce stockage contient déjà des données non chiffrées : choisis un emplacement vide.');
    if (passphrase.length < 8) throw new Error('La phrase secrète doit faire au moins 8 caractères.');
    const iterations = options.iterations ?? DEFAULT_ITERATIONS;
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(passphrase, salt, iterations);
    const check = await encryptChunk(key, enc.encode('foulee'), aad('check', 0, true));
    const header: EncryptionHeader = { format: 'foulee-encryption', version: 1, kdf: 'PBKDF2-SHA256', iterations, salt: b64(salt), check: b64(check) };
    await inner.write(ENCRYPTION_KEY, JSON.stringify(header));
    return new EncryptedProvider(inner, key, chunkSize);
  }

  async read(key: string): Promise<Blob | null> {
    if (key === ENCRYPTION_KEY) return this.inner.read(key);
    const blob = await this.inner.read(key);
    return blob ? this.decrypt(key, blob) : null;
  }

  async write(key: string, data: Blob | string | Uint8Array): Promise<void> {
    const blob = toBlob(data);
    const parts: Uint8Array[] = [MAGIC, new Uint8Array(4)];
    new DataView(parts[1]!.buffer).setUint32(0, this.chunkSize);
    const total = Math.max(1, Math.ceil(blob.size / this.chunkSize));
    for (let i = 0; i < total; i++) {
      const plain = new Uint8Array(await blob.slice(i * this.chunkSize, (i + 1) * this.chunkSize).arrayBuffer());
      parts.push(await encryptChunk(this.cryptoKey, plain, aad(key, i, i === total - 1)));
    }
    await this.inner.write(key, new Blob(parts.map((p) => buf(p))));
  }

  async list(prefix = ''): Promise<string[]> {
    return (await this.inner.list(prefix)).filter((k) => k !== ENCRYPTION_KEY);
  }
  delete(key: string): Promise<void> {
    return this.inner.delete(key);
  }
  exists(key: string): Promise<boolean> {
    return this.inner.exists(key);
  }

  private async decrypt(key: string, blob: Blob): Promise<Blob> {
    const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
    if (head.length < 8 || MAGIC.some((b, i) => head[i] !== b)) throw new DecryptionError(key);
    const chunkSize = new DataView(head.buffer).getUint32(4);
    const stride = IV + chunkSize + TAG;
    const body = blob.size - 8;
    if (body < IV + TAG) throw new DecryptionError(key);
    const total = Math.ceil(body / stride);
    const out: ArrayBuffer[] = [];
    try {
      for (let i = 0; i < total; i++) {
        const raw = new Uint8Array(await blob.slice(8 + i * stride, 8 + (i + 1) * stride).arrayBuffer());
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf(raw.subarray(0, IV)), additionalData: buf(aad(key, i, i === total - 1)) }, this.cryptoKey, buf(raw.subarray(IV)));
        out.push(plain);
      }
    } catch {
      throw new DecryptionError(key);
    }
    return new Blob(out);
  }
}
