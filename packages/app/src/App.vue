<script setup lang="ts">
import { computed, onMounted, ref, watchEffect } from 'vue';
import { RouterLink, RouterView, useRouter } from 'vue-router';
import { initStore, resetLocalStorage, state } from './store/data';
import { settings } from './store/settings';
import { applyUpdate, needRefresh, setupPwa } from './lib/pwa';
import { pendingImport, quickImport } from './lib/quick';
import VideoPicker from './components/VideoPicker.vue';
import ImportDialog from './components/ImportDialog.vue';
import { locked } from './lib/lock';
import LockOverlay from './components/LockOverlay.vue';

const location = window.location;
const router = useRouter();
const moreOpen = ref(false);
router.afterEach(() => (moreOpen.value = false));
function imported(t: { id: string; sessionId: string }[]) {
  pendingImport.value = null;
  if (t.length === 1) void router.push(`/essais/${t[0]!.id}`);
  else if (t.length) void router.push(`/seances/${t[0]!.sessionId}`);
}
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

async function reset() {
  if (!confirm('Effacer TOUTES les données locales de Foulée sur cet appareil (athlètes, essais, vidéos) ? Exporte d’abord ton coffre si c’est possible.')) return;
  await resetLocalStorage();
  location.reload();
}
const jobs = computed(() => [...state.jobs.values()]);
</script>

<template>
  <div class="shell" :class="{ terrain: settings.terrain }">
    <header class="topbar">
      <RouterLink to="/" class="brand" aria-label="Accueil Foulée">
        <span>Foulée</span>
      </RouterLink>
      <nav class="mainnav" aria-label="Navigation principale">
        <RouterLink to="/" exact-active-class="router-link-active">Vidéos</RouterLink>
        <RouterLink to="/athletes">Athlètes</RouterLink>
        <RouterLink to="/comparer">Comparer</RouterLink>
      </nav>
      <div class="topbar-right">
        <span v-if="!online" class="pill warn" title="Aucune connexion : tout fonctionne quand même">Hors ligne</span>
        <VideoPicker label="＋ Ajouter une vidéo" @picked="quickImport" />
        <div class="more">
          <button class="btn ghost" :aria-expanded="moreOpen" aria-haspopup="true" @click="moreOpen = !moreOpen">Plus</button>
          <div v-if="moreOpen" class="more-menu" role="menu" @click="moreOpen = false">
            <RouterLink to="/seances" role="menuitem">Séances d’entraînement</RouterLink>
            <RouterLink to="/replay" role="menuitem">Revoir mon geste avec un décalage</RouterLink>
            <RouterLink to="/normes" role="menuitem">Normes par catégorie</RouterLink>
            <RouterLink to="/coffre" role="menuitem">Sauvegarde et données</RouterLink>
            <hr />
            <button role="menuitemcheckbox" :aria-checked="settings.terrain" @click="settings.terrain = !settings.terrain">
              Gros boutons (mode terrain) : {{ settings.terrain ? 'activé' : 'désactivé' }}
            </button>
            <button role="menuitem" @click="locked = true">Verrouiller l’écran</button>
          </div>
        </div>
      </div>
    </header>

    <div v-if="needRefresh" class="banner info">
      Une nouvelle version de Foulée est disponible.
      <button class="btn small" @click="applyUpdate">Mettre à jour</button>
      <button class="btn ghost small" @click="needRefresh = false">Plus tard</button>
    </div>
    <div v-if="state.error && !state.failed" class="banner warn">{{ state.error }}</div>
    <div v-if="state.notice" class="banner info">{{ state.notice }}</div>

    <main class="content">
      <div v-if="!state.ready" class="empty">Ouverture du coffre… <span class="small">({{ state.step }})</span></div>
      <div v-else-if="state.failed" class="card stack">
        <h1>Le coffre ne s’ouvre pas</h1>
        <p>{{ state.error }}</p>
        <p class="small muted">Tes données ne sont pas effacées. Ferme les autres onglets de Foulée puis réessaie.</p>
        <div class="row">
          <button class="btn" @click="location.reload()">Réessayer</button>
          <button class="btn danger" @click="reset">Réinitialiser le stockage local</button>
        </div>
      </div>
      <RouterView v-else />
    </main>

    <div v-if="jobs.length" class="jobs" role="status" aria-live="polite">
      <div v-for="(j, i) in jobs" :key="i" class="job">
        <span>{{ j.label }}</span>
        <progress :value="j.progress" max="1"></progress>
      </div>
    </div>

    <ImportDialog v-if="pendingImport" :session-id="pendingImport.sessionId" :files="pendingImport.files" @done="imported" @cancel="pendingImport = null" />
    <LockOverlay v-if="locked" @unlock="locked = false" />
  </div>
</template>
