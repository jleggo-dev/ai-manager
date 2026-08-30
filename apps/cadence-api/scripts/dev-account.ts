/**
 * Resolve one of the scratch dev accounts by slug, failing loudly when it is not configured.
 *
 * `cadenceConfig.devAccounts` is typed `Record<string, string>` because the auth middleware looks
 * a slug up from a request header, so every read is `string | undefined`. A script naming a slug
 * it ships with is the other case: the account is always there — and when it isn't, saying so
 * beats threading `undefined` into a SQL parameter, which yields an empty result set that reads
 * like a passing assertion.
 */
import { cadenceConfig } from '../src/config.ts';

export function devAccount(slug: string): string {
  const id = cadenceConfig.devAccounts[slug];
  if (!id) {
    throw new Error(`unknown dev account "${slug}" (known: ${Object.keys(cadenceConfig.devAccounts).join(', ')})`);
  }
  return id;
}
