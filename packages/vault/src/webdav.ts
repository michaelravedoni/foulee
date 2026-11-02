import { assertKey, toBlob, type StorageProvider } from './provider.js';

export interface WebDavOptions {
  /** Adresse du dossier du coffre, ex. https://cloud.exemple.ch/remote.php/dav/files/moi/foulee */
  url: string;
  username?: string;
  password?: string;
  fetch?: typeof fetch;
}

export class HttpStorageError extends Error {
  constructor(
    readonly status: number,
    action: string,
  ) {
    super(`${action} : le serveur a répondu ${status}.`);
    this.name = 'HttpStorageError';
  }
}

const enc = (key: string) => key.split('/').map(encodeURIComponent).join('/');

/** Fournisseur WebDAV (Nextcloud, ownCloud, serveurs NAS). Le serveur doit autoriser le CORS pour l'application. */
export class WebDavProvider implements StorageProvider {
  readonly name: string;
  private readonly base: string;
  private readonly auth: Record<string, string>;
  private readonly f: typeof fetch;
  private readonly made = new Set<string>();

  constructor(opts: WebDavOptions) {
    this.base = opts.url.replace(/\/+$/, '');
    this.name = `WebDAV (${new URL(this.base).host})`;
    this.auth = opts.username ? { Authorization: `Basic ${btoa(unescape(encodeURIComponent(`${opts.username}:${opts.password ?? ''}`)))}` } : {};
    this.f = opts.fetch ?? ((...a) => fetch(...a));
  }

  private url(key: string): string {
    assertKey(key);
    return `${this.base}/${enc(key)}`;
  }

  private req(method: string, url: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
    return this.f(url, { ...init, method, headers: { ...this.auth, ...init.headers } });
  }

  async read(key: string): Promise<Blob | null> {
    const r = await this.req('GET', this.url(key));
    if (r.status === 404) return null;
    if (!r.ok) throw new HttpStorageError(r.status, `Lecture de ${key}`);
    return r.blob();
  }

  async write(key: string, data: Blob | string | Uint8Array): Promise<void> {
    const parts = assertKey(key);
    parts.pop();
    let path = '';
    for (const p of parts) {
      path += `${p}/`;
      if (this.made.has(path)) continue;
      const r = await this.req('MKCOL', `${this.base}/${enc(path.slice(0, -1))}`);
      // 201 créé ; 405 existe déjà ; 301 selon certains serveurs
      if (!(r.status === 201 || r.status === 405 || r.status === 301 || r.status === 200)) throw new HttpStorageError(r.status, `Création du dossier ${path}`);
      this.made.add(path);
    }
    const r = await this.req('PUT', this.url(key), { body: toBlob(data) });
    if (!r.ok) throw new HttpStorageError(r.status, `Écriture de ${key}`);
  }

  async exists(key: string): Promise<boolean> {
    const r = await this.req('HEAD', this.url(key));
    if (r.status === 404) return false;
    if (!r.ok) throw new HttpStorageError(r.status, `Test de ${key}`);
    return true;
  }

  async delete(key: string): Promise<void> {
    const r = await this.req('DELETE', this.url(key));
    if (!r.ok && r.status !== 404) throw new HttpStorageError(r.status, `Suppression de ${key}`);
  }

  async list(prefix = ''): Promise<string[]> {
    const dirParts = prefix.endsWith('/') ? prefix.split('/').filter(Boolean) : prefix.split('/').filter(Boolean).slice(0, -1);
    const out: string[] = [];
    await this.walk(dirParts.join('/'), out);
    return out.filter((k) => k.startsWith(prefix)).sort();
  }

  private async walk(dir: string, out: string[]): Promise<void> {
    const url = dir ? `${this.base}/${enc(dir)}/` : `${this.base}/`;
    const r = await this.req('PROPFIND', url, { headers: { Depth: '1', 'Content-Type': 'application/xml' }, body: '<?xml version="1.0"?><propfind xmlns="DAV:"><prop><resourcetype/></prop></propfind>' });
    if (r.status === 404) return;
    if (r.status !== 207 && !r.ok) throw new HttpStorageError(r.status, `Liste de ${dir || 'la racine'}`);
    const basePath = new URL(this.base).pathname.replace(/\/+$/, '');
    const here = `${basePath}/${dir ? enc(dir) + '/' : ''}`;
    for (const entry of parseMultistatus(await r.text())) {
      let path = entry.href.startsWith('http') ? new URL(entry.href).pathname : entry.href;
      path = path.replace(/\/+$/, entry.isDir ? '' : '/x').replace(/\/x$/, '');
      const relEnc = path.startsWith(basePath + '/') ? path.slice(basePath.length + 1) : null;
      if (relEnc === null || `${basePath}/${relEnc}/` === here || `${basePath}/${relEnc}` === here.replace(/\/$/, '')) continue;
      const rel = relEnc.split('/').map(decodeURIComponent).join('/');
      if (entry.isDir) await this.walk(rel, out);
      else out.push(rel);
    }
  }
}

/** Lecture minimale d'une réponse PROPFIND : adresse et type (dossier ou fichier) de chaque entrée. */
export function parseMultistatus(xml: string): { href: string; isDir: boolean }[] {
  const out: { href: string; isDir: boolean }[] = [];
  const blocks = xml.split(/<(?:\w+:)?response[\s>]/i).slice(1);
  for (const b of blocks) {
    const href = /<(?:\w+:)?href[^>]*>([^<]*)</i.exec(b)?.[1];
    if (!href) continue;
    out.push({ href: decodeXml(href.trim()), isDir: /<(?:\w+:)?collection\b/i.test(b) });
  }
  return out;
}

function decodeXml(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
