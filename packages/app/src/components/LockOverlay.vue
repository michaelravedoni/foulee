<script setup lang="ts">
import Ico from './Ico.vue';
import { onBeforeUnmount, ref } from 'vue';

const emit = defineEmits<{ unlock: [] }>();
const HOLD_MS = 1200;
const progress = ref(0);
let start = 0;
let raf = 0;

function down(e: PointerEvent) {
  e.preventDefault();
  start = performance.now();
  const tick = () => {
    progress.value = Math.min(1, (performance.now() - start) / HOLD_MS);
    if (progress.value >= 1) {
      emit('unlock');
      return;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}
function up() {
  cancelAnimationFrame(raf);
  progress.value = 0;
}
onBeforeUnmount(() => cancelAnimationFrame(raf));
</script>

<template>
  <div class="lock-overlay" @pointerdown.self.prevent @touchmove.prevent @contextmenu.prevent>
    <button
      class="lock-button"
      aria-label="Maintenir pour déverrouiller"
      @pointerdown="down"
      @pointerup="up"
      @pointerleave="up"
      @pointercancel="up"
      @contextmenu.prevent
    >
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="44" class="track" />
        <circle cx="50" cy="50" r="44" class="bar" :style="{ strokeDashoffset: 276.5 * (1 - progress) }" />
      </svg>
      <Ico name="lock" :size="28" />
    </button>
    <p>Écran verrouillé · maintenir le cadenas pour déverrouiller</p>
  </div>
</template>
