<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { DISCIPLINES, athleteName, type DisciplineId } from '@foulee/core';
import { DelayedReplay } from '@foulee/media';
import { athletes, importVideo, saveSession, sessions } from '../store/data';
import { settings } from '../store/settings';
import { locked } from '../lib/lock';
import { formatBytes, todayIso } from '../lib/format';

const router = useRouter();
const live = ref<HTMLVideoElement>();
const canvases = ref<HTMLCanvasElement[]>([]);
const running = ref(false);
const error = ref('');
const facing = ref<'environment' | 'user'>('environment');
const status = ref({ mode: 'encode' as 'encode' | 'images', bufferedSeconds: 0, bufferBytes: 0 });
const saveSeconds = ref(8);
const saveAthlete = ref('');
const saveDiscipline = ref<DisciplineId>('100m');
const saving = ref(false);
const savedMsg = ref('');
let engine: DelayedReplay | null = null;
let stream: MediaStream | null = null;
let statusTimer = 0;

const DELAY_CHOICES = [2, 3, 5, 8, 10, 15, 20, 30];
const views = computed(() => Array.from({ length: settings.replayViews }, (_, i) => settings.replayDelays[i] ?? 5 * (i + 1)));

async function start() {
  error.value = '';
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing.value, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      audio: false,
    });
  } catch (e) {
    error.value = `Caméra inaccessible : ${e instanceof Error ? e.message : String(e)}. Autorise l’accès à la caméra pour ce site.`;
    return;
  }
  const v = live.value!;
  v.srcObject = stream;
  await v.play();
  if (!v.videoWidth) await new Promise((r) => v.addEventListener('loadedmetadata', r, { once: true }));
  engine = new DelayedReplay(v, { fps: 30, width: 960, maxDelay: 32 });
  await engine.start();
  running.value = true;
  await nextTick();
  canvases.value.forEach((c, i) => engine!.addView(c, views.value[i]!));
  statusTimer = window.setInterval(() => engine && (status.value = engine.status()), 500);
}

function stop() {
  engine?.stop();
  engine = null;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  running.value = false;
  clearInterval(statusTimer);
}

function setDelay(i: number, d: number) {
  const next = [...settings.replayDelays];
  next[i] = d;
  settings.replayDelays = next;
  const c = canvases.value[i];
  if (c) engine?.setDelay(c, d);
}

watch(
  () => settings.replayViews,
  async () => {
    if (!engine) return;
    const e = engine;
    canvases.value.forEach((c) => e.removeView(c));
    canvases.value = [];
    await nextTick();
    canvases.value.forEach((c, i) => e.addView(c, views.value[i]!));
  },
);

async function saveClip() {
  if (!engine) return;
  saving.value = true;
  savedMsg.value = '';
  try {
    const blob = await engine.saveLast(saveSeconds.value);
    if (!blob) {
      savedMsg.value = 'Enregistrement impossible sur cet appareil (encodeur vidéo indisponible).';
      return;
    }
    const today = todayIso();
    const session = sessions.value.find((s) => s.date === today) ?? (await saveSession({ date: today, title: 'Séance du jour' }));
    const athleteId = saveAthlete.value || athletes.value[0]?.id;
    if (!athleteId) {
      savedMsg.value = 'Ajoute d’abord un athlète pour enregistrer un essai.';
      return;
    }
    const stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, 'h').replace(/h(\d\d)$/, 'm$1');
    const trial = await importVideo(blob, `replay-${today}-${stamp}.mp4`, { sessionId: session.id, athleteId, discipline: saveDiscipline.value, camera: 'fixe', tags: ['replay'] });
    savedMsg.value = `Essai ${trial.number} enregistré dans la séance du jour.`;
  } catch (e) {
    savedMsg.value = `Erreur : ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    saving.value = false;
  }
}

async function switchCamera() {
  facing.value = facing.value === 'environment' ? 'user' : 'environment';
  if (running.value) {
    stop();
    await start();
  }
}

onBeforeUnmount(stop);
</script>

<template>
  <section class="stack">
    <div class="spread">
      <h1>Replay différé</h1>
      <div class="row">
        <label class="row small">
          Vues
          <select v-model.number="settings.replayViews" style="width: auto">
            <option :value="1">1</option>
            <option :value="2">2</option>
            <option :value="3">3</option>
          </select>
        </label>
        <button class="btn ghost small" @click="switchCamera">↺ Caméra {{ facing === 'environment' ? 'arrière' : 'avant' }}</button>
        <button v-if="!running" class="btn" @click="start">▶︎ Démarrer</button>
        <button v-else class="btn danger" @click="stop">■ Arrêter</button>
        <button class="btn ghost small" :disabled="!running" @click="locked = true">Verrouiller</button>
      </div>
    </div>
    <p class="small muted">
      Pose l’appareil face à la zone d’action : l’athlète se voit avec quelques secondes de retard en revenant. Avec plusieurs
      vues, chaque écran a son propre retard. Le verrou empêche les touchers accidentels.
    </p>
    <p v-if="error" class="banner warn">{{ error }}</p>

    <div v-if="running" class="views" :class="`n${views.length}`">
      <div v-for="(d, i) in views" :key="`${i}-${views.length}`" class="view">
        <canvas :ref="(el) => { if (el) canvases[i] = el as HTMLCanvasElement; }"></canvas>
        <div class="badge">−{{ d }} s</div>
        <select class="delay" :value="d" aria-label="Retard" @change="setDelay(i, Number(($event.target as HTMLSelectElement).value))">
          <option v-for="c in DELAY_CHOICES" :key="c" :value="c">{{ c }} s</option>
        </select>
        <div v-if="status.bufferedSeconds < d" class="waiting">Mise en mémoire… {{ Math.max(0, Math.ceil(d - status.bufferedSeconds)) }} s</div>
      </div>
    </div>
    <div v-else class="empty card">Appuie sur « Démarrer » pour activer la caméra.</div>

    <div v-show="running" class="card stack">
      <div class="row">
        <video ref="live" class="live" playsinline muted aria-label="Caméra en direct"></video>
        <span class="small muted">Direct</span>
      </div>
      <div class="small muted">
        Mode {{ status.mode === 'encode' ? 'vidéo encodée (WebCodecs)' : 'images (repli)' }} · {{ Math.round(status.bufferedSeconds) }} s en mémoire ·
        {{ formatBytes(status.bufferBytes) }}
      </div>
      <div class="row">
        <strong>Garder comme essai :</strong>
        <select v-model.number="saveSeconds" style="width: auto" aria-label="Durée à garder">
          <option v-for="s in [5, 8, 12, 20, 30]" :key="s" :value="s">{{ s }} dernières s</option>
        </select>
        <select v-model="saveAthlete" style="width: auto" aria-label="Athlète">
          <option value="">{{ athletes[0] ? athleteName(athletes[0]) : 'Aucun athlète' }}</option>
          <option v-for="a in athletes.slice(1)" :key="a.id" :value="a.id">{{ athleteName(a) }}</option>
        </select>
        <select v-model="saveDiscipline" style="width: auto" aria-label="Épreuve">
          <option v-for="d in DISCIPLINES" :key="d.id" :value="d.id">{{ d.label }}</option>
        </select>
        <button class="btn" :disabled="saving || status.mode !== 'encode'" @click="saveClip">Enregistrer</button>
      </div>
      <p v-if="savedMsg" class="small">
        {{ savedMsg }}
        <button v-if="savedMsg.startsWith('Essai')" class="btn ghost small" @click="router.push('/seances')">Voir</button>
      </p>
    </div>
  </section>
</template>

<style scoped>
.live {
  width: 160px;
  border-radius: 8px;
  background: var(--stage);
}
.views {
  display: grid;
  gap: 8px;
}
.views.n2 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.views.n3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
@media (max-width: 760px) {
  .views.n2,
  .views.n3 {
    grid-template-columns: 1fr;
  }
}
.view {
  position: relative;
  background: var(--stage);
  border-radius: 12px;
  overflow: hidden;
}
.view canvas {
  width: 100%;
  display: block;
  aspect-ratio: 16 / 9;
  object-fit: contain;
}
.badge {
  position: absolute;
  left: 10px;
  top: 10px;
  background: var(--accent);
  color: var(--accent-text);
  font-weight: 800;
  font-size: 1.4rem;
  padding: 2px 10px;
  border-radius: 8px;
}
.delay {
  position: absolute;
  right: 10px;
  top: 10px;
  width: auto;
  background: rgb(0 0 0 / 0.6);
  color: #fff;
  border-color: transparent;
}
.waiting {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #fff;
  font-size: 1.2rem;
  background: rgb(0 0 0 / 0.4);
}
</style>
