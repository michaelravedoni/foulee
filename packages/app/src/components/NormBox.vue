<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { categoryFor, disciplineLabel, rateAgainst, type Analysis, type Trial } from '@foulee/core';
import { mediaOf, state } from '../store/data';
import { formatResult, resultOf } from '../lib/results';

const props = defineProps<{ trial: Trial; analysis: Analysis; fps?: number }>();

const athlete = computed(() => state.athletes.get(props.trial.athleteId));
const seasonYear = computed(() => Number((state.sessions.get(props.trial.sessionId)?.date ?? props.trial.createdAt).slice(0, 4)));
const result = computed(() => resultOf(props.trial, props.analysis, mediaOf(props.trial), props.fps));

const rows = computed(() => {
  const r = result.value;
  const a = athlete.value;
  if (!r || !a?.sex) return [];
  return state.norms.flatMap((table) => {
    const cat = categoryFor(table, a.birthDate, seasonYear.value);
    if (!cat) return [];
    const rating = rateAgainst(table, props.trial.discipline, a.sex!, cat, r.value, r.margin);
    return rating ? [{ table, rating }] : [];
  });
});

const why = computed(() => {
  if (!state.norms.length) return 'Aucun tableau de normes importé.';
  if (!result.value) return 'Pas encore de résultat mesuré pour cet essai (repères manquants).';
  if (!athlete.value?.sex) return 'Indique le sexe de l’athlète sur sa fiche pour comparer aux normes.';
  if (!athlete.value.birthDate) return 'Indique la date de naissance de l’athlète sur sa fiche pour trouver sa catégorie.';
  return 'Aucune ligne de tes tableaux ne correspond à cette épreuve et à cette catégorie.';
});
const fmt = (v: number) => formatResult(props.trial.discipline, v);
</script>

<template>
  <div class="card stack" data-testid="norm-box">
    <h3>Normes · {{ disciplineLabel(trial.discipline) }}</h3>
    <p v-if="result" class="small muted">Résultat mesuré : {{ fmt(result.value) }} (± {{ fmt(result.margin) }}).</p>
    <p v-if="!rows.length" class="small muted">
      {{ why }} <RouterLink to="/normes">Gérer les normes</RouterLink>
    </p>
    <div v-for="{ table, rating } in rows" :key="table.id" class="stack">
      <p>
        <strong>{{ rating.category.label }}</strong> ·
        <template v-if="rating.reached">niveau atteint : <strong>{{ rating.reached.label }}</strong> ({{ fmt(rating.reached.value) }})</template>
        <template v-else>aucun niveau atteint</template>
        <template v-if="rating.next"> · prochain : {{ rating.next.level.label }} ({{ fmt(rating.next.level.value) }}), à {{ fmt(rating.next.gap) }}</template>
      </p>
      <p v-if="rating.uncertain" class="small">Le résultat est trop proche d’un seuil pour trancher, vu la marge de mesure.</p>
      <p class="small muted">
        Source : {{ table.source.name }}, saison {{ table.source.season }}
        <template v-if="table.verified"> · vérifié par {{ table.verified.by }} le {{ table.verified.at }}</template>
        <strong v-else> · valeurs non vérifiées à la source</strong>.
        Indicatif.
      </p>
    </div>
  </div>
</template>
