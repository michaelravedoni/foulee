import { computed, reactive, ref, shallowRef } from 'vue';
import {
  SCHEMA,
  createAnalysis,
  createAthlete,
  createSession,
  createTrial,
  nowIso,
  touch,
  type Analysis,
  type Athlete,
  type MediaInfo,
  type Trial,
  type TrainingSession,
  type DisciplineId,
} from '@foulee/core';
import { MemoryProvider, OpfsProvider, Vault, safeExt, type StorageProvider } from '@foulee/vault';
import { probeVideo, canCreateProxy, createProxyInWorker } from '@foulee/media';
import { settings } from './settings';

/**
 * État de l'application : un index en mémoire reconstruit depuis le coffre à
 * chaque démarrage (jetable). Le coffre reste la seule source de vérité.
 */
export const state = reactive({
  ready: false,
  error: '' as string,
  /** Étape en cours à l'ouverture du coffre (affichée si ça bloque). */
  step: 'démarrage',
  /** Vrai si l'ouverture du coffre a échoué : l'app propose de réessayer ou de réinitialiser. */
  failed: false as boolean,
  providerName: '',
  persistent: false as boolean,
  athletes: new Map<string, Athlete>(),
  sessions: new Map<string, TrainingSession>(),
  trials: new Map<string, Trial>(),
  analyses: new Map<string, Analysis>(),
  media: new Map<string, MediaInfo>(),
  loadErrors: [] as { key: string; message: string }[],
  /** Travaux de fond (import, proxys) affichés dans la barre d'état. */
  jobs: new Map<string, { label: string; progress: number }>(),
});

export const vaultRef = shallowRef<Vault | null>(null);

function vault(): Vault {
  if (!vaultRef.value) throw new Error('Coffre non ouvert');
  return vaultRef.value;
}

export async function initStore(): Promise<void> {
  state.failed = false;
  state.error = '';
  try {
    let provider: StorageProvider;
    if (OpfsProvider.isSupported()) provider = new OpfsProvider();
    else {
      provider = new MemoryProvider();
      state.error = 'Ce navigateur ne permet pas le stockage local (OPFS) : les données seront perdues à la fermeture.';
    }
    const v = new Vault(provider, `Foulée ${__APP_VERSION__}`);
    state.step = 'ouverture du coffre';
    await v.open();
    vaultRef.value = v;
    state.providerName = provider.name;
    state.step = 'lecture des fiches';
    await reload();
    if (navigator.storage?.persisted) state.persistent = await navigator.storage.persisted();
  } catch (e) {
    state.failed = true;
    state.error = `Ouverture du coffre impossible (étape : ${state.step}) : ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    state.ready = true;
  }
}

/** Efface le stockage local de cet appareil (dernier recours, après confirmation). */
export async function resetLocalStorage(): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry('foulee-vault', { recursive: true });
  } catch {
    // dossier déjà absent
  }
  try {
    localStorage.removeItem('foulee.settings.v1');
  } catch {
    // ignoré
  }
}

export async function reload(): Promise<void> {
  const snap = await vault().loadAll();
  state.athletes = new Map(snap.athletes.map((a) => [a.id, a]));
  state.sessions = new Map(snap.sessions.map((s) => [s.id, s]));
  state.trials = new Map(snap.trials.map((t) => [t.id, t]));
  state.analyses = new Map(snap.analyses.map((a) => [a.trialId, a]));
  state.media = new Map(snap.media.map((m) => [m.hash, m]));
  state.loadErrors = snap.errors;
}

export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  state.persistent = await navigator.storage.persist();
  return state.persistent;
}

// ——— Lectures ———

const alive = <T extends { deletedAt?: string }>(x: T) => !x.deletedAt;

export const athletes = computed(() =>
  [...state.athletes.values()].filter(alive).sort((a, b) => a.lastName.localeCompare(b.lastName, 'fr') || a.firstName.localeCompare(b.firstName, 'fr')),
);
export const sessions = computed(() => [...state.sessions.values()].filter(alive).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)));
export const trials = computed(() => [...state.trials.values()].filter(alive));

export function trialsOfSession(sessionId: string): Trial[] {
  return trials.value.filter((t) => t.sessionId === sessionId).sort((a, b) => a.number - b.number);
}
export function trialsOfAthlete(athleteId: string): Trial[] {
  return trials.value.filter((t) => t.athleteId === athleteId);
}
export function mediaOf(trial: Trial | undefined): MediaInfo | undefined {
  return trial?.mediaHash ? state.media.get(trial.mediaHash) : undefined;
}

export const allTags = computed(() => {
  const set = new Set<string>();
  for (const x of [...state.athletes.values(), ...state.sessions.values(), ...state.trials.values()]) for (const t of x.tags) set.add(t);
  return [...set].sort((a, b) => a.localeCompare(b, 'fr'));
});

// ——— Écritures ———

export async function saveAthlete(input: Partial<Athlete> & Pick<Athlete, 'firstName' | 'lastName'>): Promise<Athlete> {
  const existing = input.id ? state.athletes.get(input.id) : undefined;
  const a = existing ? touch(existing, input) : createAthlete(input);
  await vault().save('athlete', a);
  state.athletes.set(a.id, a);
  return a;
}

export async function saveSession(input: Partial<TrainingSession> & Pick<TrainingSession, 'date'>): Promise<TrainingSession> {
  const existing = input.id ? state.sessions.get(input.id) : undefined;
  const s = existing ? touch(existing, input) : createSession(input);
  await vault().save('session', s);
  state.sessions.set(s.id, s);
  return s;
}

export async function saveTrial(trial: Trial, patch: Partial<Trial> = {}): Promise<Trial> {
  const t = touch(trial, patch);
  await vault().save('trial', t);
  state.trials.set(t.id, t);
  return t;
}

export function analysisOf(trialId: string): Analysis {
  return state.analyses.get(trialId) ?? createAnalysis(trialId);
}

const analysisTimers = new Map<string, number>();

/** Écrit immédiatement les analyses en attente (ex. l'app passe en arrière-plan). */
export function flushAnalyses(): void {
  for (const [trialId, timer] of analysisTimers) {
    clearTimeout(timer);
    const a = state.analyses.get(trialId);
    if (a) void vault().save('analysis', a);
  }
  analysisTimers.clear();
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushAnalyses);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAnalyses();
  });
}
/** Enregistre l'analyse (dessins, repères) avec un léger délai pour regrouper les écritures. */
export function saveAnalysis(a: Analysis, immediate = false): Promise<void> {
  const next = { ...a, updatedAt: nowIso() };
  state.analyses.set(a.trialId, next);
  const prev = analysisTimers.get(a.trialId);
  if (prev) clearTimeout(prev);
  const write = () => vault().save('analysis', state.analyses.get(a.trialId)!);
  if (immediate) return write();
  return new Promise((resolve) => {
    analysisTimers.set(
      a.trialId,
      window.setTimeout(() => {
        analysisTimers.delete(a.trialId);
        void write().then(resolve);
      }, 400),
    );
  });
}

/** Corbeille : suppression douce en cascade (athlète/séance → essais). */
export async function moveToTrash(kind: 'athlete' | 'session' | 'trial', id: string): Promise<void> {
  const stamp = nowIso();
  if (kind === 'trial') {
    const t = state.trials.get(id);
    if (t) await saveTrial(t, { deletedAt: stamp });
    return;
  }
  const map = kind === 'athlete' ? state.athletes : state.sessions;
  const e = map.get(id);
  if (!e) return;
  const updated = touch(e, { deletedAt: stamp });
  await vault().save(kind, updated as never);
  map.set(id, updated as never);
  for (const t of trials.value) if ((kind === 'athlete' ? t.athleteId : t.sessionId) === id) await saveTrial(t, { deletedAt: stamp });
}

export async function restore(kind: 'athlete' | 'session' | 'trial', id: string): Promise<void> {
  if (kind === 'trial') {
    const t = state.trials.get(id);
    if (t) {
      const { deletedAt: _, ...rest } = t;
      await saveTrial(rest as Trial);
    }
    return;
  }
  const map = kind === 'athlete' ? state.athletes : state.sessions;
  const e = map.get(id);
  if (!e?.deletedAt) return;
  const stamp = e.deletedAt;
  const { deletedAt: _, ...rest } = e;
  const restored = touch(rest as Athlete | TrainingSession);
  await vault().save(kind, restored as never);
  map.set(id, restored as never);
  for (const t of state.trials.values())
    if (t.deletedAt === stamp && (kind === 'athlete' ? t.athleteId : t.sessionId) === id) await restore('trial', t.id);
}

/** Suppression définitive d'un élément de la corbeille (et des vidéos devenues orphelines). */
export async function purge(kind: 'athlete' | 'session' | 'trial', id: string): Promise<void> {
  const v = vault();
  if (kind === 'trial') {
    const t = state.trials.get(id);
    await v.remove('trial', id);
    await v.remove('analysis', id);
    state.trials.delete(id);
    state.analyses.delete(id);
    if (t?.mediaHash && ![...state.trials.values()].some((x) => x.mediaHash === t.mediaHash)) {
      const m = state.media.get(t.mediaHash);
      if (m) await v.removeMedia(m);
      state.media.delete(t.mediaHash);
    }
    return;
  }
  for (const t of [...state.trials.values()]) if ((kind === 'athlete' ? t.athleteId : t.sessionId) === id) await purge('trial', t.id);
  await v.remove(kind, id);
  (kind === 'athlete' ? state.athletes : state.sessions).delete(id);
}

// ——— Import de vidéos ———

export interface ImportDefaults {
  sessionId: string;
  athleteId: string;
  discipline: DisciplineId;
  camera?: Trial['camera'];
  shoes?: Trial['shoes'];
  surface?: Trial['surface'];
  lighting?: Trial['lighting'];
  captureFps?: number;
  tags?: string[];
}

export async function importVideo(file: Blob, name: string, defaults: ImportDefaults): Promise<Trial> {
  const jobId = `import-${name}-${Date.now()}`;
  state.jobs.set(jobId, { label: `Import de ${name}`, progress: 0 });
  try {
    const probed = await probeVideo(file).catch((e: unknown) => {
      throw new Error(`${name} : ${e instanceof Error ? e.message : String(e)}`);
    });
    probed.input.dispose();
    const ext = safeExt(name, file.type);
    const { hash } = await vault().putMedia(file, ext, (phase, done, total) => {
      state.jobs.set(jobId, { label: `${phase === 'empreinte' ? 'Analyse' : 'Copie'} de ${name}`, progress: total ? done / total : 0 });
    });
    let media = state.media.get(hash);
    if (!media) {
      media = {
        schema: SCHEMA.media,
        hash,
        mime: file.type || probed.mime,
        ext,
        size: file.size,
        originalName: name,
        importedAt: nowIso(),
        width: probed.width,
        height: probed.height,
        rotation: probed.rotation,
        durationS: probed.durationS,
        frameCount: probed.timeline.frameCount,
        nominalFps: probed.timeline.nominalFps,
        variableFrameRate: probed.timeline.variable,
        ...(probed.codec ? { codec: probed.codec } : {}),
      };
      await vault().save('media', media);
      state.media.set(hash, media);
    }
    const number = Math.max(0, ...trialsOfSession(defaults.sessionId).map((t) => t.number)) + 1;
    const { tags, ...rest } = defaults;
    const trial = createTrial({ ...rest, number, mediaHash: hash, tags: tags ?? [] });
    await vault().save('trial', trial);
    state.trials.set(trial.id, trial);
    if (settings.autoProxy) void ensureProxy(media);
    return trial;
  } finally {
    state.jobs.delete(jobId);
  }
}

/** Crée le proxy basse résolution en arrière-plan si la vidéo est grande. */
export async function ensureProxy(media: MediaInfo, force = false): Promise<void> {
  if (media.proxyHash && !force) return;
  if (!force && Math.max(media.width, media.height) <= 1280) return;
  if (!canCreateProxy()) return;
  const original = await vault().getMedia(media);
  if (!original) return;
  const jobId = `proxy-${media.hash}`;
  if (state.jobs.has(jobId)) return;
  state.jobs.set(jobId, { label: `Proxy de ${media.originalName}`, progress: 0 });
  try {
    const proxy = await createProxyInWorker(original, (p) => state.jobs.set(jobId, { label: `Proxy de ${media.originalName}`, progress: p }));
    if (!proxy) return;
    await vault().putProxy(media.hash, proxy);
    const updated: MediaInfo = { ...media, proxyHash: media.hash };
    await vault().save('media', updated);
    state.media.set(media.hash, updated);
  } catch (e) {
    console.warn('Proxy impossible', e);
  } finally {
    state.jobs.delete(jobId);
  }
}

export async function loadMediaBlobs(media: MediaInfo): Promise<{ original: Blob | null; proxy: Blob | null }> {
  const v = vault();
  const [original, proxy] = await Promise.all([v.getMedia(media), media.proxyHash ? v.getProxy(media.hash) : Promise.resolve(null)]);
  return { original, proxy };
}

export const busy = computed(() => state.jobs.size > 0);
export const lastError = ref('');
