import { sql } from '../db/sql.ts';

/** Registered push targets (migration 0023). Token is the natural key — an upsert re-parents a
 *  reused token to the currently signed-in user (device handed to a new account, token rotated). */

export async function upsertDeviceToken(userId: string, token: string): Promise<void> {
  await sql`
    insert into cadence.device_tokens (token, user_id)
    values (${token}, ${userId})
    on conflict (token) do update set user_id = ${userId}, last_seen_at = now()`;
}

export async function deleteDeviceToken(userId: string, token: string): Promise<void> {
  await sql`delete from cadence.device_tokens where token = ${token} and user_id = ${userId}`;
}

export async function listDeviceTokens(userId: string): Promise<string[]> {
  const rows = await sql<{ token: string }[]>`
    select token from cadence.device_tokens where user_id = ${userId} order by last_seen_at desc`;
  return rows.map((r) => r.token);
}

/** APNs said 410 Unregistered — the token is dead for everyone, not just this user. */
export async function pruneDeadToken(token: string): Promise<void> {
  await sql`delete from cadence.device_tokens where token = ${token}`;
}
