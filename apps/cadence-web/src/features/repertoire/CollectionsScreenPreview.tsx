/**
 * `?preview=collections` — "Your collections" against the dev account's real collections.
 *
 * Not fixture data, for the same reason `ListScreenPreview` is not: this screen fetches for itself
 * and its two actions write, so a fixture version would exercise none of what it is for. Renaming
 * and removing here are real writes against the dev account.
 */
import { CollectionsScreen } from './CollectionsScreen.tsx';

export function CollectionsScreenPreview() {
  return (
    <div className="app">
      <CollectionsScreen onBack={() => {}} />
    </div>
  );
}
