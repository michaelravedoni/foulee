<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue';
import {
  RATES,
  UndoStack,
  angleAt,
  createCalibration,
  formatMeasure,
  measureAngle,
  measureLength,
  arrowHead,
  eventLabel,
  formatTimecode,
  frNumber,
  hitDistance,
  isAnnotationVisible,
  newId,
  normalizeLoop,
  realTimeScale,
  simplifyPath,
  stepRate,
  type Analysis,
  type Annotation,
  type Trajectory,
  type FrameTimeline,
  type MediaInfo,
  type Point,
  type ShapeKind,
  type TimecodeMode,
} from '@foulee/core';
import { openFrameSource, type FrameSource, type PlayHandle } from '@foulee/media';
import { settings } from '../store/settings';
import { isTypingTarget } from '../lib/keys';
import Ico from './Ico.vue';

export interface ZoomState {
  scale: number;
  x: number;
  y: number;
}

const props = withDefaults(
  defineProps<{
    media: MediaInfo;
    original: Blob;
    /** Réservé : la lecture se fait par décodage de l'original. */
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

type Tool = 'deplacer' | ShapeKind | 'gomme' | 'etalon' | 'trajectoire';
const TOOLS: { id: Tool; label: string; icon: string }[] = [
  { id: 'deplacer', label: 'Déplacer, zoomer, parcourir', icon: 'hand' },
  { id: 'ligne', label: 'Ligne', icon: 'line' },
  { id: 'fleche', label: 'Flèche', icon: 'arrow' },
  { id: 'main', label: 'Main levée', icon: 'pen' },
  { id: 'cercle', label: 'Cercle', icon: 'circle' },
  { id: 'rectangle', label: 'Rectangle', icon: 'rect' },
  { id: 'angle', label: 'Angle (3 points)', icon: 'angle' },
  { id: 'texte', label: 'Texte', icon: 'text' },
  { id: 'etalon', label: 'Étalon : segment de longueur connue', icon: 'ruler' },
  { id: 'trajectoire', label: 'Trajectoire : un point par image', icon: 'target' },
  { id: 'gomme', label: 'Gomme', icon: 'erase' },
];
const COLORS = ['#ff3b30', '#ffcc00', '#34c759', '#0a84ff', '#ffffff', '#000000'];
const SPEED_LABELS: Record<number, string> = { 0.05: '0,05×', 0.1: '0,1×', 0.25: '0,25×', 0.5: '0,5×', 1: '1×', 2: '2×' };

const root = ref<HTMLDivElement>();
const stage = ref<HTMLDivElement>();
const viewport = ref<HTMLDivElement>();
const canvas = ref<HTMLCanvasElement>();
const scrub = ref<HTMLDivElement>();

const source = shallowRef<FrameSource | null>(null);
const timeline = shallowRef<FrameTimeline | null>(null);
const loadError = ref('');
const playError = ref('');
const estimated = ref(false);
const compat = ref(false);
const frame = ref(0);
const playing = ref(false);
const rate = ref(settings.rate);
const loopA = ref<number | null>(null);
const loopB = ref<number | null>(null);
const tool = ref<Tool>('deplacer');
const timecodeMode = ref<TimecodeMode>(settings.timecode);
const fullscreen = ref(false);
const fakeFullscreen = ref(false);
const localZoom = reactive<ZoomState>({ scale: 1, x: 0, y: 0 });
const zoom = computed<ZoomState>(() => props.zoom ?? localZoom);

const W = computed(() => props.media.width || source.value?.width || 1920);
const H = computed(() => props.media.height || source.value?.height || 1080);
const fps = computed(() => timeline.value?.nominalFps ?? props.media.nominalFps);
const scale = computed(() => realTimeScale(fps.value, props.captureFps));
const lastFrame = computed(() => Math.max(0, (timeline.value?.frameCount ?? 1) - 1));
const loop = computed(() => normalizeLoop(loopA.value, loopB.value, lastFrame.value));

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

// ——— Ouverture de la source ———

let opened = 0;
async function openSource(forceFallback: boolean) {
  const token = ++opened;
  loadError.value = '';
  playError.value = '';
  const resumeAt = timeline.value ? frame.value : props.analysis.timeOrigin || 0;
  stopPlayback();
  source.value?.dispose();
  source.value = null;
  try {
    const o = await openFrameSource(props.original, { forceFallback });
    if (token !== opened) {
      o.source.dispose();
      return;
    }
    source.value = o.source;
    timeline.value = o.source.timeline;
    estimated.value = o.estimated;
    compat.value = o.source.kind !== 'webcodecs';
    await nextTick();
    if (canvas.value) {
      canvas.value.width = o.source.width;
      canvas.value.height = o.source.height;
    }
    emit('ready', o.source.timeline);
    await showFrame(resumeAt);
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e);
  }
}

onMounted(() => {
  void openSource(false);
  if (props.keyboard) window.addEventListener('keydown', onKey);
  document.addEventListener('fullscreenchange', onFsChange);
});

onBeforeUnmount(() => {
  opened++;
  stopPlayback();
  stopRepeat();
  source.value?.dispose();
  cancelAnimationFrame(uiRaf);
  window.removeEventListener('keydown', onKey);
  document.removeEventListener('fullscreenchange', onFsChange);
});

// ——— Image exacte (à l'arrêt) ———

let drawSeq = 0;
async function showFrame(i: number): Promise<void> {
  const src = source.value;
  const tl = timeline.value;
  if (!src || !tl) return;
  const target = tl.clamp(i);
  setFrameNow(target);
  const seq = ++drawSeq;
  try {
    const img = await src.getFrame(target);
    if (!img || seq !== drawSeq || !canvas.value || playing.value) return;
    canvas.value.getContext('2d')?.drawImage(img, 0, 0, canvas.value.width, canvas.value.height);
    playError.value = '';
  } catch (e) {
    playError.value = `Image ${target} illisible : ${e instanceof Error ? e.message : String(e)}`;
  }
}

function setFrameNow(f: number) {
  frame.value = f;
  emit('frame', f);
}

function seek(i: number) {
  pause();
  void showFrame(i);
}
function step(n: number) {
  pause();
  void showFrame(frame.value + n);
}

// ——— Lecture : décodage cadencé sur l'horloge, un seul canvas ———

let handle: PlayHandle | null = null;
let uiRaf = 0;
let pendingFrame = -1;

/** Le canvas est dessiné à chaque image ; l'interface (temps, curseur) au plus une fois par trame d'affichage. */
function queueUi(idx: number) {
  pendingFrame = idx;
  if (uiRaf) return;
  uiRaf = requestAnimationFrame(() => {
    uiRaf = 0;
    if (playing.value && pendingFrame >= 0) setFrameNow(pendingFrame);
  });
}

function startPlayback() {
  const src = source.value;
  const tl = timeline.value;
  if (!src || !tl || playing.value) return;
  const l = loop.value;
  let from = frame.value;
  const end = l ? l.b : lastFrame.value;
  if (from >= end || (l && from < l.a)) from = l ? l.a : 0;
  playing.value = true;
  playError.value = '';
  const ctx = canvas.value?.getContext('2d');
  handle = src.play({
    from,
    rate: rate.value,
    loop: l,
    onFrame: (idx, draw) => {
      if (ctx && canvas.value) draw(ctx, canvas.value.width, canvas.value.height);
      queueUi(idx);
    },
    onEnd: (reason, error) => {
      handle = null;
      playing.value = false;
      if (pendingFrame >= 0) setFrameNow(pendingFrame);
      if (reason === 'error') playError.value = `Lecture interrompue : ${error?.message ?? 'erreur de décodage'}`;
    },
  });
}

function stopPlayback() {
  handle?.stop();
  handle = null;
  playing.value = false;
  cancelAnimationFrame(uiRaf);
  uiRaf = 0;
  if (pendingFrame >= 0 && timeline.value) setFrameNow(pendingFrame);
  pendingFrame = -1;
}

function pause() {
  if (playing.value) stopPlayback();
}
function play() {
  startPlayback();
}
function togglePlay() {
  if (playing.value) pause();
  else play();
}

/** Redémarre la lecture avec de nouveaux réglages (vitesse, boucle) sans saut visible. */
function restartIfPlaying() {
  if (!playing.value) return;
  stopPlayback();
  startPlayback();
}

function setRate(r: number) {
  rate.value = r;
  settings.rate = r;
  restartIfPlaying();
}

// ——— Boucle A-B, origine ———

function setLoopA() {
  loopA.value = frame.value;
  if (loopB.value !== null && loopB.value <= frame.value) loopB.value = null;
  restartIfPlaying();
}
function setLoopB() {
  loopB.value = frame.value;
  if (loopA.value !== null && loopA.value >= frame.value) loopA.value = null;
  restartIfPlaying();
}
function clearLoop() {
  loopA.value = null;
  loopB.value = null;
  restartIfPlaying();
}
function setOrigin() {
  update({ timeOrigin: frame.value });
}
function cycleTimecode() {
  const modes: TimecodeMode[] = ['ms', 'image', 'hms'];
  timecodeMode.value = modes[(modes.indexOf(timecodeMode.value) + 1) % modes.length]!;
  settings.timecode = timecodeMode.value;
}

// ——— Répétition au maintien des boutons image ———

let repeatTimer = 0;
let repeatInterval = 0;
function startRepeat(dir: number, e: PointerEvent) {
  e.preventDefault();
  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  step(dir);
  stopRepeat();
  repeatTimer = window.setTimeout(() => {
    repeatInterval = window.setInterval(() => {
      const next = frame.value + Math.sign(dir);
      if (next < 0 || next > lastFrame.value) return stopRepeat();
      void showFrame(next);
    }, 60);
  }, 380);
}
function stopRepeat() {
  clearTimeout(repeatTimer);
  clearInterval(repeatInterval);
  repeatTimer = 0;
  repeatInterval = 0;
}
function keyboardClick(dir: 1 | -1 | 10 | -10, e: MouseEvent) {
  // Les clics souris/tactile sont gérés par pointerdown ; ici seulement le clavier.
  if (e.detail === 0) step(dir);
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

// ——— Saisie au pointeur sur l'image : dessin, parcours, zoom ———

const pointers = new Map<number, Point>();
let pinchStart: { dist: number; mid: Point; zoom: ZoomState } | null = null;
let panStart: { p: Point; zoom: ZoomState } | null = null;
let scrubStart: { x: number; frame: number; moved: boolean; t: number } | null = null;
let lastTap = 0;
const draft = ref<Annotation | null>(null);
let angleStage = 0;

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
  if (e.ctrlKey || e.metaKey || zoom.value.scale > 1 || Math.abs(e.deltaY) > Math.abs(e.deltaX) * 2) {
    const r = stage.value!.getBoundingClientRect();
    zoomAt({ x: e.clientX - r.left, y: e.clientY - r.top }, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025)));
  } else {
    // glissement horizontal du pavé tactile : parcours image par image
    step(Math.sign(e.deltaX));
  }
}

const drawingEnabled = computed(() => tool.value !== 'deplacer' && !props.analysis.locked);
const pxPerFrame = computed(() => (settings.terrain ? 9 : 6));

function holdFrames(): number | null {
  return settings.drawHold > 0 ? Math.round(settings.drawHold * fps.value) : null;
}

function onPointerDown(e: PointerEvent) {
  stage.value?.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, stagePoint(e));
  if (pointers.size === 2) {
    draft.value = null;
    angleStage = 0;
    scrubStart = null;
    const [a, b] = [...pointers.values()] as [Point, Point];
    pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, zoom: { ...zoom.value } };
    panStart = null;
    return;
  }
  if (pointers.size > 2) return;
  if (!drawingEnabled.value) {
    const p = stagePoint(e);
    if (zoom.value.scale > 1) panStart = { p, zoom: { ...zoom.value } };
    scrubStart = { x: p.x, frame: frame.value, moved: false, t: performance.now() };
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
  if (t === 'etalon') {
    etalonDraft.value = { a: p, b: p };
    return;
  }
  if (t === 'trajectoire') {
    addTrackPoint(p);
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
  if (!drawingEnabled.value) {
    const p = stagePoint(e);
    if (scrubStart && Math.abs(p.x - scrubStart.x) > 8) scrubStart.moved = true;
    if (panStart) {
      setZoom({ ...panStart.zoom, x: panStart.zoom.x + p.x - panStart.p.x, y: panStart.zoom.y + p.y - panStart.p.y });
    } else if (scrubStart?.moved) {
      // Balayage horizontal : une image tous les quelques pixels (image non zoomée).
      if (playing.value) pause();
      const delta = Math.round((p.x - scrubStart.x) / pxPerFrame.value);
      const target = timeline.value?.clamp(scrubStart.frame + delta) ?? 0;
      if (target !== frame.value) void showFrame(target);
    }
    return;
  }
  if (etalonDraft.value) {
    etalonDraft.value = { a: etalonDraft.value.a, b: videoPoint(e) };
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
  const wasDown = pointers.has(e.pointerId);
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchStart = null;
  if (pointers.size === 0) panStart = null;
  if (!wasDown) return;

  if (!drawingEnabled.value) {
    const s = scrubStart;
    scrubStart = null;
    if (s && !s.moved && pointers.size === 0 && performance.now() - s.t < 350 && e.type === 'pointerup') {
      const now = performance.now();
      if (now - lastTap < 320) {
        // double toucher : zoom ×3 à cet endroit, ou retour à 1×
        lastTap = 0;
        if (zoom.value.scale > 1) setZoom({ scale: 1, x: 0, y: 0 });
        else zoomAt(stagePoint(e), 3);
      } else {
        lastTap = now;
        if (playing.value) pause(); // un toucher pendant la lecture met en pause
      }
    }
    return;
  }

  if (etalonDraft.value) {
    const { a, b } = etalonDraft.value;
    etalonDraft.value = null;
    finishEtalon(a, b);
    return;
  }
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
      angleStage = 1;
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

// ——— Mesures : étalon, longueurs, trajectoires ———

const etalonDraft = ref<{ a: Point; b: Point } | null>(null);
const calibration = computed(() => props.analysis.calibration);
const trajectories = computed(() => props.analysis.trajectories ?? []);
const activeTrack = ref<string | null>(null);

function finishEtalon(a: Point, b: Point) {
  if (Math.hypot(b.x - a.x, b.y - a.y) < W.value * 0.01) return;
  const raw = window.prompt('Longueur réelle de ce segment, en mètres (ex. 10 pour deux plots à 10 m)');
  const meters = Number(raw?.replace(',', '.'));
  const cal = createCalibration(a, b, meters);
  if (!cal) return;
  update({ calibration: cal });
  tool.value = 'deplacer';
}
function removeCalibration() {
  const { calibration: _drop, ...rest } = props.analysis;
  emit('update:analysis', rest as Analysis);
}

function setTrajectories(next: Trajectory[]) {
  update({ trajectories: next });
}
function addTrackPoint(p: Point) {
  const list = [...trajectories.value];
  let tr = list.find((t) => t.id === activeTrack.value);
  if (!tr) {
    tr = { id: newId('trj'), label: `Trajectoire ${list.length + 1}`, color: settings.drawColor, points: [] };
    list.push(tr);
    activeTrack.value = tr.id;
  }
  const f = frame.value;
  tr.points = [...tr.points.filter((q) => q.frame !== f), { frame: f, x: p.x, y: p.y }].sort((a, b) => a.frame - b.frame);
  setTrajectories(list.map((t) => (t.id === tr!.id ? tr! : t)));
  // Passe à l'image suivante pour pointer la suivante.
  if (f < lastFrame.value) void showFrame(f + 1);
}
function newTrack() {
  activeTrack.value = null;
}
function undoTrackPoint() {
  const tr = trajectories.value.find((t) => t.id === activeTrack.value) ?? trajectories.value[trajectories.value.length - 1];
  if (!tr) return;
  const points = tr.points.slice(0, -1);
  const last = tr.points[tr.points.length - 1];
  setTrajectories(points.length ? trajectories.value.map((t) => (t.id === tr.id ? { ...t, points } : t)) : trajectories.value.filter((t) => t.id !== tr.id));
  if (last) void showFrame(last.frame);
}
function trackPath(t: Trajectory): string {
  return t.points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
}
function lengthText(a: Annotation): string {
  const cal = calibration.value;
  if (!cal || a.points.length < 2) return '';
  return formatMeasure(measureLength(a.points[0]!, a.points[1]!, cal), 'm', frNumber);
}
function mid(a: Annotation): Point {
  return { x: (a.points[0]!.x + a.points[1]!.x) / 2, y: (a.points[0]!.y + a.points[1]!.y) / 2 };
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
  return formatMeasure(measureAngle(a.points[0]!, a.points[1]!, a.points[2]!, calibration.value?.clickErrorPx), '°', frNumber, 1);
}
const fontSize = computed(() => Math.max(W.value, H.value) * 0.028);

// ——— Barre de temps : pointeur capturé, repères, boucle A-B glissable ———

const markers = computed(() => props.analysis.events.map((ev) => ({ id: ev.id, frame: ev.frame, label: eventLabel(ev.type, ev.side) })));
function pct(f: number) {
  return `${(f / Math.max(1, lastFrame.value)) * 100}%`;
}
function frameFromX(clientX: number): number {
  const r = scrub.value!.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  return Math.round(ratio * lastFrame.value);
}
let scrubbing = false;
function scrubDown(e: PointerEvent) {
  if ((e.target as HTMLElement).closest('.handle')) return;
  scrub.value?.setPointerCapture(e.pointerId);
  scrubbing = true;
  pause();
  void showFrame(frameFromX(e.clientX));
}
function scrubMove(e: PointerEvent) {
  if (scrubbing) void showFrame(frameFromX(e.clientX));
}
function scrubUp() {
  scrubbing = false;
}
let dragHandle: 'A' | 'B' | null = null;
function handleDown(which: 'A' | 'B', e: PointerEvent) {
  e.stopPropagation();
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  dragHandle = which;
}
function handleMove(e: PointerEvent) {
  if (!dragHandle) return;
  const f = frameFromX(e.clientX);
  if (dragHandle === 'A') loopA.value = loopB.value !== null ? Math.min(f, loopB.value - 1) : f;
  else loopB.value = loopA.value !== null ? Math.max(f, loopA.value + 1) : f;
}
function handleUp() {
  if (dragHandle) restartIfPlaying();
  dragHandle = null;
}
function onScrubKey(e: KeyboardEvent) {
  const big = e.shiftKey ? 10 : 1;
  if (e.key === 'ArrowRight') {
    e.preventDefault();
    e.stopPropagation();
    step(big);
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    e.stopPropagation();
    step(-big);
  }
}

// ——— Molette (jog) ———

let jogStart: { x: number; frame: number } | null = null;
function jogDown(e: PointerEvent) {
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  pause();
  jogStart = { x: e.clientX, frame: frame.value };
}
function jogMove(e: PointerEvent) {
  if (!jogStart) return;
  const delta = Math.round((e.clientX - jogStart.x) / pxPerFrame.value);
  const target = timeline.value?.clamp(jogStart.frame + delta) ?? 0;
  if (target !== frame.value) void showFrame(target);
}
function jogUp() {
  jogStart = null;
}

// ——— Plein écran et clavier ———

function toggleFullscreen() {
  const el = root.value;
  if (!el) return;
  if (fakeFullscreen.value) {
    fakeFullscreen.value = false;
    fullscreen.value = false;
  } else if (document.fullscreenElement) void document.exitFullscreen();
  else if (el.requestFullscreen) el.requestFullscreen().catch(() => (fakeFullscreen.value = fullscreen.value = true));
  else fakeFullscreen.value = fullscreen.value = true;
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
    case 'k':
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
    case 'ArrowUp':
      e.preventDefault();
      setRate(stepRate(rate.value, 1));
      break;
    case 'ArrowDown':
      e.preventDefault();
      setRate(stepRate(rate.value, -1));
      break;
    case 'Home':
      seek(loop.value?.a ?? 0);
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
    case '=':
      setRate(stepRate(rate.value, 1));
      break;
    case '-':
      setRate(stepRate(rate.value, -1));
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
      if (fakeFullscreen.value) toggleFullscreen();
      tool.value = 'deplacer';
      draft.value = null;
      angleStage = 0;
      break;
  }
}

watch(
  () => props.original,
  () => void openSource(compat.value),
);

function toggleCompat() {
  void openSource(!compat.value);
}

defineExpose({ frame, timeline, playing, rate, seek, step, play, pause, setRate, showFrame });

const stageStyle = computed(() => ({
  aspectRatio: `${W.value} / ${H.value}`,
  width: fakeFullscreen.value || fullscreen.value
    ? `min(100%, calc((100dvh - 210px) * ${W.value / H.value}))`
    : `min(100%, calc(${props.compact ? '42dvh' : '62dvh'} * ${W.value / H.value}))`,
}));
const viewportStyle = computed(() => ({
  transform: `translate(${zoom.value.x}px, ${zoom.value.y}px) scale(${zoom.value.scale})`,
}));
</script>

<template>
  <div ref="root" class="player" :class="{ compact, 'fake-fullscreen': fakeFullscreen, playing }">
    <div v-if="loadError" class="empty">
      <strong>Vidéo illisible sur cet appareil.</strong><br />
      {{ loadError }}
      <div class="row center" style="margin-top: 12px">
        <button class="btn secondary small" @click="openSource(true)">Essayer le mode compatibilité</button>
      </div>
    </div>
    <template v-else>
      <div class="stage-wrap">
        <div
          ref="stage"
          class="stage"
          :class="{ drawing: drawingEnabled, zoomed: zoom.scale > 1 }"
          :style="stageStyle"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
          @wheel="onWheel"
        >
          <div ref="viewport" class="viewport" :style="viewportStyle">
            <canvas ref="canvas" class="layer"></canvas>
            <svg class="layer draw" :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none">
              <g v-for="a in draft ? [...visibleAnnotations, draft] : visibleAnnotations" :key="a.id" :stroke="a.color" fill="none">
                <template v-if="a.kind === 'ligne'">
                  <path :d="pathOf(a)" :stroke-width="a.width" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round" />
                  <text v-if="calibration && a.points.length >= 2" :x="mid(a).x" :y="mid(a).y - fontSize * 0.5" :font-size="fontSize" :fill="a.color" stroke="#000" :stroke-width="fontSize * 0.08" paint-order="stroke" font-weight="700" text-anchor="middle">{{ lengthText(a) }}</text>
                </template>
                <path v-else-if="a.kind === 'main'" :d="pathOf(a)" :stroke-width="a.width" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round" />
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
              <g v-if="calibration || etalonDraft" class="etalon" stroke="#00e5ff" fill="none">
                <path
                  :d="etalonDraft ? `M${etalonDraft.a.x} ${etalonDraft.a.y} L${etalonDraft.b.x} ${etalonDraft.b.y}` : `M${calibration!.a.x} ${calibration!.a.y} L${calibration!.b.x} ${calibration!.b.y}`"
                  stroke-width="3"
                  stroke-dasharray="10 6"
                  vector-effect="non-scaling-stroke"
                />
                <circle :cx="(etalonDraft ?? calibration!).a.x" :cy="(etalonDraft ?? calibration!).a.y" :r="fontSize * 0.2" fill="#00e5ff" stroke="none" />
                <circle :cx="(etalonDraft ?? calibration!).b.x" :cy="(etalonDraft ?? calibration!).b.y" :r="fontSize * 0.2" fill="#00e5ff" stroke="none" />
                <text v-if="calibration && !etalonDraft" :x="(calibration.a.x + calibration.b.x) / 2" :y="(calibration.a.y + calibration.b.y) / 2 - fontSize * 0.5" :font-size="fontSize" fill="#00e5ff" stroke="#000" :stroke-width="fontSize * 0.08" paint-order="stroke" font-weight="700" text-anchor="middle">étalon {{ frNumber(calibration.meters, 2) }} m</text>
              </g>
              <g v-for="t in trajectories" :key="t.id" :stroke="t.color" fill="none">
                <path :d="trackPath(t)" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" opacity="0.8" />
                <circle v-for="q in t.points" :key="q.frame" :cx="q.x" :cy="q.y" :r="q.frame === frame ? fontSize * 0.32 : fontSize * 0.16" :fill="q.frame === frame ? t.color : 'none'" stroke-width="2" vector-effect="non-scaling-stroke" />
              </g>
            </svg>
          </div>

          <div class="hud">
            <button class="hud-tc mono" title="Changer l’affichage du temps" @pointerdown.stop @click="cycleTimecode">{{ timecode }}</button>
            <span class="hud-frame mono">{{ frame }} / {{ lastFrame }}</span>
            <span v-if="label" class="hud-label">{{ label }}</span>
            <span v-if="zoom.scale > 1" class="hud-zoom">×{{ frNumber(zoom.scale, 1) }}</span>
            <span v-if="playing" class="hud-rate">{{ SPEED_LABELS[rate] ?? `${frNumber(rate, 2)}×` }}</span>
          </div>

          <div v-if="!source" class="stage-loading">Lecture du fichier…</div>
        </div>
      </div>

      <p v-if="playError" class="banner warn" role="alert">
        {{ playError }}
        <button v-if="!compat" class="btn small" @click="openSource(true)">Mode compatibilité</button>
      </p>

      <div class="timeline">
        <div
          ref="scrub"
          class="scrub"
          tabindex="0"
          role="slider"
          aria-label="Position dans la vidéo"
          :aria-valuemin="0"
          :aria-valuemax="lastFrame"
          :aria-valuenow="frame"
          @pointerdown="scrubDown"
          @pointermove="scrubMove"
          @pointerup="scrubUp"
          @pointercancel="scrubUp"
          @keydown="onScrubKey"
        >
          <div class="track">
            <div class="fill" :style="{ width: pct(frame) }"></div>
            <div v-if="loop" class="loop" :style="{ left: pct(loop.a), width: `calc(${pct(loop.b)} - ${pct(loop.a)})` }"></div>
            <span class="origin" :style="{ left: pct(analysis.timeOrigin) }" title="t = 0"></span>
            <span v-for="m in markers" :key="m.id" class="mark" :style="{ left: pct(m.frame) }" :title="m.label"></span>
          </div>
          <div class="thumb" :style="{ left: pct(frame) }"></div>
          <button
            v-if="loopA !== null"
            class="handle a"
            :style="{ left: pct(loopA) }"
            aria-label="Début de boucle"
            @pointerdown="handleDown('A', $event)"
            @pointermove="handleMove"
            @pointerup="handleUp"
            @pointercancel="handleUp"
          >A</button>
          <button
            v-if="loopB !== null"
            class="handle b"
            :style="{ left: pct(loopB) }"
            aria-label="Fin de boucle"
            @pointerdown="handleDown('B', $event)"
            @pointermove="handleMove"
            @pointerup="handleUp"
            @pointercancel="handleUp"
          >B</button>
        </div>
      </div>

      <div class="transport">
        <div class="group">
          <button class="btn secondary icon" title="Début (Origine)" aria-label="Aller au début" @click="seek(loop?.a ?? 0)"><Ico name="start" /></button>
          <button class="btn secondary icon" title="−10 images (Maj+←)" aria-label="Reculer de 10 images" @pointerdown="startRepeat(-10, $event)" @pointerup="stopRepeat" @pointercancel="stopRepeat" @click="keyboardClick(-10, $event)"><Ico name="back" /></button>
          <button class="btn secondary icon" title="Image précédente (←)" aria-label="Image précédente" @pointerdown="startRepeat(-1, $event)" @pointerup="stopRepeat" @pointercancel="stopRepeat" @click="keyboardClick(-1, $event)"><Ico name="prev" /></button>
          <button class="btn icon play" :title="playing ? 'Pause (Espace)' : 'Lecture (Espace)'" :aria-label="playing ? 'Pause' : 'Lecture'" @click="togglePlay">
            <Ico :name="playing ? 'pause' : 'play'" :size="26" />
          </button>
          <button class="btn secondary icon" title="Image suivante (→)" aria-label="Image suivante" @pointerdown="startRepeat(1, $event)" @pointerup="stopRepeat" @pointercancel="stopRepeat" @click="keyboardClick(1, $event)"><Ico name="next" /></button>
          <button class="btn secondary icon" title="+10 images (Maj+→)" aria-label="Avancer de 10 images" @pointerdown="startRepeat(10, $event)" @pointerup="stopRepeat" @pointercancel="stopRepeat" @click="keyboardClick(10, $event)"><Ico name="fwd" /></button>
          <button class="btn secondary icon" title="Fin" aria-label="Aller à la fin" @click="seek(loop?.b ?? lastFrame)"><Ico name="end" /></button>
        </div>
        <div class="group seg" role="group" aria-label="Vitesse">
          <button v-for="s in RATES" :key="s" class="seg-btn" :class="{ active: rate === s }" :aria-pressed="rate === s" @click="setRate(s)">
            {{ SPEED_LABELS[s] }}
          </button>
        </div>
        <div v-if="!compact" class="group">
          <button class="btn ghost small" :class="{ active: loopA !== null }" title="Début de boucle ([)" @click="setLoopA">A</button>
          <button class="btn ghost small" :class="{ active: loopB !== null }" title="Fin de boucle (])" @click="setLoopB">B</button>
          <button class="btn ghost small" :disabled="loopA === null && loopB === null" title="Effacer la boucle (\)" aria-label="Effacer la boucle" @click="clearLoop"><Ico name="loop" :size="16" /> ✕</button>
          <button class="btn ghost small" title="Définir l’image courante comme t = 0 (touche 0)" @click="setOrigin">t = 0</button>
          <button class="btn ghost small icon" :title="fullscreen || fakeFullscreen ? 'Quitter le plein écran (F)' : 'Plein écran (F)'" aria-label="Plein écran" @click="toggleFullscreen"><Ico :name="fullscreen || fakeFullscreen ? 'exit' : 'full'" :size="18" /></button>
        </div>
      </div>

      <div v-if="!compact" class="jog" role="slider" aria-label="Molette : glisser pour avancer image par image" :aria-valuenow="frame" @pointerdown="jogDown" @pointermove="jogMove" @pointerup="jogUp" @pointercancel="jogUp">
        <span v-for="i in 48" :key="i" class="tick" :class="{ major: (i + frame) % 6 === 0 }" :style="{ transform: `translateX(${-(frame % 6) * 2}px)` }"></span>
      </div>

      <div v-if="!compact" class="toolbar" role="toolbar" aria-label="Dessin">
        <button
          v-for="t in TOOLS"
          :key="t.id"
          class="btn ghost small tool"
          :class="{ active: tool === t.id }"
          :title="t.label"
          :aria-label="t.label"
          :aria-pressed="tool === t.id"
          :disabled="t.id !== 'deplacer' && analysis.locked"
          @click="tool = t.id"
        >
          <Ico :name="t.icon" :size="20" />
        </button>
        <template v-if="tool === 'trajectoire'">
          <span class="sep"></span>
          <button class="btn ghost small" @click="newTrack">Nouvelle</button>
          <button class="btn ghost small" @click="undoTrackPoint">Retirer le dernier point</button>
        </template>
        <button v-if="calibration && tool === 'etalon'" class="btn ghost small" @click="removeCalibration">Retirer l’étalon</button>
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
        <button class="btn ghost small icon" :disabled="!canUndo" title="Annuler (Ctrl+Z)" aria-label="Annuler" @click="doUndo"><Ico name="undo" :size="18" /></button>
        <button class="btn ghost small icon" :disabled="!canRedo" title="Rétablir (Ctrl+Maj+Z)" aria-label="Rétablir" @click="doRedo"><Ico name="redo" :size="18" /></button>
        <button class="btn ghost small" title="Effacer les dessins visibles" @click="clearFrameDrawings">Effacer</button>
        <button class="btn ghost small" :aria-pressed="analysis.locked" title="Verrouiller le calque de dessin" @click="update({ locked: !analysis.locked })">
          <Ico :name="analysis.locked ? 'lock' : 'unlock'" :size="16" /> Calque
        </button>
      </div>

      <p v-if="estimated" class="small muted">Cadence estimée à 30 i/s : le conteneur de ce fichier n’a pas pu être lu.</p>
      <p v-else-if="source && !compact" class="small muted info-line">
        <span>
          {{ source.kind === 'webcodecs' ? 'Décodage WebCodecs (image exacte)' : 'Mode compatibilité (élément vidéo)' }} ·
          {{ timeline?.frameCount }} images · {{ frNumber(fps, fps % 1 ? 2 : 0) }} i/s{{ timeline?.variable ? ' (variable)' : '' }} · ±{{ frNumber((1000 / fps) * scale, 1) }} ms par image
        </span>
        <button class="btn ghost small" @click="toggleCompat">{{ compat ? 'Revenir au décodage exact' : 'Mode compatibilité' }}</button>
      </p>
      <p v-if="!compact" class="small muted keys">
        Espace lecture · ← → image · Maj+← → 10 images · ↑ ↓ vitesse · [ ] boucle · 0 origine · F plein écran · glisser sur l’image pour parcourir · pincer ou double-toucher pour zoomer
      </p>
    </template>
  </div>
</template>

<style scoped>
.player {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.player.fake-fullscreen,
.player:fullscreen {
  position: fixed;
  inset: 0;
  z-index: 500;
  background: var(--bg);
  padding: calc(8px + env(safe-area-inset-top)) calc(8px + env(safe-area-inset-right)) calc(8px + env(safe-area-inset-bottom)) calc(8px + env(safe-area-inset-left));
  overflow: auto;
}
.stage-wrap {
  display: flex;
  justify-content: center;
  background: var(--stage);
  border-radius: 14px;
  overflow: hidden;
}
.stage {
  position: relative;
  overflow: hidden;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  cursor: ew-resize;
}
.stage.zoomed {
  cursor: grab;
}
.stage.drawing {
  cursor: crosshair;
}
.viewport {
  position: absolute;
  inset: 0;
  transform-origin: 0 0;
  will-change: transform;
}
.layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}
.draw {
  pointer-events: none;
  overflow: visible;
}
.hud {
  position: absolute;
  left: 10px;
  top: 10px;
  right: 10px;
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
  pointer-events: none;
}
.hud > * {
  background: rgb(0 0 0 / 0.62);
  color: #fff;
  border-radius: 8px;
  padding: 3px 9px;
  font-size: 0.85rem;
  backdrop-filter: blur(6px);
}
.hud-tc {
  pointer-events: auto;
  border: 0;
  font-size: 1.05rem;
  cursor: pointer;
  min-width: 7ch;
  text-align: left;
}
.hud-frame {
  color: #cfd8e1;
}
.hud-rate {
  background: var(--accent);
  color: var(--accent-text);
  font-weight: 700;
}
.bigplay {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 76px;
  height: 76px;
  border-radius: 50%;
  border: 0;
  background: rgb(0 0 0 / 0.5);
  color: #fff;
  display: grid;
  place-items: center;
  cursor: pointer;
  backdrop-filter: blur(6px);
  transition: transform 0.12s, background 0.12s;
}
.bigplay:hover {
  background: var(--accent);
  transform: translate(-50%, -50%) scale(1.06);
}
.stage-loading {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #fff;
}

.timeline {
  padding: 0 2px;
}
.scrub {
  position: relative;
  height: 40px;
  touch-action: none;
  cursor: pointer;
  outline-offset: 2px;
}
.track {
  position: absolute;
  left: 0;
  right: 0;
  top: 15px;
  height: 10px;
  border-radius: 5px;
  background: var(--surface-2);
  border: 1px solid var(--border);
}
.fill {
  position: absolute;
  inset: 0 auto 0 0;
  background: color-mix(in srgb, var(--accent) 55%, transparent);
  border-radius: 5px;
}
.loop {
  position: absolute;
  top: -1px;
  bottom: -1px;
  background: color-mix(in srgb, var(--ok) 35%, transparent);
  border-radius: 3px;
}
.track .mark {
  position: absolute;
  top: -6px;
  width: 3px;
  height: 22px;
  margin-left: -1px;
  background: var(--accent);
  border-radius: 2px;
}
.track .origin {
  position: absolute;
  top: -8px;
  width: 2px;
  height: 26px;
  margin-left: -1px;
  background: var(--ok);
}
.thumb {
  position: absolute;
  top: 8px;
  width: 22px;
  height: 22px;
  margin-left: -11px;
  border-radius: 50%;
  background: var(--accent);
  border: 3px solid var(--surface);
  box-shadow: 0 1px 4px rgb(0 0 0 / 0.4);
  pointer-events: none;
}
.handle {
  position: absolute;
  top: 0;
  width: 24px;
  height: 18px;
  margin-left: -12px;
  padding: 0;
  border: 0;
  border-radius: 5px 5px 2px 2px;
  background: var(--ok);
  color: #fff;
  font-size: 0.7rem;
  font-weight: 800;
  cursor: ew-resize;
  touch-action: none;
}
.handle.b {
  background: var(--warn);
}

.transport {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  align-items: center;
  justify-content: space-between;
}
.group {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}
.play {
  width: calc(var(--tap) * 1.5);
}
.seg {
  gap: 0;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 3px;
}
.seg-btn {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  padding: 0 10px;
  min-height: calc(var(--tap) - 12px);
  min-width: 46px;
  border-radius: 8px;
  cursor: pointer;
  touch-action: manipulation;
}
.seg-btn.active {
  background: var(--accent);
  color: var(--accent-text);
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
.tick {
  width: 2px;
  height: 40%;
  background: var(--border);
  border-radius: 1px;
}
.tick.major {
  height: 70%;
  background: var(--muted);
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}
.tool {
  min-width: var(--tap);
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
.swatch.active {
  outline: 3px solid var(--accent);
  outline-offset: 1px;
}
.narrow {
  width: auto;
  min-height: calc(var(--tap) - 8px);
  padding: 2px 6px;
}
.info-line {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  margin: 0;
}
.keys {
  margin: 0;
}
.center {
  justify-content: center;
}
.compact .transport {
  gap: 6px;
}
.compact .seg-btn {
  min-width: 38px;
  padding: 0 6px;
}
@media (max-width: 720px) {
  .keys {
    display: none;
  }
}
</style>
