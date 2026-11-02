import { describe, expect, it } from 'vitest';
import { SCHEMA, createAnalysis, createAthlete, createSession, createTrial, touch, type MediaInfo } from '@foulee/core';
import {
  DecryptionError,
  EncryptedProvider,
  MemoryProvider,
  MirrorProvider,
  S3Provider,
  VaultMismatchError,
  Vault,
  WebDavProvider,
  WrongPassphraseError,
  mediaKey,
  parseMultistatus,
  sha256Blob,
  signV4,
  syncProviders,
  type StorageProvider,
} from '../src/index.js';

const FAST = { iterations: 1000, chunkSize: 1000 };

function bytes(size: number, seed = 1): Uint8Array {
  const b = new Uint8Array(size);
  let x = seed;
  for (let i = 0; i < size; i++) b[i] = (x = (x * 1103515245 + 12345) & 0x7fffffff) & 0xff;
  return b;
}
async function same(a: Blob | null, b: Blob | null): Promise<boolean> {
  if (!a || !b) return a === b;
  return (await sha256Blob(a)) === (await sha256Blob(b));
}

// ——— Serveurs simulés (fonctions fetch en mémoire) ———

function davServer(root = 'https://dav.test/remote/foulee') {
  const files = new Map<string, Blob>();
  const dirs = new Set<string>(['']);
  const log: string[] = [];
  const base = new URL(root).pathname;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? 'GET';
    log.push(`${method} ${url.pathname}`);
    const rel = decodeURIComponent(url.pathname.slice(base.length)).replace(/^\//, '').replace(/\/$/, '');
    if (method === 'MKCOL') {
      if (dirs.has(rel)) return new Response(null, { status: 405 });
      dirs.add(rel);
      return new Response(null, { status: 201 });
    }
    if (method === 'PUT') {
      const parent = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
      if (!dirs.has(parent)) return new Response(null, { status: 409 });
      files.set(rel, init!.body as Blob);
      return new Response(null, { status: 201 });
    }
    if (method === 'GET' || method === 'HEAD') {
      const f = files.get(rel);
      return f ? new Response(method === 'GET' ? f : null, { status: 200 }) : new Response(null, { status: 404 });
    }
    if (method === 'DELETE') {
      files.delete(rel);
      return new Response(null, { status: 204 });
    }
    if (method === 'PROPFIND') {
      if (!dirs.has(rel)) return new Response(null, { status: 404 });
      const prefix = rel ? rel + '/' : '';
      const enc = (p: string) => p.split('/').map(encodeURIComponent).join('/');
      const items: string[] = [`<d:response><d:href>${base}/${enc(prefix)}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>`];
      for (const d of dirs) if (d && d.startsWith(prefix) && !d.slice(prefix.length).includes('/')) items.push(`<d:response><d:href>${base}/${enc(d)}/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>`);
      for (const f of files.keys()) if (f.startsWith(prefix) && !f.slice(prefix.length).includes('/')) items.push(`<d:response><d:href>${base}/${enc(f)}</d:href><d:propstat><d:prop><d:resourcetype/></d:prop></d:propstat></d:response>`);
      return new Response(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${items.join('')}</d:multistatus>`, { status: 207 });
    }
    return new Response(null, { status: 405 });
  };
  return { fetcher, files, log, root };
}

function s3Server(bucket = 'seau') {
  const files = new Map<string, Blob>();
  const seen: Record<string, string>[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? 'GET';
    seen.push((init?.headers ?? {}) as Record<string, string>);
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (parts[0] !== bucket) return new Response(null, { status: 404 });
    const key = parts.slice(1).join('/');
    if (method === 'PUT') {
      files.set(key, init!.body as Blob);
      return new Response(null, { status: 200 });
    }
    if (method === 'GET' && !key) {
      const prefix = url.searchParams.get('prefix') ?? '';
      const all = [...files.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = Number(url.searchParams.get('continuation-token') ?? 0);
      const page = all.slice(start, start + 2);
      const more = start + 2 < all.length;
      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
      return new Response(`<ListBucketResult><IsTruncated>${more}</IsTruncated>${more ? `<NextContinuationToken>${start + 2}</NextContinuationToken>` : ''}${page.map((k) => `<Contents><Key>${esc(k)}</Key></Contents>`).join('')}</ListBucketResult>`);
    }
    if (method === 'GET' || method === 'HEAD') {
      const f = files.get(key);
      return f ? new Response(method === 'GET' ? f : null) : new Response(null, { status: 404 });
    }
    if (method === 'DELETE') {
      files.delete(key);
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 400 });
  };
  return { fetcher, files, seen };
}

// ——— Chiffrement ———

describe('chiffrement', () => {
  it('chiffre par blocs et relit à l’identique, petits et gros fichiers', async () => {
    const inner = new MemoryProvider();
    const p = await EncryptedProvider.open(inner, 'phrase-secrete', { createIfMissing: true, ...FAST });
    for (const size of [0, 1, 999, 1000, 1001, 5555]) {
      const data = bytes(size, size + 1);
      await p.write(`media/f${size}.mp4`, data);
      const back = await p.read(`media/f${size}.mp4`);
      expect(new Uint8Array(await back!.arrayBuffer())).toEqual(data);
    }
    const raw = new Uint8Array(await (await inner.read('media/f999.mp4'))!.arrayBuffer());
    expect(new TextDecoder().decode(raw.slice(0, 4))).toBe('FLE1');
    expect(await p.list()).not.toContain('encryption.json');
    expect(await inner.list()).toContain('encryption.json');
  });

  it('refuse une mauvaise phrase et rouvre avec la bonne', async () => {
    const inner = new MemoryProvider();
    const p = await EncryptedProvider.open(inner, 'phrase-secrete', { createIfMissing: true, ...FAST });
    await p.write('a.json', '{"x":1}');
    await expect(EncryptedProvider.open(inner, 'autre-phrase-1')).rejects.toBeInstanceOf(WrongPassphraseError);
    const again = await EncryptedProvider.open(inner, 'phrase-secrete', FAST);
    expect(await (await again.read('a.json'))!.text()).toBe('{"x":1}');
    expect(await EncryptedProvider.isEncrypted(inner)).toBe(true);
  });

  it('détecte l’altération, la troncature et le déplacement de fichier', async () => {
    const inner = new MemoryProvider();
    const p = await EncryptedProvider.open(inner, 'phrase-secrete', { createIfMissing: true, ...FAST });
    await p.write('media/v.mp4', bytes(3500));
    const raw = new Uint8Array(await (await inner.read('media/v.mp4'))!.arrayBuffer());

    const flipped = raw.slice();
    flipped[100] = flipped[100]! ^ 1;
    await inner.write('media/v.mp4', flipped);
    await expect(p.read('media/v.mp4')).rejects.toBeInstanceOf(DecryptionError);

    const stride = 12 + 1000 + 16;
    await inner.write('media/v.mp4', raw.slice(0, 8 + 2 * stride)); // coupé à une limite de bloc
    await expect(p.read('media/v.mp4')).rejects.toBeInstanceOf(DecryptionError);

    await inner.write('media/other.mp4', raw); // copié sous un autre nom
    await expect(p.read('media/other.mp4')).rejects.toBeInstanceOf(DecryptionError);
  });

  it('refuse de chiffrer un emplacement qui contient déjà des données', async () => {
    const inner = new MemoryProvider();
    await inner.write('manifest.json', '{}');
    await expect(EncryptedProvider.open(inner, 'phrase-secrete', { createIfMissing: true, ...FAST })).rejects.toThrow(/non chiffrées/);
    await expect(EncryptedProvider.open(new MemoryProvider(), 'court', { createIfMissing: true, ...FAST })).rejects.toThrow(/8 caractères/);
  });
});

// ——— Fournisseurs distants ———

async function contract(p: StorageProvider) {
  await p.write('manifest.json', '{"a":1}');
  await p.write('trials/tri_1.json', '{"b":2}');
  await p.write('media/vidéo été 1.mp4', bytes(3000));
  expect(await (await p.read('manifest.json'))!.text()).toBe('{"a":1}');
  expect(await p.read('nope.json')).toBeNull();
  expect(await p.exists('trials/tri_1.json')).toBe(true);
  expect(await p.exists('trials/tri_2.json')).toBe(false);
  expect(await p.list()).toEqual(['manifest.json', 'media/vidéo été 1.mp4', 'trials/tri_1.json']);
  expect(await p.list('trials/')).toEqual(['trials/tri_1.json']);
  expect(new Uint8Array(await (await p.read('media/vidéo été 1.mp4'))!.arrayBuffer())).toEqual(bytes(3000));
  await p.delete('trials/tri_1.json');
  await p.delete('trials/tri_1.json');
  expect(await p.exists('trials/tri_1.json')).toBe(false);
}

describe('WebDAV', () => {
  it('respecte le contrat du fournisseur, avec identifiants', async () => {
    const s = davServer();
    const headers: (string | undefined)[] = [];
    const f: typeof fetch = (i, init) => {
      headers.push((init?.headers as Record<string, string> | undefined)?.Authorization);
      return s.fetcher(i, init);
    };
    await contract(new WebDavProvider({ url: s.root, username: 'léa', password: 'mdp', fetch: f }));
    expect(headers.every((h) => h?.startsWith('Basic '))).toBe(true);
    expect(s.log.some((l) => l.startsWith('MKCOL'))).toBe(true);
  });

  it('lit une réponse PROPFIND avec ou sans préfixe d’espace de noms', () => {
    const xml = '<D:multistatus xmlns:D="DAV:"><D:response><D:href>/a/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat></D:response><response><href>/a/b%20c.json</href><propstat><prop><resourcetype/></prop></propstat></response></D:multistatus>';
    expect(parseMultistatus(xml)).toEqual([
      { href: '/a/', isDir: true },
      { href: '/a/b%20c.json', isDir: false },
    ]);
  });
});

describe('S3', () => {
  it('respecte le contrat du fournisseur, avec liste paginée et préfixe', async () => {
    const s = s3Server();
    await contract(new S3Provider({ region: 'eu-west-1', bucket: 'seau', accessKeyId: 'AK', secretAccessKey: 'SK', endpoint: 'https://s3.test', fetch: s.fetcher }));
    expect(s.seen.every((h) => /^AWS4-HMAC-SHA256 Credential=AK\//.test(h.authorization ?? ''))).toBe(true);
    const p = new S3Provider({ region: 'eu-west-1', bucket: 'seau', accessKeyId: 'AK', secretAccessKey: 'SK', endpoint: 'https://s3.test', prefix: 'foulee/', fetch: s.fetcher });
    await p.write('x.json', '{}');
    expect([...s.files.keys()]).toContain('foulee/x.json');
    expect(await p.list()).toEqual(['x.json']);
  });

  it('signe comme AWS (vecteur de test « get-vanilla » de la documentation)', async () => {
    const h = await signV4({
      method: 'GET',
      url: 'https://example.amazonaws.com/',
      region: 'us-east-1',
      service: 'service',
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      date: new Date('2015-08-30T12:36:00Z'),
    });
    expect(h.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
    );
  });
});

// ——— Synchronisation, miroir, restauration ———

async function filledVault(provider: StorageProvider = new MemoryProvider()) {
  const vault = new Vault(provider);
  await vault.open();
  const athlete = createAthlete({ firstName: 'Léa', lastName: 'Rey', tags: ['sprint'] });
  const session = createSession({ date: '2026-11-02', place: 'Halle de Sion' });
  const video = new Blob([bytes(9000) as Uint8Array<ArrayBuffer>], { type: 'video/mp4' });
  const { hash } = await vault.putMedia(video, 'mp4');
  const media: MediaInfo = {
    schema: SCHEMA.media, hash, mime: 'video/mp4', ext: 'mp4', size: video.size, originalName: 'IMG_1.MP4', importedAt: new Date().toISOString(),
    width: 1920, height: 1080, rotation: 0, durationS: 2, frameCount: 480, nominalFps: 240, variableFrameRate: false,
  };
  const trial = createTrial({ sessionId: session.id, athleteId: athlete.id, discipline: '100m', number: 1, mediaHash: hash });
  await vault.save('athlete', athlete);
  await vault.save('session', session);
  await vault.save('trial', trial);
  await vault.save('media', media);
  await vault.save('analysis', { ...createAnalysis(trial.id), timeOrigin: 37 });
  await vault.putProxy(hash, new Blob([bytes(500, 7) as Uint8Array<ArrayBuffer>]));
  return { vault, athlete, trial, hash, video };
}

describe('sauvegarde et restauration', () => {
  it('sauvegarde chiffrée sur WebDAV puis restauration complète sur un nouvel appareil', async () => {
    const { vault: device1, hash, video } = await filledVault();
    const dav = davServer();
    const remote = await EncryptedProvider.open(new WebDavProvider({ url: dav.root, fetch: dav.fetcher }), 'phrase-secrete', { createIfMissing: true, ...FAST });
    const report = await syncProviders(device1.provider, remote);
    expect(report.errors).toEqual([]);
    expect(report.copied).toBeGreaterThanOrEqual(7);

    // Rien d'exploitable en clair sur le serveur
    const rawVideo = new Uint8Array(await dav.files.get(mediaKey(hash, 'mp4'))!.arrayBuffer());
    expect(new TextDecoder().decode(rawVideo.slice(0, 4))).toBe('FLE1');
    expect(await dav.files.get('athletes/' + (await device1.provider.list('athletes/'))[0]!.split('/')[1])!.text()).not.toContain('Rey');

    // Deuxième sauvegarde : rien à recopier
    const again = await syncProviders(device1.provider, remote);
    expect(again.copied).toBe(0);

    // Nouvel appareil : coffre local vide (avec son propre manifeste), phrase saisie à nouveau
    const device2Provider = new MemoryProvider();
    const device2 = new Vault(device2Provider);
    await device2.open();
    const reopened = await EncryptedProvider.open(new WebDavProvider({ url: dav.root, fetch: dav.fetcher }), 'phrase-secrete', FAST);
    await expect(syncProviders(reopened, device2Provider)).rejects.toBeInstanceOf(VaultMismatchError);
    const restored = await syncProviders(reopened, device2Provider, { adoptManifest: true });
    expect(restored.errors).toEqual([]);

    const a = await device1.loadAll();
    const b = await new Vault(device2Provider).loadAll();
    expect(b.errors).toEqual([]);
    expect(b.athletes).toEqual(a.athletes);
    expect(b.trials).toEqual(a.trials);
    expect(b.analyses).toEqual(a.analyses);
    expect(b.media).toEqual(a.media);
    expect((await new Vault(device2Provider).open()).vaultId).toBe((await device1.open()).vaultId);
    expect(await same(await device2Provider.read(mediaKey(hash, 'mp4')), video)).toBe(true);
  });

  it('garde la version la plus récente de chaque fiche', async () => {
    const { vault, athlete } = await filledVault();
    const other = new MemoryProvider();
    await syncProviders(vault.provider, other);
    const newer = touch(athlete, { notes: 'modifiée ici' });
    await new Promise((r) => setTimeout(r, 5));
    await vault.save('athlete', touch(newer, { notes: 'plus récente' }));
    await syncProviders(vault.provider, other);
    expect(JSON.parse(await (await other.read(`athletes/${athlete.id}.json`))!.text()).notes).toBe('plus récente');
    // Dans l'autre sens, une version plus ancienne n'écrase rien
    await syncProviders(other, vault.provider);
    expect(JSON.parse(await (await vault.provider.read(`athletes/${athlete.id}.json`))!.text()).notes).toBe('plus récente');
  });

  it('refuse de sauvegarder sur le coffre d’une autre personne', async () => {
    const { vault } = await filledVault();
    const { vault: other } = await filledVault();
    await expect(syncProviders(vault.provider, other.provider)).rejects.toBeInstanceOf(VaultMismatchError);
  });

  it('S3 : même parcours de sauvegarde et de restauration', async () => {
    const { vault } = await filledVault();
    const s = s3Server();
    const remote = new S3Provider({ region: 'eu-west-1', bucket: 'seau', accessKeyId: 'AK', secretAccessKey: 'SK', endpoint: 'https://s3.test', fetch: s.fetcher });
    expect((await syncProviders(vault.provider, remote)).errors).toEqual([]);
    const fresh = new MemoryProvider();
    expect((await syncProviders(remote, fresh, { adoptManifest: true })).errors).toEqual([]);
    expect((await new Vault(fresh).loadAll()).trials).toHaveLength(1);
  });

  it('miroir : écrit en local d’abord, rattrape après une panne', async () => {
    const primary = new MemoryProvider();
    const mirror = new MemoryProvider();
    let down = true;
    const flaky: StorageProvider = {
      name: 'miroir',
      read: (k) => mirror.read(k),
      list: (p) => mirror.list(p),
      exists: (k) => mirror.exists(k),
      delete: (k) => mirror.delete(k),
      write: async (k, d) => {
        if (down) throw new Error('réseau coupé');
        await mirror.write(k, d);
      },
    };
    const m = new MirrorProvider(primary, [flaky]);
    await m.write('a.json', '{"v":1}'); // ne lève pas
    await m.flush();
    expect(m.pendingCount).toBe(1);
    expect(m.lastError).toMatch(/réseau/);
    expect(await primary.exists('a.json')).toBe(true);
    expect(await mirror.exists('a.json')).toBe(false);
    down = false;
    await m.flush();
    expect(m.pendingCount).toBe(0);
    expect(await (await mirror.read('a.json'))!.text()).toBe('{"v":1}');
  });
});
