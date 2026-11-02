<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { DirectoryProvider, VaultMismatchError, WrongPassphraseError, syncProviders, type SyncReport } from '@foulee/vault';
import { reload, state, vaultRef } from '../store/data';
import { formatBytes } from '../lib/format';
import { deleteHandle, loadTargets, openTarget, putHandle, saveTargets, type BackupKind, type BackupTarget } from '../lib/backups';

const targets = ref<BackupTarget[]>(loadTargets());
const adding = ref(false);
const draft = reactive<Partial<BackupTarget> & { kind: BackupKind; passphrase: string; passphrase2: string }>({ kind: 'webdav', encrypted: true, passphrase: '', passphrase2: '' });
let pickedHandle: FileSystemDirectoryHandle | null = null;
const pickedName = ref('');

const busy = ref('');
const message = ref('');
const error = ref('');
const progress = ref(0);
const report = ref<SyncReport | null>(null);
const phrases = reactive<Record<string, string>>({}); // gardées en mémoire pour la session seulement
const canDir = DirectoryProvider.isSupported();

const KIND_LABEL: Record<BackupKind, string> = { webdav: 'WebDAV (Nextcloud, NAS…)', s3: 'S3 (AWS, Scaleway, MinIO…)', dir: 'Dossier du disque' };

async function pickDir() {
  try {
    pickedHandle = await (window as unknown as { showDirectoryPicker: (o: object) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({ mode: 'readwrite' });
    pickedName.value = pickedHandle.name;
  } catch {
    // annulé
  }
}

function resetDraft() {
  Object.assign(draft, { kind: 'webdav', encrypted: true, passphrase: '', passphrase2: '', label: '', url: '', username: '', password: '', endpoint: '', region: '', bucket: '', prefix: '', accessKeyId: '', secretAccessKey: '' });
  pickedHandle = null;
  pickedName.value = '';
}

async function addTarget() {
  error.value = '';
  const t: BackupTarget = {
    id: `bkp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    kind: draft.kind,
    label: draft.label?.trim() || KIND_LABEL[draft.kind],
    encrypted: !!draft.encrypted,
    ...(draft.kind === 'webdav' ? { url: draft.url?.trim() ?? '', ...(draft.username ? { username: draft.username, password: draft.password ?? '' } : {}) } : {}),
    ...(draft.kind === 's3'
      ? { region: draft.region?.trim() ?? '', bucket: draft.bucket?.trim() ?? '', accessKeyId: draft.accessKeyId?.trim() ?? '', secretAccessKey: draft.secretAccessKey ?? '', ...(draft.endpoint?.trim() ? { endpoint: draft.endpoint.trim() } : {}), ...(draft.prefix?.trim() ? { prefix: draft.prefix.trim() } : {}) }
      : {}),
  };
  try {
    if (t.encrypted) {
      if (draft.passphrase.length < 8) throw new Error('La phrase secrète doit faire au moins 8 caractères.');
      if (draft.passphrase !== draft.passphrase2) throw new Error('Les deux phrases secrètes ne correspondent pas.');
    }
    if (t.kind === 'dir') {
      if (!pickedHandle) throw new Error('Choisis un dossier.');
      await putHandle(t.id, pickedHandle);
    }
    // Test de connexion, et création de l'en-tête de chiffrement si l'emplacement est vide.
    busy.value = t.id;
    const p = await openTarget(t, draft.passphrase, true);
    await p.list('manifest');
    if (t.encrypted) phrases[t.id] = draft.passphrase;
    targets.value = [...targets.value, t];
    saveTargets(targets.value);
    adding.value = false;
    resetDraft();
    message.value = 'Destination ajoutée. Lance une première sauvegarde.';
  } catch (e) {
    error.value = `Connexion impossible : ${explain(e)}`;
    if (t.kind === 'dir') void deleteHandle(t.id);
  } finally {
    busy.value = '';
  }
}

function explain(e: unknown): string {
  if (e instanceof WrongPassphraseError) return 'phrase secrète incorrecte.';
  if (e instanceof VaultMismatchError) return e.message;
  if (e instanceof TypeError) return 'le serveur est injoignable ou refuse l’accès depuis cette application (CORS). Vérifie l’adresse et la configuration du serveur.';
  return e instanceof Error ? e.message : String(e);
}

function phraseFor(t: BackupTarget): string | null {
  if (!t.encrypted) return '';
  if (phrases[t.id]) return phrases[t.id]!;
  const p = window.prompt(`Phrase secrète de « ${t.label} »`);
  if (p === null) return null;
  return p;
}

async function backup(t: BackupTarget) {
  const local = vaultRef.value;
  const phrase = phraseFor(t);
  if (!local || phrase === null) return;
  await run(t, async () => {
    const remote = await openTarget(t, phrase, true);
    if (t.encrypted) phrases[t.id] = phrase;
    report.value = await syncProviders(local.provider, remote, { onProgress: (p) => (progress.value = p.total ? p.done / p.total : 1) });
    if (!report.value.errors.length) {
      t.lastBackupAt = new Date().toISOString();
      saveTargets(targets.value);
    }
    message.value = `Sauvegarde terminée : ${report.value.copied} fichier(s) copié(s), ${report.value.skipped} déjà à jour (${formatBytes(report.value.bytes)}).`;
  });
}

async function restoreFrom(t: BackupTarget) {
  const local = vaultRef.value;
  const phrase = phraseFor(t);
  if (!local || phrase === null) return;
  await run(t, async () => {
    const remote = await openTarget(t, phrase, false);
    if (t.encrypted) phrases[t.id] = phrase;
    const onProgress = (p: { done: number; total: number }) => (progress.value = p.total ? p.done / p.total : 1);
    try {
      report.value = await syncProviders(remote, local.provider, { onProgress });
    } catch (e) {
      if (!(e instanceof VaultMismatchError)) throw e;
      const hasData = state.athletes.size + state.trials.size > 0;
      const ok = confirm(
        hasData
          ? 'Cette sauvegarde est celle d’un autre coffre, et cet appareil contient déjà des données. Les fiches de la sauvegarde seront ajoutées aux tiennes (la plus récente gagne) et l’identité du coffre deviendra celle de la sauvegarde. Continuer ?'
          : 'Restaurer cette sauvegarde sur cet appareil ?',
      );
      if (!ok) return;
      report.value = await syncProviders(remote, local.provider, { onProgress, adoptManifest: true });
    }
    await reload();
    message.value = `Restauration terminée : ${report.value.copied} fichier(s) récupéré(s).`;
  });
}

async function run(t: BackupTarget, job: () => Promise<void>) {
  busy.value = t.id;
  message.value = '';
  error.value = '';
  report.value = null;
  progress.value = 0;
  try {
    await job();
  } catch (e) {
    error.value = explain(e);
    if (e instanceof WrongPassphraseError) delete phrases[t.id];
  } finally {
    busy.value = '';
  }
}

async function removeTarget(t: BackupTarget) {
  if (!confirm(`Retirer « ${t.label} » de la liste ? Les fichiers déjà sauvegardés restent sur place.`)) return;
  if (t.kind === 'dir') await deleteHandle(t.id);
  delete phrases[t.id];
  targets.value = targets.value.filter((x) => x.id !== t.id);
  saveTargets(targets.value);
}

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString('fr-CH') : 'jamais');
const sizeHint = computed(() => `${state.trials.size} essais, ${state.media.size} vidéos`);
</script>

<template>
  <section class="stack">
    <div class="spread">
      <h1>Sauvegardes</h1>
      <RouterLink class="btn ghost small" to="/coffre">← Coffre</RouterLink>
    </div>
    <p class="muted">
      Copie ton coffre ({{ sizeHint }}) sur un autre emplacement : dossier du disque, WebDAV ou S3. Avec le chiffrement, les fiches et les
      vidéos sont illisibles sans ta phrase secrète, même pour l’hébergeur. <strong>Si tu perds la phrase, personne ne peut récupérer les données.</strong>
      Pour réinstaller sur un autre appareil : ajoute la même destination, puis « Restaurer ».
    </p>

    <p v-if="message" class="banner" role="status">{{ message }}</p>
    <p v-if="error" class="banner warn" role="alert">{{ error }}</p>
    <progress v-if="busy && progress > 0" :value="progress" max="1"></progress>
    <ul v-if="report?.errors.length" class="small">
      <li v-for="e in report.errors" :key="e.key" class="mono">{{ e.key }} : {{ e.message }}</li>
    </ul>

    <div v-for="t in targets" :key="t.id" class="card stack">
      <div class="spread">
        <div>
          <strong>{{ t.label }}</strong>
          <span class="pill" :class="t.encrypted ? 'ok' : 'warn'" style="margin-left: 8px">{{ t.encrypted ? 'Chiffré' : 'Non chiffré' }}</span>
          <div class="small muted">{{ KIND_LABEL[t.kind] }} · dernière sauvegarde : {{ when(t.lastBackupAt) }}</div>
        </div>
        <button class="btn ghost small" @click="removeTarget(t)">Retirer</button>
      </div>
      <div class="row">
        <button class="btn small" :disabled="!!busy" @click="backup(t)">{{ busy === t.id ? 'En cours…' : 'Sauvegarder maintenant' }}</button>
        <button class="btn secondary small" :disabled="!!busy" @click="restoreFrom(t)">Restaurer sur cet appareil</button>
      </div>
    </div>
    <p v-if="!targets.length && !adding" class="empty">Aucune destination. Ajoute-en une pour sauvegarder ton coffre hors de cet appareil.</p>

    <div v-if="adding" class="card stack">
      <h2>Nouvelle destination</h2>
      <label class="field">
        Type
        <select v-model="draft.kind">
          <option value="webdav">{{ KIND_LABEL.webdav }}</option>
          <option value="s3">{{ KIND_LABEL.s3 }}</option>
          <option v-if="canDir" value="dir">{{ KIND_LABEL.dir }}</option>
        </select>
      </label>
      <label class="field">Nom <input v-model="draft.label" placeholder="ex. Nextcloud du club" /></label>
      <template v-if="draft.kind === 'webdav'">
        <label class="field">Adresse du dossier <input v-model="draft.url" placeholder="https://cloud.exemple.ch/remote.php/dav/files/moi/foulee" autocomplete="off" /></label>
        <div class="form-grid">
          <label class="field">Utilisateur <input v-model="draft.username" autocomplete="off" /></label>
          <label class="field">Mot de passe (d’application) <input v-model="draft.password" type="password" autocomplete="off" /></label>
        </div>
      </template>
      <template v-else-if="draft.kind === 's3'">
        <div class="form-grid">
          <label class="field">Seau (bucket) <input v-model="draft.bucket" autocomplete="off" /></label>
          <label class="field">Région <input v-model="draft.region" placeholder="eu-west-1" autocomplete="off" /></label>
          <label class="field">Adresse du service (vide pour AWS) <input v-model="draft.endpoint" placeholder="https://s3.fr-par.scw.cloud" autocomplete="off" /></label>
          <label class="field">Dossier dans le seau <input v-model="draft.prefix" placeholder="foulee/" autocomplete="off" /></label>
          <label class="field">Clé d’accès <input v-model="draft.accessKeyId" autocomplete="off" /></label>
          <label class="field">Clé secrète <input v-model="draft.secretAccessKey" type="password" autocomplete="off" /></label>
        </div>
      </template>
      <template v-else>
        <div class="row">
          <button class="btn secondary small" @click="pickDir">Choisir un dossier…</button>
          <span class="small">{{ pickedName || 'aucun dossier choisi' }}</span>
        </div>
      </template>
      <label class="row small"><input v-model="draft.encrypted" type="checkbox" /> Chiffrer (recommandé)</label>
      <div v-if="draft.encrypted" class="form-grid">
        <label class="field">Phrase secrète (8 caractères minimum) <input v-model="draft.passphrase" type="password" autocomplete="new-password" /></label>
        <label class="field">Confirmer <input v-model="draft.passphrase2" type="password" autocomplete="new-password" /></label>
      </div>
      <p class="small muted">
        Les identifiants de connexion sont gardés sur cet appareil seulement. La phrase secrète n’est jamais enregistrée : elle est redemandée à chaque
        nouvelle session. Le serveur doit autoriser les requêtes depuis cette application (CORS).
      </p>
      <div class="row">
        <button class="btn" :disabled="!!busy" @click="addTarget">{{ busy ? 'Test…' : 'Ajouter' }}</button>
        <button class="btn ghost" @click="adding = false; resetDraft()">Annuler</button>
      </div>
    </div>
    <div v-else><button class="btn secondary" @click="adding = true">＋ Ajouter une destination</button></div>
  </section>
</template>
