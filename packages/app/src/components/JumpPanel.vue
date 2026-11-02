<script setup lang="ts">
import { computed } from 'vue';
import EventTemplate from './EventTemplate.vue';
import {
  analyzeJump,
  formatMeasure,
  frNumber,
  jumpSpecFor,
  type Analysis,
  type FrameTimeline,
} from '@foulee/core';

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

const spec = computed(() => jumpSpecFor(props.discipline));
const result = computed(() => (spec.value && props.timeline ? analyzeJump(spec.value, props.analysis.events, props.timeline, props.timeScale, props.fps) : null));

const fmt = (m: { value: number; margin: number }, unit: string, minDigits = 0) => formatMeasure(m, unit, frNumber, minDigits);
const secs = (m: { value: number; margin: number }) => `${frNumber(m.value, 3)} ± ${frNumber(m.margin, 3)} s`;
const metricText = (m: { value: { value: number; margin: number }; digits: number; unit: string }) =>
  `${frNumber(m.value.value, m.digits)} ± ${frNumber(m.value.margin, m.digits + 1)} ${m.unit}`;
</script>

<template>
  <div v-if="spec" class="stack jump">
    <p class="small muted">
      {{ spec.label }} : avance image par image, puis marque chaque événement ci-dessous. Les positions (en mètres) se lisent depuis la
      planche ou le point de repère ; avant la planche, saisis une valeur négative. Elles servent à la longueur, aux phases et à la vitesse d’élan.
    </p>

    <EventTemplate :title="`Gabarit du ${spec.label.toLowerCase()}`" :defs="spec.events" :events="analysis.events" @mark="(t, sd, p) => emit('mark', t, sd, p)" @seek="(f) => emit('seek', f)" @remove="(id) => emit('remove', id)" />

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
            <tr v-for="m in result.metrics" :key="m.id" :class="{ unreliable: m.reliable === false }">
              <td>{{ m.label }}<span v-if="m.indicative" class="tag-indic">indicatif</span></td>
              <td class="mono">{{ metricText(m) }}<span v-if="m.reliable === false" title="Cadence trop faible"> ⚠</span></td>
            </tr>
          </tbody>
        </table>
        <p class="small muted">Les estimations « indicatif » viennent du temps de vol (balistique) : des ordres de grandeur, pas des mesures.</p>
      </section>

      <section v-if="result.phases.length" class="stack">
        <h3>Phases</h3>
        <table class="tbl small">
          <thead><tr><th>Phase</th><th>Contact</th><th>Vol</th><th>Distance</th><th>Part</th></tr></thead>
          <tbody>
            <tr v-for="(p, i) in result.phases" :key="i">
              <td>{{ p.label }}</td>
              <td class="mono">{{ p.contact ? fmt({ value: p.contact.value * 1000, margin: p.contact.margin * 1000 }, 'ms') : '—' }}</td>
              <td class="mono">{{ p.flight ? secs(p.flight) : '—' }}</td>
              <td class="mono">{{ p.distance ? fmt(p.distance, 'm') : '—' }}</td>
              <td class="mono">{{ p.share !== undefined ? frNumber(p.share * 100, 0) + ' %' : '—' }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section v-if="result.steps.length" class="stack">
        <h3>Pas d’élan</h3>
        <table class="tbl small">
          <thead><tr><th>Pas</th><th>Durée</th><th>Fréquence</th><th>Longueur</th></tr></thead>
          <tbody>
            <tr v-for="(s, i) in result.steps" :key="s.to.id" @click="emit('seek', s.to.frame)">
              <td>{{ i + 1 }}</td>
              <td class="mono">{{ secs(s.time) }}</td>
              <td class="mono">{{ fmt(s.frequency, 'Hz') }}</td>
              <td class="mono">{{ s.length ? fmt(s.length, 'm') : '—' }}</td>
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
.unreliable {
  opacity: 0.7;
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
  color: var(--muted);
  border: 1px solid var(--border, currentColor);
  border-radius: 6px;
  padding: 0 6px;
  margin-left: 6px;
}
</style>
