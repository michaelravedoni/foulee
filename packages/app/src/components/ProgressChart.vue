<script setup lang="ts">
import { computed } from 'vue';
import { isTimeDiscipline, summarize } from '@foulee/core';
import { trialsOfAthlete } from '../store/data';
import { formatDate } from '../lib/format';
import { formatResult, resultsOfAthlete } from '../lib/results';

const props = defineProps<{ athleteId: string; discipline: string; label: string }>();

const seasonYear = new Date().getFullYear();
const points = computed(() => resultsOfAthlete(trialsOfAthlete(props.athleteId), props.discipline).sort((a, b) => a.date.localeCompare(b.date)));
const sum = computed(() => summarize(props.discipline, points.value, seasonYear));
const fmt = (v: number) => formatResult(props.discipline, v);

const W = 560;
const H = 140;
const PAD = 12;
const geom = computed(() => {
  const pts = points.value;
  if (!pts.length) return null;
  const lo = Math.min(...pts.map((p) => p.value - p.margin));
  const hi = Math.max(...pts.map((p) => p.value + p.margin));
  const span = hi - lo || 1;
  const t0 = Date.parse(pts[0]!.date);
  const tSpan = Date.parse(pts[pts.length - 1]!.date) - t0 || 1;
  // Pour un temps, le meilleur est en haut : on inverse l'axe.
  const y = (v: number) => PAD + ((isTimeDiscipline(props.discipline) ? v - lo : hi - v) / span) * (H - 2 * PAD);
  const x = (d: string) => PAD + ((Date.parse(d) - t0) / tSpan) * (W - 2 * PAD);
  const xs = pts.length === 1 ? () => W / 2 : x;
  return pts.map((p) => ({ id: p.id, cx: xs(p.date), cy: y(p.value), y1: y(p.value + p.margin), y2: y(p.value - p.margin) }));
});
const path = computed(() => (geom.value ?? []).map((g, i) => `${i ? 'L' : 'M'}${g.cx.toFixed(1)},${g.cy.toFixed(1)}`).join(' '));

const trend = computed(() => {
  switch (sum.value.direction) {
    case 'mieux':
      return 'Tendance : en progression (au-delà de la marge de mesure).';
    case 'moins':
      return 'Tendance : en recul (au-delà de la marge de mesure).';
    case 'stable':
      return 'Tendance : stable (variation dans la marge de mesure).';
    default:
      return 'Tendance : il faut au moins 3 résultats pour en parler.';
  }
});
</script>

<template>
  <div v-if="points.length" class="card stack" :data-testid="`progress-${discipline}`">
    <h3>Progression · {{ label }}</h3>
    <p class="small">
      Record <strong>{{ fmt(sum.personalBest!.value) }}</strong> ({{ formatDate(sum.personalBest!.date) }})
      <template v-if="sum.seasonBest"> · meilleur de {{ seasonYear }} <strong>{{ fmt(sum.seasonBest.value) }}</strong></template>
      · moyenne des {{ Math.min(3, points.length) }} derniers {{ fmt(sum.rollingMean!) }}
    </p>
    <p class="small muted">{{ trend }} {{ points.length }} résultat{{ points.length > 1 ? 's' : '' }} mesuré{{ points.length > 1 ? 's' : '' }}, barres = marge de mesure. Indicatif.</p>
    <svg v-if="geom" :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="`Courbe des résultats en ${label}`" style="width: 100%; max-height: 160px">
      <path :d="path" fill="none" stroke="var(--ink-muted)" stroke-width="1" />
      <g v-for="g in geom" :key="g.id" stroke="var(--ink)">
        <line :x1="g.cx" :x2="g.cx" :y1="g.y1" :y2="g.y2" stroke-width="1" />
        <circle :cx="g.cx" :cy="g.cy" r="3.5" fill="var(--ink)" />
      </g>
    </svg>
  </div>
</template>
