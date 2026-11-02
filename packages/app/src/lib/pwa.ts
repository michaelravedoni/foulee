import { ref } from 'vue';
import { registerSW } from 'virtual:pwa-register';

export const needRefresh = ref(false);
export const offlineReady = ref(false);
let update: ((reload?: boolean) => Promise<void>) | undefined;

export function setupPwa(): void {
  if (!('serviceWorker' in navigator)) return;
  update = registerSW({
    immediate: true,
    onNeedRefresh() {
      needRefresh.value = true;
    },
    onOfflineReady() {
      offlineReady.value = true;
    },
  });
}

export function applyUpdate(): void {
  void update?.(true);
}
