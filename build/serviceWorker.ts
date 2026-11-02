import { readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';

/**
 * Vite plugin that writes dist/sw.js: a service worker that saves every file
 * of this build on the device so the app opens instantly and works offline.
 * Each build gets its own cache name, so a new deploy installs a fresh copy
 * and the app offers to switch to it.
 */
export function serviceWorker(): Plugin {
  return {
    name: 'tyler-finance-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const publicFiles = readdirSync('public');
      const files = [...Object.keys(bundle), ...publicFiles].filter((f) => f !== 'sw.js').sort();
      const version = createHash('sha256')
        .update(files.join('\n'))
        .update(Object.values(bundle).map((b) => ('code' in b ? b.code : String(b.source))).join(''))
        .digest('hex')
        .slice(0, 12);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: swSource(version, files) });
    },
  };
}

function swSource(version: string, files: string[]): string {
  return `// Generated at build time. Saves the app on the device for instant, offline use.
const VERSION = ${JSON.stringify(version)};
const FILES = ${JSON.stringify(['./', ...files.map((f) => './' + f)])};
const SCOPE = new URL(self.registration.scope).pathname;
// The live app and each pull request preview share one website, so each keeps
// its own saved copy and only ever replaces its own older versions.
const PREFIX = 'tyler-finance:' + SCOPE + ':';
const CACHE = PREFIX + VERSION;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// The page asks the waiting worker to take over when the person taps "Update".
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Only this app's own files; never bank, sync or other sites' requests.
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE)) return;
  // Pull request previews live under this app's folder but have their own worker.
  if (url.pathname.slice(SCOPE.length).startsWith('preview/')) return;

  if (req.mode === 'navigate') {
    // Open instantly from the saved copy; fall back to the network.
    event.respondWith(caches.match('./', { cacheName: CACHE, ignoreVary: true }).then((hit) => hit || fetch(req)));
    return;
  }
  event.respondWith(caches.match(req, { cacheName: CACHE, ignoreSearch: true, ignoreVary: true }).then((hit) => hit || fetch(req)));
});
`;
}
