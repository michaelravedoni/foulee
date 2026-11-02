import { createRouter, createWebHashHistory } from 'vue-router';

/**
 * Historique par « # » : fonctionne sur GitHub Pages et hors-ligne sans
 * configuration serveur (un rechargement ne produit jamais de 404).
 */
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'accueil', component: () => import('./views/HomeView.vue') },
    { path: '/athletes', name: 'athletes', component: () => import('./views/AthletesView.vue') },
    { path: '/athletes/:id', name: 'athlete', component: () => import('./views/AthleteView.vue'), props: true },
    { path: '/seances', name: 'seances', component: () => import('./views/SessionsView.vue') },
    { path: '/seances/:id', name: 'seance', component: () => import('./views/SessionView.vue'), props: true },
    { path: '/essais/:id', name: 'essai', component: () => import('./views/TrialView.vue'), props: true },
    { path: '/comparer', name: 'comparer', component: () => import('./views/CompareView.vue') },
    { path: '/replay', name: 'replay', component: () => import('./views/ReplayView.vue') },
    { path: '/coffre', name: 'coffre', component: () => import('./views/VaultView.vue') },
    { path: '/sauvegardes', name: 'sauvegardes', component: () => import('./views/BackupView.vue') },
    { path: '/corbeille', name: 'corbeille', component: () => import('./views/TrashView.vue') },
    { path: '/diagnostic', name: 'diagnostic', component: () => import('./views/DiagnosticView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
});
