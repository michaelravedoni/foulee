<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { athleteName, disciplineLabel } from '@foulee/core';
import { athletes, saveSession, sessions, state, trials, trialsOfSession } from '../store/data';
import { formatDate, todayIso } from '../lib/format';
import ImportDialog from '../components/ImportDialog.vue';
import VideoPicker from '../components/VideoPicker.vue';

const router = useRouter();
const pending = ref<{ sessionId: string; files: File[] } | null>(null);
const recentSessions = computed(() => sessions.value.slice(0, 5));
const favorites = computed(() => athletes.value.filter((a) => a.favorite));
const recentTrials = computed(() => [...trials.value].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6));

async function todaySession(): Promise<string> {
  const today = todayIso();
  const existing = sessions.value.find((s) => s.date === today);
  if (existing) return existing.id;
  return (await saveSession({ date: today, title: 'Séance du jour' })).id;
}

async function quickImport(files: File[]) {
  pending.value = { sessionId: await todaySession(), files };
}

async function newSession() {
  const s = await saveSession({ date: todayIso(), title: '' });
  void router.push(`/seances/${s.id}`);
}
</script>

<template>
  <section class="stack">
    <div class="hero card">
      <h1>Bonjour</h1>
      <p class="muted">Filme avec l’app caméra de l’appareil, puis importe la vidéo ici. Tout reste sur cet appareil, même sans réseau.</p>
      <div class="row">
        <VideoPicker label="Essai rapide (séance du jour)" @picked="quickImport" />
        <button class="btn secondary" @click="newSession">＋ Nouvelle séance</button>
        <RouterLink class="btn secondary" to="/replay">⏱ Replay différé</RouterLink>
      </div>
    </div>

    <div v-if="state.athletes.size === 0" class="card">
      <h2>Pour commencer</h2>
      <ol class="muted">
        <li>Ajoute tes athlètes dans <RouterLink to="/athletes">Athlètes</RouterLink>.</li>
        <li>Crée une séance, puis importe les vidéos de chaque essai.</li>
        <li>Analyse image par image, dessine, compare deux essais côte à côte.</li>
        <li>Exporte régulièrement ton coffre (menu <RouterLink to="/coffre">Coffre</RouterLink>) pour le sauvegarder.</li>
      </ol>
    </div>

    <div class="grid">
      <div class="card stack">
        <div class="spread">
          <h2>Séances récentes</h2>
          <RouterLink to="/seances" class="small">Tout voir</RouterLink>
        </div>
        <p v-if="!recentSessions.length" class="muted small">Aucune séance.</p>
        <ul class="list">
          <li v-for="s in recentSessions" :key="s.id">
            <RouterLink class="list-item" :to="`/seances/${s.id}`">
              <div class="grow">
                <div class="title">{{ s.title || formatDate(s.date) }}</div>
                <div class="small muted">{{ formatDate(s.date) }}{{ s.place ? ` · ${s.place}` : '' }}</div>
              </div>
              <span class="pill">{{ trialsOfSession(s.id).length }} essais</span>
            </RouterLink>
          </li>
        </ul>
      </div>
      <div class="card stack">
        <h2>Derniers essais</h2>
        <p v-if="!recentTrials.length" class="muted small">Aucun essai.</p>
        <ul class="list">
          <li v-for="t in recentTrials" :key="t.id">
            <RouterLink class="list-item" :to="`/essais/${t.id}`">
              <div class="grow">
                <div class="title">
                  {{ state.athletes.get(t.athleteId) ? athleteName(state.athletes.get(t.athleteId)!) : '—' }} · {{ disciplineLabel(t.discipline) }}
                </div>
                <div class="small muted">Essai {{ t.number }} · {{ formatDate(state.sessions.get(t.sessionId)?.date ?? t.createdAt) }}</div>
              </div>
            </RouterLink>
          </li>
        </ul>
      </div>
      <div v-if="favorites.length" class="card stack">
        <h2>Favoris</h2>
        <ul class="list">
          <li v-for="a in favorites" :key="a.id">
            <RouterLink class="list-item" :to="`/athletes/${a.id}`">★ {{ athleteName(a) }}</RouterLink>
          </li>
        </ul>
      </div>
    </div>

    <ImportDialog
      v-if="pending"
      :session-id="pending.sessionId"
      :files="pending.files"
      @done="(t) => { pending = null; if (t.length === 1) router.push(`/essais/${t[0]!.id}`); else router.push(`/seances/${t[0]?.sessionId}`); }"
      @cancel="pending = null"
    />
  </section>
</template>
