<script setup lang="ts">
import { RouterLink } from 'vue-router';
import { athleteName, disciplineLabel, type Trial } from '@foulee/core';
import { mediaOf, state } from '../store/data';
import { formatDate, formatFps } from '../lib/format';

defineProps<{ trials: Trial[]; showAthlete?: boolean; showSession?: boolean; selectable?: boolean; selected?: string[] }>();
const emit = defineEmits<{ toggle: [string] }>();
</script>

<template>
  <ul class="list">
    <li v-for="t in trials" :key="t.id" class="trial-row">
      <label v-if="selectable" class="pick" :aria-label="`Sélectionner l’essai ${t.number} pour comparer`">
        <input type="checkbox" :checked="selected?.includes(t.id)" @change="emit('toggle', t.id)" />
      </label>
      <RouterLink class="list-item" :to="`/essais/${t.id}`">
        <span class="num">{{ t.number }}</span>
        <div class="grow">
          <div class="title">
            <template v-if="showAthlete">{{ state.athletes.get(t.athleteId) ? athleteName(state.athletes.get(t.athleteId)!) : '—' }} · </template>
            {{ disciplineLabel(t.discipline) }}
            <span v-if="t.favorite">★</span>
          </div>
          <div class="small muted">
            <template v-if="showSession">{{ formatDate(state.sessions.get(t.sessionId)?.date ?? '') }} · </template>
            <template v-if="mediaOf(t)">{{ formatFps(t.captureFps ?? mediaOf(t)!.nominalFps) }} · {{ mediaOf(t)!.width }}×{{ mediaOf(t)!.height }}</template>
            <template v-else>sans vidéo</template>
            <template v-if="t.officialResult"> · {{ t.officialResult }}</template>
          </div>
        </div>
        <span v-for="tag in t.tags.slice(0, 3)" :key="tag" class="pill">{{ tag }}</span>
      </RouterLink>
    </li>
  </ul>
</template>

<style scoped>
.trial-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.trial-row .list-item {
  flex: 1;
  min-width: 0;
}
.pick {
  display: grid;
  place-items: center;
  width: var(--tap);
  height: var(--tap);
}
.pick input {
  width: 22px;
  height: 22px;
}
.num {
  font-weight: 700;
  font-size: 1.1rem;
  width: 2ch;
  text-align: center;
  color: var(--accent);
}
</style>
