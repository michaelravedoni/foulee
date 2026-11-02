import { reactive, watch } from 'vue';
import type { TimecodeMode } from '@foulee/core';

/** Préférences propres à cet appareil (pas dans le coffre). */
interface Settings {
  terrain: boolean;
  autoProxy: boolean;
  timecode: TimecodeMode;
  drawColor: string;
  drawWidth: number;
  /** Durée d'affichage des dessins (s) ; 0 = toujours visible. */
  drawHold: number;
  replayDelays: number[];
  replayViews: number;
}

const DEFAULTS: Settings = {
  terrain: false,
  autoProxy: true,
  timecode: 'ms',
  drawColor: '#ff3b30',
  drawWidth: 4,
  drawHold: 1,
  replayDelays: [5, 10, 15],
  replayViews: 1,
};

const KEY = 'foulee.settings.v1';

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export const settings = reactive<Settings>(load());

watch(
  settings,
  (s) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      // stockage indisponible (navigation privée) : préférences non conservées
    }
  },
  { deep: true },
);
