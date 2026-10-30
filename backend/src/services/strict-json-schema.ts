/**
 * Make a JSON Schema acceptable to OpenAI strict mode, and say when it cannot be.
 *
 * Strict mode has two rules for every object in the schema: `additionalProperties` must be
 * `false`, and every declared property must be listed in `required`. `expected-schema-to-json-schema.ts`
 * already builds that shape wherever a job DECLARES sub-fields. Where it does not — a bare
 * `{ type: "object" }` with no `fields`, or an array of such objects — the generator emits
 * `additionalProperties: true`, which is the one shape strict mode rejects outright
 * (`'additionalProperties' is required to be supplied and to be false`, measured 2026-10-29).
 *
 * Such an object cannot be closed here: closing it would mean "an empty object", which is not
 * what the job asked for. So the walk does two things: it closes every object that has
 * properties (belt and braces — the generator already does), and it reports the path of every
 * object that has none. A schema with any open path is sent with `strict: false`, where the
 * provider treats it as guidance rather than a contract. Which jobs that is today is pinned in
 * `backend/test/strict-json-schema.test.ts`.
 */

export interface StrictSchemaResult {
  /** A deep copy with every closable object closed. */
  schema: Record<string, unknown>;
  /** True when no open object remains, i.e. the schema may be sent with `strict: true`. */
  strict: boolean;
  /** JSON-pointer-ish paths of the objects that could not be closed, e.g. `items[]`, `flags`. */
  openPaths: string[];
}

function isObjectNode(node: Record<string, unknown>): boolean {
  const t = node.type;
  return t === 'object' || (Array.isArray(t) && t.includes('object'));
}

function walk(node: unknown, path: string, openPaths: string[]): unknown {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return node;
  const copy: Record<string, unknown> = { ...(node as Record<string, unknown>) };

  if (isObjectNode(copy)) {
    const props = copy.properties;
    const keys = props && typeof props === 'object' ? Object.keys(props as Record<string, unknown>) : [];
    if (keys.length === 0) {
      openPaths.push(path || '(root)');
    } else {
      const nextProps: Record<string, unknown> = {};
      for (const key of keys) {
        nextProps[key] = walk((props as Record<string, unknown>)[key], path ? `${path}.${key}` : key, openPaths);
      }
      copy.properties = nextProps;
      copy.required = keys;
      copy.additionalProperties = false;
    }
  }

  if (copy.items && typeof copy.items === 'object') {
    copy.items = walk(copy.items, `${path}[]`, openPaths);
  }

  return copy;
}

export function closeSchemaForStrictMode(schema: Record<string, unknown>): StrictSchemaResult {
  const openPaths: string[] = [];
  const closed = walk(schema, '', openPaths) as Record<string, unknown>;
  return { schema: closed, strict: openPaths.length === 0, openPaths };
}
