<script setup lang="ts">
const PATHS: Record<string, string> = {
  play: 'M8 5v14l11-7z',
  pause: 'M6 5h4v14H6zm8 0h4v14h-4z',
  next: 'M6 5v14l9-7zM17 5h2v14h-2z',
  prev: 'M18 5v14l-9-7zM5 5h2v14H5z',
  fwd: 'M13 6v12l8.5-6zM4 6v12l8.5-6z',
  back: 'M11 6v12l-8.5-6zM20 6v12l-8.5-6z',
  start: 'M6 6h2v12H6zM9.5 12l8.5 6V6z',
  end: 'M16 6h2v12h-2zM14.5 12L6 18V6z',
  full: 'M5 5h5v2H7v3H5zM14 5h5v5h-2V7h-3zM5 14h2v3h3v2H5zM17 14h2v5h-5v-2h3z',
  exit: 'M8 5h2v5H5V8h3zM14 5h2v3h3v2h-5zM5 14h5v5H8v-3H5zM14 14h5v2h-3v3h-2z',
  loop: 'M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z',
  undo: 'M12.5 8c-2.65 0-5.05 1-6.9 2.6L2 7v9h9l-3.6-3.6A8 8 0 0 1 12.5 10c3.5 0 6.5 2.3 7.6 5.5l2.4-.8C21.1 10.7 17.2 8 12.5 8z',
  redo: 'M11.5 8c2.65 0 5.05 1 6.9 2.6L22 7v9h-9l3.6-3.6A8 8 0 0 0 11.5 10c-3.5 0-6.5 2.3-7.6 5.5l-2.4-.8C2.9 10.7 6.8 8 11.5 8z',
  hand: 'M9 11V5.5a1.5 1.5 0 0 1 3 0V10h1V4.5a1.5 1.5 0 0 1 3 0V10h1V6.5a1.5 1.5 0 0 1 3 0V15c0 3.9-3.1 7-7 7h-1c-2.5 0-4-1-5.3-3L3.4 14.700a1.500 1.500 0 0 1 2.400-1.800L9 15.500z',
  line: 'M4 20L20 4',
  arrow: 'M5 19L18 6M18 6h-7M18 6v7',
  pen: 'M3 21l3.500-1 12-12a2.100 2.100 0 0 0-3-3l-12 12zM14 6l4 4',
  circle: 'M12 4a8 8 0 1 0 0.001 0z',
  rect: 'M4 6h16v12H4z',
  angle: 'M4 20L16 6M4 20h16M9 20a6 6 0 0 0-1.500-4',
  text: 'M5 6V4h14v2h-6v14h-2V6z',
  erase: 'M16.200 3.500L21 8.300a1.500 1.500 0 0 1 0 2.100L11 20.500H5.500L3.500 18.500a1.500 1.500 0 0 1 0-2.100L14.100 3.500a1.500 1.500 0 0 1 2.100 0zM9 20.500h12',
  lock: 'M7 10V8a5 5 0 0 1 10 0v2h1v11H6V10zm2 0h6V8a3 3 0 0 0-6 0z',
  ruler: 'M3 17L17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2',
  target: 'M12 3v4M12 17v4M3 12h4M17 12h4M12 9a3 3 0 1 0 0.001 0z',
  unlock: 'M7 10V8a5 5 0 0 1 9.500-2.200l-1.800.9A3 3 0 0 0 9 8v2h9v11H6V10z',
};
const STROKE = new Set(['line', 'arrow', 'pen', 'circle', 'rect', 'angle', 'erase', 'ruler', 'target']);
defineProps<{ name: string; size?: number }>();
</script>

<template>
  <svg
    :width="size ?? 22"
    :height="size ?? 22"
    viewBox="0 0 24 24"
    aria-hidden="true"
    :fill="STROKE.has(name) ? 'none' : 'currentColor'"
    :stroke="STROKE.has(name) ? 'currentColor' : 'none'"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path :d="PATHS[name]" />
  </svg>
</template>
