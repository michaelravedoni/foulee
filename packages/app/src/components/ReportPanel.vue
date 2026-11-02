<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  analyzeJump,
  analyzeSprint,
  jumpSpecFor,
  athleteName,
  realTimeScale,
  specFor,
  timeSourceFromEvents,
  type Analysis,
  type FrameTimeline,
  type Trial,
} from '@foulee/core';
import type { FrameImage } from '@foulee/media';
import type { HistoryTrial, JumpHistoryTrial, JumpReportInput, ReportImage, ReportInput } from '@foulee/report';
import { analysisOf, mediaOf, state, trialsOfAthlete } from '../store/data';
import { formatDate } from '../lib/format';

const props = defineProps<{
  trial: Trial;
  analysis: Analysis;
  timeline: FrameTimeline | null;
  fps: number;
  grab: (frame: number) => Promise<FrameImage | null | undefined>;
}>();

const spec = computed(() => specFor(props.trial.discipline));
const jump = computed(() => jumpSpecFor(props.trial.discipline));
const busy = ref('');
const error = ref('');

function history(): HistoryTrial[] {
  const s = spec.value;
  if (!s) return [];
  const cur = props.trial;
  const sessionDate = (t: Trial) => state.sessions.get(t.sessionId)?.date ?? t.createdAt.slice(0, 10);
  return trialsOfAthlete(cur.athleteId)
    .filter((t) => t.id !== cur.id && t.discipline === cur.discipline && !t.deletedAt)
    .map((t) => ({ t, an: analysisOf(t.id), media: mediaOf(t) }))
    .filter(({ an }) => an.events.length >= 2)
    .map(({ t, an, media }) => {
      const fps = media?.nominalFps ?? props.fps;
      const date = sessionDate(t);
      return {
        id: t.id,
        label: `${formatDate(date)} · essai ${t.number}`,
        date,
        analysis: analyzeSprint(s, an.events, timeSourceFromEvents(an.events, fps), realTimeScale(fps, t.captureFps), fps),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Images clés : départ, milieu et arrivée si marqués, sinon trois images réparties. */
async function keyImages(): Promise<ReportImage[]> {
  const tl = props.timeline;
  if (!tl) return [];
  const ev = props.analysis.events;
  const pick = (type: string) => ev.find((e) => e.type === type)?.frame;
  const start = pick('depart');
  const end = pick('arrivee');
  let frames: { f: number; label: string }[];
  if (start !== undefined && end !== undefined && end > start) {
    frames = [
      { f: start, label: 'Départ' },
      { f: Math.round((start + end) / 2), label: 'Milieu de course' },
      { f: end, label: 'Arrivée' },
    ];
  } else {
    const last = tl.frameCount - 1;
    frames = [0, Math.round(last / 2), last].map((f, i) => ({ f, label: ['Début', 'Milieu', 'Fin'][i]! }));
  }
  return imagesAt(frames);
}

async function imagesAt(frames: { f: number; label: string }[]): Promise<ReportImage[]> {
  const out: ReportImage[] = [];
  for (const { f, label } of frames) {
    const img = await props.grab(f);
    if (!img) continue;
    const iw = img.width;
    const ih = img.height;
    const w = Math.min(640, iw);
    const h = Math.round((w * ih) / iw);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d')!.drawImage(img, 0, 0, w, h);
    out.push({ label: `${label} · img ${f}`, dataUrl: c.toDataURL('image/jpeg', 0.8), width: w, height: h });
  }
  return out;
}

function jumpHistory(): JumpHistoryTrial[] {
  const js = jump.value;
  if (!js) return [];
  const cur = props.trial;
  const sessionDate = (t: Trial) => state.sessions.get(t.sessionId)?.date ?? t.createdAt.slice(0, 10);
  return trialsOfAthlete(cur.athleteId)
    .filter((t) => t.id !== cur.id && t.discipline === cur.discipline && !t.deletedAt)
    .map((t) => ({ t, an: analysisOf(t.id), media: mediaOf(t) }))
    .filter(({ an }) => an.events.length >= 2)
    .map(({ t, an, media }) => {
      const f = media?.nominalFps ?? props.fps;
      const date = sessionDate(t);
      return { id: t.id, label: `${formatDate(date)} · essai ${t.number}`, date, analysis: analyzeJump(js, an.events, timeSourceFromEvents(an.events, f), realTimeScale(f, t.captureFps), f) };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Images clés d'un saut : appel, décollage, sommet ou réception (celles qui sont marquées). */
async function jumpImages(): Promise<ReportImage[]> {
  const wanted: [string, string][] = [['appel', 'Appel'], ['decollage', 'Décollage'], ['sommet', 'Sommet'], ['lacher', 'Lâcher'], ['reception', 'Réception']];
  const frames = wanted
    .map(([type, label]) => ({ f: props.analysis.events.find((e) => e.type === type)?.frame, label }))
    .filter((x): x is { f: number; label: string } => x.f !== undefined)
    .slice(0, 6);
  return imagesAt(frames);
}

async function buildJumpInput(withImages: boolean): Promise<JumpReportInput | null> {
  const js = jump.value;
  const tl = props.timeline;
  if (!js || !tl) return null;
  const t = props.trial;
  const session = state.sessions.get(t.sessionId);
  const athlete = state.athletes.get(t.athleteId);
  const media = mediaOf(t);
  return {
    athleteName: athlete ? athleteName(athlete) : '-',
    disciplineLabel: js.label,
    jump: js.id,
    date: session?.date ?? t.createdAt.slice(0, 10),
    ...(session?.place ? { place: session.place } : {}),
    ...(session?.weather ? { weather: session.weather } : {}),
    trialNumber: t.number,
    notes: t.notes,
    ...(t.officialResult ? { officialResult: t.officialResult } : {}),
    nominalFps: media?.nominalFps ?? props.fps,
    ...(t.captureFps ? { captureFps: t.captureFps } : {}),
    ...(props.analysis.calibration ? { calibration: props.analysis.calibration } : {}),
    specDataVersion: js.dataVersion,
    analysis: analyzeJump(js, props.analysis.events, tl, realTimeScale(props.fps, t.captureFps), props.fps),
    history: jumpHistory(),
    images: withImages ? await jumpImages() : [],
    generatedAt: new Date().toISOString(),
  };
}

async function buildInput(withImages: boolean): Promise<ReportInput | null> {
  const s = spec.value;
  const tl = props.timeline;
  if (!s || !tl) return null;
  const t = props.trial;
  const session = state.sessions.get(t.sessionId);
  const athlete = state.athletes.get(t.athleteId);
  const media = mediaOf(t);
  const scale = realTimeScale(props.fps, t.captureFps);
  return {
    athleteName: athlete ? athleteName(athlete) : '-',
    disciplineLabel: s.label,
    distance: s.distance,
    date: session?.date ?? t.createdAt.slice(0, 10),
    ...(session?.place ? { place: session.place } : {}),
    ...(session?.weather ? { weather: session.weather } : {}),
    trialNumber: t.number,
    notes: t.notes,
    ...(t.officialResult ? { officialResult: t.officialResult } : {}),
    nominalFps: media?.nominalFps ?? props.fps,
    ...(t.captureFps ? { captureFps: t.captureFps } : {}),
    ...(props.analysis.calibration ? { calibration: props.analysis.calibration } : {}),
    specDataVersion: s.dataVersion,
    analysis: analyzeSprint(s, props.analysis.events, tl, scale, props.fps),
    history: history(),
    images: withImages ? await keyImages() : [],
    generatedAt: new Date().toISOString(),
  };
}

function save(bytes: Uint8Array | string, type: string, name: string) {
  const blob = new Blob([bytes as BlobPart], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

const fileBase = computed(() => {
  const a = state.athletes.get(props.trial.athleteId);
  const name = a ? athleteName(a) : 'athlete';
  return `${name}-${props.trial.discipline}-essai${props.trial.number}`.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_');
});

async function run(kind: 'athlete' | 'coach' | 'csv' | 'csvHistory') {
  busy.value = kind;
  error.value = '';
  try {
    const withImages = kind === 'athlete' || kind === 'coach';
    const report = await import('@foulee/report');
    if (jump.value) {
      const ji = await buildJumpInput(withImages);
      if (!ji) throw new Error('la vidéo n’est pas encore prête');
      if (kind === 'athlete') save(await report.renderPdf(report.buildJumpAthleteReport(ji)), 'application/pdf', `${fileBase.value}-athlete.pdf`);
      else if (kind === 'coach') save(await report.renderPdf(report.buildJumpCoachReport(ji)), 'application/pdf', `${fileBase.value}-coach.pdf`);
      else if (kind === 'csv') save('﻿' + report.csvJump(ji), 'text/csv;charset=utf-8', `${fileBase.value}.csv`);
      else save('﻿' + report.csvJumpHistory(ji), 'text/csv;charset=utf-8', `${fileBase.value}-historique.csv`);
      return;
    }
    const input = await buildInput(withImages);
    if (!input) throw new Error('la vidéo n’est pas encore prête');
    if (kind === 'athlete') save(await report.renderPdf(report.buildAthleteReport(input)), 'application/pdf', `${fileBase.value}-athlete.pdf`);
    else if (kind === 'coach') save(await report.renderPdf(report.buildCoachReport(input)), 'application/pdf', `${fileBase.value}-coach.pdf`);
    else if (kind === 'csv') save('﻿' + report.csvTrial(input), 'text/csv;charset=utf-8', `${fileBase.value}.csv`);
    else save('﻿' + report.csvHistory(input), 'text/csv;charset=utf-8', `${fileBase.value}-historique.csv`);
  } catch (e) {
    error.value = `Rapport impossible : ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    busy.value = '';
  }
}
</script>

<template>
  <div v-if="!spec && !jump" class="stack">
    <p class="small muted">Les rapports couvrent pour l’instant le sprint, les haies et les sauts.</p>
  </div>
  <div v-else class="stack">
    <p class="small muted">
      Deux PDF générés sur l’appareil, sans réseau, à partir des repères de cet essai. Le rapport athlète tient en une ou deux pages ;
      le rapport coach détaille les mesures, les marges et l’historique.
    </p>
    <div class="row">
      <button class="btn small" :disabled="!!busy || !timeline" @click="run('athlete')">{{ busy === 'athlete' ? 'Création…' : 'PDF athlète' }}</button>
      <button class="btn small" :disabled="!!busy || !timeline" @click="run('coach')">{{ busy === 'coach' ? 'Création…' : 'PDF coach' }}</button>
    </div>
    <h3>Tableur</h3>
    <div class="row">
      <button class="btn secondary small" :disabled="!!busy || !timeline" @click="run('csv')">CSV de l’essai</button>
      <button class="btn secondary small" :disabled="!!busy || !timeline" @click="run('csvHistory')">CSV de l’historique</button>
    </div>
    <p class="small muted">Séparateur « ; » et virgule décimale : s’ouvre directement dans Excel.</p>
    <p v-if="error" class="small" role="alert" style="color: var(--warn)">{{ error }}</p>
  </div>
</template>
