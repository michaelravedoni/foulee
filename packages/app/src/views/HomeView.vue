<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { athleteName, disciplineLabel, type Trial } from '@foulee/core';
import { analysisOf, mediaOf, state, trials } from '../store/data';
import { formatDate } from '../lib/format';
import { formatResult, resultOf } from '../lib/results';
import { quickImport } from '../lib/quick';
import VideoPicker from '../components/VideoPicker.vue';

const q = ref('');

const cards = computed(() => {
  const needle = q.value.trim().toLowerCase();
  return [...trials.value]
    .sort((a, b) => (state.sessions.get(b.sessionId)?.date ?? '').localeCompare(state.sessions.get(a.sessionId)?.date ?? '') || b.createdAt.localeCompare(a.createdAt))
    .map((t) => {
      const a = state.athletes.get(t.athleteId);
      const name = a ? athleteName(a) : '—';
      const date = state.sessions.get(t.sessionId)?.date ?? t.createdAt.slice(0, 10);
      const an = analysisOf(t.id);
      const r = resultOf(t, an, mediaOf(t));
      return { t, name, date, marks: an.events.length, result: r ? formatResult(t.discipline, r.value) : '' };
    })
    .filter((c) => !needle || `${c.name} ${disciplineLabel(c.t.discipline)} ${c.t.tags.join(' ')} ${formatDate(c.date)}`.toLowerCase().includes(needle));
});
const label = (t: Trial) => disciplineLabel(t.discipline);
</script>

<template>
  <section class="stack">
    <div class="spread">
      <h1>Mes vidéos</h1>
      <input v-if="trials.length" v-model="q" type="search" placeholder="Chercher un athlète, une épreuve…" aria-label="Chercher une vidéo" class="search" />
    </div>

    <div v-if="!trials.length" class="card stack welcome">
      <h2>Mesure une course, un saut ou un lancer à partir d’une vidéo</h2>
      <ol class="steps">
        <li><strong>Ajoute</strong> une vidéo filmée avec l’appareil photo du téléphone ou de la tablette.</li>
        <li><strong>Avance image par image</strong> et marque les moments clés (départ, passages, arrivée…).</li>
        <li><strong>Lis les résultats</strong> et exporte un rapport en PDF.</li>
      </ol>
      <div class="row"><VideoPicker label="＋ Ajouter ma première vidéo" @picked="quickImport" /></div>
      <p class="small muted">Tout reste sur cet appareil et fonctionne sans connexion.</p>
    </div>

    <p v-else-if="!cards.length" class="muted">Aucune vidéo ne correspond à « {{ q }} ».</p>
    <ul v-else class="cards">
      <li v-for="c in cards" :key="c.t.id">
        <RouterLink class="vcard" :to="`/essais/${c.t.id}`">
          <span class="vthumb" aria-hidden="true">
            <span class="vdisc">{{ label(c.t) }}</span>
          </span>
          <span class="vtitle">{{ c.name }} · {{ label(c.t) }}</span>
          <span class="vmeta">
            {{ formatDate(c.date) }}
            <template v-if="c.result"> · <strong>{{ c.result }}</strong></template>
            <template v-else-if="c.marks"> · mesure en cours</template>
            <template v-else> · à mesurer</template>
          </span>
        </RouterLink>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.search {
  max-width: 340px;
}
.welcome {
  max-width: 720px;
}
.steps {
  padding-left: 22px;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 1.05rem;
}
.cards {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 20px 16px;
}
.vcard {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--text);
  text-decoration: none;
}
.vthumb {
  aspect-ratio: 16 / 9;
  border-radius: var(--radius-md);
  background: #000;
  color: #fff;
  display: grid;
  place-items: center;
}
.vdisc {
  font-family: var(--font-display);
  text-transform: uppercase;
  font-size: 1.4rem;
}
.vtitle {
  font-weight: 500;
}
.vmeta {
  font-size: 0.9rem;
  color: var(--muted);
}
</style>
