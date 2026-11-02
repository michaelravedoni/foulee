<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { exportArchive, importArchive, type ImportReport } from '@foulee/vault';
import { ensureProxy, reload, requestPersistence, state, vaultRef } from '../store/data';
import { settings } from '../store/settings';
import { formatBytes, todayIso } from '../lib/format';

const usage = ref<{ usage: number; quota: number } | null>(null);
const busy = ref('');
const progress = ref(0);
const message = ref('');
const report = ref<ImportReport | null>(null);
const fileInput = ref<HTMLInputElement>();

const version = `${__APP_VERSION__} · ${__COMMIT__} · ${__BUILD_DATE__.slice(0, 16).replace('T', ' ')}`;
const mediaBytes = computed(() => [...state.media.values()].reduce((s, m) => s + m.size, 0));

async function refreshUsage() {
  const est = await navigator.storage?.estimate?.();
  if (est) usage.value = { usage: est.usage ?? 0, quota: est.quota ?? 0 };
}
onMounted(refreshUsage);

type SaveHandle = { createWritable(): Promise<FileSystemWritableFileStream> };
type PickerWindow = Window & { showSaveFilePicker?: (o: unknown) => Promise<SaveHandle> };

async function doExport(includeMedia: boolean) {
  const v = vaultRef.value;
  if (!v) return;
  message.value = '';
  const name = `foulee-coffre-${todayIso()}${includeMedia ? '' : '-sans-videos'}.zip`;
  busy.value = 'export';
  progress.value = 0;
  try {
    const w = window as PickerWindow;
    if (w.showSaveFilePicker && includeMedia) {
      // Ordinateur (Chromium) : écriture en flux, sans tout garder en mémoire.
      let handle: SaveHandle;
      try {
        handle = await w.showSaveFilePicker({ suggestedName: name, types: [{ description: 'Archive ZIP', accept: { 'application/zip': ['.zip'] } }] });
      } catch {
        return; // annulé
      }
      const writable = await handle.createWritable();
      await exportArchive(v, { includeMedia, onProgress: (d, t) => (progress.value = d / t), sink: (c) => writable.write(c as Uint8Array<ArrayBuffer>) });
      await writable.close();
    } else {
      const blob = await exportArchive(v, { includeMedia, onProgress: (d, t) => (progress.value = d / t) });
      if (!blob) return;
      const file = new File([blob], name, { type: 'application/zip' });
      const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
      if (nav.canShare?.({ files: [file] }) && /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document) {
        // iPhone/iPad : la feuille de partage permet « Enregistrer dans Fichiers ».
        await navigator.share({ files: [file], title: name }).catch(() => download(blob, name));
      } else download(blob, name);
    }
    message.value = 'Export terminé.';
  } catch (e) {
    message.value = `Export impossible : ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    busy.value = '';
  }
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function doImport() {
  const f = fileInput.value?.files?.[0];
  if (fileInput.value) fileInput.value.value = '';
  const v = vaultRef.value;
  if (!f || !v) return;
  busy.value = 'import';
  message.value = '';
  report.value = null;
  try {
    report.value = await importArchive(v, f, (d, t) => (progress.value = d / t));
    await reload();
    message.value = 'Import terminé.';
  } catch (e) {
    message.value = `Import impossible : ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    busy.value = '';
    void refreshUsage();
  }
}

async function persist() {
  const ok = await requestPersistence();
  message.value = ok
    ? 'Stockage persistant accordé : le navigateur ne videra pas le coffre automatiquement.'
    : 'Refusé par le navigateur. Sur iPhone/iPad, installe Foulée sur l’écran d’accueil (Partager → Sur l’écran d’accueil).';
}

async function buildProxies() {
  for (const m of state.media.values()) await ensureProxy(m, true);
  void refreshUsage();
}
</script>

<template>
  <section class="stack">
    <h1>Coffre</h1>
    <p class="muted">
      Toutes les données sont dans un coffre au format ouvert, sur cet appareil ({{ state.providerName }}). Exporte-le
      régulièrement : l’archive ZIP se relit sans l’application et se réimporte sur un autre appareil.
    </p>
    <div class="grid">
      <div class="card stack">
        <h2>Stockage</h2>
        <div class="small">
          {{ state.athletes.size }} athlètes · {{ state.sessions.size }} séances · {{ state.trials.size }} essais · {{ state.media.size }} vidéos ({{ formatBytes(mediaBytes) }})
        </div>
        <div v-if="usage" class="small muted">Utilisé : {{ formatBytes(usage.usage) }} sur {{ formatBytes(usage.quota) }} disponibles</div>
        <progress v-if="usage && usage.quota" :value="usage.usage" :max="usage.quota"></progress>
        <div class="row">
          <span class="pill" :class="state.persistent ? 'ok' : 'warn'">{{ state.persistent ? 'Persistant' : 'Non persistant' }}</span>
          <button v-if="!state.persistent" class="btn ghost small" @click="persist">Demander la persistance</button>
        </div>
        <div v-if="state.loadErrors.length" class="small" style="color: var(--danger)">
          {{ state.loadErrors.length }} fichier(s) illisible(s) ignoré(s) :
          <ul>
            <li v-for="e in state.loadErrors" :key="e.key" class="mono">{{ e.key }} — {{ e.message }}</li>
          </ul>
        </div>
      </div>
      <div class="card stack">
        <h2>Exporter</h2>
        <button class="btn" :disabled="!!busy" @click="doExport(true)">Exporter tout (avec vidéos)</button>
        <button class="btn secondary" :disabled="!!busy" @click="doExport(false)">Exporter sans les vidéos</button>
        <p class="small muted">Les proxys basse résolution ne sont pas exportés : ils se recréent.</p>
      </div>
      <div class="card stack">
        <h2>Importer</h2>
        <button class="btn secondary" :disabled="!!busy" @click="fileInput?.click()">Importer une archive…</button>
        <input ref="fileInput" class="sr-only" type="file" accept=".zip,application/zip" @change="doImport" />
        <p class="small muted">Fusion : pour chaque fiche, la version la plus récente gagne. Chaque vidéo est vérifiée par son empreinte SHA-256.</p>
      </div>
      <div class="card stack">
        <h2>Réglages de cet appareil</h2>
        <label class="row"><input v-model="settings.autoProxy" type="checkbox" /> Créer un proxy basse résolution à l’import (vidéos &gt; 1280 px)</label>
        <button class="btn ghost small" :disabled="!!busy || !state.media.size" @click="buildProxies">Recréer tous les proxys</button>
        <RouterLink to="/corbeille" class="btn ghost small">Corbeille</RouterLink>
        <RouterLink to="/diagnostic" class="btn ghost small">Diagnostic et test du lecteur</RouterLink>
      </div>
    </div>
    <div v-if="busy" class="card">
      {{ busy === 'export' ? 'Export' : 'Import' }} en cours…
      <progress :value="progress" max="1"></progress>
    </div>
    <p v-if="message" class="banner info">{{ message }}</p>
    <div v-if="report" class="card small">
      {{ report.added }} ajouté(s) · {{ report.updated }} mis à jour · {{ report.skipped }} inchangé(s) · {{ report.media }} vidéo(s)
      <ul v-if="report.errors.length" style="color: var(--danger)">
        <li v-for="e in report.errors" :key="e.key" class="mono">{{ e.key }} — {{ e.message }}</li>
      </ul>
    </div>
    <p class="small muted">Foulée {{ version }}</p>
  </section>
</template>
