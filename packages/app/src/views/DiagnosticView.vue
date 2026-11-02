<script setup lang="ts">
import { ref } from 'vue';
import { openFrameSource, canCreateProxy, webCodecsAvailable, type OpenedVideo } from '@foulee/media';
import { OpfsProvider } from '@foulee/vault';
import { formatBytes } from '../lib/format';

/**
 * Prototype de validation du lecteur image par image (risque n° 1 du plan) :
 * à lancer sur iPhone et iPad avec une vraie vidéo.
 */
const checks = [
  { label: 'WebCodecs (VideoDecoder)', ok: webCodecsAvailable() },
  { label: 'Encodeur vidéo (proxy, replay enregistrable)', ok: canCreateProxy() },
  { label: 'requestVideoFrameCallback (repli)', ok: 'requestVideoFrameCallback' in HTMLVideoElement.prototype },
  { label: 'Stockage OPFS', ok: OpfsProvider.isSupported() },
  { label: 'Service worker (hors-ligne)', ok: 'serviceWorker' in navigator },
  { label: 'Caméra (getUserMedia)', ok: !!navigator.mediaDevices?.getUserMedia },
  { label: 'Installée comme app', ok: matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true },
];
const results = ref<string[]>([]);
const running = ref(false);
const input = ref<HTMLInputElement>();
const canvas = ref<HTMLCanvasElement>();
const forceFallback = ref(false);

function log(s: string) {
  results.value.push(s);
}

async function run() {
  const f = input.value?.files?.[0];
  if (!f) return;
  results.value = [];
  running.value = true;
  let opened: OpenedVideo | null = null;
  try {
    log(`Fichier : ${f.name} · ${formatBytes(f.size)} · ${f.type || 'type inconnu'}`);
    let t0 = performance.now();
    opened = await openFrameSource(f, { forceFallback: forceFallback.value });
    const { source, probe } = opened;
    const tl = source.timeline;
    log(`Ouverture : ${(performance.now() - t0).toFixed(0)} ms · méthode ${source.kind}${opened.estimated ? ' (chronologie estimée)' : ''}`);
    if (probe) log(`Conteneur : ${probe.width}×${probe.height}, rotation ${probe.rotation}°, codec ${probe.codec ?? '?'}, décodable : ${probe.canDecode ? 'oui' : 'non'}`);
    log(`Chronologie : ${tl.frameCount} images, ${tl.nominalFps} i/s${tl.variable ? ' (cadence variable)' : ''}, durée ${tl.duration.toFixed(3)} s`);
    const c = canvas.value!;
    c.width = source.width;
    c.height = source.height;
    const ctx = c.getContext('2d')!;
    const n = Math.min(60, tl.frameCount);
    t0 = performance.now();
    for (let i = 0; i < n; i++) {
      const bmp = await source.getFrame(i);
      if (bmp) ctx.drawImage(bmp, 0, 0, c.width, c.height);
    }
    const fwd = (performance.now() - t0) / n;
    log(`Pas avant : ${fwd.toFixed(1)} ms par image (${n} images)`);
    t0 = performance.now();
    for (let i = n - 1; i >= Math.max(0, n - 30); i--) {
      const bmp = await source.getFrame(i);
      if (bmp) ctx.drawImage(bmp, 0, 0, c.width, c.height);
    }
    log(`Pas arrière : ${((performance.now() - t0) / Math.min(30, n)).toFixed(1)} ms par image`);
    const mid = Math.floor(tl.frameCount / 2);
    t0 = performance.now();
    await source.getFrame(mid);
    log(`Saut au milieu (image ${mid}) : ${(performance.now() - t0).toFixed(0)} ms`);
    t0 = performance.now();
    await source.getFrame(mid - 1);
    log(`Puis image précédente : ${(performance.now() - t0).toFixed(0)} ms`);
    log('OK · Test terminé : envoie ces lignes à ton développeur.');
  } catch (e) {
    log(`Erreur : ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    opened?.source.dispose();
    running.value = false;
  }
}

const ua = navigator.userAgent;
</script>

<template>
  <section class="stack">
    <h1>Diagnostic</h1>
    <div class="card stack">
      <h2>Capacités de cet appareil</h2>
      <ul class="list">
        <li v-for="c in checks" :key="c.label" class="list-item">
          <span>{{ c.ok ? 'OK' : 'Attention' }}</span>
          <span class="grow">{{ c.label }}</span>
        </li>
      </ul>
      <p class="small muted mono">{{ ua }}</p>
    </div>
    <div class="card stack">
      <h2>Test du lecteur image par image</h2>
      <p class="small muted">Choisis une vidéo filmée avec l’appareil (idéalement un ralenti 120 ou 240 i/s). Le test ne copie rien dans le coffre.</p>
      <div class="row">
        <input ref="input" type="file" accept="video/*" style="max-width: 320px" />
        <label class="row small"><input v-model="forceFallback" type="checkbox" /> Forcer le repli (sans WebCodecs)</label>
        <button class="btn" :disabled="running" @click="run">{{ running ? 'Test en cours…' : 'Lancer le test' }}</button>
      </div>
      <canvas ref="canvas" class="preview"></canvas>
      <pre v-if="results.length" class="mono small out">{{ results.join('\n') }}</pre>
    </div>
  </section>
</template>

<style scoped>
.preview {
  max-width: 100%;
  max-height: 40dvh;
  background: var(--stage);
  border-radius: 8px;
}
.out {
  white-space: pre-wrap;
  background: var(--surface-2);
  padding: 12px;
  border-radius: 8px;
  margin: 0;
}
</style>
