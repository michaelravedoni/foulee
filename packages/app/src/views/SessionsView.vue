<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { athleteName, matchesQuery } from '@foulee/core';
import { saveSession, sessions, state, trialsOfSession } from '../store/data';
import { formatDate, todayIso } from '../lib/format';

const router = useRouter();
const query = ref('');
const onlyFav = ref(false);
const filtered = computed(() =>
  sessions.value.filter((s) => {
    if (onlyFav.value && !s.favorite) return false;
    const names = trialsOfSession(s.id).map((t) => {
      const a = state.athletes.get(t.athleteId);
      return a ? athleteName(a) : '';
    });
    return matchesQuery([s.title, s.place, s.notes, s.date, formatDate(s.date), ...s.tags, ...names], query.value);
  }),
);

async function create() {
  const s = await saveSession({ date: todayIso() });
  void router.push(`/seances/${s.id}`);
}
</script>

<template>
  <section class="stack">
    <div class="spread">
      <h1>Séances</h1>
      <button class="btn" @click="create">＋ Nouvelle séance</button>
    </div>
    <div class="row">
      <input v-model="query" type="search" placeholder="Rechercher (lieu, date, athlète, tag…)" aria-label="Rechercher" style="max-width: 360px" />
      <button class="btn ghost small" :aria-pressed="onlyFav" @click="onlyFav = !onlyFav">★ Favoris</button>
    </div>
    <p v-if="!filtered.length" class="empty">{{ sessions.length ? 'Aucun résultat.' : 'Aucune séance pour l’instant.' }}</p>
    <ul class="list">
      <li v-for="s in filtered" :key="s.id">
        <RouterLink class="list-item" :to="`/seances/${s.id}`">
          <span aria-hidden="true">{{ s.favorite ? '★' : '·' }}</span>
          <div class="grow">
            <div class="title">{{ s.title || formatDate(s.date) }}</div>
            <div class="small muted">{{ formatDate(s.date) }}{{ s.place ? ` · ${s.place}` : '' }}</div>
          </div>
          <span class="pill">{{ trialsOfSession(s.id).length }} essais</span>
        </RouterLink>
      </li>
    </ul>
  </section>
</template>
