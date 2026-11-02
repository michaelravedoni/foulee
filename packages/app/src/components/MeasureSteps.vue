<script setup lang="ts">
import { computed, ref } from 'vue';

export interface Step {
  id: string;
  type: string;
  label: string;
  hint?: string;
  /** Pied gauche / droit à choisir. */
  sided?: boolean;
  /** Position fixe en mètres (passage à 10 m, haie…). */
  fixed?: number;
  /** Position à saisir : distance depuis la référence ou hauteur. */
  ask?: { kind: 'distance' | 'hauteur'; initial?: string };
  optional?: boolean;
  done: boolean;
}

const props = defineProps<{ steps: Step[]; intro?: string }>();
const emit = defineEmits<{ mark: [type: string, side?: 'G' | 'D', position?: number] }>();

const chosen = ref<string | null>(null);
const input = ref<Record<string, string>>({});

/** Étape en cours : celle que l'utilisateur a touchée, sinon la première non faite (les facultatives passent après). */
const current = computed(() => {
  const picked = props.steps.find((s) => s.id === chosen.value);
  if (picked) return picked;
  return props.steps.find((s) => !s.done && !s.optional) ?? props.steps.find((s) => !s.done) ?? props.steps[props.steps.length - 1];
});
const finished = computed(() => props.steps.length > 0 && props.steps.every((s) => s.done || s.optional) && !chosen.value);

function posOf(s: Step): number | undefined {
  if (s.fixed !== undefined) return s.fixed;
  if (!s.ask) return undefined;
  const raw = (input.value[s.id] ?? s.ask.initial ?? '').trim().replace(',', '.');
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function markCurrent(side?: 'G' | 'D') {
  const s = current.value;
  if (!s) return;
  emit('mark', s.type, s.sided ? (side ?? 'G') : undefined, posOf(s));
  chosen.value = null;
}
defineExpose({ markCurrent });
</script>

<template>
  <div v-if="steps.length" class="steps stack" data-testid="steps">
    <p v-if="intro" class="small muted">{{ intro }}</p>
    <ol class="chips" aria-label="Étapes de la mesure">
      <li v-for="s in steps" :key="s.id">
        <button
          class="chip"
          :class="{ done: s.done, now: current?.id === s.id && !finished }"
          :aria-current="current?.id === s.id && !finished ? 'step' : undefined"
          :title="s.hint ?? s.label"
          @click="chosen = s.id"
        >
          {{ s.label }}<span v-if="s.done" aria-hidden="true"> ✓</span>
        </button>
      </li>
    </ol>
    <template v-if="current">
      <p v-if="current.hint" class="small muted">{{ current.hint }}</p>
      <div class="row">
        <label v-if="current.ask" class="small muted">
          {{ current.ask.kind === 'hauteur' ? 'Hauteur (m)' : 'Position (m)' }}
          <input v-model="input[current.id]" class="pos" inputmode="decimal" :placeholder="current.ask.initial ?? ''" :aria-label="`${current.ask.kind === 'hauteur' ? 'Hauteur' : 'Position'} (m) : ${current.label}`" />
        </label>
        <template v-if="current.sided">
          <button class="btn big" :aria-label="`Marquer ici : ${current.label} gauche`" @click="markCurrent('G')">Marquer ici : {{ current.label }} gauche</button>
          <button class="btn big" :aria-label="`Marquer ici : ${current.label} droit`" @click="markCurrent('D')">Marquer ici : {{ current.label }} droit</button>
        </template>
        <button v-else class="btn big" data-testid="mark-current" @click="markCurrent()">Marquer ici : {{ current.label }}</button>
      </div>
      <p class="small muted">Raccourci : <kbd>Entrée</kbd><template v-if="current.sided"> (pied gauche) ou <kbd>Maj</kbd>+<kbd>Entrée</kbd> (pied droit)</template>.</p>
    </template>
  </div>
</template>

<style scoped>
.chips {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip {
  appearance: none;
  font: inherit;
  font-size: 13px;
  padding: 4px 10px;
  min-height: 32px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.chip.done {
  background: var(--fill);
  color: var(--on-fill);
  border-color: var(--fill);
}
.chip.now {
  border: 2px solid var(--text);
  color: var(--text);
  font-weight: 600;
}
.big {
  min-height: 52px;
  font-size: 1rem;
  padding: 0 20px;
}
.pos {
  width: 4.5em;
  margin-left: 6px;
}
kbd {
  font: 500 12px var(--font-mono, monospace);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0 4px;
}
</style>
