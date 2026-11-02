import { ref } from 'vue';
import { saveSession, sessions } from '../store/data';
import { todayIso } from './format';

/** Vidéos choisies et en attente d'être rattachées à un athlète (boîte « Ajouter une vidéo »). */
export const pendingImport = ref<{ sessionId: string; files: File[] } | null>(null);

/** La séance du jour est créée à la demande : l'utilisateur n'a pas à penser aux séances pour ajouter une vidéo. */
export async function quickImport(files: File[]): Promise<void> {
  const today = todayIso();
  const existing = sessions.value.find((s) => s.date === today);
  const id = existing ? existing.id : (await saveSession({ date: today, title: 'Séance du jour' })).id;
  pendingImport.value = { sessionId: id, files };
}
