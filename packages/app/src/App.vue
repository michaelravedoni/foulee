<script setup lang="ts">
import { computed, onMounted, ref, watchEffect } from 'vue';
import { RouterLink, RouterView } from 'vue-router';
import { initStore, state } from './store/data';
import { settings } from './store/settings';
import { applyUpdate, needRefresh, offlineReady, setupPwa } from './lib/pwa';
import { locked } from './lib/lock';
import LockOverlay from './components/LockOverlay.vue';

const online = ref(navigator.onLine);
window.addEventListener('online', () => (online.value = true));
window.addEventListener('offline', () => (online.value = false));

onMounted(() => {
  setupPwa();
  void initStore();
});

watchEffect(() => {
  document.documentElement.classList.toggle('terrain', settings.terrain);
});

const logo = `${import.meta.env.BASE_URL}favicon.svg`;
const jobs = computed(() => [...state.jobs.values()]);
</script>

<template>
  <div class="shell" :class="{ terrain: settings.terrain }">
    <header class="topbar">
      <RouterLink to="/" class="brand" aria-label="Accueil Foulée">
        <img :src="logo" alt="" width="28" height="28" />
        <span>Foulée</span>
      </RouterLink>
      <nav class="mainnav" aria-label="Navigation principale">
        <RouterLink to="/athletes">Athlètes</RouterLink>
        <RouterLink to="/seances">Séances</RouterLink>
        <RouterLink to="/comparer">Comparer</RouterLink>
        <RouterLink to="/replay">Replay</RouterLink>
        <RouterLink to="/coffre">Coffre</RouterLink>
      </nav>
      <div class="topbar-right">
        <span v-if="!online" class="pill warn" title="Aucune connexion : tout fonctionne quand même">Hors ligne</span>
        <button
          class="btn ghost small"
          :aria-pressed="settings.terrain"
          title="Mode Terrain : gros boutons, utilisable d’une main"
          @click="settings.terrain = !settings.terrain"
        >
          {{ settings.terrain ? 'Terrain' : 'Analyse' }}
        </button>
        <button class="btn ghost small" title="Verrouiller l’écran" aria-label="Verrouiller l’écran" @click="locked = true">🔒</button>
      </div>
    </header>

    <div v-if="needRefresh" class="banner info">
      Une nouvelle version de Foulée est disponible.
      <button class="btn small" @click="applyUpdate">Mettre à jour</button>
      <button class="btn ghost small" @click="needRefresh = false">Plus tard</button>
    </div>
    <div v-else-if="offlineReady" class="banner ok">
      Foulée est prête à fonctionner sans réseau.
      <button class="btn ghost small" @click="offlineReady = false">OK</button>
    </div>
    <div v-if="state.error" class="banner warn">{{ state.error }}</div>

    <main class="content">
      <div v-if="!state.ready" class="empty">Ouverture du coffre…</div>
      <RouterView v-else />
    </main>

    <div v-if="jobs.length" class="jobs" role="status" aria-live="polite">
      <div v-for="(j, i) in jobs" :key="i" class="job">
        <span>{{ j.label }}</span>
        <progress :value="j.progress" max="1"></progress>
      </div>
    </div>

    <LockOverlay v-if="locked" @unlock="locked = false" />
  </div>
</template>
