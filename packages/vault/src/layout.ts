import type { EntityKind } from '@foulee/core';

/** Version du format de coffre écrite dans manifest.json. */
export const VAULT_FORMAT = 'foulee-vault';
export const VAULT_FORMAT_VERSION = 1;

export const MANIFEST_KEY = 'manifest.json';

export const DIRS = {
  athlete: 'athletes/',
  session: 'sessions/',
  trial: 'trials/',
  analysis: 'analyses/',
  media: 'media/',
  /** Tableaux de normes importés par le coach (norms@1). */
  norms: 'norms/',
  proxy: 'proxies/',
} as const;

export function entityKey(kind: EntityKind, id: string): string {
  return `${DIRS[kind]}${id}.json`;
}

export function normKey(id: string): string {
  return `${DIRS.norms}${id}.json`;
}

export function mediaKey(hash: string, ext: string): string {
  return `${DIRS.media}${hash}.${ext}`;
}

export function proxyKey(hash: string): string {
  return `${DIRS.proxy}${hash}.mp4`;
}

/** Extension de fichier sûre (minuscules, 1 à 5 caractères alphanumériques). */
export function safeExt(name: string, mime = ''): string {
  const m = /\.([a-z0-9]{1,5})$/i.exec(name);
  if (m) return m[1]!.toLowerCase();
  if (mime.includes('quicktime')) return 'mov';
  if (mime.includes('webm')) return 'webm';
  return 'mp4';
}

export interface VaultManifest {
  format: typeof VAULT_FORMAT;
  formatVersion: number;
  vaultId: string;
  createdAt: string;
  updatedAt: string;
  generator: string;
  /** Rempli uniquement dans une archive exportée. */
  exportedAt?: string;
  /** Faux si l'archive a été exportée sans les vidéos. */
  includesMedia?: boolean;
}
