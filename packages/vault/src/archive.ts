import { Unzip, UnzipInflate, Zip, ZipDeflate, ZipPassThrough, strToU8 } from 'fflate';
import { VALIDATORS, parseNormTable, type EntityKind } from '@foulee/core';
import { createSha256 } from './hash.js';
import { DIRS, MANIFEST_KEY, VAULT_FORMAT, type VaultManifest } from './layout.js';
import type { Vault } from './vault.js';

export interface ExportOptions {
  /** Inclure les vidéos originales (défaut : oui). */
  includeMedia?: boolean;
  onProgress?: (done: number, total: number, key: string) => void;
  /**
   * Destination en flux (ex. fichier choisi avec showSaveFilePicker).
   * Sans destination, l'archive est assemblée dans un Blob.
   */
  sink?: (chunk: Uint8Array) => Promise<void> | void;
}

/**
 * Exporte le coffre en archive ZIP lisible sans l'application : la même
 * arborescence que le coffre (JSON compressés, vidéos stockées telles quelles).
 * Les proxys ne sont pas exportés : ils se régénèrent.
 */
export async function exportArchive(vault: Vault, opts: ExportOptions = {}): Promise<Blob | null> {
  const includeMedia = opts.includeMedia ?? true;
  const manifest = await vault.readManifest();
  if (!manifest) throw new Error('Coffre non initialisé');
  const all = await vault.provider.list('');
  const keys = all.filter((k) => {
    if (k === MANIFEST_KEY || k.startsWith(DIRS.proxy)) return false;
    if (!includeMedia && k.startsWith(DIRS.media) && !k.endsWith('.json')) return false;
    return true;
  });

  const parts: Uint8Array[] = [];
  let pendingSink: Promise<void> = Promise.resolve();
  let failure: unknown;
  const zip = new Zip((err, chunk) => {
    if (err) {
      failure = err;
      return;
    }
    if (opts.sink) {
      const sink = opts.sink;
      pendingSink = pendingSink.then(() => sink(chunk));
    } else parts.push(chunk);
  });

  const exported: VaultManifest = { ...manifest, exportedAt: new Date().toISOString(), includesMedia: includeMedia };
  addText(zip, MANIFEST_KEY, JSON.stringify(exported, null, 2) + '\n');
  addText(zip, 'LISEZMOI.txt', README);

  let done = 0;
  for (const key of keys) {
    const blob = await vault.provider.read(key);
    if (!blob) continue;
    if (key.endsWith('.json')) {
      addText(zip, key, await blob.text());
    } else {
      const entry = new ZipPassThrough(key);
      zip.add(entry);
      const reader = blob.stream().getReader();
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        entry.push(r.value);
        await pendingSink; // contre-pression vers la destination
      }
      entry.push(new Uint8Array(0), true);
    }
    opts.onProgress?.(++done, keys.length, key);
    if (failure) throw failure;
  }
  zip.end();
  await pendingSink;
  if (failure) throw failure;
  return opts.sink ? null : new Blob(parts as Uint8Array<ArrayBuffer>[], { type: 'application/zip' });
}

function addText(zip: Zip, name: string, text: string): void {
  const entry = new ZipDeflate(name, { level: 6 });
  zip.add(entry);
  entry.push(strToU8(text), true);
}

export interface ImportReport {
  added: number;
  updated: number;
  skipped: number;
  media: number;
  errors: { key: string; message: string }[];
}

const KIND_BY_DIR: [string, EntityKind][] = [
  [DIRS.athlete, 'athlete'],
  [DIRS.session, 'session'],
  [DIRS.trial, 'trial'],
  [DIRS.analysis, 'analysis'],
  [DIRS.media, 'media'],
];

/**
 * Importe une archive ZIP dans le coffre, en fusionnant : pour chaque entité,
 * la version la plus récente (updatedAt) gagne. Chaque vidéo est vérifiée
 * contre son empreinte SHA-256 avant d'être écrite.
 */
export async function importArchive(
  vault: Vault,
  archive: Blob,
  onProgress?: (done: number, total: number) => void,
): Promise<ImportReport> {
  const report: ImportReport = { added: 0, updated: 0, skipped: 0, media: 0, errors: [] };
  const files: { name: string; chunks: Uint8Array[]; hash?: ReturnType<typeof createSha256>; done: boolean }[] = [];
  const unzip = new Unzip((file) => {
    const isMedia = file.name.startsWith(DIRS.media) && !file.name.endsWith('.json');
    const entry = { name: file.name, chunks: [] as Uint8Array[], hash: isMedia ? createSha256() : undefined, done: false };
    files.push(entry);
    file.ondata = (err, chunk, final) => {
      if (err) {
        report.errors.push({ key: file.name, message: err.message });
        entry.done = true;
        return;
      }
      entry.chunks.push(chunk);
      entry.hash?.update(chunk);
      if (final) entry.done = true;
    };
    file.start();
  });
  unzip.register(UnzipInflate);

  let manifestSeen = false;
  const handle = async (f: (typeof files)[number]) => {
    const name = f.name;
    if (name.endsWith('/') || name === 'LISEZMOI.txt') return;
    if (name.startsWith(DIRS.proxy)) return;
    if (name === MANIFEST_KEY) {
      const m = JSON.parse(await new Blob(f.chunks as Uint8Array<ArrayBuffer>[]).text()) as VaultManifest;
      if (m.format !== VAULT_FORMAT) throw new Error('Cette archive n’est pas un coffre Foulée.');
      if (m.formatVersion > 1) throw new Error(`Archive au format v${m.formatVersion}, non prise en charge.`);
      manifestSeen = true;
      return;
    }
    if (name.startsWith(DIRS.norms)) {
      try {
        if (!name.endsWith('.json')) throw new Error('fichier inattendu');
        const table = parseNormTable(JSON.parse(await new Blob(f.chunks as Uint8Array<ArrayBuffer>[]).text()));
        if (name !== `${DIRS.norms}${table.id}.json`) throw new Error('nom différent de l’identifiant du tableau');
        if (await vault.provider.exists(name)) report.skipped++;
        else {
          await vault.provider.write(name, JSON.stringify(table, null, 2) + '\n');
          report.added++;
        }
      } catch (e) {
        report.errors.push({ key: name, message: e instanceof Error ? e.message : String(e) });
      }
      return;
    }
    const kindEntry = KIND_BY_DIR.find(([dir]) => name.startsWith(dir));
    try {
      if (!kindEntry) throw new Error('fichier inattendu');
      if (!name.endsWith('.json')) {
        const m = /^media\/([0-9a-f]{64})\.([a-z0-9]{1,5})$/.exec(name);
        if (!m) throw new Error('nom de média invalide');
        if (f.hash!.hex() !== m[1]) throw new Error('empreinte SHA-256 différente : fichier corrompu');
        if (!(await vault.provider.exists(name))) {
          await vault.provider.write(name, new Blob(f.chunks as Uint8Array<ArrayBuffer>[]));
          report.media++;
        } else report.skipped++;
        return;
      }
      const [, kind] = kindEntry;
      const value = VALIDATORS[kind](JSON.parse(await new Blob(f.chunks as Uint8Array<ArrayBuffer>[]).text()), name);
      const current = await vault.provider.read(name);
      if (!current) {
        await vault.provider.write(name, JSON.stringify(value, null, 2) + '\n');
        report.added++;
        return;
      }
      const cur = JSON.parse(await current.text()) as { updatedAt?: string; importedAt?: string };
      const incoming = value as { updatedAt?: string; importedAt?: string };
      const a = incoming.updatedAt ?? incoming.importedAt ?? '';
      const b = cur.updatedAt ?? cur.importedAt ?? '';
      if (a > b) {
        await vault.provider.write(name, JSON.stringify(value, null, 2) + '\n');
        report.updated++;
      } else report.skipped++;
    } catch (e) {
      report.errors.push({ key: name, message: e instanceof Error ? e.message : String(e) });
    }
  };

  const reader = archive.stream().getReader();
  let read = 0;
  for (;;) {
    const r = await reader.read();
    if (r.done) {
      unzip.push(new Uint8Array(0), true);
      break;
    }
    unzip.push(r.value);
    read += r.value.byteLength;
    onProgress?.(read, archive.size);
    // Écrit les fichiers terminés au fil de l'eau pour limiter la mémoire.
    while (files.length && files[0]!.done) await handle(files.shift()!);
  }
  while (files.length) {
    const f = files.shift()!;
    if (!f.done) report.errors.push({ key: f.name, message: 'fichier tronqué' });
    else await handle(f);
  }
  if (!manifestSeen) throw new Error('Archive sans manifest.json : ce n’est pas un coffre Foulée.');
  await vault.touchManifest();
  return report;
}

const README = `Coffre Foulée – archive exportée

Ce dossier se lit sans l'application :
- manifest.json : version du format de coffre ;
- athletes/, sessions/, trials/ : une fiche JSON par entité ;
- analyses/ : dessins, repères et origine du temps de chaque essai ;
- media/<empreinte>.<ext> : vidéos originales, nommées par leur SHA-256 ;
- media/<empreinte>.json : cadence, nombre d'images et dimensions.

Format documenté dans docs/format-coffre-v1.md du dépôt Foulée.
`;
