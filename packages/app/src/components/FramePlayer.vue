<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef } from 'vue';
import {
  UndoStack,
  angleAt,
  arrowHead,
  eventLabel,
  formatTimecode,
  frNumber,
  hitDistance,
  isAnnotationVisible,
  newId,
  realTimeScale,
  simplifyPath,
  type Analysis,
  type Annotation,
  type FrameTimeline,
  type MediaInfo,
  type Point,
  type ShapeKind,
  type TimecodeMode,
} from '@foulee/core';
import { openFrameSource, type FrameSource } from '@foulee/media';
import { settings } from '../store/settings';
import { isTypingTarget } from '../lib/keys';

export interface ZoomState {
  scale: number;
  x: number;
  y: number;
}

const props = withDefaults(
  defineProps<{
    media: MediaInfo;
    original: Blob;
    proxy?: Blob | null;
    analysis: Analysis;
    captureFps?: number;
    compact?: boolean;
    keyboard?: boolean;
    zoom?: ZoomState;
    label?: string;
  }>(),
  { proxy: null, captureFps: undefined, compact: false, keyboard: false, zoom: undefined, label: '' },
);

const emit = defineEmits<{
  'update:analysis': [Analysis];
  'update:zoom': [ZoomState];
  frame: [number];
  ready: [FrameTimeline];
}>();

const SPEEDS = [0.05, 0.1, 0.25, 0.5, 1, 2];
const SPEED_LABELS: Record<number, string> = { 0.05: '0,05×', 0.1: '0,1×', 0.25: '0,25×', 0.5: '0,5×', 1: '1×', 2: '2×' };
type Tool = 'deplacer' | ShapeKind | 'gomme';
const TOOLS: { id: Tool; label: string; icon: string }[] = [
  { id: 'deplacer', label: 'Déplacer / zoomer', icon: '✋' },
  { id: 'ligne', label: 'Ligne', icon: '╱' },
  { id: 'fleche', label: 'Flèche', icon: '↗' },
  { id: 'main', label: 'Main levée', icon: '✎' },
  { id: 'cercle', label: 'Cercle', icon: '◯' },
  { id: 'rectangle', label: 'Rectangle', icon: '▭' },
  { id: 'angle', label: 'Angle', icon: '∠' },
  { id: 'texte', label: 'Texte', icon: 'T' },
  { id: 'gomme', label: 'Gomme', icon: '⌫' },
];
const COLORS = ['#ff3b30', '#ffcc00', '#34c759', '#0a84ff', '#ffffff', '#000000'];

const stage = ref<HTMLDivElement>();
const viewport = ref<HTMLDivElement>();
const canvas = ref<HTMLCanvasElement>();
const video = ref<HTMLVideoElement>();

const source = shallowRef<FrameSource | null>(null);
const timeline = shallowRef<FrameTimeline | null>(null);
const loadError = ref('');
const estimated = ref(false);
const frame = ref(0);
const playing = ref(false);
const rate = ref(0.25);
const loopA = ref<number | null>(null);
const loopB = ref<number | null>(null);
const tool = ref<Tool>('deplacer');
const timecodeMode = ref<TimecodeMode>(settings.timecode);
const fullscreen = ref(false);
const fakeFullscreen = ref(false);
const localZoom = reactive<ZoomState>({ scale: 1, x: 0, y: 0 });
const zoom = computed<ZoomState>(() => props.zoom ?? localZoom);
let playUrl = '';

const W = computed(() => props.media.width || source.value?.width || 1920);
const H = computed(() => props.media.height || source.value?.height || 1080);
const fps = computed(() => timeline.value?.nominalFps ?? props.media.nominalFps);
const scale = computed(() => realTimeScale(fps.value, props.captureFps));
const lastFrame = computed(() => Math.max(0, (timeline.value?.frameCount ?? 1) - 1));

const timecode = computed(() => {
  const tl = timeline.value;
  if (!tl) return '';
  return formatTimecode(timecodeMode.value, {
    frame: frame.value,
    originFrame: props.analysis.timeOrigin,
    time: tl.timeOf(frame.value),
    originTime: tl.timeOf(props.analysis.timeOrigin),
    scale: scale.value,
  });
});

// ——— Ouverture ———

onMounted(async () => {
  try {
    const opened = await openFrameSource(props.original);
    source.value = opened.source;
    timeline.value = opened.source.timeline;
    estimated.value = opened.estimated;
    playUrl = URL.createObjectURL(props.proxy ?? props.original);
    if (video.value) video.value.src = playUrl;
    await nextTick();
    if (canvas.value) {
      canvas.value.width = opened.source.width;
      canvas.value.height = opened.source.height;
    }
    emit('ready', opened.source.timeline);
    await showFrame(props.analysis.timeOrigin || 0);
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e);
  }
  if (props.keyboard) window.addEventListener('keydown', onKey);
  document.addEventListener('fullscreenchange', onFsChange);
});

onBeforeUnmount(() => {
  stopPlayback();
  source.value?.dispose();
  if (playUrl) URL.revokeObjectURL(playUrl);
  window.removeEventListener('keydown', onKey);
  document.removeEventListener('fullscreenchange', onFsChange);
});

// ——— Affichage d'une image exacte ———

let drawSeq = 0;
async function showFrame(i: number): Promise<void> {
  const src = source.value;
  const tl = timeline.value;
  if (!src || !tl) return;
  const target = tl.clamp(i);
  frame.value = target;
  emit('frame', target);
  const seq = ++drawSeq;
  const bmp = await src.getFrame(target);
  if (!bmp || seq !== drawSeq || !canvas.value) return;
  const ctx = canvas.value.getContext('2d');
  ctx?.drawImage(bmp, 0, 0, canvas.value.width, canvas.value.height);
}

function seek(i: number) {
  if (playing.value) pause();
  void showFrame(i);
}
function step(n: number) {
  if (playing.value) pause();
  void showFrame(frame.value + n);
}

// ——— Lecture ———

let rafId = 0;
let steppedLast = 0;
let steppedTime = 0;
let stepped = false;

async function play() {
  const tl = timeline.value;
  const v = video.value;
  if (!tl || !v || playing.value) return;
  if (frame.value >= lastFrame.value) await showFrame(loopA.value ?? 0);
  playing.value = true;
  stepped = rate.value < 0.1;
  if (!stepped) {
    try {
      v.playbackRate = rate.value;
    } catch {
      stepped = true;
    }
  }
  if (stepped) {
    steppedTime = tl.timeOf(frame.value);
    steppedLast = performance.now();
    rafId = requestAnimationFrame(steppedTick);
    return;
  }
  v.currentTime = tl.timeOf(frame.value) + tl.durationOf(frame.value) / 2;
  try {
    await v.play();
  } catch {
    // lecture refusée (ex. économie d'énergie) : repli image par image
    stepped = true;
    steppedTime = tl.timeOf(frame.value);
    steppedLast = performance.now();
    rafId = requestAnimationFrame(steppedTick);
    return;
  }
  watchVideoFrames();
}

function watchVideoFrames() {
  const v = video.value!;
  const tl = timeline.value!;
  const onFrame = (mediaTime: number) => {
    if (!playing.value) return;
    const f = tl.frameAt(mediaTime);
    frame.value = f;
    emit('frame', f);
    if (loopB.value !== null && f >= loopB.value) {
      v.currentTime = tl.timeOf(loopA.value ?? 0) + tl.durationOf(0) / 2;
    }
  };
  if (typeof (v as HTMLVideoElement).requestVideoFrameCallback === 'function') {
    const cb = (_now: number, meta: VideoFrameCallbackMetadata) => {
      onFrame(meta.mediaTime);
      if (playing.value) v.requestVideoFrameCallback(cb);
    };
    v.requestVideoFrameCallback(cb);
  } else {
    const tick = () => {
      onFrame(v.currentTime);
      if (playing.value) rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }
}

function steppedTick(now: number) {
  const tl = timeline.value;
  if (!playing.value || !tl) return;
  steppedTime += ((now - steppedLast) / 1000) * rate.value;
  steppedLast = now;
  let f = tl.frameAt(steppedTime);
  const end = loopB.value ?? lastFrame.value;
  if (f >= end) {
    if (loopB.value !== null) {
      f = loopA.value ?? 0;
      steppedTime = tl.timeOf(f);
    } else {
      f = end;
      void showFrame(f);
      pause();
      return;
    }
  }
  if (f !== frame.value) void showFrame(f);
  rafId = requestAnimationFrame(steppedTick);
}

function stopPlayback() {
  cancelAnimationFrame(rafId);
  video.value?.pause();
}

function pause() {
  if (!playing.value) return;
  const tl = timeline.value;
  const v = video.value;
  playing.value = false;
  stopPlayback();
  if (!stepped && tl && v) void showFrame(tl.frameAt(v.currentTime));
}

function togglePlay() {
  if (playing.value) pause();
  else void play();
}

function onEnded() {
  if (!playing.value) return;
  if (loopB.value !== null || loopA.value !== null) {
    playing.value = false;
    void showFrame(loopA.value ?? 0).then(play);
    return;
  }
  pause();
  void showFrame(lastFrame.value);
}

function setRate(r: number) {
  rate.value = r;
  if (playing.value) {
    pause();
    void play();
  }
}

// ——— Boucle A-B, origine ———

function setLoopA() {
  loopA.value = frame.value;
  if (loopB.value !== null && loopB.value <= frame.value) loopB.value = null;
}
function setLoopB() {
  loopB.value = frame.value;
  if (loopA.value !== null && loopA.value >= frame.value) loopA.value = null;
}
function clearLoop() {
  loopA.value = null;
  loopB.value = null;
}
function setOrigin() {
  update({ timeOrigin: frame.value });
}
function cycleTimecode() {
  const modes: TimecodeMode[] = ['ms', 'image', 'hms'];
  timecodeMode.value = modes[(modes.indexOf(timecodeMode.value) + 1) % modes.length]!;
  settings.timecode = timecodeMode.value;
}

// ——— Analyse (dessins, repères) ———

const undo = new UndoStack<Annotation[]>();
const canUndo = ref(false);
const canRedo = ref(false);

function update(patch: Partial<Analysis>) {
  emit('update:analysis', { ...props.analysis, ...patch });
}
function commitAnnotations(next: Annotation[]) {
  undo.push(props.analysis.annotations);
  update({ annotations: next });
  canUndo.value = undo.canUndo;
  canRedo.value = undo.canRedo;
}
function doUndo() {
  const prev = undo.undo(props.analysis.annotations);
  if (prev) update({ annotations: prev });
  canUndo.value = undo.canUndo;
  canRedo.value = undo.canRedo;
}
function doRedo() {
  const next = undo.redo(props.analysis.annotations);
  if (next) update({ annotations: next });
  canUndo.value = undo.canUndo;
  canRedo.value = undo.canRedo;
}
function clearFrameDrawings() {
  const keep = props.analysis.annotations.filter((a) => !isAnnotationVisible(a, frame.value));
  if (keep.length !== props.analysis.annotations.length) commitAnnotations(keep);
}

const visibleAnnotations = computed(() => props.analysis.annotations.filter((a) => isAnnotationVisible(a, frame.value)));

// ——— Saisie au pointeur : dessin, déplacement, pincement ———

const pointers = new Map<number, Point>();
let pinchStart: { dist: number; mid: Point; zoom: ZoomState } | null = null;
let panStart: { p: Point; zoom: ZoomState } | null = null;
const draft = ref<Annotation | null>(null);
let angleStage = 0; // 0 : rien ; 1 : premier bras tracé

function stagePoint(e: PointerEvent): Point {
  const r = stage.value!.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
function videoPoint(e: PointerEvent): Point {
  const r = viewport.value!.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * W.value, y: ((e.clientY - r.top) / r.height) * H.value };
}
function setZoom(z: ZoomState) {
  const s = Math.min(12, Math.max(1, z.scale));
  const r = stage.value?.getBoundingClientRect();
  let { x, y } = z;
  if (r) {
    // Borne le déplacement pour garder l'image dans le cadre.
    x = Math.min(0, Math.max(r.width * (1 - s), x));
    y = Math.min(0, Math.max(r.height * (1 - s), y));
  }
  const next = s === 1 ? { scale: 1, x: 0, y: 0 } : { scale: s, x, y };
  if (props.zoom) emit('update:zoom', next);
  else Object.assign(localZoom, next);
}
function zoomAt(p: Point, factor: number) {
  const z = zoom.value;
  const s = Math.min(12, Math.max(1, z.scale * factor));
  const k = s / z.scale;
  setZoom({ scale: s, x: p.x - (p.x - z.x) * k, y: p.y - (p.y - z.y) * k });
}
function onWheel(e: WheelEvent) {
  e.preventDefault();
  const r = stage.value!.getBoundingClientRect();
  zoomAt({ x: e.clientX - r.left, y: e.clientY - r.top }, Math.exp(-e.deltaY * 0.0025));
}

const drawingEnabled = computed(() => tool.value !== 'deplacer' && !props.analysis.locked);

function holdFrames(): number | null {
  return settings.drawHold > 0 ? Math.round(settings.drawHold * fps.value) : null;
}

function onPointerDown(e: PointerEvent) {
  stage.value?.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, stagePoint(e));
  if (pointers.size === 2) {
    // Deux doigts : pincement pour zoomer (annule un tracé en cours).
    draft.value = null;
    angleStage = 0;
    const [a, b] = [...pointers.values()] as [Point, Point];
    pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, zoom: { ...zoom.value } };
    panStart = null;
    return;
  }
  if (pointers.size > 2) return;
  if (!drawingEnabled.value) {
    panStart = { p: stagePoint(e), zoom: { ...zoom.value } };
    return;
  }
  if (playing.value) pause();
  const p = videoPoint(e);
  const t = tool.value;
  if (t === 'gomme') {
    eraseAt(p);
    return;
  }
  if (t === 'texte') {
    const text = window.prompt('Texte à afficher');
    if (text?.trim()) commitAnnotations([...props.analysis.annotations, makeAnnotation('texte', [p], text.trim())]);
    return;
  }
  if (t === 'angle' && angleStage === 1 && draft.value) {
    draft.value = { ...draft.value, points: [draft.value.points[0]!, draft.value.points[1]!, p] };
    return;
  }
  draft.value = makeAnnotation(t as ShapeKind, [p, p]);
}

function onPointerMove(e: PointerEvent) {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, stagePoint(e));
  if (pinchStart && pointers.size === 2) {
    const [a, b] = [...pointers.values()] as [Point, Point];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const z0 = pinchStart.zoom;
    const s = Math.min(12, Math.max(1, (z0.scale * dist) / pinchStart.dist));
    const k = s / z0.scale;
    setZoom({ scale: s, x: mid.x - (pinchStart.mid.x - z0.x) * k, y: mid.y - (pinchStart.mid.y - z0.y) * k });
    return;
  }
  if (panStart) {
    const p = stagePoint(e);
    setZoom({ ...panStart.zoom, x: panStart.zoom.x + p.x - panStart.p.x, y: panStart.zoom.y + p.y - panStart.p.y });
    return;
  }
  const d = draft.value;
  if (!d) return;
  const p = videoPoint(e);
  if (d.kind === 'main') draft.value = { ...d, points: [...d.points, p] };
  else if (d.kind === 'angle' && d.points.length === 3) draft.value = { ...d, points: [d.points[0]!, d.points[1]!, p] };
  else draft.value = { ...d, points: [d.points[0]!, p] };
}

function onPointerUp(e: PointerEvent) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchStart = null;
  if (pointers.size === 0) panStart = null;
  const d = draft.value;
  if (!d) return;
  const [p0, p1] = d.points as [Point, Point];
  const tiny = Math.hypot(p1.x - p0.x, p1.y - p0.y) < W.value * 0.005;
  if (d.kind === 'angle') {
    if (angleStage === 0) {
      if (tiny) {
        draft.value = null;
        return;
      }
      angleStage = 1; // attend le second bras
      return;
    }
    angleStage = 0;
    draft.value = null;
    commitAnnotations([...props.analysis.annotations, d]);
    return;
  }
  draft.value = null;
  if (tiny && d.kind !== 'main') return;
  const final = d.kind === 'main' ? { ...d, points: simplifyPath(d.points, W.value * 0.0015) } : d;
  commitAnnotations([...props.analysis.annotations, final]);
}

function eraseAt(p: Point) {
  const tolerance = (W.value / (viewport.value?.getBoundingClientRect().width ?? W.value)) * 16;
  let best: Annotation | null = null;
  let bestD = tolerance;
  for (const a of visibleAnnotations.value) {
    const dd = hitDistance(a, p);
    if (dd < bestD) {
      best = a;
      bestD = dd;
    }
  }
  if (best) commitAnnotations(props.analysis.annotations.filter((a) => a.id !== best!.id));
}

function makeAnnotation(kind: ShapeKind, points: Point[], text?: string): Annotation {
  return {
    id: newId('ann'),
    kind,
    points,
    ...(text ? { text } : {}),
    color: settings.drawColor,
    width: settings.drawWidth,
    frame: frame.value,
    holdFrames: holdFrames(),
  };
}

function pathOf(a: Annotation): string {
  return a.points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
}
function arrowPath(a: Annotation): string {
  const [p0, p1] = a.points as [Point, Point];
  const [l, r] = arrowHead(p0, p1, Math.max(W.value, H.value) * 0.02);
  return `M${l.x} ${l.y} L${p1.x} ${p1.y} L${r.x} ${r.y}`;
}
function angleText(a: Annotation): string {
  if (a.points.length < 3) return '';
  return `${frNumber(angleAt(a.points[0]!, a.points[1]!, a.points[2]!), 1)}°`;
}
const fontSize = computed(() => Math.max(W.value, H.value) * 0.028);

// ——— Barre de temps et molette (jog) ———

const markers = computed(() =>
  props.analysis.events.map((ev) => ({ id: ev.id, frame: ev.frame, label: eventLabel(ev.type, ev.side) })),
);
function pct(f: number) {
  return `${(f / Math.max(1, lastFrame.value)) * 100}%`;
}

let jogStart: { x: number; frame: number } | null = null;
function jogDown(e: PointerEvent) {
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  if (playing.value) pause();
  jogStart = { x: e.clientX, frame: frame.value };
}
function jogMove(e: PointerEvent) {
  if (!jogStart) return;
  const delta = Math.round((e.clientX - jogStart.x) / (settings.terrain ? 10 : 6));
  const target = timeline.value?.clamp(jogStart.frame + delta) ?? 0;
  if (target !== frame.value) void showFrame(target);
}
function jogUp() {
  jogStart = null;
}

// ——— Plein écran et clavier ———

const root = ref<HTMLDivElement>();
function toggleFullscreen() {
  const el = root.value;
  if (!el) return;
  if (fakeFullscreen.value) {
    fakeFullscreen.value = false;
    fullscreen.value = false;
  } else if (document.fullscreenElement) void document.exitFullscreen();
  else if (el.requestFullscreen) el.requestFullscreen().catch(() => (fakeFullscreen.value = fullscreen.value = true));
  else fakeFullscreen.value = fullscreen.value = true; // iPhone : plein écran simulé
}
function onFsChange() {
  fullscreen.value = document.fullscreenElement === root.value;
}

function onKey(e: KeyboardEvent) {
  if (isTypingTarget(e.target)) return;
  const big = e.shiftKey ? 10 : 1;
  const mod = e.ctrlKey || e.metaKey;
  switch (e.key) {
    case ' ':
      e.preventDefault();
      togglePlay();
      break;
    case 'ArrowRight':
    case '.':
      e.preventDefault();
      step(big);
      break;
    case 'ArrowLeft':
    case ',':
      e.preventDefault();
      step(-big);
      break;
    case 'Home':
      seek(0);
      break;
    case 'End':
      seek(lastFrame.value);
      break;
    case '[':
      setLoopA();
      break;
    case ']':
      setLoopB();
      break;
    case '\\':
      clearLoop();
      break;
    case '0':
      setOrigin();
      break;
    case 'f':
      if (!mod) toggleFullscreen();
      break;
    case '+':
      setRate(SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(rate.value) + 1)]!);
      break;
    case '-':
      setRate(SPEEDS[Math.max(0, SPEEDS.indexOf(rate.value) - 1)]!);
      break;
    case 'z':
    case 'Z':
      if (mod) {
        e.preventDefault();
        if (e.shiftKey) doRedo();
        else doUndo();
      }
      break;
    case 'y':
      if (mod) {
        e.preventDefault();
        doRedo();
      }
      break;
    case 'Escape':
      tool.value = 'deplacer';
      draft.value = null;
      angleStage = 0;
      break;
  }
}

defineExpose({ frame, timeline, playing, rate, seek, step, play, pause, setRate, showFrame });

const stageStyle = computed(() => ({
  aspectRatio: `${W.value} / ${H.value}`,
  width: fullscreen.value ? `min(100%, calc((100dvh - 120px) * ${W.value / H.value}))` : `min(100%, calc(${props.compact ? '42dvh' : '60dvh'} * ${W.value / H.value}))`,
}));
const viewportStyle = computed(() => ({
  transform: `translate(${zoom.value.x}px, ${zoom.value.y}px) scale(${zoom.value.scale})`,
}));
</script>

<template>
  <div ref="root" class="player" :class="{ compact, 'fake-fullscreen': fakeFullscreen }">
    <div v-if="loadError" class="empty">
      <strong>Vidéo illisible sur cet appareil.</strong><br />
      {{ loadError }}
    </div>
    <template v-else>
      <div class="stage-wrap">
        <div
          ref="stage"
          class="stage"
          :class="{ drawing: drawingEnabled }"
          :style="stageStyle"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
          @wheel="onWheel"
          @dblclick="setZoom({ scale: 1, x: 0, y: 0 })"
        >
          <div ref="viewport" class="viewport" :style="viewportStyle">
            <video
              ref="video"
              class="layer"
              :class="{ hidden: !playing }"
              playsinline
              muted
              preload="auto"
              disablepictureinpicture
              @ended="onEnded"
            ></video>
            <canvas ref="canvas" class="layer" :class="{ hidden: playing }"></canvas>
            <svg class="layer draw" :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none">
              <g v-for="a in draft ? [...visibleAnnotations, draft] : visibleAnnotations" :key="a.id" :stroke="a.color" :fill="'none'">
                <path v-if="a.kind === 'ligne' || a.kind === 'main'" :d="pathOf(a)" :stroke-width="a.width" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round" />
                <template v-else-if="a.kind === 'fleche'">
                  <path :d="pathOf(a)" :stroke-width="a.width" vector-effect="non-scaling-stroke" stroke-linecap="round" />
                  <path :d="arrowPath(a)" :stroke-width="a.width" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round" />
                </template>
                <circle
                  v-else-if="a.kind === 'cercle'"
                  :cx="a.points[0]!.x"
                  :cy="a.points[0]!.y"
                  :r="Math.hypot(a.points[1]!.x - a.points[0]!.x, a.points[1]!.y - a.points[0]!.y)"
                  :stroke-width="a.width"
                  vector-effect="non-scaling-stroke"
                />
                <rect
                  v-else-if="a.kind === 'rectangle'"
                  :x="Math.min(a.points[0]!.x, a.points[1]!.x)"
                  :y="Math.min(a.points[0]!.y, a.points[1]!.y)"
                  :width="Math.abs(a.points[1]!.x - a.points[0]!.x)"
                  :height="Math.abs(a.points[1]!.y - a.points[0]!.y)"
                  :stroke-width="a.width"
                  vector-effect="non-scaling-stroke"
                />
                <template v-else-if="a.kind === 'angle'">
                  <path :d="pathOf(a)" :stroke-width="a.width" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round" />
                  <text
                    v-if="a.points.length === 3"
                    :x="a.points[1]!.x + fontSize * 0.6"
                    :y="a.points[1]!.y - fontSize * 0.6"
                    :font-size="fontSize"
                    :fill="a.color"
                    stroke="#000"
                    :stroke-width="fontSize * 0.08"
                    paint-order="stroke"
                    font-weight="700"
                  >{{ angleText(a) }}</text>
                </template>
                <text
                  v-else-if="a.kind === 'texte'"
                  :x="a.points[0]!.x"
                  :y="a.points[0]!.y"
                  :font-size="fontSize"
                  :fill="a.color"
                  stroke="#000"
                  :stroke-width="fontSize * 0.08"
                  paint-order="stroke"
                  font-weight="700"
                >{{ a.text }}</text>
              </g>
            </svg>
          </div>
          <div class="hud">
            <button class="hud-tc mono" title="Changer l’affichage du temps" @pointerdown.stop @click="cycleTimecode">{{ timecode }}</button>
            <span v-if="label" class="hud-label">{{ label }}</span>
            <span v-if="zoom.scale > 1" class="hud-zoom">×{{ frNumber(zoom.scale, 1) }}</span>
          </div>
          <div v-if="!source" class="stage-loading">Lecture du fichier…</div>
        </div>
      </div>

      <div class="timebar" :aria-label="`Image ${frame} sur ${lastFrame}`">
        <input
          type="range"
          min="0"
          :max="lastFrame"
          :value="frame"
          aria-label="Position"
          @input="seek(Number(($event.target as HTMLInputElement).value))"
        />
        <div class="marks" aria-hidden="true">
          <span v-if="loopA !== null && loopB !== null" class="loop" :style="{ left: pct(loopA), width: `calc(${pct(loopB)} - ${pct(loopA)})` }"></span>
          <span v-else-if="loopA !== null" class="loop-edge" :style="{ left: pct(loopA) }"></span>
          <span class="origin" :style="{ left: pct(analysis.timeOrigin) }" title="t = 0"></span>
          <span v-for="m in markers" :key="m.id" class="mark" :style="{ left: pct(m.frame) }" :title="m.label"></span>
        </div>
      </div>
      <div class="jog" role="slider" aria-label="Molette : glisser pour avancer image par image" :aria-valuenow="frame" @pointerdown="jogDown" @pointermove="jogMove" @pointerup="jogUp" @pointercancel="jogUp">
        <span v-for="i in 40" :key="i" class="tick" :style="{ transform: `translateX(${-(frame % 6) * 1}px)` }"></span>
      </div>

      <div class="controls">
        <div class="row">
          <button class="btn secondary icon" title="−10 images (Maj+←)" aria-label="Reculer de 10 images" @click="step(-10)">⏪</button>
          <button class="btn secondary icon" title="Image précédente (←)" aria-label="Image précédente" @click="step(-1)">◀︎</button>
          <button class="btn icon play" :title="playing ? 'Pause (Espace)' : 'Lecture (Espace)'" :aria-label="playing ? 'Pause' : 'Lecture'" @click="togglePlay">
            {{ playing ? '❚❚' : '▶︎' }}
          </button>
          <button class="btn secondary icon" title="Image suivante (→)" aria-label="Image suivante" @click="step(1)">▶︎❘</button>
          <button class="btn secondary icon" title="+10 images (Maj+→)" aria-label="Avancer de 10 images" @click="step(10)">⏩</button>
        </div>
        <div class="row speeds" role="group" aria-label="Vitesse">
          <button v-for="s in SPEEDS" :key="s" class="btn ghost small" :class="{ active: rate === s }" @click="setRate(s)">
            {{ SPEED_LABELS[s] }}
          </button>
        </div>
        <div v-if="!compact" class="row">
          <button class="btn ghost small" title="Début de boucle ([)" @click="setLoopA">A</button>
          <button class="btn ghost small" title="Fin de boucle (])" @click="setLoopB">B</button>
          <button class="btn ghost small" :disabled="loopA === null && loopB === null" title="Effacer la boucle (\)" @click="clearLoop">A-B ✕</button>
          <button class="btn ghost small" title="Définir l’image courante comme t = 0 (touche 0)" @click="setOrigin">t = 0</button>
          <button class="btn ghost small" :title="fullscreen ? 'Quitter le plein écran (F)' : 'Plein écran (F)'" @click="toggleFullscreen">{{ fullscreen ? '✕ Plein écran' : '⛶' }}</button>
        </div>
      </div>

      <div v-if="!compact" class="toolbar" role="toolbar" aria-label="Dessin">
        <button
          v-for="t in TOOLS"
          :key="t.id"
          class="btn ghost small tool"
          :class="{ active: tool === t.id }"
          :title="t.label"
          :aria-label="t.label"
          :disabled="t.id !== 'deplacer' && analysis.locked"
          @click="tool = t.id"
        >
          {{ t.icon }}
        </button>
        <span class="sep"></span>
        <button
          v-for="c in COLORS"
          :key="c"
          class="swatch"
          :class="{ active: settings.drawColor === c }"
          :style="{ background: c }"
          :aria-label="`Couleur ${c}`"
          @click="settings.drawColor = c"
        ></button>
        <select v-model.number="settings.drawWidth" class="narrow" aria-label="Épaisseur">
          <option :value="2">fin</option>
          <option :value="4">moyen</option>
          <option :value="7">épais</option>
        </select>
        <select v-model.number="settings.drawHold" class="narrow" aria-label="Durée d’affichage des dessins">
          <option :value="0.25">0,25 s</option>
          <option :value="1">1 s</option>
          <option :value="3">3 s</option>
          <option :value="0">toujours</option>
        </select>
        <span class="sep"></span>
        <button class="btn ghost small" :disabled="!canUndo" title="Annuler (Ctrl+Z)" aria-label="Annuler" @click="doUndo">↶</button>
        <button class="btn ghost small" :disabled="!canRedo" title="Rétablir (Ctrl+Maj+Z)" aria-label="Rétablir" @click="doRedo">↷</button>
        <button class="btn ghost small" title="Effacer les dessins visibles" @click="clearFrameDrawings">Effacer</button>
        <button
          class="btn ghost small"
          :aria-pressed="analysis.locked"
          title="Verrouiller le calque de dessin"
          @click="update({ locked: !analysis.locked })"
        >
          {{ analysis.locked ? '🔒 Calque' : '🔓 Calque' }}
        </button>
      </div>
      <p v-if="estimated" class="small muted">Cadence estimée à 30 i/s : le conteneur de ce fichier n’a pas pu être lu.</p>
      <p v-else-if="source && !compact" class="small muted">
        Décodage {{ source.kind === 'webcodecs' ? 'WebCodecs (image exacte)' : 'vidéo + requestVideoFrameCallback (repli)' }} ·
        {{ timeline?.frameCount }} images · {{ frNumber(fps, fps % 1 ? 2 : 0) }} i/s{{ timeline?.variable ? ' (variable)' : '' }} · ±{{
          frNumber((1000 / fps) * scale, 1)
        }}
        ms par image
      </p>
    </template>
  </div>
</template>

<style scoped>
.player {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.player.fake-fullscreen,
.player:fullscreen {
  position: fixed;
  inset: 0;
  z-index: 500;
  background: var(--bg);
  padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
  overflow: auto;
}
.stage-wrap {
  display: flex;
  justify-content: center;
  background: var(--stage);
  border-radius: 12px;
  overflow: hidden;
}
.stage {
  position: relative;
  overflow: hidden;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  cursor: grab;
}
.stage.drawing {
  cursor: crosshair;
}
.viewport {
  position: absolute;
  inset: 0;
  transform-origin: 0 0;
}
.layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}
.layer.hidden {
  visibility: hidden;
}
.draw {
  pointer-events: none;
  overflow: visible;
}
.hud {
  position: absolute;
  left: 8px;
  top: 8px;
  right: 8px;
  display: flex;
  gap: 6px;
  align-items: center;
  pointer-events: none;
}
.hud > * {
  background: rgb(0 0 0 / 0.6);
  color: #fff;
  border-radius: 6px;
  padding: 2px 8px;
  font-size: 0.85rem;
}
.hud-tc {
  pointer-events: auto;
  border: 0;
  font-size: 1rem;
  cursor: pointer;
}
.stage-loading {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #fff;
}
.timebar {
  position: relative;
}
.timebar input {
  width: 100%;
  accent-color: var(--accent);
  min-height: 28px;
}
.marks {
  position: absolute;
  left: 8px;
  right: 8px;
  top: 0;
  height: 6px;
  pointer-events: none;
}
.marks > span {
  position: absolute;
  top: 0;
  height: 6px;
}
.mark {
  width: 2px;
  background: var(--accent);
}
.origin {
  width: 2px;
  background: var(--ok);
  height: 10px !important;
}
.loop {
  background: color-mix(in srgb, var(--accent) 40%, transparent);
}
.loop-edge {
  width: 2px;
  background: var(--accent);
}
.jog {
  height: 34px;
  border-radius: 8px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 6px;
  overflow: hidden;
  touch-action: none;
  cursor: ew-resize;
}
:global(html.terrain) .jog {
  height: 56px;
}
.tick {
  width: 2px;
  height: 60%;
  background: var(--border);
  border-radius: 1px;
}
.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  align-items: center;
  justify-content: space-between;
}
.play {
  width: calc(var(--tap) * 1.4);
  font-size: 1.1rem;
}
.speeds .btn {
  min-width: 44px;
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}
.tool {
  min-width: var(--tap);
  font-size: 1.05rem;
}
.sep {
  width: 1px;
  height: 24px;
  background: var(--border);
  margin: 0 4px;
}
.swatch {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid var(--border);
  cursor: pointer;
  padding: 0;
}
:global(html.terrain) .swatch {
  width: 40px;
  height: 40px;
}
.swatch.active {
  outline: 3px solid var(--accent);
  outline-offset: 1px;
}
.narrow {
  width: auto;
  min-height: calc(var(--tap) - 8px);
  padding: 2px 6px;
}
.compact .controls {
  gap: 4px;
}
</style>
