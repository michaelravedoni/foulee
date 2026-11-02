<script setup lang="ts">
import { ref } from 'vue';
import { NormError, parseNormTable, disciplineLabel, type NormTable } from '@foulee/core';
import { removeNorm, saveNorm, state } from '../store/data';
import { todayIso } from '../lib/format';

const message = ref('');
const open = ref<string | null>(null);

/** Modèle à remplir : exemple de structure, sans aucune valeur officielle. */
const TEMPLATE: NormTable = {
  schema: 'norms@1',
  id: 'mon-tableau',
  title: 'Mon tableau de normes',
  source: { name: 'Nom de la source (ex. Swiss Athletics)', url: 'https://', season: '2026', retrievedAt: todayIso() },
  categories: [{ id: 'u16', label: 'U16', minAge: 14, maxAge: 15 }],
  entries: [{ discipline: '100m', category: 'u16', sex: 'M', levels: [{ label: 'Niveau 1', value: 13.5 }, { label: 'Niveau 2', value: 12.9 }] }],
};

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const downloadTemplate = () => download('foulee-modele-normes.json', JSON.stringify(TEMPLATE, null, 2) + '\n');

async function onFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = '';
  message.value = '';
  for (const f of files) {
    try {
      const table = parseNormTable(JSON.parse(await f.text()));
      if (state.norms.some((n) => n.id === table.id) && !confirm(`Un tableau « ${table.id} » existe déjà. Le remplacer ?`)) continue;
      await saveNorm(table);
      message.value += `« ${table.title} » importé (${table.entries.length} lignes). `;
    } catch (err) {
      message.value += `${f.name} : ${err instanceof SyntaxError ? 'ce n’est pas un fichier JSON valide.' : err instanceof NormError ? err.message : String(err)} `;
    }
  }
}

async function verify(t: NormTable) {
  const by = prompt('Ton nom (tu confirmes avoir contrôlé ces valeurs à la source officielle) :');
  if (!by?.trim()) return;
  await saveNorm({ ...t, verified: { by: by.trim(), at: todayIso() } });
}
async function unverify(t: NormTable) {
  const { verified: _v, ...rest } = t;
  await saveNorm(rest);
}
async function del(t: NormTable) {
  if (confirm(`Supprimer le tableau « ${t.title} » ?`)) await removeNorm(t.id);
}
const levels = (t: NormTable, i: number) => t.entries[i]!.levels.map((l) => `${l.label} ${String(l.value).replace('.', ',')}`).join(' · ');
</script>

<template>
  <section class="stack">
    <h1>Normes</h1>
    <p class="muted">
      Foulée n’embarque <strong>aucune</strong> valeur de norme : tu importes un tableau que tu as contrôlé à la source officielle
      (Swiss Athletics ou autre). Il est gardé dans ton coffre, avec sa source, sa saison et son état de vérification, qui s’affichent
      partout où il sert. Les athlètes ont besoin d’une date de naissance et d’un sexe sur leur fiche.
    </p>
    <div class="row">
      <label class="btn">
        Importer un tableau (JSON)
        <input type="file" accept=".json,application/json" multiple hidden data-testid="norm-file" @change="onFile" />
      </label>
      <button class="btn ghost" @click="downloadTemplate">Télécharger le modèle</button>
    </div>
    <p v-if="message" class="small" role="status">{{ message }}</p>
    <p v-if="!state.norms.length" class="muted">Aucun tableau importé.</p>
    <div v-for="t in state.norms" :key="t.id" class="card stack">
      <div class="spread">
        <div>
          <h2>{{ t.title }}</h2>
          <p class="small muted">
            {{ t.source.name }} · saison {{ t.source.season }}
            <template v-if="t.source.url"> · <a :href="t.source.url" target="_blank" rel="noopener">{{ t.source.url }}</a></template>
            <template v-if="t.source.retrievedAt"> · relevé le {{ t.source.retrievedAt }}</template>
          </p>
          <p class="small">
            <template v-if="t.verified">Vérifié à la source par <strong>{{ t.verified.by }}</strong> le {{ t.verified.at }}.</template>
            <strong v-else>Valeurs non vérifiées à la source.</strong>
          </p>
        </div>
        <div class="row">
          <button v-if="!t.verified" class="btn small" @click="verify(t)">J’ai vérifié à la source</button>
          <button v-else class="btn ghost small" @click="unverify(t)">Retirer la vérification</button>
          <button class="btn ghost small" @click="open = open === t.id ? null : t.id">{{ open === t.id ? 'Masquer' : 'Voir les lignes' }}</button>
          <button class="btn ghost small" @click="del(t)">Supprimer</button>
        </div>
      </div>
      <ul v-if="open === t.id" class="small stack">
        <li v-for="(e, i) in t.entries" :key="i">
          {{ disciplineLabel(e.discipline) }} · {{ t.categories.find((c) => c.id === e.category)?.label }} · {{ e.sex === 'F' ? 'femmes' : 'hommes' }} :
          {{ levels(t, i) }}
        </li>
      </ul>
    </div>
  </section>
</template>
