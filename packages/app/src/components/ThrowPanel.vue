<script setup lang="ts">
import { computed } from 'vue';
import { analyzeThrow, formatMeasure, frNumber, throwSpecFor, type Analysis, type FrameTimeline } from '@foulee/core';
import EventTemplate from './EventTemplate.vue';

const props = defineProps<{
  discipline: string;
  analysis: Analysis;
  timeline: FrameTimeline | null;
  fps: number;
  timeScale: number;
}>();
const emit = defineEmits<{
  mark: [type: string, side?: 'G' | 'D', position?: number];
  seek: [frame: number];
  remove: [id: string];
}>();

const spec = computed(() => throwSpecFor(props.discipline));
const result = computed(() =>
  spec.value && props.timeline ? analyzeThrow(spec.value, props.analysis.events, props.analysis.trajectories ?? [], props.analysis.calibration, props.timeline, props.timeScale) : null,
);
const fmt = (m: { value: number; margin: number }, unit: string) => formatMeasure(m, unit, frNumber);
const metricText = (m: { value: { value: number; margin: number }; digits: number; unit: string }) =>
  `${frNumber(m.value.value, m.digits)} ± ${frNumber(m.value.margin, m.digits + 1)}${m.unit ? ' ' + m.unit : ''}`;
</script>

<template>
  <div v-if="spec" class="stack throw">
    <p class="small muted">
      Pour la vitesse et l’angle de lâcher : dans « Dessiner », trace d’abord un <strong>étalon</strong> (outil règle), puis pointe l’<strong>engin sur 3 à 4 images à partir du lâcher</strong> (outil trajectoire).
    </p>

    <EventTemplate :title="`Tous les repères du ${spec.label.toLowerCase()}, avec leurs positions`" collapse-defs :defs="spec.events" :events="analysis.events" @mark="(t, sd, p) => emit('mark', t, sd, p)" @seek="(f) => emit('seek', f)" @remove="(id) => emit('remove', id)" />

    <template v-if="result">
      <p v-if="result.missing.length" class="small" role="status">À poser : {{ result.missing.join(', ') }}.</p>
      <ul v-if="result.checks.length" class="checks small">
        <li v-for="(c, i) in result.checks" :key="i" :class="c.level">
          <strong>{{ c.level === 'alerte' ? 'Attention' : 'Info' }}</strong> · {{ c.message }}
        </li>
      </ul>

      <section v-if="result.metrics.length" class="stack">
        <h3>Mesures</h3>
        <table class="tbl small">
          <tbody>
            <tr v-for="m in result.metrics" :key="m.id">
              <td>{{ m.label }}<span v-if="m.indicative" class="tag-indic">indicatif</span></td>
              <td class="mono">{{ metricText(m) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="result.release" class="small muted">Engin suivi : « {{ result.release.trajectoryLabel }} », {{ result.release.points }} points après le lâcher.</p>
      </section>

      <section v-if="result.phases.length" class="stack">
        <h3>Phases</h3>
        <table class="tbl small">
          <thead><tr><th>Phase</th><th>Durée</th></tr></thead>
          <tbody>
            <tr v-for="(p, i) in result.phases" :key="i" @click="emit('seek', p.to.frame)">
              <td>{{ p.label }}</td>
              <td class="mono">{{ fmt(p.duration, 's') }}</td>
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
.tbl tbody tr:hover {
  background: var(--surface-2);
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
.tag-indic {
  font-size: 0.7em;
  color: var(--muted);
  border: 1px solid var(--border, currentColor);
  border-radius: 6px;
  padding: 0 6px;
  margin-left: 6px;
}
</style>
