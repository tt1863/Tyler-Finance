import { create } from 'zustand';

/** True when a newer version of the app has been downloaded and is ready. */
export const useUpdate = create<{ ready: boolean }>(() => ({ ready: false }));

let waiting: ServiceWorker | null = null;

/**
 * Save the app on the device (offline + instant open) and watch for new
 * versions. Only in real builds; development reloads normally.
 */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      const watch = (sw: ServiceWorker | null) => {
        if (!sw) return;
        const check = () => {
          // A new version is installed while an older one runs this page.
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            waiting = sw;
            useUpdate.setState({ ready: true });
          }
        };
        check();
        sw.addEventListener('statechange', check);
      };
      watch(reg.waiting);
      reg.addEventListener('updatefound', () => watch(reg.installing));
      // Look for a new version whenever the app comes back to the foreground.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void reg.update().catch(() => undefined);
      });
    } catch {
      // Offline support is a bonus; the app works without it.
    }
  });

  // Reload only when the person asked to switch versions (not on the very
  // first install, when the worker simply starts looking after the page).
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!updating) return;
    updating = false;
    window.location.reload();
  });
}

let updating = false;

/** Switch to the new version now (reloads the app). */
export function applyUpdate() {
  updating = true;
  if (waiting) waiting.postMessage('skip-waiting');
  else window.location.reload();
}
