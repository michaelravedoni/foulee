import { describe, expect, it } from 'vitest';
import { SCHEMA, createAnalysis, createAthlete, createSession, createTrial, touch, type MediaInfo } from '@foulee/core';
import {
  InvalidKeyError,
  MemoryProvider,
  Vault,
  exportArchive,
  importArchive,
  mediaKey,
  migrateManifest,
  safeExt,
  sha256Blob,
} from '../src/index.js';

function fakeVideo(size: number, seed = 1): Blob {
  const bytes = new Uint8Array(size);
  let x = seed;
  for (let i = 0; i < size; i++) bytes[i] = (x = (x * 1103515245 + 12345) & 0x7fffffff) & 0xff;
  return new Blob([bytes], { type: 'video/mp4' });
}

async function filledVault() {
  const vault = new Vault(new MemoryProvider());
  await vault.open();
  const athlete = createAthlete({ firstName: 'Léa', lastName: 'Rey', tags: ['sprint'] });
  const session = createSession({ date: '2026-11-02', place: 'Halle de Sion' });
  const video = fakeVideo(300_000);
  const { hash } = await vault.putMedia(video, 'mp4');
  const media: MediaInfo = {
    schema: SCHEMA.media,
    hash,
    mime: 'video/mp4',
    ext: 'mp4',
    size: video.size,
    originalName: 'IMG_0001.MP4',
    importedAt: new Date().toISOString(),
    width: 1920,
    height: 1080,
    rotation: 0,
    durationS: 2,
    frameCount: 480,
    nominalFps: 240,
    variableFrameRate: false,
  };
  const trial = createTrial({ sessionId: session.id, athleteId: athlete.id, discipline: '100m', number: 1, mediaHash: hash });
  await vault.save('athlete', athlete);
  await vault.save('session', session);
  await vault.save('trial', trial);
  await vault.save('media', media);
  await vault.save('analysis', createAnalysis(trial.id));
  await vault.putProxy(hash, fakeVideo(1000, 7));
  return { vault, athlete, session, trial, media, video };
}

describe('coffre v1', () => {
  it('crée un manifeste puis le relit', async () => {
    const vault = new Vault(new MemoryProvider());
    const m = await vault.open();
    expect(m.format).toBe('foulee-vault');
    expect(m.formatVersion).toBe(1);
    expect((await vault.open()).vaultId).toBe(m.vaultId);
  });

  it('range chaque entité dans son fichier JSON', async () => {
    const { vault, athlete, trial } = await filledVault();
    const keys = await vault.provider.list('');
    expect(keys).toContain(`athletes/${athlete.id}.json`);
    expect(keys).toContain(`trials/${trial.id}.json`);
    expect(keys).toContain(`analyses/${trial.id}.json`);
    const snap = await vault.loadAll();
    expect(snap.athletes).toEqual([athlete]);
    expect(snap.trials).toHaveLength(1);
    expect(snap.media[0]?.frameCount).toBe(480);
    expect(snap.errors).toEqual([]);
  });

  it('nomme les médias par SHA-256 et déduplique', async () => {
    const { vault, video, media } = await filledVault();
    expect(media.hash).toBe(await sha256Blob(video));
    expect(await vault.provider.exists(mediaKey(media.hash, 'mp4'))).toBe(true);
    const again = await vault.putMedia(video, 'mp4');
    expect(again).toEqual({ hash: media.hash, existed: true });
  });

  it('signale un fichier invalide sans bloquer le chargement', async () => {
    const { vault } = await filledVault();
    await vault.provider.write('athletes/ath_cassé.json', '{pas du json');
    const snap = await vault.loadAll();
    expect(snap.athletes).toHaveLength(1);
    expect(snap.errors.map((e) => e.key)).toEqual(['athletes/ath_cassé.json']);
  });

  it('refuse les clés dangereuses', async () => {
    const p = new MemoryProvider();
    await expect(p.write('../x', 'a')).rejects.toBeInstanceOf(InvalidKeyError);
    await expect(p.write('/abs', 'a')).rejects.toBeInstanceOf(InvalidKeyError);
  });

  it('refuse un coffre d’une version future', () => {
    expect(() =>
      migrateManifest({ format: 'foulee-vault', formatVersion: 2, vaultId: 'v', createdAt: '', updatedAt: '', generator: '' }),
    ).toThrow(/v2/);
  });

  it('déduit une extension sûre', () => {
    expect(safeExt('IMG_1234.MOV')).toBe('mov');
    expect(safeExt('clip', 'video/webm')).toBe('webm');
    expect(safeExt('../../evil')).toBe('mp4');
  });
});

describe('export et import du coffre', () => {
  it('fait un aller-retour complet, vidéos comprises, sans les proxys', async () => {
    const src = await filledVault();
    const zip = await exportArchive(src.vault);
    expect(zip).not.toBeNull();
    const dst = new Vault(new MemoryProvider());
    await dst.open();
    const report = await importArchive(dst, zip!);
    expect(report.errors).toEqual([]);
    expect(report.added).toBe(5);
    expect(report.media).toBe(1);
    const snap = await dst.loadAll();
    expect(snap.athletes).toEqual([src.athlete]);
    const copied = await dst.getMedia(src.media);
    expect(await sha256Blob(copied!)).toBe(src.media.hash);
    expect(await dst.provider.list('proxies/')).toEqual([]);
  });

  it('peut exporter sans les vidéos', async () => {
    const src = await filledVault();
    const zip = await exportArchive(src.vault, { includeMedia: false });
    expect(zip!.size).toBeLessThan(src.video.size);
    const dst = new Vault(new MemoryProvider());
    await dst.open();
    const report = await importArchive(dst, zip!);
    expect(report.media).toBe(0);
    expect((await dst.loadAll()).media).toHaveLength(1);
  });

  it('fusionne : la version la plus récente gagne', async () => {
    const src = await filledVault();
    const zip = await exportArchive(src.vault);
    // Le coffre de destination a une version plus récente de l'athlète.
    const newer = touch(src.athlete, { notes: 'modifié ici', updatedAt: '2099-01-01T00:00:00.000Z' });
    await src.vault.save('athlete', newer);
    const report = await importArchive(src.vault, zip!);
    expect(report.updated).toBe(0);
    expect((await src.vault.get('athlete', src.athlete.id))?.notes).toBe('modifié ici');
  });

  it('détecte une vidéo corrompue', async () => {
    const src = await filledVault();
    // Remplace la vidéo par un contenu différent sous le même nom.
    await src.vault.provider.write(mediaKey(src.media.hash, 'mp4'), fakeVideo(1000, 3));
    const zip = await exportArchive(src.vault);
    const dst = new Vault(new MemoryProvider());
    await dst.open();
    const report = await importArchive(dst, zip!);
    expect(report.errors[0]?.message).toMatch(/SHA-256/);
    expect(await dst.getMedia(src.media)).toBeNull();
  });

  it('rejette une archive qui n’est pas un coffre', async () => {
    const dst = new Vault(new MemoryProvider());
    await expect(importArchive(dst, new Blob([new Uint8Array([1, 2, 3])]))).rejects.toThrow();
  });
});
