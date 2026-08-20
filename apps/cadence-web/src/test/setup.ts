import '@testing-library/jest-dom/vitest';
import { beforeEach } from 'vitest';

/**
 * Node 24+ ships its own `localStorage` global, and it SHADOWS jsdom's — resolving to `undefined`
 * unless the process was started with `--localstorage-file`. So `window.localStorage.clear()` throws
 * on a modern local Node while passing in CI (Node 22), which reads as a broken test rather than a
 * platform difference. Restore jsdom's behaviour with a minimal in-memory store when the global has
 * been shadowed away; on Node 22 this is a no-op.
 */
if (!window.localStorage) {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    },
  });
}

/**
 * A test starts with an empty device.
 *
 * `localStorage` is one store for a whole file, so anything a test leaves behind is state the next
 * test silently inherits — and it only LOOKS harmless while the things kept there are flags nobody
 * renders. The coach transcript cache (coach-transcript-cache.ts) made that concrete: a chat test
 * that sent a message left the conversation on the device, and the next test in the file opened
 * with the previous test's turns already painted, failing on messages it never sent.
 *
 * Registered here so it runs BEFORE any per-file `beforeEach` (setup files are loaded first), which
 * means a test that seeds its own keys still gets to — it just starts from nothing, like a phone
 * that has never run the app.
 */
beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    /* storage shadowed or disabled — nothing kept, nothing to clear */
  }
});

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});
