<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { DISCIPLINES, athleteName, type DisciplineId, type Trial } from '@foulee/core';
import { athletes, importVideo, saveAthlete, state } from '../store/data';
import TagEditor from './TagEditor.vue';

const props = defineProps<{ sessionId: string; files: File[]; athleteId?: string }>();
const emit = defineEmits<{ done: [Trial[]]; cancel: [] }>();

const dialog = ref<HTMLDialogElement>();
const athleteId = ref(props.athleteId ?? '');
const newFirst = ref('');
const newLast = ref('');
const discipline = ref<DisciplineId>('100m');
const captureFps = ref<number | ''>('');
const tags = ref<string[]>([]);
const running = ref(false);
const errors = ref<string[]>([]);
const session = computed(() => state.sessions.get(props.sessionId));

onMounted(() => {
  dialog.value?.showModal();
  if (!athleteId.value) athleteId.value = athletes.value.length === 1 ? athletes.value[0]!.id : athletes.value.length === 0 ? '__new' : '';
});

async function run() {
  errors.value = [];
  running.value = true;
  try {
    let aid = athleteId.value;
    if (aid === '__new') {
      if (!newFirst.value.trim() && !newLast.value.trim()) {
        errors.value = ['Indique le prénom ou le nom du nouvel athlète.'];
        return;
      }
      aid = (await saveAthlete({ firstName: newFirst.value.trim(), lastName: newLast.value.trim() })).id;
    }
    if (!aid) {
      errors.value = ['Choisis un athlète.'];
      return;
    }
    const created: Trial[] = [];
    for (const f of props.files) {
      try {
        created.push(
          await importVideo(f, f.name, {
            sessionId: props.sessionId,
            athleteId: aid,
            discipline: discipline.value,
            ...(captureFps.value ? { captureFps: Number(captureFps.value) } : {}),
            tags: tags.value,
          }),
        );
      } catch (e) {
        errors.value.push(e instanceof Error ? e.message : String(e));
      }
    }
    if (errors.value.length === 0) {
      dialog.value?.close();
      emit('done', created);
    }
  } finally {
    running.value = false;
  }
}

function cancel() {
  dialog.value?.close();
  emit('cancel');
}
</script>

<template>
  <dialog ref="dialog" @cancel.prevent="cancel">
    <form class="stack" @submit.prevent="run">
      <h2>{{ files.length > 1 ? `Ajouter ${files.length} vidéos` : 'Ajouter la vidéo' }}</h2>
      <ul class="small muted files">
        <li v-for="f in files" :key="f.name">{{ f.name }}</li>
      </ul>
      <label class="field">
        Athlète
        <select v-model="athleteId" required>
          <option value="" disabled>Qui est sur la vidéo ?</option>
          <option v-for="a in athletes" :key="a.id" :value="a.id">{{ athleteName(a) }}</option>
          <option value="__new">＋ Nouvel athlète</option>
        </select>
      </label>
      <div v-if="athleteId === '__new'" class="form-grid">
        <label class="field">Prénom <input v-model="newFirst" autocomplete="off" autofocus /></label>
        <label class="field">Nom <input v-model="newLast" autocomplete="off" /></label>
      </div>
      <div class="form-grid">
        <label class="field">
          Épreuve
          <select v-model="discipline">
            <option v-for="d in DISCIPLINES" :key="d.id" :value="d.id">{{ d.label }}</option>
          </select>
        </label>
      </div>
      <details class="stack">
        <summary>Options (cadence, étiquettes)</summary>
        <div class="stack opts">
        <label class="field">
          Cadence de prise de vue
          <select v-model="captureFps">
            <option value="">Celle du fichier</option>
            <option :value="60">60 i/s</option>
            <option :value="120">120 i/s</option>
            <option :value="240">240 i/s</option>
          </select>
        </label>
        <p class="small muted">
        La cadence est lue automatiquement dans la vidéo. Ne la change que pour un ralenti ré-encodé (par exemple du 240 i/s exporté à 30 i/s).
        </p>
      <TagEditor v-model="tags" quick />
        </div>
      </details>
      <ul v-if="errors.length" class="errors">
        <li v-for="(e, i) in errors" :key="i">{{ e }}</li>
      </ul>
      <div class="row" style="justify-content: flex-end">
        <button type="button" class="btn ghost" :disabled="running" @click="cancel">Annuler</button>
        <button type="submit" class="btn" :disabled="running">{{ running ? 'Ajout en cours…' : 'Ajouter' }}</button>
      </div>
    </form>
  </dialog>
</template>

<style scoped>
.files {
  margin: 0;
  padding-left: 18px;
  max-height: 90px;
  overflow: auto;
}
.errors {
  color: var(--danger);
  margin: 0;
  padding-left: 18px;
}
</style>
