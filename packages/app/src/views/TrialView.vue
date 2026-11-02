<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import {
  BASIC_EVENT_TYPES,
  CAMERA_LABELS,
  DISCIPLINES,
  LIGHTING_LABELS,
  SHOES_LABELS,
  SURFACE_LABELS,
  athleteName,
  derivedTags,
  disciplineLabel,
  eventLabel,
  formatTimecode,
  newId,
  realTimeScale,
  type Analysis,
  type FrameTimeline,
  type MarkedEvent,
  type Trial,
} from '@foulee/core';
import { analysisOf, athletes, loadMediaBlobs, mediaOf, moveToTrash, saveAnalysis, saveTrial, state, trialsOfAthlete, ensureProxy } from '../store/data';
import { formatBytes, formatDate, formatFps } from '../lib/format';
import FramePlayer from '../components/FramePlayer.vue';
import { isTypingTarget } from '../lib/keys';
import TagEditor from '../components/TagEditor.vue';

const props = defineProps<{ id: string }>();
const router = useRouter();
const trial = computed(() => state.trials.get(props.id));
const media = computed(() => mediaOf(trial.value));
const athlete = computed(() => (trial.value ? state.athletes.get(trial.value.athleteId) : undefined));
const session = computed(() => (trial.value ? state.sessions.get(trial.value.sessionId) : undefined));
const original = shallowRef<Blob | null>(null);
const proxy = shallowRef<Blob | null>(null);
const missing = ref(false);
const analysis = ref<Analysis>(analysisOf(props.id));
const player = ref<InstanceType<typeof FramePlayer>>();
const timeline = shallowRef<FrameTimeline | null>(null);
const currentFrame = ref(0);
const tab = ref<'reperes' | 'infos'>('reperes');

watch(
  () => props.id,
  async () => {
    analysis.value = analysisOf(props.id);
    original.value = null;
    missing.value = false;
    const m = media.value;
    if (!m) return;
    const blobs = await loadMediaBlobs(m);
    if (!blobs.original) {
      missing.value = true;
      return;
    }
    proxy.value = blobs.proxy;
    original.value = blobs.original;
  },
  { immediate: true },
);

function onAnalysis(a: Analysis) {
  analysis.value = a;
  void saveAnalysis(a);
}

async function patch(p: Partial<Trial>) {
  if (trial.value) await saveTrial(trial.value, p);
}

const others = computed(() => {
  const t = trial.value;
  if (!t) return [];
  return trialsOfAthlete(t.athleteId)
    .filter((x) => x.id !== t.id && x.discipline === t.discipline && x.mediaHash)
    .sort((a, b) => (state.sessions.get(b.sessionId)?.date ?? '').localeCompare(state.sessions.get(a.sessionId)?.date ?? '') || b.number - a.number);
});
const previous = computed(() => {
  const t = trial.value;
  if (!t) return undefined;
  const sameSession = trialsOfAthlete(t.athleteId).filter((x) => x.sessionId === t.sessionId && x.number < t.number && x.discipline === t.discipline && x.mediaHash);
  return sameSession.sort((a, b) => b.number - a.number)[0] ?? others.value[0];
});
const best = computed(() => others.value.find((x) => x.tags.includes('meilleur')));

// ——— Repères (événements) ———
const fps = computed(() => timeline.value?.nominalFps ?? media.value?.nominalFps ?? 30);
function mark(type: string, side?: 'G' | 'D') {
  const tl = timeline.value;
  if (!tl) return;
  const f = currentFrame.value;
  const ev: MarkedEvent = { id: newId('evt'), type, frame: f, time: tl.timeOf(f), source: 'manuel', confidence: 1, ...(side ? { side } : {}) };
  const events = [...analysis.value.events, ev].sort((a, b) => a.frame - b.frame);
  onAnalysis({ ...analysis.value, events });
}
function removeEvent(id: string) {
  onAnalysis({ ...analysis.value, events: analysis.value.events.filter((e) => e.id !== id) });
}
function eventTime(ev: MarkedEvent): string {
  const tl = timeline.value;
  if (!tl) return '';
  return formatTimecode('ms', {
    frame: ev.frame,
    originFrame: analysis.value.timeOrigin,
    time: tl.timeOf(ev.frame),
    originTime: tl.timeOf(analysis.value.timeOrigin),
    scale: realTimeScale(fps.value, trial.value?.captureFps),
  });
}
function deltaMs(a: MarkedEvent, b: MarkedEvent): string {
  const tl = timeline.value;
  if (!tl) return '';
  const ms = (tl.timeOf(b.frame) - tl.timeOf(a.frame)) * 1000 * realTimeScale(fps.value, trial.value?.captureFps);
  return `+${ms.toFixed(0)} ms`;
}

function onKey(e: KeyboardEvent) {
  if (isTypingTarget(e.target)) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const t = BASIC_EVENT_TYPES.find((x) => x.key === e.key.toLowerCase());
  if (!t) return;
  e.preventDefault();
  mark(t.id, t.sided ? (e.shiftKey ? 'D' : 'G') : undefined);
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));

async function trash() {
  if (!confirm('Mettre cet essai à la corbeille ?')) return;
  const sid = trial.value?.sessionId;
  await moveToTrash('trial', props.id);
  void router.push(sid ? `/seances/${sid}` : '/');
}
</script>

<template>
  <section v-if="trial" class="trial stack">
    <div class="spread">
      <div>
        <h1>
          {{ athlete ? athleteName(athlete) : '—' }} · {{ disciplineLabel(trial.discipline) }}
          <span class="muted">essai {{ trial.number }}</span>
        </h1>
        <div class="small muted">
          <RouterLink :to="`/seances/${trial.sessionId}`">{{ session?.title || formatDate(session?.date ?? '') }}</RouterLink>
          <template v-if="athlete"> · <RouterLink :to="`/athletes/${athlete.id}`">fiche athlète</RouterLink></template>
        </div>
      </div>
      <div class="row">
        <RouterLink v-if="previous" class="btn secondary small" :to="{ path: '/comparer', query: { e: [trial.id, previous.id] } }">Comparer au précédent</RouterLink>
        <RouterLink v-if="best" class="btn secondary small" :to="{ path: '/comparer', query: { e: [trial.id, best.id] } }">Comparer au meilleur</RouterLink>
        <button class="btn ghost small" :aria-pressed="trial.favorite" @click="patch({ favorite: !trial.favorite })">★</button>
      </div>
    </div>

    <TagEditor :model-value="trial.tags" quick :derived="derivedTags(trial, media?.nominalFps)" @update:model-value="(tags) => patch({ tags })" />

    <div class="layout">
      <div class="main">
        <p v-if="!media" class="empty">Cet essai n’a pas de vidéo.</p>
        <p v-else-if="missing" class="empty">La vidéo de cet essai n’est pas dans le coffre de cet appareil (archive importée sans vidéos ?).</p>
        <p v-else-if="!original" class="empty">Chargement de la vidéo…</p>
        <FramePlayer
          v-else
          ref="player"
          :key="id"
          :media="media"
          :original="original"
          :proxy="proxy"
          :analysis="analysis"
          :capture-fps="trial.captureFps"
          keyboard
          @update:analysis="onAnalysis"
          @ready="(tl) => (timeline = tl)"
          @frame="(f) => (currentFrame = f)"
        />
      </div>
      <aside class="side card">
        <div class="tabs">
          <button :class="{ active: tab === 'reperes' }" @click="tab = 'reperes'">Repères</button>
          <button :class="{ active: tab === 'infos' }" @click="tab = 'infos'">Essai</button>
        </div>
        <div v-if="tab === 'reperes'" class="stack">
          <div class="row">
            <template v-for="t in BASIC_EVENT_TYPES" :key="t.id">
              <template v-if="t.sided">
                <button class="btn secondary small" :title="`${t.label} gauche (touche ${t.key})`" @click="mark(t.id, 'G')">{{ t.label }} G</button>
                <button class="btn secondary small" :title="`${t.label} droit (Maj+${t.key})`" @click="mark(t.id, 'D')">{{ t.label }} D</button>
              </template>
              <button v-else class="btn secondary small" :title="`${t.label} (touche ${t.key})`" @click="mark(t.id)">{{ t.label }}</button>
            </template>
          </div>
          <p class="small muted">Marque l’image affichée. Les mesures calculées à partir des repères arrivent en phase 2 et 3.</p>
          <ol v-if="analysis.events.length" class="list events">
            <li v-for="(ev, i) in analysis.events" :key="ev.id" class="list-item">
              <button class="linklike grow" @click="player?.seek(ev.frame)">
                <strong>{{ eventLabel(ev.type, ev.side) }}</strong>
                <span class="mono small">{{ eventTime(ev) }} · img {{ ev.frame }}</span>
                <span v-if="i > 0" class="mono small muted">{{ deltaMs(analysis.events[i - 1]!, ev) }}</span>
              </button>
              <button class="btn ghost small icon" :aria-label="`Supprimer ${eventLabel(ev.type, ev.side)}`" @click="removeEvent(ev.id)">✕</button>
            </li>
          </ol>
          <p v-else class="muted small">Aucun repère.</p>
        </div>
        <div v-else class="stack">
          <label class="field">
            Athlète
            <select :value="trial.athleteId" @change="patch({ athleteId: ($event.target as HTMLSelectElement).value })">
              <option v-for="a in athletes" :key="a.id" :value="a.id">{{ athleteName(a) }}</option>
            </select>
          </label>
          <label class="field">
            Épreuve
            <select :value="trial.discipline" @change="patch({ discipline: ($event.target as HTMLSelectElement).value as Trial['discipline'] })">
              <option v-for="d in DISCIPLINES" :key="d.id" :value="d.id">{{ d.label }}</option>
            </select>
          </label>
          <div class="form-grid">
            <label class="field">
              Caméra
              <select :value="trial.camera ?? ''" @change="patch({ camera: (($event.target as HTMLSelectElement).value || undefined) as Trial['camera'] })">
                <option value="">—</option>
                <option v-for="(l, k) in CAMERA_LABELS" :key="k" :value="k">{{ l }}</option>
              </select>
            </label>
            <label class="field">
              Chaussures
              <select :value="trial.shoes ?? ''" @change="patch({ shoes: (($event.target as HTMLSelectElement).value || undefined) as Trial['shoes'] })">
                <option value="">—</option>
                <option v-for="(l, k) in SHOES_LABELS" :key="k" :value="k">{{ l }}</option>
              </select>
            </label>
            <label class="field">
              Surface
              <select :value="trial.surface ?? ''" @change="patch({ surface: (($event.target as HTMLSelectElement).value || undefined) as Trial['surface'] })">
                <option value="">—</option>
                <option v-for="(l, k) in SURFACE_LABELS" :key="k" :value="k">{{ l }}</option>
              </select>
            </label>
            <label class="field">
              Éclairage
              <select :value="trial.lighting ?? ''" @change="patch({ lighting: (($event.target as HTMLSelectElement).value || undefined) as Trial['lighting'] })">
                <option value="">—</option>
                <option v-for="(l, k) in LIGHTING_LABELS" :key="k" :value="k">{{ l }}</option>
              </select>
            </label>
            <label class="field">
              Cadence réelle (i/s)
              <input
                type="number"
                min="1"
                step="1"
                inputmode="numeric"
                :value="trial.captureFps ?? ''"
                :placeholder="media ? String(media.nominalFps) : ''"
                @change="patch({ captureFps: Number(($event.target as HTMLInputElement).value) || undefined })"
              />
            </label>
            <label class="field">
              Résultat officiel
              <input :value="trial.officialResult ?? ''" placeholder="ex. 11,42" @change="patch({ officialResult: ($event.target as HTMLInputElement).value || undefined })" />
            </label>
          </div>
          <label class="field">Notes <textarea :value="trial.notes" @change="patch({ notes: ($event.target as HTMLTextAreaElement).value })"></textarea></label>
          <div v-if="media" class="small muted">
            {{ media.originalName }} · {{ formatBytes(media.size) }} · {{ media.width }}×{{ media.height }} · {{ formatFps(media.nominalFps) }}{{ media.variableFrameRate ? ' (variable)' : '' }} ·
            {{ media.frameCount }} images · {{ media.codec ?? 'codec inconnu' }} · proxy : {{ media.proxyHash ? 'oui' : 'non' }}
            <button v-if="!media.proxyHash" class="btn ghost small" @click="ensureProxy(media, true)">Créer le proxy</button>
          </div>
          <div><button class="btn ghost small" @click="trash">Mettre l’essai à la corbeille</button></div>
        </div>
      </aside>
    </div>
  </section>
  <p v-else class="empty">Essai introuvable.</p>
</template>

<style scoped>
.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: 16px;
  align-items: start;
}
@media (max-width: 1000px) {
  .layout {
    grid-template-columns: 1fr;
  }
}
.side {
  padding: 8px 12px 12px;
}
.events .list-item {
  padding: 4px 6px 4px 10px;
  min-height: 0;
}
.linklike {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 10px;
  align-items: baseline;
  background: none;
  border: 0;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  padding: 6px 0;
}
</style>
