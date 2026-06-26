/**
 * Convert a string to a URL-safe slug: lowercase, alphanumeric + hyphens.
 */
export function slugify(value = ''): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}
