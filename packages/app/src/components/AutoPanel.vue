<script setup lang="ts">
import { computed, ref } from 'vue';
import { eventLabel, frNumber, newId, suggestFootEvents, type FrameTimeline, type MarkedEvent, type PoseSample, type SuggestedEvent } from '@foulee/core';
import { estimatePoses, type FrameImage } from '@foulee/media';
import { getPoseEstimator } from '../lib/pose';

const props = defineProps<{
  timeline: FrameTimeline | null;
  events: MarkedEvent[];
  grab: (frame: number) => Promise<FrameImage | null | undefined>;
  showSkeleton: boolean;
}>();
const emit = defineEmits<{
  poses: [samples: PoseSample[]];
  addEvents: [events: MarkedEvent[]];
  seek: [frame: number];
  'update:showSkeleton': [value: boolean];
}>();

const status = ref('');
const error = ref('');
const running = ref(false);
const progress = ref({ done: 0, total: 0 });
const found = ref<{ withPose: number; total: number; engine: string } | null>(null);
const suggestions = ref<SuggestedEvent[]>([]);
let abort: AbortController | null = null;

const step = ref(0); // 0 = automatique
const stepUsed = computed(() => {
  const n = props.timeline?.frameCount ?? 0;
  return step.value || Math.max(1, Math.ceil(n / 600));
});

async function run() {
  const tl = props.timeline;
  if (!tl) return;
  running.value = true;
  error.value = '';
  suggestions.value = [];
  found.value = null;
  abort = new AbortController();
  try {
    const est = await getPoseEstimator((m) => (status.value = m));
    status.value = 'Analyse des images…';
    const samples = await estimatePoses(est, props.grab, tl, {
      from: 0,
      to: tl.frameCount - 1,
      step: stepUsed.value,
      signal: abort.signal,
      onProgress: (done, total) => (progress.value = { done, total }),
    });
    emit('poses', samples);
    found.value = { withPose: samples.filter((s) => s.lm).length, total: samples.length, engine: est.name };
    suggestions.value = suggestFootEvents(samples).filter((s) => !already(s));
    status.value = abort.signal.aborted ? 'Analyse interrompue.' : '';
  } catch (e) {
    error.value = `Analyse impossible : ${e instanceof Error ? e.message : String(e)}`;
    status.value = '';
  } finally {
    running.value = false;
  }
}
function stop() {
  abort?.abort();
}

/** Un repère équivalent (même type, même côté, à moins de deux images) existe déjà. */
function already(s: SuggestedEvent): boolean {
  return props.events.some((e) => e.type === s.type && e.side === s.side && Math.abs(e.frame - s.frame) <= 2);
}

function toEvent(s: SuggestedEvent): MarkedEvent {
  const tl = props.timeline!;
  return { id: newId('evt'), type: s.type, side: s.side, frame: s.frame, time: tl.timeOf(s.frame), source: 'auto', confidence: s.confidence, label: 'détecté (pose)' };
}
function accept(s: SuggestedEvent) {
  emit('addEvents', [toEvent(s)]);
  suggestions.value = suggestions.value.filter((x) => x !== s);
}
function reject(s: SuggestedEvent) {
  suggestions.value = suggestions.value.filter((x) => x !== s);
}
function acceptAll() {
  const list = suggestions.value.filter((s) => s.confidence >= 0.5);
  emit('addEvents', list.map(toEvent));
  suggestions.value = suggestions.value.filter((s) => !list.includes(s));
}
const confident = computed(() => suggestions.value.filter((s) => s.confidence >= 0.5).length);
</script>

<template>
  <div class="stack auto">
    <p class="small muted">
      Foulée repère le corps de l’athlète image par image, puis <strong>propose</strong> les appuis et les décollages : tu valides ou tu corriges.
      Tout se passe sur cet appareil. Une caméra fixe et un athlète bien visible, de profil, donnent les meilleurs résultats.
    </p>
    <div class="row">
      <button class="btn big" :disabled="running || !timeline" data-testid="auto-run" @click="run">{{ running ? 'Analyse en cours…' : 'Lancer l’analyse automatique' }}</button>
      <button v-if="running" class="btn ghost small" @click="stop">Arrêter</button>
      <label class="small muted">Vitesse de l’analyse
        <select v-model.number="step" :disabled="running" aria-label="Vitesse de l’analyse">
          <option :value="0">équilibrée (1 image sur {{ stepUsed }})</option>
          <option :value="1">la plus précise (toutes les images)</option>
          <option :value="2">rapide (1 image sur 2)</option>
          <option :value="4">très rapide (1 image sur 4)</option>
        </select>
      </label>
    </div>
    <p v-if="status" class="small" role="status">{{ status }}</p>
    <div v-if="running && progress.total" class="bar" role="progressbar" :aria-valuenow="progress.done" :aria-valuemax="progress.total">
      <div class="fill" :style="{ width: (progress.done / progress.total) * 100 + '%' }"></div>
    </div>
    <p v-if="running && progress.total" class="small muted mono">image {{ progress.done }} / {{ progress.total }}</p>
    <p v-if="error" class="small warn-text" role="alert">{{ error }}</p>

    <template v-if="found">
      <p class="small">
        Corps détecté sur <strong>{{ found.withPose }}</strong> image{{ found.withPose > 1 ? 's' : '' }} sur {{ found.total }} · {{ found.engine }}
      </p>
      <label class="small row"><input type="checkbox" :checked="showSkeleton" @change="emit('update:showSkeleton', ($event.target as HTMLInputElement).checked)" /> Afficher le squelette sur la vidéo</label>
      <p v-if="found.withPose < found.total * 0.5" class="small warn-text">Le corps est mal détecté sur une grande partie de la vidéo : les propositions seront peu fiables.</p>

      <section class="stack">
        <h3>Repères proposés <span class="muted small">({{ suggestions.length }})</span></h3>
        <p v-if="!suggestions.length" class="small muted">Aucun appui à proposer (ou déjà tous posés).</p>
        <template v-else>
          <div class="row">
            <button class="btn secondary small" :disabled="!confident" @click="acceptAll">Accepter les {{ confident }} repères sûrs</button>
          </div>
          <ul class="plain small">
            <li v-for="s in suggestions" :key="s.type + s.side + s.frame" class="row">
              <button class="linklike grow" @click="emit('seek', s.frame)">
                {{ eventLabel(s.type, s.side) }} <span class="muted mono">img {{ s.frame }} · confiance {{ frNumber(s.confidence * 100, 0) }} %</span>
              </button>
              <button class="btn secondary small" :aria-label="`Accepter ${eventLabel(s.type, s.side)} image ${s.frame}`" @click="accept(s)">✓</button>
              <button class="btn ghost small icon" :aria-label="`Ignorer ${eventLabel(s.type, s.side)} image ${s.frame}`" @click="reject(s)">✕</button>
            </li>
          </ul>
        </template>
        <p class="small muted">Les repères acceptés restent modifiables. Vérifie toujours l’image : le modèle peut se tromper (pied caché, flou, fond chargé).</p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.big {
  min-height: 48px;
  padding: 0 20px;
}
.plain {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 4px;
}
.bar {
  height: 6px;
  border-radius: 3px;
  background: var(--surface-2);
  overflow: hidden;
}
.fill {
  height: 100%;
  background: var(--accent, #3b82f6);
  transition: width 0.1s linear;
}
.warn-text {
  color: var(--warn);
}
</style>
