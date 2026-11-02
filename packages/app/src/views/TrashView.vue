<script setup lang="ts">
import { computed } from 'vue';
import { athleteName, disciplineLabel } from '@foulee/core';
import { purge, restore, state } from '../store/data';
import { formatDate } from '../lib/format';

type Item = { kind: 'athlete' | 'session' | 'trial'; id: string; label: string; deletedAt: string };

const items = computed<Item[]>(() => {
  const out: Item[] = [];
  for (const a of state.athletes.values()) if (a.deletedAt) out.push({ kind: 'athlete', id: a.id, label: `Athlète : ${athleteName(a)}`, deletedAt: a.deletedAt });
  for (const s of state.sessions.values())
    if (s.deletedAt) out.push({ kind: 'session', id: s.id, label: `Séance : ${s.title || formatDate(s.date)}`, deletedAt: s.deletedAt });
  for (const t of state.trials.values()) {
    if (!t.deletedAt) continue;
    // Les essais supprimés avec leur athlète ou leur séance sont restaurés avec eux.
    const parentDeleted = state.athletes.get(t.athleteId)?.deletedAt === t.deletedAt || state.sessions.get(t.sessionId)?.deletedAt === t.deletedAt;
    if (parentDeleted) continue;
    const a = state.athletes.get(t.athleteId);
    out.push({ kind: 'trial', id: t.id, label: `Essai ${t.number} : ${a ? athleteName(a) : '—'} · ${disciplineLabel(t.discipline)}`, deletedAt: t.deletedAt });
  }
  return out.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
});

async function purgeOne(i: Item) {
  if (confirm(`Supprimer définitivement « ${i.label} » ? Les vidéos qui ne servent plus seront effacées.`)) await purge(i.kind, i.id);
}
async function purgeAll() {
  if (!confirm('Vider la corbeille ? Cette action est définitive.')) return;
  for (const i of items.value) await purge(i.kind, i.id);
}
</script>

<template>
  <section class="stack">
    <div class="spread">
      <h1>Corbeille</h1>
      <button class="btn danger" :disabled="!items.length" @click="purgeAll">Vider la corbeille</button>
    </div>
    <p v-if="!items.length" class="empty">La corbeille est vide.</p>
    <ul class="list">
      <li v-for="i in items" :key="i.id" class="list-item">
        <div class="grow">
          <div class="title">{{ i.label }}</div>
          <div class="small muted">Supprimé le {{ formatDate(i.deletedAt) }}</div>
        </div>
        <button class="btn secondary small" @click="restore(i.kind, i.id)">Restaurer</button>
        <button class="btn ghost small" @click="purgeOne(i)">Supprimer</button>
      </li>
    </ul>
  </section>
</template>
