import { HttpStorageError } from './webdav.js';
import { assertKey, toBlob, type StorageProvider } from './provider.js';

export interface S3Options {
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Point d'accès compatible S3 (MinIO, Wasabi, Scaleway…) ; vide pour AWS. */
  endpoint?: string;
  /** Préfixe de « dossier » dans le seau, ex. « foulee/ ». */
  prefix?: string;
  fetch?: typeof fetch;
}

const te = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const buf = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
async function sha256Hex(data: string | Uint8Array): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? buf(te.encode(data)) : buf(data)));
}
async function hmac(key: Uint8Array | ArrayBuffer, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key instanceof Uint8Array ? buf(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, buf(te.encode(data)));
}
const rfc3986 = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export interface SignInput {
  method: string;
  url: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** En-têtes à signer (hors `host` et `x-amz-date`, ajoutés ici). */
  headers?: Record<string, string>;
  /** Empreinte SHA-256 du contenu, ou « UNSIGNED-PAYLOAD ». */
  payloadHash: string;
  date: Date;
}

/** Signature AWS Signature Version 4. Renvoie les en-têtes à envoyer (dont Authorization). */
export async function signV4(i: SignInput): Promise<Record<string, string>> {
  const u = new URL(i.url);
  const amzDate = i.date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = { ...(i.headers ?? {}), host: u.host, 'x-amz-date': amzDate };
  const names = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, ' ')]));
  const canonicalHeaders = names.map((n) => `${n}:${lower[n]}\n`).join('');
  const query = [...u.searchParams.entries()]
    .map(([k, v]) => [rfc3986(k), rfc3986(v)] as const)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const canonicalPath = u.pathname.split('/').map((s) => rfc3986(decodeURIComponent(s))).join('/') || '/';
  const signed = names.join(';');
  const canonical = [i.method, canonicalPath, query, canonicalHeaders, signed, i.payloadHash].join('\n');
  const scope = `${day}/${i.region}/${i.service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonical)].join('\n');
  let k: ArrayBuffer = await hmac(te.encode(`AWS4${i.secretAccessKey}`), day);
  k = await hmac(k, i.region);
  k = await hmac(k, i.service);
  k = await hmac(k, 'aws4_request');
  const signature = hex(await hmac(k, toSign));
  return { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${i.accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}` };
}

/** Fournisseur S3 (AWS et services compatibles). Le seau doit autoriser le CORS pour l'application. */
export class S3Provider implements StorageProvider {
  readonly name: string;
  private readonly f: typeof fetch;
  private readonly prefix: string;

  constructor(private readonly o: S3Options) {
    this.prefix = (o.prefix ?? '').replace(/^\/+/, '').replace(/\/*$/, '/').replace(/^\/$/, '');
    this.name = `S3 (${o.bucket})`;
    this.f = o.fetch ?? ((...a) => fetch(...a));
  }

  private urlFor(key: string, query = ''): string {
    const path = key ? key.split('/').map(rfc3986).join('/') : '';
    if (this.o.endpoint) return `${this.o.endpoint.replace(/\/+$/, '')}/${this.o.bucket}/${path}${query}`;
    return `https://${this.o.bucket}.s3.${this.o.region}.amazonaws.com/${path}${query}`;
  }

  private async call(method: string, key: string, query = '', body?: Blob) {
    const url = this.urlFor(key, query);
    const payloadHash = body ? 'UNSIGNED-PAYLOAD' : await sha256Hex('');
    const headers = await signV4({
      method,
      url,
      region: this.o.region,
      service: 's3',
      accessKeyId: this.o.accessKeyId,
      secretAccessKey: this.o.secretAccessKey,
      headers: { 'x-amz-content-sha256': payloadHash },
      payloadHash,
      date: new Date(),
    });
    delete headers.host; // posé par le navigateur
    return this.f(url, { method, headers, ...(body ? { body } : {}) });
  }

  async read(key: string): Promise<Blob | null> {
    assertKey(key);
    const r = await this.call('GET', this.prefix + key);
    if (r.status === 404) return null;
    if (!r.ok) throw new HttpStorageError(r.status, `Lecture de ${key}`);
    return r.blob();
  }
  async write(key: string, data: Blob | string | Uint8Array): Promise<void> {
    assertKey(key);
    const r = await this.call('PUT', this.prefix + key, '', toBlob(data));
    if (!r.ok) throw new HttpStorageError(r.status, `Écriture de ${key}`);
  }
  async exists(key: string): Promise<boolean> {
    assertKey(key);
    const r = await this.call('HEAD', this.prefix + key);
    if (r.status === 404) return false;
    if (!r.ok) throw new HttpStorageError(r.status, `Test de ${key}`);
    return true;
  }
  async delete(key: string): Promise<void> {
    assertKey(key);
    const r = await this.call('DELETE', this.prefix + key);
    if (!r.ok && r.status !== 404) throw new HttpStorageError(r.status, `Suppression de ${key}`);
  }
  async list(prefix = ''): Promise<string[]> {
    const out: string[] = [];
    let token = '';
    for (;;) {
      const q = `?list-type=2&prefix=${rfc3986(this.prefix + prefix)}${token ? `&continuation-token=${rfc3986(token)}` : ''}`;
      const r = await this.call('GET', '', q);
      if (!r.ok) throw new HttpStorageError(r.status, 'Liste des fichiers');
      const xml = await r.text();
      for (const m of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) out.push(decodeXml(m[1]!).slice(this.prefix.length));
      const next = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)?.[1];
      if (/<IsTruncated>true<\/IsTruncated>/.test(xml) && next) token = decodeXml(next);
      else break;
    }
    return out.sort();
  }
}

function decodeXml(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
