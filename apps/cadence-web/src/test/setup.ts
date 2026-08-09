import '@testing-library/jest-dom/vitest';

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
