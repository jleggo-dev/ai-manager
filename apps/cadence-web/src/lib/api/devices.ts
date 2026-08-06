import { BASE, headers } from './http.ts';

/** Register this device's APNs token so the coach can reach the user (native shell only). */
export async function registerPushToken(token: string): Promise<boolean> {
  const res = await fetch(`${BASE}/me/push-token`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ token }),
  });
  return res.ok;
}

/** Forget this device's token (sign-out, or the user turning notifications off). */
export async function removePushToken(token: string): Promise<boolean> {
  const res = await fetch(`${BASE}/me/push-token`, {
    method: 'DELETE',
    headers: headers(),
    body: JSON.stringify({ token }),
  });
  return res.ok;
}
