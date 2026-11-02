<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, shallowRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  athleteName,
  disciplineLabel,
  eventLabel,
  realTimeScale,
  type Analysis,
  type FrameTimeline,
  type MediaInfo,
  type Trial,
} from '@foulee/core';
import { analysisOf, loadMediaBlobs, mediaOf, saveAnalysis, state, trials } from '../store/data';
import { formatDate } from '../lib/format';
import FramePlayer, { type ZoomState } from '../components/FramePlayer.vue';
import { isTypingTarget } from '../lib/keys';

interface Pane {
  trial: Trial;
  media: MediaInfo;
  original: Blob;
  proxy: Blob | null;
  analysis: Analysis;
  timeline: FrameTimeline | null;
  frame: number;
  sync: number;
}

const route = useRoute();
const router = useRouter();
const ids = computed(() => {
  const e = route.query.e;
  return (Array.isArray(e) ? e : e ? [e] : []).filter((x): x is string => typeof x === 'string').slice(0, 4);
});
const panes = shallowRef<Pane[]>([]);
type Player = InstanceType<typeof FramePlayer>;
const players = ref<Player[]>([]);
function setPlayer(i: number, el: unknown) {
  if (el) players.value[i] = el as Player;
  else players.value.splice(i, 1);
}
const linkedZoom = ref(true);
const sharedZoom = reactive<ZoomState>({ scale: 1, x: 0, y: 0 });
const rate = ref(0.25);
const playing = ref(false);
const layout = ref<'auto' | 'colonne'>('auto');
const syncType = ref('');
const pickerQuery = ref('');

watch(
  ids,
  async (list) => {
    const out: Pane[] = [];
    for (const id of list) {
      const t = state.trials.get(id);
      const m = mediaOf(t);
      if (!t || !m) continue;
      const { original, proxy } = await loadMediaBlobs(m);
      if (!original) continue;
      const analysis = analysisOf(id);
      out.push(reactive({ trial: t, media: m, original, proxy, analysis, timeline: null, frame: analysis.timeOrigin, sync: analysis.timeOrigin }) as Pane);
    }
    panes.value = out;
  },
  { immediate: true },
);

function label(p: Pane): string {
  const a = state.athletes.get(p.trial.athleteId);
  const s = state.sessions.get(p.trial.sessionId);
  return `${a ? athleteName(a) : '—'} · ${disciplineLabel(p.trial.discipline)} · essai ${p.trial.number} · ${formatDate(s?.date ?? '')}`;
}

function scaleOf(p: Pane): number {
  return realTimeScale(p.timeline?.nominalFps ?? p.media.nominalFps, p.trial.captureFps);
}

/** Aligne toutes les vues sur la vue maîtresse (0), en temps réel depuis leur point de synchro. */
function alignToMaster() {
  const master = panes.value[0];
  if (!master?.timeline) return;
  const dt = (master.timeline.timeOf(master.frame) - master.timeline.timeOf(master.sync)) * scaleOf(master);
  panes.value.forEach((p, i) => {
    if (i === 0 || !p.timeline) return;
    const target = p.timeline.nearestFrame(p.timeline.timeOf(p.sync) + dt / scaleOf(p));
    players.value[i]?.seek(target);
  });
}

function stepAll(n: number) {
  pauseAll();
  players.value[0]?.step(n);
  // La vue maîtresse émet sa nouvelle image ; on aligne ensuite les autres.
  requestAnimationFrame(alignToMaster);
}

function playAll() {
  if (playing.value) return pauseAll();
  playing.value = true;
  players.value.forEach((pl) => {
    pl.setRate(rate.value);
    void pl.play();
  });
}
function pauseAll() {
  if (!playing.value) return;
  playing.value = false;
  players.value.forEach((pl) => pl.pause());
  requestAnimationFrame(alignToMaster);
}
function setRate(r: number) {
  rate.value = r;
  if (playing.value) {
    pauseAll();
    playAll();
  }
}

function syncHere() {
  panes.value.forEach((p) => (p.sync = p.frame));
}
function syncOnEvent() {
  if (!syncType.value) return;
  const [type, side] = syncType.value.split('|') as [string, string | undefined];
  panes.value.forEach((p, i) => {
    const ev = p.analysis.events.find((e) => e.type === type && (side ? e.side === side : true));
    if (ev) {
      p.sync = ev.frame;
      players.value[i]?.seek(ev.frame);
    }
  });
}
const commonEvents = computed(() => {
  if (!panes.value.length) return [];
  const keys = panes.value.map((p) => new Set(p.analysis.events.map((e) => `${e.type}|${e.side ?? ''}`)));
  return [...keys[0]!].filter((k) => keys.every((s) => s.has(k)));
});

function onAnalysis(p: Pane, a: Analysis) {
  p.analysis = a;
  void saveAnalysis(a);
}

function removePane(i: number) {
  void router.replace({ query: { e: ids.value.filter((_, j) => j !== i) } });
}
const candidates = computed(() =>
  trials.value
    .filter((t) => t.mediaHash && !ids.value.includes(t.id))
    .filter((t) => {
      const q = pickerQuery.value.toLowerCase();
      if (!q) return true;
      const a = state.athletes.get(t.athleteId);
      return `${a ? athleteName(a) : ''} ${disciplineLabel(t.discipline)}`.toLowerCase().includes(q);
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 30),
);
function addPane(id: string) {
  void router.replace({ query: { e: [...ids.value, id].slice(0, 4) } });
}

function onKey(e: KeyboardEvent) {
  if (isTypingTarget(e.target)) return;
  if (e.key === 'ArrowRight') {
    e.preventDefault();
    stepAll(e.shiftKey ? 10 : 1);
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    stepAll(e.shiftKey ? -10 : -1);
  } else if (e.key === ' ') {
    e.preventDefault();
    playAll();
  }
}
window.addEventListener('keydown', onKey);
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));

const gridClass = computed(() => (layout.value === 'colonne' ? 'cols-1' : `cols-${Math.min(2, panes.value.length)}`));
</script>

<template>
  <section class="stack">
    <div class="spread">
      <h1>Comparer</h1>
      <div class="row">
        <button class="btn ghost small" :aria-pressed="linkedZoom" @click="linkedZoom = !linkedZoom">Zoom lié</button>
        <button class="btn ghost small" @click="layout = layout === 'auto' ? 'colonne' : 'auto'">{{ layout === 'auto' ? 'Côte à côte' : 'Empilé' }}</button>
      </div>
    </div>

    <div v-if="panes.length" class="card controls">
      <div class="row">
        <button class="btn secondary icon" aria-label="Reculer de 10 images" @click="stepAll(-10)">⏪</button>
        <button class="btn secondary icon" aria-label="Image précédente" @click="stepAll(-1)">◀︎</button>
        <button class="btn icon" :aria-label="playing ? 'Pause' : 'Lecture'" @click="playAll">{{ playing ? '❚❚' : '▶︎' }}</button>
        <button class="btn secondary icon" aria-label="Image suivante" @click="stepAll(1)">▶︎❘</button>
        <button class="btn secondary icon" aria-label="Avancer de 10 images" @click="stepAll(10)">⏩</button>
        <select :value="rate" aria-label="Vitesse" style="width: auto" @change="setRate(Number(($event.target as HTMLSelectElement).value))">
          <option v-for="s in [0.1, 0.25, 0.5, 1]" :key="s" :value="s">{{ String(s).replace('.', ',') }}×</option>
        </select>
      </div>
      <div class="row">
        <button class="btn small" title="Chaque vidéo garde son image actuelle comme point commun" @click="syncHere">⇆ Synchroniser ici</button>
        <select v-if="commonEvents.length" v-model="syncType" style="width: auto" aria-label="Synchroniser sur un repère">
          <option value="">Synchroniser sur un repère…</option>
          <option v-for="k in commonEvents" :key="k" :value="k">{{ eventLabel(k.split('|')[0]!, (k.split('|')[1] || undefined) as 'G' | 'D' | undefined) }}</option>
        </select>
        <button v-if="commonEvents.length" class="btn ghost small" :disabled="!syncType" @click="syncOnEvent">OK</button>
      </div>
      <p class="small muted" style="flex-basis: 100%; margin: 0">
        Place chaque vidéo sur le même instant (par exemple le décollage) avec ses propres boutons, puis « Synchroniser ici » :
        les boutons du haut avancent alors toutes les vidéos ensemble, en temps réel même si les cadences diffèrent.
      </p>
    </div>

    <div class="panes" :class="gridClass">
      <div v-for="(p, i) in panes" :key="p.trial.id" class="pane stack">
        <div class="spread small">
          <strong>{{ label(p) }}</strong>
          <button class="btn ghost small" :aria-label="`Retirer ${label(p)}`" @click="removePane(i)">✕</button>
        </div>
        <FramePlayer
          :ref="(el) => setPlayer(i, el)"
          :media="p.media"
          :original="p.original"
          :proxy="p.proxy"
          :analysis="p.analysis"
          :capture-fps="p.trial.captureFps"
          :zoom="linkedZoom ? sharedZoom : undefined"
          compact
          @update:zoom="(z) => Object.assign(sharedZoom, z)"
          @update:analysis="(a) => onAnalysis(p, a)"
          @ready="(tl) => (p.timeline = tl)"
          @frame="(f) => (p.frame = f)"
        />
        <div class="small muted mono">synchro : image {{ p.sync }} · décalage {{ p.frame - p.sync }} img</div>
      </div>
    </div>

    <div v-if="ids.length < 4" class="card stack">
      <h2>{{ panes.length ? 'Ajouter un essai' : 'Choisis 2 à 4 essais' }}</h2>
      <input v-model="pickerQuery" type="search" placeholder="Filtrer par athlète ou épreuve" aria-label="Filtrer" />
      <ul class="list">
        <li v-for="t in candidates" :key="t.id">
          <button class="list-item pickbtn" @click="addPane(t.id)">
            <span class="grow">
              {{ state.athletes.get(t.athleteId) ? athleteName(state.athletes.get(t.athleteId)!) : '—' }} · {{ disciplineLabel(t.discipline) }} · essai
              {{ t.number }}
              <span class="small muted"> · {{ formatDate(state.sessions.get(t.sessionId)?.date ?? '') }}</span>
            </span>
            <span class="pill">＋</span>
          </button>
        </li>
      </ul>
      <p v-if="!candidates.length" class="muted small">Aucun autre essai avec vidéo.</p>
    </div>
  </section>
</template>

<style scoped>
.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
  align-items: center;
}
.panes {
  display: grid;
  gap: 12px;
}
.cols-1 {
  grid-template-columns: 1fr;
}
.cols-2 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
@media (max-width: 760px) {
  .cols-2 {
    grid-template-columns: 1fr;
  }
}
.pickbtn {
  width: 100%;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
</style>
