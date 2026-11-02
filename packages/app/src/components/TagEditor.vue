<script setup lang="ts">
import { computed, ref } from 'vue';
import { QUICK_TAGS, addTag, normalizeTag, toggleTag } from '@foulee/core';
import { allTags } from '../store/data';

const props = withDefaults(defineProps<{ modelValue: string[]; quick?: boolean; derived?: string[] }>(), { quick: false, derived: () => [] });
const emit = defineEmits<{ 'update:modelValue': [string[]] }>();

const input = ref('');
const listId = `tags-${Math.random().toString(36).slice(2, 8)}`;
const suggestions = computed(() => allTags.value.filter((t) => !props.modelValue.includes(t)));

const custom = computed(() => props.modelValue.filter((x) => !(props.quick && (QUICK_TAGS as readonly string[]).includes(x))));

function add() {
  const t = normalizeTag(input.value);
  if (t) emit('update:modelValue', addTag(props.modelValue, t));
  input.value = '';
}
function remove(t: string) {
  emit('update:modelValue', props.modelValue.filter((x) => x !== t));
}
function toggle(t: string) {
  emit('update:modelValue', toggleTag(props.modelValue, t));
}
</script>

<template>
  <div class="tags stack">
    <div v-if="quick" class="row" role="group" aria-label="Tags rapides">
      <button
        v-for="t in QUICK_TAGS"
        :key="t"
        class="pill"
        :class="{ accent: modelValue.includes(t) }"
        :aria-pressed="modelValue.includes(t)"
        @click="toggle(t)"
      >
        {{ t }}
      </button>
    </div>
    <div class="row">
      <span v-for="t in derived" :key="`d-${t}`" class="pill" title="Tag automatique (champs de l’essai)">{{ t }}</span>
      <span v-for="t in custom" :key="t" class="pill accent">
        {{ t }}
        <button class="x" :aria-label="`Retirer ${t}`" @click="remove(t)">✕</button>
      </span>
      <form class="add" @submit.prevent="add">
        <input v-model="input" :list="listId" placeholder="Ajouter un tag" aria-label="Ajouter un tag" enterkeyhint="done" />
        <datalist :id="listId">
          <option v-for="s in suggestions" :key="s" :value="s"></option>
        </datalist>
      </form>
    </div>
  </div>
</template>

<style scoped>
.x {
  border: 0;
  background: none;
  color: inherit;
  cursor: pointer;
  padding: 0 0 0 4px;
  font-size: 0.8rem;
}
.add input {
  min-height: 32px;
  width: 160px;
  padding: 4px 8px;
}
</style>
