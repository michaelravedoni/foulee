import {
  SCHEMA,
  VALIDATORS,
  nowIso,
  type Analysis,
  type Athlete,
  type EntityKind,
  type MediaInfo,
  type Trial,
  type TrainingSession,
} from '@foulee/core';
import { sha256Blob } from './hash.js';
import {
  DIRS,
  MANIFEST_KEY,
  VAULT_FORMAT,
  VAULT_FORMAT_VERSION,
  entityKey,
  mediaKey,
  proxyKey,
  type VaultManifest,
} from './layout.js';
import { migrateManifest } from './migrations.js';
import type { StorageProvider } from './provider.js';

export interface VaultSnapshot {
  athletes: Athlete[];
  sessions: TrainingSession[];
  trials: Trial[];
  analyses: Analysis[];
  media: MediaInfo[];
  /** Fichiers illisibles ou invalides : signalés, jamais supprimés. */
  errors: { key: string; message: string }[];
}

export type EntityOf<K extends EntityKind> = K extends 'athlete'
  ? Athlete
  : K extends 'session'
    ? TrainingSession
    : K extends 'trial'
      ? Trial
      : K extends 'analysis'
        ? Analysis
        : MediaInfo;

function idOf(kind: EntityKind, entity: Athlete | TrainingSession | Trial | Analysis | MediaInfo): string {
  if (kind === 'analysis') return (entity as Analysis).trialId;
  if (kind === 'media') return (entity as MediaInfo).hash;
  return (entity as Athlete).id;
}

export class Vault {
  constructor(
    readonly provider: StorageProvider,
    private readonly generator = 'Foulée',
  ) {}

  /** Ouvre le coffre ; le crée s'il est vide ; migre le manifeste si besoin. */
  async open(): Promise<VaultManifest> {
    const existing = await this.readManifest();
    if (existing) {
      const migrated = migrateManifest(existing);
      if (migrated !== existing) await this.writeJson(MANIFEST_KEY, migrated);
      return migrated;
    }
    const now = nowIso();
    const manifest: VaultManifest = {
      format: VAULT_FORMAT,
      formatVersion: VAULT_FORMAT_VERSION,
      vaultId: `vlt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
      createdAt: now,
      updatedAt: now,
      generator: this.generator,
    };
    await this.writeJson(MANIFEST_KEY, manifest);
    return manifest;
  }

  async readManifest(): Promise<VaultManifest | null> {
    const blob = await this.provider.read(MANIFEST_KEY);
    if (!blob) return null;
    const m = JSON.parse(await blob.text()) as VaultManifest;
    if (m.format !== VAULT_FORMAT) throw new Error('Ce dossier ne contient pas un coffre Foulée.');
    return m;
  }

  async loadAll(): Promise<VaultSnapshot> {
    const snap: VaultSnapshot = { athletes: [], sessions: [], trials: [], analyses: [], media: [], errors: [] };
    const lists: [EntityKind, unknown[]][] = [
      ['athlete', snap.athletes],
      ['session', snap.sessions],
      ['trial', snap.trials],
      ['analysis', snap.analyses],
      ['media', snap.media],
    ];
    for (const [kind, target] of lists) {
      const keys = (await this.provider.list(DIRS[kind])).filter((k) => k.endsWith('.json'));
      await Promise.all(
        keys.map(async (key) => {
          try {
            const blob = await this.provider.read(key);
            if (!blob) return;
            target.push(VALIDATORS[kind](JSON.parse(await blob.text()), key));
          } catch (e) {
            snap.errors.push({ key, message: e instanceof Error ? e.message : String(e) });
          }
        }),
      );
    }
    return snap;
  }

  async save<K extends EntityKind>(kind: K, entity: EntityOf<K>): Promise<void> {
    VALIDATORS[kind](entity);
    await this.writeJson(entityKey(kind, idOf(kind, entity)), entity);
  }

  async get<K extends EntityKind>(kind: K, id: string): Promise<EntityOf<K> | null> {
    const blob = await this.provider.read(entityKey(kind, id));
    if (!blob) return null;
    return VALIDATORS[kind](JSON.parse(await blob.text())) as EntityOf<K>;
  }

  /** Suppression définitive (la corbeille est gérée par `deletedAt`). */
  async remove(kind: EntityKind, id: string): Promise<void> {
    await this.provider.delete(entityKey(kind, id));
  }

  /**
   * Ajoute un fichier vidéo au coffre, nommé par son empreinte SHA-256.
   * Un fichier déjà présent n'est pas réécrit (déduplication).
   */
  async putMedia(
    file: Blob,
    ext: string,
    onProgress?: (phase: 'empreinte' | 'copie', done: number, total: number) => void,
  ): Promise<{ hash: string; existed: boolean }> {
    const hash = await sha256Blob(file, (d, t) => onProgress?.('empreinte', d, t));
    const key = mediaKey(hash, ext);
    if (await this.provider.exists(key)) return { hash, existed: true };
    onProgress?.('copie', 0, file.size);
    await this.provider.write(key, file);
    onProgress?.('copie', file.size, file.size);
    return { hash, existed: false };
  }

  getMedia(info: Pick<MediaInfo, 'hash' | 'ext'>): Promise<Blob | null> {
    return this.provider.read(mediaKey(info.hash, info.ext));
  }

  async removeMedia(info: Pick<MediaInfo, 'hash' | 'ext' | 'proxyHash'>): Promise<void> {
    await this.provider.delete(mediaKey(info.hash, info.ext));
    await this.provider.delete(entityKey('media', info.hash));
    await this.provider.delete(proxyKey(info.hash));
  }

  /** Les proxys sont un cache jetable, rangé à part et jamais exporté. */
  putProxy(hash: string, blob: Blob): Promise<void> {
    return this.provider.write(proxyKey(hash), blob);
  }

  getProxy(hash: string): Promise<Blob | null> {
    return this.provider.read(proxyKey(hash));
  }

  async touchManifest(): Promise<void> {
    const m = await this.readManifest();
    if (m) await this.writeJson(MANIFEST_KEY, { ...m, updatedAt: nowIso() });
  }

  private writeJson(key: string, value: unknown): Promise<void> {
    return this.provider.write(key, JSON.stringify(value, null, 2) + '\n');
  }
}

export { SCHEMA };
