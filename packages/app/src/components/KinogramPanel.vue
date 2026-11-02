<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { eventLabel, formatTimecode, gridLayout, kinogramFrames, type Analysis, type FrameTimeline, type KinogramMode } from '@foulee/core';
import type { FrameImage } from '@foulee/media';

const props = defineProps<{
  analysis: Analysis;
  timeline: FrameTimeline | null;
  timeScale: number;
  title: string;
  grab: (frame: number) => Promise<FrameImage | null | undefined>;
}>();

type Source = 'tous' | 'appui' | 'decollage' | 'passage' | 'regulier';
const source = ref<Source>('tous');
const count = ref(8);
const cols = ref(4);
const busy = ref(false);
const error = ref('');
const canvas = ref<HTMLCanvasElement>();
const done = ref(false);

const spec = computed<KinogramMode>(() =>
  source.value === 'regulier' ? { mode: 'even', count: count.value } : { mode: 'events', ...(source.value === 'tous' ? {} : { types: [source.value] }) },
);
const frames = computed(() => (props.timeline ? kinogramFrames(props.analysis.events, props.timeline, spec.value) : []));

function labelOf(frame: number): string {
  const tl = props.timeline!;
  const ev = props.analysis.events.find((e) => e.frame === frame);
  const t = formatTimecode('ms', {
    frame,
    originFrame: props.analysis.timeOrigin,
    time: tl.timeOf(frame),
    originTime: tl.timeOf(props.analysis.timeOrigin),
    scale: props.timeScale,
  });
  return `${ev ? eventLabel(ev.type, ev.side) + ' · ' : ''}img ${frame} · ${t}`;
}

async function generate() {
  const list = frames.value;
  if (!list.length || !props.timeline) return;
  busy.value = true;
  error.value = '';
  done.value = false;
  try {
    const images: { frame: number; img: FrameImage }[] = [];
    for (const f of list) {
      const img = await props.grab(f);
      if (img) images.push({ frame: f, img });
    }
    if (!images.length) throw new Error('aucune image décodée');
    await nextTick();
    const first = images[0]!.img;
    const iw = 'width' in first ? first.width : 640;
    const ih = 'height' in first ? first.height : 360;
    const tileW = 360;
    const tileH = Math.round((tileW * ih) / iw);
    const bar = 22;
    const { cols: c, rows } = gridLayout(images.length, cols.value);
    const cv = canvas.value!;
    cv.width = c * tileW;
    cv.height = rows * (tileH + bar);
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = '#10151b';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.font = '13px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    images.forEach(({ frame, img }, i) => {
      const x = (i % c) * tileW;
      const y = Math.floor(i / c) * (tileH + bar);
      ctx.drawImage(img, x, y, tileW, tileH);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(labelOf(frame), x + 6, y + tileH + bar / 2);
      ctx.strokeStyle = '#10151b';
      ctx.strokeRect(x, y, tileW, tileH + bar);
    });
    done.value = true;
  } catch (e) {
    error.value = `Kinogramme impossible : ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    busy.value = false;
  }
}

function download() {
  canvas.value?.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kinogramme-${props.title.replace(/[^\w-]+/g, '_') || 'essai'}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, 'image/png');
}
</script>

<template>
  <div class="stack">
    <p class="small muted">Planche d’images aux repères que tu as marqués (semi-manuel) : marque les appuis, puis génère. Les dessins ne sont pas inclus.</p>
    <div class="form-grid">
      <label class="field">
        Images
        <select v-model="source">
          <option value="tous">Tous les repères</option>
          <option value="appui">Appuis</option>
          <option value="decollage">Décollages</option>
          <option value="passage">Passages</option>
          <option value="regulier">Régulières entre le premier et le dernier repère</option>
        </select>
      </label>
      <label v-if="source === 'regulier'" class="field">
        Nombre
        <input v-model.number="count" type="number" min="2" max="24" />
      </label>
      <label class="field">
        Colonnes
        <select v-model.number="cols">
          <option :value="2">2</option>
          <option :value="3">3</option>
          <option :value="4">4</option>
          <option :value="6">6</option>
        </select>
      </label>
    </div>
    <div class="row">
      <button class="btn small" :disabled="busy || !frames.length" @click="generate">{{ busy ? 'Génération…' : `Générer (${frames.length} images)` }}</button>
      <button v-if="done" class="btn secondary small" @click="download">Télécharger en PNG</button>
    </div>
    <p v-if="!frames.length" class="small muted">Aucune image à afficher : marque d’abord des repères.</p>
    <p v-if="error" class="small" role="alert" style="color: var(--warn)">{{ error }}</p>
    <canvas v-show="done" ref="canvas" class="kino" aria-label="Kinogramme"></canvas>
  </div>
</template>

<style scoped>
.kino {
  width: 100%;
  height: auto;
  border-radius: 8px;
}
</style>
