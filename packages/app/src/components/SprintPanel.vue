<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  analyzeSprint,
  eventLabel,
  formatMeasure,
  frNumber,
  specFor,
  type Analysis,
  type FrameTimeline,
  type MarkedEvent,
  type SoundOnset,
} from '@foulee/core';
import { NoAudioError, scanAudioOnsets } from '@foulee/media';

const props = defineProps<{
  discipline: string;
  analysis: Analysis;
  timeline: FrameTimeline | null;
  fps: number;
  timeScale: number;
  /** Fichier vidéo d'origine, pour lire la piste audio. */
  original?: Blob | null;
}>();
const emit = defineEmits<{
  mark: [type: string, side?: 'G' | 'D', position?: number];
  seek: [frame: number];
  remove: [id: string];
  soundStart: [time: number, ratio: number];
}>();

// ——— Départ au son ———
const gunDistance = ref('0');
const scanning = ref(false);
const scanError = ref('');
const onsets = ref<SoundOnset[]>([]);
async function scan() {
  if (!props.original) return;
  scanning.value = true;
  scanError.value = '';
  onsets.value = [];
  try {
    const d = Number(gunDistance.value.replace(',', '.'));
    const r = await scanAudioOnsets(props.original, { distanceM: Number.isFinite(d) ? d : 0 });
    onsets.value = r.onsets;
    if (!r.onsets.length) scanError.value = 'Aucun son net détecté (enregistrement silencieux ou trop bruité).';
  } catch (e) {
    scanError.value = e instanceof NoAudioError ? e.message : `Lecture du son impossible : ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    scanning.value = false;
  }
}

const spec = computed(() => specFor(props.discipline));
const result = computed(() => (spec.value && props.timeline ? analyzeSprint(spec.value, props.analysis.events, props.timeline, props.timeScale, props.fps) : null));

const isHurdles = computed(() => !!spec.value?.hurdles);
const points = computed(() => {
  const s = spec.value;
  if (!s) return [];
  return s.splitPoints.map((m, i) => {
    const last = i === s.splitPoints.length - 1;
    const type = last ? 'arrivee' : isHurdles.value ? 'haie' : 'passage';
    const label = last ? 'Arrivée' : isHurdles.value ? `Haie ${i + 1}` : `${frNumber(m, 0)} m`;
    const done = props.analysis.events.some((e) => e.type === type && (type === 'arrivee' ? true : e.position === m));
    return { m, type, label, done, title: `${last ? 'Arrivée' : isHurdles.value ? `Haie ${i + 1}` : 'Passage'} à ${frNumber(m, 2)} m` };
  });
});

const fmt = (m: { value: number; margin: number }, unit: string, minDigits = 0) => formatMeasure(m, unit, frNumber, minDigits);
const secs = (m: { value: number; margin: number }) => (Number.isFinite(m.value) ? `${frNumber(m.value, 3)} ± ${frNumber(m.margin, 3)} s` : '—');
const label = (e: MarkedEvent) => eventLabel(e.type, e.side);
</script>

<template>
  <div v-if="!spec" class="stack">
    <p class="muted small">Les spécifications d’épreuve couvrent pour l’instant le sprint et les haies. Les sauts et lancers arrivent dans les phases suivantes ; les repères et les mesures libres restent disponibles.</p>
  </div>
  <div v-else class="stack sprint">
    <p class="small muted">
      {{ spec.label }} : marque l’image affichée. Les temps partent du départ ; chaque marge est d’au plus une image.
    </p>
    <section class="stack">
      <h3>Départ et passages</h3>
      <div class="row">
        <button class="btn secondary small" @click="emit('mark', 'depart')">Départ</button>
        <button
          v-for="p in points"
          :key="p.type + p.m"
          class="btn small"
          :class="p.done ? 'ghost done' : 'secondary'"
          :title="p.title"
          @click="emit('mark', p.type, undefined, p.m)"
        >
          {{ p.label }}<span v-if="p.done" aria-hidden="true"> ✓</span>
        </button>
      </div>
    </section>
    <section class="stack">
      <h3>Départ au son</h3>
      <div class="row">
        <label class="small muted">Distance au pistolet (m)
          <input v-model="gunDistance" class="pos" inputmode="decimal" aria-label="Distance au pistolet en mètres" />
        </label>
        <button class="btn secondary small" :disabled="scanning || !original" @click="scan">{{ scanning ? 'Analyse…' : 'Détecter le départ' }}</button>
      </div>
      <p v-if="scanError" class="small warn-text" role="alert">{{ scanError }}</p>
      <ul v-if="onsets.length" class="plain small">
        <li v-for="(o, i) in onsets" :key="o.time" class="row">
          <span class="grow mono">{{ frNumber(o.time, 3) }} s · niveau {{ frNumber(o.peak * 100, 0) }} %<template v-if="i === 0"> · le plus fort</template></span>
          <button class="btn secondary small" @click="emit('soundStart', o.time, o.ratio)">Utiliser comme départ</button>
        </li>
      </ul>
      <p class="small muted">Place le départ sur l’image où le son commence ; la précision est celle de l’image (le son est lu au 2 ms). Indique la distance au pistolet si le micro en est loin : le retard du son est retiré. Vérifie toujours l’image proposée.</p>
    </section>
    <section class="stack">
      <h3>Appuis</h3>
      <div class="row">
        <button class="btn secondary small" title="Appui gauche (a)" @click="emit('mark', 'appui', 'G')">Appui G</button>
        <button class="btn secondary small" title="Appui droit (Maj+a)" @click="emit('mark', 'appui', 'D')">Appui D</button>
        <button class="btn secondary small" title="Décollage gauche (z)" @click="emit('mark', 'decollage', 'G')">Décollage G</button>
        <button class="btn secondary small" title="Décollage droit (Maj+z)" @click="emit('mark', 'decollage', 'D')">Décollage D</button>
      </div>
    </section>

    <section class="stack">
      <h3>Repères posés</h3>
      <p v-if="!analysis.events.length" class="small muted">Aucun repère.</p>
      <ul v-else class="plain small">
        <li v-for="e in analysis.events" :key="e.id" class="row">
          <button class="linklike grow" @click="emit('seek', e.frame)">
            {{ label(e) }}<template v-if="e.position !== undefined"> · {{ frNumber(e.position, 2) }} m</template>
            <span class="muted mono"> img {{ e.frame }}</span>
          </button>
          <button class="btn ghost small icon" :aria-label="`Supprimer ${label(e)} ${e.position !== undefined ? frNumber(e.position, 2) + ' m' : 'image ' + e.frame}`" @click="emit('remove', e.id)">✕</button>
        </li>
      </ul>
    </section>

    <template v-if="result">
      <ul v-if="result.checks.length" class="checks small">
        <li v-for="(c, i) in result.checks" :key="i" :class="c.level">
          <strong>{{ c.level === 'alerte' ? 'Attention' : 'Info' }}</strong> · {{ c.message }}
        </li>
      </ul>

      <section class="stack">
        <h3>Splits</h3>
        <p v-if="!result.splits.length" class="small muted">Marque le départ puis au moins un passage ou l’arrivée.</p>
        <table v-else class="tbl small">
          <thead><tr><th>Section</th><th>Temps</th><th>Cumulé</th><th>Vitesse</th><th></th></tr></thead>
          <tbody>
            <tr v-for="r in result.splits" :key="r.from.id + r.to.id" @click="emit('seek', r.to.frame)">
              <td>{{ frNumber(r.fromM, 1) }}–{{ frNumber(r.toM, 1) }} m</td>
              <td class="mono">{{ secs(r.segment) }}</td>
              <td class="mono">{{ secs(r.cumulative) }}</td>
              <td class="mono">{{ fmt(r.speed, 'm/s') }}</td>
              <td><button class="btn ghost small icon" :aria-label="`Supprimer le repère à ${frNumber(r.toM, 1)} m`" title="Supprimer ce repère" @click.stop="emit('remove', r.to.id)">✕</button></td>
            </tr>
          </tbody>
        </table>
        <p v-if="result.total" class="small">Temps : <strong class="mono">{{ secs(result.total) }}</strong></p>
      </section>

      <section v-if="result.profile" class="stack">
        <h3>Profil Vmax / tau <span class="tag-indic">indicatif</span></h3>
        <ul class="plain small">
          <li>Vmax : <span class="mono">{{ fmt(result.profile.vmax, 'm/s') }}</span></li>
          <li>τ : <span class="mono">{{ fmt(result.profile.tau, 's') }}</span></li>
          <li>F0 : <span class="mono">{{ frNumber(result.profile.f0, 1) }} N/kg</span> · Pmax : <span class="mono">{{ frNumber(result.profile.pmax, 1) }} W/kg</span></li>
          <li class="muted">Ajusté sur {{ result.profile.points }} points, écart moyen {{ frNumber(result.profile.rmse * 100, 0) }} cm. Marges à 2 écarts-types.</li>
        </ul>
      </section>

      <section v-if="result.steps.length" class="stack">
        <h3>Pas</h3>
        <table class="tbl small">
          <thead><tr><th>Pas</th><th>Durée</th><th>Fréquence</th><th>Longueur</th></tr></thead>
          <tbody>
            <tr v-for="(s, i) in result.steps" :key="s.to.id" @click="emit('seek', s.to.frame)">
              <td>{{ i + 1 }} · {{ label(s.from) }}→{{ label(s.to) }}</td>
              <td class="mono">{{ secs(s.time) }}</td>
              <td class="mono">{{ fmt(s.frequency, 'Hz') }}</td>
              <td class="mono">{{ s.length ? fmt(s.length, 'm') : '—' }}</td>
            </tr>
          </tbody>
        </table>
        <p class="small muted">Longueur de pas : indique la position de chaque appui (m) dans l’onglet Mesures.</p>
      </section>

      <section v-if="result.contacts.length" class="stack">
        <h3>Contacts</h3>
        <table class="tbl small">
          <thead><tr><th>Appui</th><th>Contact</th><th>Vol</th></tr></thead>
          <tbody>
            <tr v-for="c in result.contacts" :key="c.on.id" :class="{ unreliable: !c.reliable }" @click="emit('seek', c.on.frame)">
              <td>{{ label(c.on) }} · img {{ c.on.frame }}</td>
              <td class="mono">{{ fmt({ value: c.contact.value * 1000, margin: c.contact.margin * 1000 }, 'ms') }}<span v-if="!c.reliable" class="small muted" title="Cadence trop faible"> · cadence faible</span></td>
              <td class="mono">{{ c.flight ? fmt({ value: c.flight.value * 1000, margin: c.flight.margin * 1000 }, 'ms') : '—' }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </div>
</template>

<style scoped>
.tbl {
  width: 100%;
  border-collapse: collapse;
}
.tbl th {
  text-align: left;
  color: var(--muted);
  font-weight: 500;
}
.tbl td,
.tbl th {
  padding: 4px 6px 4px 0;
  vertical-align: top;
}
.tbl tbody tr {
  cursor: pointer;
}
.tbl tbody tr:hover {
  background: var(--surface-2);
}
.unreliable {
  opacity: 0.7;
}
.done {
  opacity: 0.75;
}
.checks {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 4px;
}
.checks li.alerte {
  color: var(--warn);
}
.plain {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 2px;
}
.tag-indic {
  font-size: 0.7em;
  font-weight: 500;
  color: var(--muted);
  border: 1px solid var(--border, currentColor);
  border-radius: 6px;
  padding: 0 6px;
  margin-left: 6px;
}
.warn-text {
  color: var(--warn);
}
.pos {
  width: 4.5em;
  margin-left: 6px;
}
</style>
