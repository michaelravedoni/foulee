<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { athleteName, matchesQuery } from '@foulee/core';
import { athletes, saveAthlete, trialsOfAthlete } from '../store/data';
import { age } from '../lib/format';

const router = useRouter();
const query = ref('');
const onlyFav = ref(false);
const tag = ref('');
const showForm = ref(false);
const first = ref('');
const last = ref('');
const birth = ref('');

const tags = computed(() => [...new Set(athletes.value.flatMap((a) => a.tags))].sort());
const filtered = computed(() =>
  athletes.value.filter(
    (a) =>
      (!onlyFav.value || a.favorite) &&
      (!tag.value || a.tags.includes(tag.value)) &&
      matchesQuery([a.firstName, a.lastName, ...a.tags, a.notes], query.value),
  ),
);

async function create() {
  if (!first.value.trim() && !last.value.trim()) return;
  const a = await saveAthlete({ firstName: first.value.trim(), lastName: last.value.trim(), ...(birth.value ? { birthDate: birth.value } : {}) });
  first.value = last.value = birth.value = '';
  showForm.value = false;
  void router.push(`/athletes/${a.id}`);
}
</script>

<template>
  <section class="stack">
    <div class="spread">
      <h1>Athlètes</h1>
      <button class="btn" @click="showForm = !showForm">＋ Ajouter</button>
    </div>
    <form v-if="showForm" class="card form-grid" @submit.prevent="create">
      <label class="field">Prénom <input v-model="first" autocomplete="off" autofocus /></label>
      <label class="field">Nom <input v-model="last" autocomplete="off" /></label>
      <label class="field">Date de naissance <input v-model="birth" type="date" /></label>
      <div class="row" style="align-self: end">
        <button class="btn" type="submit">Créer</button>
        <button class="btn ghost" type="button" @click="showForm = false">Annuler</button>
      </div>
    </form>
    <div class="row">
      <input v-model="query" type="search" placeholder="Rechercher un athlète, un tag…" aria-label="Rechercher" style="max-width: 360px" />
      <select v-if="tags.length" v-model="tag" aria-label="Filtrer par tag" style="width: auto">
        <option value="">Tous les tags</option>
        <option v-for="t in tags" :key="t" :value="t">{{ t }}</option>
      </select>
      <button class="btn ghost small" :aria-pressed="onlyFav" @click="onlyFav = !onlyFav">★ Favoris</button>
    </div>
    <p v-if="!filtered.length" class="empty">{{ athletes.length ? 'Aucun résultat.' : 'Aucun athlète pour l’instant.' }}</p>
    <ul class="list">
      <li v-for="a in filtered" :key="a.id">
        <RouterLink class="list-item" :to="`/athletes/${a.id}`">
          <span aria-hidden="true">{{ a.favorite ? '★' : '·' }}</span>
          <div class="grow">
            <div class="title">{{ athleteName(a) }}</div>
            <div class="small muted">
              {{ age(a.birthDate) }}<template v-if="a.tags.length"> · {{ a.tags.join(', ') }}</template>
            </div>
          </div>
          <span class="pill">{{ trialsOfAthlete(a.id).length }} essais</span>
        </RouterLink>
      </li>
    </ul>
  </section>
</template>
