/**
 * Resolve dot/bracket paths against a JSON value.
 * Supports: "score", "analysis.score", "items[0].title", "items[0]"
 * Top-level keys without dots/brackets use direct property access (backward compatible).
 */

export function resolveJsonPath(root: unknown, path: string): unknown {
  if (!path || typeof path !== 'string') return undefined;
  /* Fast path: simple top-level key with no path syntax */
  if (!path.includes('.') && !path.includes('[')) {
    if (root && typeof root === 'object' && !Array.isArray(root)) {
      return (root as Record<string, unknown>)[path];
    }
    return undefined;
  }

  const segments = tokenizePath(path);
  let current: unknown = root;

  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;

    if (segment.type === 'property') {
      if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined;
      current = (current as Record<string, unknown>)[segment.key];
    } else if (segment.type === 'index') {
      if (!Array.isArray(current)) return undefined;
      current = current[segment.index];
    }
  }

  return current;
}

/** Extract the first path segment key for trim-to-json expectedKeys (top-level disambiguation). */
export function rootKeyFromPath(path: string): string {
  if (!path.includes('.') && !path.includes('[')) return path;
  const segments = tokenizePath(path);
  const first = segments[0];
  if (first?.type === 'property') return first.key;
  return path;
}

type PathSegment = { type: 'property'; key: string } | { type: 'index'; index: number };

function tokenizePath(path: string): PathSegment[] {
  const segments: PathSegment[] = [];
  let i = 0;
  let current = '';

  while (i < path.length) {
    const ch = path[i];

    if (ch === '.') {
      if (current) {
        segments.push({ type: 'property', key: current });
        current = '';
      }
      i++;
      continue;
    }

    if (ch === '[') {
      if (current) {
        segments.push({ type: 'property', key: current });
        current = '';
      }
      const close = path.indexOf(']', i);
      if (close === -1) break;
      const inner = path.slice(i + 1, close).trim();
      const idx = parseInt(inner, 10);
      if (!Number.isNaN(idx)) segments.push({ type: 'index', index: idx });
      i = close + 1;
      continue;
    }

    current += ch;
    i++;
  }

  if (current) segments.push({ type: 'property', key: current });
  return segments;
}
