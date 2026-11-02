<script setup lang="ts">
import { reactive } from 'vue';
import { eventLabel, frNumber, type JumpEventDef, type MarkedEvent } from '@foulee/core';

const props = defineProps<{ title: string; defs: JumpEventDef[]; events: MarkedEvent[] }>();
const emit = defineEmits<{
  mark: [type: string, side?: 'G' | 'D', position?: number];
  seek: [frame: number];
  remove: [id: string];
}>();

// Position saisie par rangée du gabarit (l'appel est sur la planche : 0 m par défaut).
const pos = reactive<Record<string, string>>({});
const keyOf = (i: number) => `r${i}`;
function posText(i: number, type: string): string {
  return pos[keyOf(i)] ?? (type === 'appel' ? '0' : '');
}
function parsePos(i: number, type: string): number | undefined {
  const raw = posText(i, type).trim().replace(',', '.');
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}
function put(i: number, type: string, side?: 'G' | 'D') {
  emit('mark', type, side, props.defs[i]?.position ? parsePos(i, type) : undefined);
}
function count(type: string): number {
  return props.events.filter((e) => e.type === type).length;
}
const label = (e: MarkedEvent) => eventLabel(e.type, e.side);
const posLabel = (kind: 'distance' | 'hauteur' | undefined) => (kind === 'hauteur' ? 'Hauteur (m)' : 'Position (m)');
</script>

<template>
    <section class="stack">
      <h3>{{ title }}</h3>
      <ul class="plain">
        <li v-for="(d, i) in defs" :key="i" class="def stack">
          <div class="row">
            <strong class="grow">{{ d.label }}<span v-if="!d.required" class="muted small"> (facultatif)</span></strong>
            <span class="muted small mono">{{ count(d.type) }} posé{{ count(d.type) > 1 ? 's' : '' }}</span>
          </div>
          <p class="small muted">{{ d.hint }}</p>
          <div class="row">
            <template v-if="d.sided">
              <button class="btn secondary small" :aria-label="`${d.label} gauche`" @click="put(i, d.type, 'G')">{{ d.label.split(' (')[0] }} G</button>
              <button class="btn secondary small" :aria-label="`${d.label} droit`" @click="put(i, d.type, 'D')">{{ d.label.split(' (')[0] }} D</button>
            </template>
            <button v-else class="btn secondary small" :aria-label="d.label" @click="put(i, d.type)">Marquer</button>
            <label v-if="d.position" class="small muted">{{ posLabel(d.position) }}
              <input
                class="pos"
                inputmode="decimal"
                :value="posText(i, d.type)"
                :aria-label="`${posLabel(d.position)} : ${d.label}`"
                @input="pos[keyOf(i)] = ($event.target as HTMLInputElement).value"
              />
            </label>
          </div>
        </li>
      </ul>
    </section>

    <section class="stack">
      <h3>Repères posés</h3>
      <p v-if="!events.length" class="small muted">Aucun repère.</p>
      <ul v-else class="plain small">
        <li v-for="e in events" :key="e.id" class="row">
          <button class="linklike grow" @click="emit('seek', e.frame)">
            {{ label(e) }}<template v-if="e.position !== undefined"> · {{ frNumber(e.position, 2) }} m</template>
            <span class="muted mono"> img {{ e.frame }}</span>
          </button>
          <button class="btn ghost small icon" :aria-label="`Supprimer ${label(e)} image ${e.frame}`" @click="emit('remove', e.id)">✕</button>
        </li>
      </ul>
    </section>

</template>

<style scoped>
.def {
  padding: 8px 0;
  border-bottom: 1px solid var(--border, transparent);
}
.plain {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 2px;
}
.pos {
  width: 4.5em;
  margin-left: 6px;
}
</style>
