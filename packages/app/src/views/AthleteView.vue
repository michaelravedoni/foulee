<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { DISCIPLINES, athleteName, type Athlete } from '@foulee/core';
import { moveToTrash, saveAthlete, state, trialsOfAthlete } from '../store/data';
import { age } from '../lib/format';
import TagEditor from '../components/TagEditor.vue';
import TrialList from '../components/TrialList.vue';
import ProgressChart from '../components/ProgressChart.vue';

const props = defineProps<{ id: string }>();
const router = useRouter();
const athlete = computed(() => state.athletes.get(props.id));
const draft = ref<Athlete | null>(null);
// Le brouillon n'est repris depuis le coffre qu'à l'ouverture d'une fiche : sinon l'enregistrement d'un champ
// écraserait ce que l'utilisateur est en train de saisir dans le suivant.
watch(
  athlete,
  (a) => {
    if (!a) draft.value = null;
    else if (draft.value?.id !== a.id) draft.value = { ...a, tags: [...a.tags] };
  },
  { immediate: true },
);

const discipline = ref('');
const selected = ref<string[]>([]);
const trialList = computed(() =>
  trialsOfAthlete(props.id)
    .filter((t) => !discipline.value || t.discipline === discipline.value)
    .sort((a, b) => (state.sessions.get(b.sessionId)?.date ?? '').localeCompare(state.sessions.get(a.sessionId)?.date ?? '') || a.number - b.number),
);
const usedDisciplines = computed(() => DISCIPLINES.filter((d) => trialsOfAthlete(props.id).some((t) => t.discipline === d.id)));

let timer = 0;
function flush() {
  clearTimeout(timer);
  timer = 0;
  if (draft.value) void saveAthlete(draft.value);
}
function save() {
  clearTimeout(timer);
  timer = window.setTimeout(flush, 300);
}
// Une modification en attente est enregistrée si on quitte la fiche avant la fin du délai.
onBeforeUnmount(() => {
  if (timer) flush();
});
async function trash() {
  if (!athlete.value || !confirm(`Mettre ${athleteName(athlete.value)} et ses essais à la corbeille ?`)) return;
  await moveToTrash('athlete', props.id);
  void router.push('/athletes');
}
function toggle(id: string) {
  selected.value = selected.value.includes(id) ? selected.value.filter((x) => x !== id) : [...selected.value, id].slice(-4);
}
</script>

<template>
  <section v-if="draft" class="stack">
    <div class="spread">
      <h1>{{ athleteName(draft) || 'Athlète' }} <span class="muted small">{{ age(draft.birthDate) }}</span></h1>
      <div class="row">
        <button class="btn ghost small" :aria-pressed="draft.favorite" @click="draft.favorite = !draft.favorite; save()">★ Favori</button>
        <button class="btn ghost small" @click="trash">Corbeille</button>
      </div>
    </div>
    <div class="card stack">
      <div class="form-grid">
        <label class="field">Prénom <input v-model="draft.firstName" @input="save" /></label>
        <label class="field">Nom <input v-model="draft.lastName" @input="save" /></label>
        <label class="field">Date de naissance <input v-model="draft.birthDate" type="date" @input="save" @change="save" /></label>
        <label class="field">
          Sexe (pour les normes)
          <select v-model="draft.sex" data-testid="athlete-sex" @change="save">
            <option :value="undefined">—</option>
            <option value="F">Femme</option>
            <option value="M">Homme</option>
          </select>
        </label>
      </div>
      <TagEditor v-model="draft.tags" @update:model-value="save" />
      <label class="field">Notes <textarea v-model="draft.notes" @input="save"></textarea></label>
    </div>
    <ProgressChart v-for="d in usedDisciplines" :key="d.id" :athlete-id="id" :discipline="d.id" :label="d.label" />
    <div class="spread">
      <h2>Essais</h2>
      <div class="row">
        <select v-model="discipline" aria-label="Filtrer par épreuve" style="width: auto">
          <option value="">Toutes les épreuves</option>
          <option v-for="d in usedDisciplines" :key="d.id" :value="d.id">{{ d.label }}</option>
        </select>
        <button class="btn small" :disabled="selected.length < 2" @click="router.push({ path: '/comparer', query: { e: selected } })">
          Comparer ({{ selected.length }})
        </button>
      </div>
    </div>
    <p v-if="!trialList.length" class="muted">Aucun essai. Importe des vidéos depuis une séance.</p>
    <TrialList :trials="trialList" show-session selectable :selected="selected" @toggle="toggle" />
  </section>
  <p v-else class="empty">Athlète introuvable.</p>
</template>
