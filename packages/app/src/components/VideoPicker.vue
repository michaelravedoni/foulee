<script setup lang="ts">
import { ref } from 'vue';

const emit = defineEmits<{ picked: [File[]] }>();
withDefaults(defineProps<{ label?: string; primary?: boolean }>(), { label: 'Importer des vidéos', primary: true });
const input = ref<HTMLInputElement>();

function onChange() {
  const files = [...(input.value?.files ?? [])];
  if (input.value) input.value.value = '';
  if (files.length) emit('picked', files);
}
</script>

<template>
  <button type="button" class="btn" :class="{ secondary: !primary }" @click="input?.click()">{{ label }}</button>
  <input ref="input" class="sr-only" type="file" accept="video/*,.mov,.mp4,.m4v,.webm" multiple tabindex="-1" @change="onChange" />
</template>
