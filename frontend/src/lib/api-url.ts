export function resolveApiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  const prefix = import.meta.env.VITE_API_PATH_PREFIX || '';
  if (p.startsWith('/api')) return `${prefix}${p}`;
  return p;
}
