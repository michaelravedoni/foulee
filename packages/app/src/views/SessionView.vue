<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { LIGHTING_LABELS, SURFACE_LABELS, VENUE_LABELS, athleteName, type TrainingSession, type Trial } from '@foulee/core';
import { moveToTrash, saveSession, state, trialsOfSession } from '../store/data';
import { formatDate } from '../lib/format';
import ImportDialog from '../components/ImportDialog.vue';
import TagEditor from '../components/TagEditor.vue';
import TrialList from '../components/TrialList.vue';
import VideoPicker from '../components/VideoPicker.vue';

const props = defineProps<{ id: string }>();
const router = useRouter();
const session = computed(() => state.sessions.get(props.id));
const draft = ref<TrainingSession | null>(null);
watch(session, (s) => (draft.value = s ? { ...s, tags: [...s.tags] } : null), { immediate: true });
const pendingFiles = ref<File[] | null>(null);
const selected = ref<string[]>([]);
const showDetails = ref(false);

const groups = computed(() => {
  const map = new Map<string, Trial[]>();
  for (const t of trialsOfSession(props.id)) {
    const list = map.get(t.athleteId) ?? [];
    list.push(t);
    map.set(t.athleteId, list);
  }
  return [...map.entries()].map(([athleteId, trials]) => ({ athleteId, athlete: state.athletes.get(athleteId), trials }));
});

let timer = 0;
function save() {
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    if (draft.value) void saveSession(draft.value);
  }, 300);
}
async function trash() {
  if (!confirm('Mettre cette séance et ses essais à la corbeille ?')) return;
  await moveToTrash('session', props.id);
  void router.push('/seances');
}
function toggle(id: string) {
  selected.value = selected.value.includes(id) ? selected.value.filter((x) => x !== id) : [...selected.value, id].slice(-4);
}
function imported(trials: Trial[]) {
  pendingFiles.value = null;
  if (trials.length === 1) void router.push(`/essais/${trials[0]!.id}`);
}
</script>

<template>
  <section v-if="draft" class="stack">
    <div class="spread">
      <div>
        <h1>{{ draft.title || formatDate(draft.date) }}</h1>
        <div class="muted small">{{ formatDate(draft.date) }}{{ draft.place ? ` · ${draft.place}` : '' }}</div>
      </div>
      <div class="row">
        <VideoPicker @picked="(f) => (pendingFiles = f)" />
        <button class="btn ghost small" :aria-pressed="draft.favorite" @click="draft.favorite = !draft.favorite; save()">★</button>
        <button class="btn ghost small" @click="showDetails = !showDetails">{{ showDetails ? 'Masquer' : 'Détails' }}</button>
      </div>
    </div>
    <p class="small muted">
      Astuce iPhone/iPad : importe depuis l’app Fichiers (ou choisis « Actuel » dans les options du sélecteur Photos) pour
      garder la cadence et la qualité d’origine.
    </p>

    <div v-if="showDetails" class="card stack">
      <div class="form-grid">
        <label class="field">Date <input v-model="draft.date" type="date" @change="save" /></label>
        <label class="field">Titre <input v-model="draft.title" placeholder="ex. Vitesse – départs" @input="save" /></label>
        <label class="field">Lieu <input v-model="draft.place" placeholder="ex. Halle de Sion" @input="save" /></label>
        <label class="field">
          Type
          <select v-model="draft.venue" @change="save">
            <option :value="undefined">—</option>
            <option v-for="(l, k) in VENUE_LABELS" :key="k" :value="k">{{ l }}</option>
          </select>
        </label>
        <label class="field">
          Éclairage
          <select v-model="draft.lighting" @change="save">
            <option :value="undefined">—</option>
            <option v-for="(l, k) in LIGHTING_LABELS" :key="k" :value="k">{{ l }}</option>
          </select>
        </label>
        <label class="field">
          Surface
          <select v-model="draft.surface" @change="save">
            <option :value="undefined">—</option>
            <option v-for="(l, k) in SURFACE_LABELS" :key="k" :value="k">{{ l }}</option>
          </select>
        </label>
        <label class="field">Météo <input v-model="draft.weather" placeholder="ex. 12 °C, vent de face" @input="save" /></label>
      </div>
      <TagEditor v-model="draft.tags" @update:model-value="save" />
      <label class="field">Notes <textarea v-model="draft.notes" @input="save"></textarea></label>
      <div><button class="btn ghost small" @click="trash">Mettre la séance à la corbeille</button></div>
    </div>

    <div v-if="groups.length" class="spread">
      <h2>Essais</h2>
      <button class="btn small" :disabled="selected.length < 2" @click="router.push({ path: '/comparer', query: { e: selected } })">
        Comparer la sélection ({{ selected.length }})
      </button>
    </div>
    <p v-else class="empty">Aucun essai. Importe une ou plusieurs vidéos pour commencer.</p>
    <div v-for="g in groups" :key="g.athleteId" class="stack">
      <h3>{{ g.athlete ? athleteName(g.athlete) : 'Athlète inconnu' }}</h3>
      <TrialList :trials="g.trials" selectable :selected="selected" @toggle="toggle" />
    </div>

    <ImportDialog v-if="pendingFiles" :session-id="id" :files="pendingFiles" @done="imported" @cancel="pendingFiles = null" />
  </section>
  <p v-else class="empty">Séance introuvable.</p>
</template>
