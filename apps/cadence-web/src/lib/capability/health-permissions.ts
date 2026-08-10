/**
 * Reading whatever `capacitor-health` hands back from a permission request.
 *
 * **Why this is a whole module instead of one `.some()` call.** It was one `.some()` call, and it
 * threw on every iPhone from the first day:
 *
 *   TypeError: (await requestHealthPermissions({...})).permissions.some is not a function
 *
 * The plugin's own TypeScript declares `PermissionResponse { permissions: { [k: string]: boolean }[] }`
 * — an array. iOS does not return an array. The types describe the Android contract and the code
 * believed them, so the failure landed *before* any workout was ever read, and surfaced as the
 * uselessly vague "I couldn't read Apple Health just now".
 *
 * **What the answer even means.** Per the plugin's own docs: *"In iOS we can't really detect if a
 * user granted or denied a permission. The return value reflects the assumption that all
 * permissions were granted."* So on the platform we care about, this value carries no information
 * — the request completing without throwing is the whole signal. That is why an unrecognised shape
 * resolves to `true` rather than `false`: refusing to proceed because a plugin returned a shape we
 * did not expect would deny people a feature they had just granted.
 *
 * Never throws. A permission probe is not worth losing the feature over.
 */
export function grantedFromPermissionResponse(res: unknown): boolean {
  const permissions = (res as { permissions?: unknown } | null | undefined)?.permissions;

  // Android's documented shape: one object per permission, values telling us what was granted.
  if (Array.isArray(permissions)) {
    // An empty array is "nothing reported", not "everything denied" — same reasoning as below.
    if (!permissions.length) return true;
    return permissions.some((p) => Object.values((p ?? {}) as Record<string, unknown>).some(Boolean));
  }

  // A plain map of permission → boolean, which is what an iOS build returning anything at all
  // most plausibly means.
  if (permissions && typeof permissions === 'object') {
    return Object.values(permissions as Record<string, unknown>).some(Boolean);
  }

  // iOS in practice: nothing usable came back, and nothing was ever going to. The call returned,
  // which is the only thing this platform will ever tell us.
  return true;
}
