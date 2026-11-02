<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import {
  BASIC_EVENT_TYPES,
  DISCIPLINES,
  athleteName,
  derivedTags,
  disciplineLabel,
  eventLabel,
  formatMeasure,
  formatTimecode,
  frNumber,
  calibrationRelError,
  pixelsPerMeter,
  sectionSpeed,
  sectionsBetween,
  trajectoryLength,
  trajectorySpeeds,
  newId,
  jumpSpecFor,
  throwSpecFor,
  specFor,
  isTimeDiscipline,
  realTimeScale,
  type Analysis,
  type FrameTimeline,
  type MarkedEvent,
  type Landmark,
  type PoseSample,
  type Trial,
} from '@foulee/core';
import { analysisOf, athletes, loadMediaBlobs, mediaOf, moveToTrash, saveAnalysis, saveTrial, state, trialsOfAthlete, ensureProxy } from '../store/data';
import { formatBytes, formatDate, formatFps } from '../lib/format';
import FramePlayer from '../components/FramePlayer.vue';
import { isTypingTarget } from '../lib/keys';
import TagEditor from '../components/TagEditor.vue';
import SprintPanel from '../components/SprintPanel.vue';
import JumpPanel from '../components/JumpPanel.vue';
import ThrowPanel from '../components/ThrowPanel.vue';
import AutoPanel from '../components/AutoPanel.vue';
import KinogramPanel from '../components/KinogramPanel.vue';
import ReportPanel from '../components/ReportPanel.vue';
import NormBox from '../components/NormBox.vue';
import MeasureSteps, { type Step } from '../components/MeasureSteps.vue';
import { resultOf } from '../lib/results';

const props = defineProps<{ id: string }>();
const router = useRouter();
const trial = computed(() => state.trials.get(props.id));
const media = computed(() => mediaOf(trial.value));
const athlete = computed(() => (trial.value ? state.athletes.get(trial.value.athleteId) : undefined));
const session = computed(() => (trial.value ? state.sessions.get(trial.value.sessionId) : undefined));
const original = shallowRef<Blob | null>(null);
const proxy = shallowRef<Blob | null>(null);
const missing = ref(false);
const analysis = ref<Analysis>(analysisOf(props.id));
const player = ref<InstanceType<typeof FramePlayer>>();
const timeline = shallowRef<FrameTimeline | null>(null);
const currentFrame = ref(0);
const steps = ref<InstanceType<typeof MeasureSteps>>();
const stepIntro = 'Avance image par image (flèches ← →, ou glisse sur la vidéo) jusqu’à l’image voulue, puis appuie sur le bouton.';
const stepList = computed<Step[]>(() => {
  const t = trial.value;
  if (!t) return [];
  const ev = analysis.value.events;
  const sp = specFor(t.discipline);
  if (sp) {
    const hurdles = !!sp.hurdles;
    const list: Step[] = [{ id: 'depart', type: 'depart', label: 'Départ', done: ev.some((e) => e.type === 'depart') }];
    sp.splitPoints.forEach((m, i) => {
      const last = i === sp.splitPoints.length - 1;
      const type = last ? 'arrivee' : hurdles ? 'haie' : 'passage';
      list.push({
        id: `p${i}`,
        type,
        label: last ? 'Arrivée' : hurdles ? `Haie ${i + 1}` : `${frNumber(m, 0)} m`,
        fixed: m,
        done: ev.some((e) => e.type === type && (type === 'arrivee' ? true : e.position === m)),
      });
    });
    return list;
  }
  const defs = jumpSpecFor(t.discipline)?.events ?? throwSpecFor(t.discipline)?.events;
  return (defs ?? []).map((d, i) => ({
    id: `d${i}`,
    type: d.type,
    label: d.label.split(' (')[0]!,
    hint: d.hint,
    ...(d.sided ? { sided: true } : {}),
    ...(d.required ? {} : { optional: true }),
    ...(d.position ? { ask: { kind: d.position, ...(d.type === 'appel' ? { initial: '0' } : {}) } } : {}),
    done: ev.some((e) => e.type === d.type),
  }));
});
const mainResult = computed(() => {
  const t = trial.value;
  const r = t ? resultOf(t, analysis.value, media.value, fps.value) : undefined;
  if (!t || !r || !(r.value > 0)) return '';
  const f = (v: number, d: number) => v.toFixed(d).replace('.', ',');
  return `${f(r.value, 2)} ± ${f(r.margin, 3)} ${isTimeDiscipline(t.discipline) ? 's' : 'm'}`;
});

watch(
  () => props.id,
  async () => {
    analysis.value = analysisOf(props.id);
    original.value = null;
    missing.value = false;
    const m = media.value;
    if (!m) return;
    const blobs = await loadMediaBlobs(m);
    if (!blobs.original) {
      missing.value = true;
      return;
    }
    proxy.value = blobs.proxy;
    original.value = blobs.original;
  },
  { immediate: true },
);

function onAnalysis(a: Analysis) {
  analysis.value = a;
  void saveAnalysis(a);
}

async function patch(p: Partial<Trial>) {
  if (trial.value) await saveTrial(trial.value, p);
}

const others = computed(() => {
  const t = trial.value;
  if (!t) return [];
  return trialsOfAthlete(t.athleteId)
    .filter((x) => x.id !== t.id && x.discipline === t.discipline && x.mediaHash)
    .sort((a, b) => (state.sessions.get(b.sessionId)?.date ?? '').localeCompare(state.sessions.get(a.sessionId)?.date ?? '') || b.number - a.number);
});
const previous = computed(() => {
  const t = trial.value;
  if (!t) return undefined;
  const sameSession = trialsOfAthlete(t.athleteId).filter((x) => x.sessionId === t.sessionId && x.number < t.number && x.discipline === t.discipline && x.mediaHash);
  return sameSession.sort((a, b) => b.number - a.number)[0] ?? others.value[0];
});
const best = computed(() => others.value.find((x) => x.tags.includes('meilleur')));

const SINGLE_JUMP_EVENTS = ['appel', 'reception', 'sommet', 'planter', 'lacher', 'barre', 'puissance', 'rotation', 'pascroises', 'blocage', 'impact'];

// ——— Repères (événements) ———
const fps = computed(() => timeline.value?.nominalFps ?? media.value?.nominalFps ?? 30);
function mark(type: string, side?: 'G' | 'D', position?: number) {
  const tl = timeline.value;
  if (!tl) return;
  const f = currentFrame.value;
  const ev: MarkedEvent = { id: newId('evt'), type, frame: f, time: tl.timeOf(f), source: 'manuel', confidence: 1, ...(side ? { side } : {}), ...(position !== undefined ? { position } : {}) };
  // Un repère positionné (passage, haie) remplace celui de même type et de même position ;
  // dans un saut, les repères uniques (appel, réception, sommet…) sont remplacés.
  const kept = (jumpSpecFor(trial.value?.discipline ?? '') || throwSpecFor(trial.value?.discipline ?? '')) && SINGLE_JUMP_EVENTS.includes(type)
    ? analysis.value.events.filter((x) => x.type !== type)
    : position === undefined ? analysis.value.events : analysis.value.events.filter((x) => !(x.type === type && x.position === position));
  const events = [...kept, ev].sort((a, b) => a.frame - b.frame);
  onAnalysis({ ...analysis.value, events });
}
async function grabFrame(f: number) {
  return (await player.value?.grab(f)) ?? null;
}
function soundStart(time: number, ratio: number) {
  const tl = timeline.value;
  if (!tl) return;
  const f = tl.nearestFrame(time);
  const ev: MarkedEvent = { id: newId('evt'), type: 'depart', frame: f, time: tl.timeOf(f), source: 'auto', confidence: Math.min(1, ratio / 3), label: 'départ au son' };
  const events = [...analysis.value.events.filter((x) => x.type !== 'depart'), ev].sort((a, b) => a.frame - b.frame);
  onAnalysis({ ...analysis.value, events });
  player.value?.seek(f);
}
const poseMap = shallowRef<Map<number, Landmark[]> | null>(null);
const showSkeleton = ref(true);
function onPoses(samples: PoseSample[]) {
  poseMap.value = new Map(samples.flatMap((p) => (p.lm ? [[p.frame, p.lm] as const] : [])));
}
function addEvents(list: MarkedEvent[]) {
  const events = [...analysis.value.events, ...list].sort((a, b) => a.frame - b.frame);
  onAnalysis({ ...analysis.value, events });
}
function removeEvent(id: string) {
  onAnalysis({ ...analysis.value, events: analysis.value.events.filter((e) => e.id !== id) });
}
function eventTime(ev: MarkedEvent): string {
  const tl = timeline.value;
  if (!tl) return '';
  return formatTimecode('ms', {
    frame: ev.frame,
    originFrame: analysis.value.timeOrigin,
    time: tl.timeOf(ev.frame),
    originTime: tl.timeOf(analysis.value.timeOrigin),
    scale: realTimeScale(fps.value, trial.value?.captureFps),
  });
}
function deltaMs(a: MarkedEvent, b: MarkedEvent): string {
  const tl = timeline.value;
  if (!tl) return '';
  const ms = (tl.timeOf(b.frame) - tl.timeOf(a.frame)) * 1000 * realTimeScale(fps.value, trial.value?.captureFps);
  return `+${ms.toFixed(0)} ms`;
}

// ——— Mesures (phase 2) ———
const timeScale = computed(() => realTimeScale(fps.value, trial.value?.captureFps));
const cal = computed(() => analysis.value.calibration);

function setPosition(id: string, raw: string) {
  const n = raw.trim() === '' ? undefined : Number(raw.replace(',', '.'));
  const events = analysis.value.events.map((e) => {
    if (e.id !== id) return e;
    const { position: _drop, ...rest } = e;
    return n !== undefined && Number.isFinite(n) ? { ...rest, position: n } : rest;
  });
  onAnalysis({ ...analysis.value, events });
}

const sections = computed(() => {
  const tl = timeline.value;
  if (!tl) return [];
  return sectionsBetween(analysis.value.events, tl, timeScale.value).map((s) => {
    const meters = s.from.position !== undefined && s.to.position !== undefined ? s.to.position - s.from.position : undefined;
    return {
      ...s,
      meters,
      speed: meters !== undefined && meters > 0 ? sectionSpeed(meters, s.seconds, s.margin) : undefined,
      text: `${frNumber(s.seconds, 3)} ± ${frNumber(s.margin, 3)} s`,
    };
  });
});
const totalSection = computed(() => {
  const list = sections.value;
  if (list.length < 2) return null;
  const sec = list.reduce((a, s) => a + s.seconds, 0);
  // Du premier au dernier repère : la marge est celle des deux extrémités seulement.
  const first = list[0]!;
  const last = list[list.length - 1]!;
  const tl = timeline.value!;
  const margin = ((tl.durationOf(first.from.frame) + tl.durationOf(last.to.frame)) / 2) * timeScale.value;
  return { text: `${frNumber(sec, 3)} ± ${frNumber(margin, 3)} s` };
});

const trackStats = computed(() => {
  const tl = timeline.value;
  return (analysis.value.trajectories ?? []).map((t) => {
    const c = cal.value;
    const speeds = tl && c ? trajectorySpeeds(t.points, c, tl, timeScale.value) : [];
    const peak = speeds.reduce<(typeof speeds)[number] | null>((m, s) => (!m || s.speed.value > m.speed.value ? s : m), null);
    return {
      t,
      length: c ? formatMeasure(trajectoryLength(t.points, c), 'm', frNumber) : '—',
      peak: peak ? formatMeasure(peak.speed, 'm/s', frNumber) : '—',
      peakFrame: peak?.frame,
    };
  });
});
function removeTrack(id: string) {
  onAnalysis({ ...analysis.value, trajectories: (analysis.value.trajectories ?? []).filter((t) => t.id !== id) });
}

function onKey(e: KeyboardEvent) {
  if (isTypingTarget(e.target)) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Enter') {
    // Entrée marque l'étape en cours, sauf si un bouton ou un lien a le focus (Entrée l'active alors).
    if ((e.target as HTMLElement | null)?.closest?.('button, a, summary, select, details')) return;
    e.preventDefault();
    steps.value?.markCurrent(e.shiftKey ? 'D' : 'G');
    return;
  }
  const t = BASIC_EVENT_TYPES.find((x) => x.key === e.key.toLowerCase());
  if (!t) return;
  e.preventDefault();
  mark(t.id, t.sided ? (e.shiftKey ? 'D' : 'G') : undefined);
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));

async function trash() {
  if (!confirm('Mettre cet essai à la corbeille ?')) return;
  const sid = trial.value?.sessionId;
  await moveToTrash('trial', props.id);
  void router.push(sid ? `/seances/${sid}` : '/');
}
</script>

<template>
  <section v-if="trial" class="trial stack">
    <div class="spread">
      <div>
        <h1>
          {{ athlete ? athleteName(athlete) : '—' }} · {{ disciplineLabel(trial.discipline) }}
        </h1>
        <div class="small muted">
          Essai {{ trial.number }} ·
          <RouterLink :to="`/seances/${trial.sessionId}`">{{ formatDate(session?.date ?? '') }}</RouterLink>
          <template v-if="athlete"> · <RouterLink :to="`/athletes/${athlete.id}`">voir {{ athlete.firstName || athleteName(athlete) }}</RouterLink></template>
        </div>
      </div>
      <div class="row">
        <RouterLink v-if="previous" class="btn secondary small" :to="{ path: '/comparer', query: { e: [trial.id, previous.id] } }">Comparer au précédent</RouterLink>
        <RouterLink v-if="best" class="btn secondary small" :to="{ path: '/comparer', query: { e: [trial.id, best.id] } }">Comparer au meilleur</RouterLink>
        <button class="btn ghost small" :aria-pressed="trial.favorite" @click="patch({ favorite: !trial.favorite })">★</button>
      </div>
    </div>

    <div class="layout">
      <div class="main">
        <p v-if="!media" class="empty">Cet essai n’a pas de vidéo.</p>
        <p v-else-if="missing" class="empty">La vidéo de cet essai n’est pas dans le coffre de cet appareil (archive importée sans vidéos ?).</p>
        <p v-else-if="!original" class="empty">Chargement de la vidéo…</p>
        <FramePlayer
          v-else
          ref="player"
          :key="id"
          :media="media"
          :original="original"
          :proxy="proxy"
          :analysis="analysis"
          :capture-fps="trial.captureFps"
          keyboard
          @update:analysis="onAnalysis"
          @ready="(tl) => (timeline = tl)"
          @frame="(f) => (currentFrame = f)"
          :pose="showSkeleton ? poseMap : null"
        />
      </div>
      <aside class="side">
        <section class="card stack" aria-labelledby="h-mesure">
          <h2 id="h-mesure">Mesure</h2>
          <p v-if="mainResult" class="bigresult" data-testid="main-result">{{ mainResult }}</p>
          <MeasureSteps ref="steps" :steps="stepList" :intro="stepIntro" @mark="mark" />
          <JumpPanel
            v-if="jumpSpecFor(trial.discipline)"
            :discipline="trial.discipline"
            :analysis="analysis"
            :timeline="timeline"
            :fps="fps"
            :time-scale="timeScale"
            @mark="mark"
            @seek="(f) => player?.seek(f)"
            @remove="removeEvent"
          />
          <ThrowPanel
            v-else-if="throwSpecFor(trial.discipline)"
            :discipline="trial.discipline"
            :analysis="analysis"
            :timeline="timeline"
            :fps="fps"
            :time-scale="timeScale"
            @mark="mark"
            @seek="(f) => player?.seek(f)"
            @remove="removeEvent"
          />
          <SprintPanel
            v-else
            :discipline="trial.discipline"
            :analysis="analysis"
            :timeline="timeline"
            :fps="fps"
            :time-scale="timeScale"
            :original="original"
            @mark="mark"
            @sound-start="soundStart"
            @seek="(f) => player?.seek(f)"
            @remove="removeEvent"
          />
        </section>

        <section class="card stack auto-card" aria-labelledby="h-auto" data-testid="auto-card">
          <h2 id="h-auto">Analyse automatique</h2>
          <AutoPanel
            v-model:show-skeleton="showSkeleton"
            :timeline="timeline"
            :events="analysis.events"
            :grab="grabFrame"
            @poses="onPoses"
            @add-events="addEvents"
            @seek="(f) => player?.seek(f)"
          />
        </section>

        <NormBox :trial="trial" :analysis="analysis" :fps="fps" />

        <details class="card more-sec">
          <summary>Rapport et export</summary>
          <ReportPanel :trial="trial" :analysis="analysis" :timeline="timeline" :fps="fps" :grab="grabFrame" />
        </details>
        <details class="card more-sec">
          <summary>Étalon, sections et trajectoires</summary>
        <div class="stack measures">
          <p class="small muted">
            Mesures <strong>indicatives</strong> : valables dans le plan de l’étalon, caméra fixe et à peu près perpendiculaire à la piste.
            Les marges tiennent compte du pointage et de la durée d’une image.
          </p>
          <section class="stack">
            <h3>Étalon</h3>
            <p v-if="cal" class="small">
              {{ frNumber(cal.meters, 2) }} m = {{ frNumber(pixelsPerMeter(cal), 1) }} px/m, incertitude ±{{ frNumber(calibrationRelError(cal) * 100, 1) }} %.
              <button class="linklike" @click="onAnalysis({ ...analysis, calibration: undefined })">Retirer</button>
            </p>
            <p v-else class="small muted">Outil « règle » du lecteur : trace un segment de longueur connue (deux plots, une ligne de piste) sur une image.</p>
          </section>
          <section class="stack">
            <h3>Chrono par sections</h3>
            <p v-if="analysis.events.length < 2" class="small muted">Marque au moins deux repères (onglet Repères) pour obtenir des temps de section.</p>
            <template v-else>
              <div v-for="ev in analysis.events" :key="ev.id" class="row small">
                <span class="grow">{{ eventLabel(ev.type, ev.side) }} <span class="muted mono">img {{ ev.frame }}</span></span>
                <label class="muted">position
                  <input
                    class="pos"
                    type="text"
                    inputmode="decimal"
                    placeholder="m"
                    :value="ev.position ?? ''"
                    :aria-label="`Position de ${eventLabel(ev.type, ev.side)} en mètres`"
                    @change="setPosition(ev.id, ($event.target as HTMLInputElement).value)"
                  />
                </label>
              </div>
              <table class="sections small">
                <thead><tr><th>Section</th><th>Temps</th><th>Vitesse</th></tr></thead>
                <tbody>
                  <tr v-for="s in sections" :key="s.from.id + s.to.id">
                    <td>{{ eventLabel(s.from.type, s.from.side) }} → {{ eventLabel(s.to.type, s.to.side) }}<template v-if="s.meters !== undefined"> · {{ frNumber(s.meters, 1) }} m</template></td>
                    <td class="mono">{{ s.text }}</td>
                    <td class="mono">{{ s.speed ? formatMeasure(s.speed, 'm/s', frNumber) : '—' }}</td>
                  </tr>
                </tbody>
              </table>
              <p v-if="totalSection" class="small">Total : <span class="mono">{{ totalSection.text }}</span></p>
              <p class="small muted">La marge est d’au plus une image par section. Indique la position de chaque repère (m depuis le départ) pour obtenir les vitesses.</p>
            </template>
          </section>
          <section class="stack">
            <h3>Trajectoires</h3>
            <p v-if="!trackStats.length" class="small muted">Outil « cible » du lecteur : un clic par image pour suivre un point (hanche, pied, engin).</p>
            <div v-for="r in trackStats" :key="r.t.id" class="row small">
              <span class="grow">
                <strong :style="{ color: r.t.color }">{{ r.t.label }}</strong> · {{ r.t.points.length }} points · longueur {{ r.length }}
                <template v-if="cal"> · pic {{ r.peak }}</template>
                <span v-else class="muted"> · pose un étalon pour les vitesses</span>
              </span>
              <button class="btn ghost small icon" :aria-label="`Supprimer ${r.t.label}`" @click="removeTrack(r.t.id)">✕</button>
            </div>
          </section>
        </div>
        </details>
        <details class="card more-sec">
          <summary>Repères libres</summary>
        <div class="stack">
          <div class="row">
            <template v-for="t in BASIC_EVENT_TYPES" :key="t.id">
              <template v-if="t.sided">
                <button class="btn secondary small" :title="`${t.label} gauche (touche ${t.key})`" @click="mark(t.id, 'G')">{{ t.label }} G</button>
                <button class="btn secondary small" :title="`${t.label} droit (Maj+${t.key})`" @click="mark(t.id, 'D')">{{ t.label }} D</button>
              </template>
              <button v-else class="btn secondary small" :title="`${t.label} (touche ${t.key})`" @click="mark(t.id)">{{ t.label }}</button>
            </template>
          </div>
          <p class="small muted">Marque l’image affichée avec un repère libre. Les temps de section sont dans l’onglet Résultats.</p>
          <ol v-if="analysis.events.length" class="list events">
            <li v-for="(ev, i) in analysis.events" :key="ev.id" class="list-item">
              <button class="linklike grow" @click="player?.seek(ev.frame)">
                <strong>{{ eventLabel(ev.type, ev.side) }}</strong>
                <span class="mono small">{{ eventTime(ev) }} · img {{ ev.frame }}</span>
                <span v-if="i > 0" class="mono small muted">{{ deltaMs(analysis.events[i - 1]!, ev) }}</span>
              </button>
              <button class="btn ghost small icon" :aria-label="`Supprimer ${eventLabel(ev.type, ev.side)}`" @click="removeEvent(ev.id)">✕</button>
            </li>
          </ol>
          <p v-else class="muted small">Aucun repère.</p>
        </div>
        </details>
        <details class="card more-sec">
          <summary>Kinogramme (images en séquence)</summary>
          <KinogramPanel
            :analysis="analysis"
            :timeline="timeline"
            :time-scale="timeScale"
            :title="`${athlete ? athleteName(athlete) : ''}-${trial.discipline}-${trial.number}`"
            :grab="grabFrame"
          />
        </details>
        <details class="card more-sec">
          <summary>Informations sur l’essai</summary>
        <div class="stack">
          <TagEditor :model-value="trial.tags" quick :derived="derivedTags(trial, media?.nominalFps)" @update:model-value="(tags) => patch({ tags })" />
          <label class="field">
            Athlète
            <select :value="trial.athleteId" @change="patch({ athleteId: ($event.target as HTMLSelectElement).value })">
              <option v-for="a in athletes" :key="a.id" :value="a.id">{{ athleteName(a) }}</option>
            </select>
          </label>
          <label class="field">
            Épreuve
            <select :value="trial.discipline" @change="patch({ discipline: ($event.target as HTMLSelectElement).value as Trial['discipline'] })">
              <option v-for="d in DISCIPLINES" :key="d.id" :value="d.id">{{ d.label }}</option>
            </select>
          </label>
          <div class="form-grid">
            <label class="field">
              Cadence réelle (i/s)
              <input
                type="number"
                min="1"
                step="1"
                inputmode="numeric"
                :value="trial.captureFps ?? ''"
                :placeholder="media ? String(media.nominalFps) : ''"
                @change="patch({ captureFps: Number(($event.target as HTMLInputElement).value) || undefined })"
              />
            </label>
            <label class="field">
              Résultat officiel
              <input :value="trial.officialResult ?? ''" placeholder="ex. 11,42" @change="patch({ officialResult: ($event.target as HTMLInputElement).value || undefined })" />
            </label>
          </div>
          <label class="field">Notes <textarea :value="trial.notes" @change="patch({ notes: ($event.target as HTMLTextAreaElement).value })"></textarea></label>
          <div v-if="media" class="small muted">
            {{ media.originalName }} · {{ formatBytes(media.size) }} · {{ media.width }}×{{ media.height }} · {{ formatFps(media.nominalFps) }}{{ media.variableFrameRate ? ' (variable)' : '' }} ·
            {{ media.frameCount }} images · {{ media.codec ?? 'codec inconnu' }} · proxy : {{ media.proxyHash ? 'oui' : 'non' }}
            <button v-if="!media.proxyHash" class="btn ghost small" @click="ensureProxy(media, true)">Créer le proxy</button>
          </div>
          <div><button class="btn ghost small" @click="trash">Mettre l’essai à la corbeille</button></div>
        </div>
        </details>
      </aside>
    </div>
  </section>
  <p v-else class="empty">Essai introuvable.</p>
</template>

<style scoped>
.pos {
  width: 4.5em;
  margin-left: 6px;
}
.sections {
  width: 100%;
  border-collapse: collapse;
}
.sections th {
  text-align: left;
  color: var(--muted);
  font-weight: 500;
}
.sections td,
.sections th {
  padding: 4px 6px 4px 0;
  vertical-align: top;
}
.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: 16px;
  align-items: start;
}
/* Diptyque : panneau Cream (mesures) à gauche, panneau Void (vidéo) qui prend le reste. */
@media (min-width: 1001px) {
  .layout {
    grid-template-columns: minmax(320px, 400px) minmax(0, 1fr);
  }
  .layout > .side {
    order: -1;
  }
}
@media (max-width: 1000px) {
  .layout {
    grid-template-columns: 1fr;
  }
}
.side {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
@media (min-width: 1001px) {
  .layout > .main {
    position: sticky;
    top: 8px;
  }
}
.more-sec > summary {
  cursor: pointer;
  font-weight: 600;
  min-height: var(--tap);
  display: flex;
  align-items: center;
}
.more-sec[open] > summary {
  margin-bottom: 8px;
}
.bigresult {
  margin: 0;
  font-family: var(--font-display);
  font-size: 2rem;
  line-height: 1.1;
}
.events .list-item {
  padding: 4px 6px 4px 10px;
  min-height: 0;
}
.linklike {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 10px;
  align-items: baseline;
  background: none;
  border: 0;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  padding: 6px 0;
}
</style>
