import { getUser, setHomeLocation } from '../repos/users.ts';
import { geocodeCity } from './weather/weather.ts';
import type { CoachActionTool } from './coach-action-types.ts';

/**
 * `set_home_location` — the coach's own write path for a fact that, until now, only Settings and
 * the ambient capture job could record (routes/me.ts `POST /me/location`, services/capture.ts's
 * stated-city branch). The daily date/time stamp (date-context.ts) used to tell her to "ask once,
 * warmly, if outdoor plans come up" when nothing was on file; that nudge is retired in favour of a
 * plain fact ("no weather is available"), and this tool is what closes the gap it leaves — a
 * person who volunteers a place in chat ("I just moved to Denver") now has somewhere for that to
 * land, made explicit and consented rather than inferred.
 *
 * Geocoding reuses `geocodeCity` (OpenWeatherMap direct geocoding) — the same lookup Settings and
 * capture already use, so "Denver" resolves to the same coordinates everywhere. The write reuses
 * `setHomeLocation`, which also clears `current_location` — setting home is a statement you are
 * AT home, the same reasoning `POST /me/location` already applies.
 *
 * Timezone is deliberately left untouched: a place name alone carries no IANA zone, and
 * `setHomeLocation` replaces whichever timezone it is given — so the existing value is read back
 * and passed straight through rather than passed as null, the same guard capture.ts's stated-city
 * branch already applies (never let a location write silently blank a timezone someone already
 * has). `setTimezoneIfUnset` exists for the moment a timezone is actually stated in words; this
 * tool has no such input to give it.
 *
 * Never touches `current_location` directly (A21's commute-dwell path) and never reads device
 * geolocation — it records only what the person said, in their own words.
 */

export const SET_HOME_LOCATION: CoachActionTool = {
  name: 'set_home_location',
  description:
    'Record the place their weather and daylight are read from. Takes effect immediately. Use when they tell you where they live or have moved to — "I just moved to Denver", "I\'m based in Lisbon, Portugal" — so outdoor conditions can be checked from here on; do not use this for where they are right now on a trip, only for home. Pass {"place": "Bend OR"} in their own words, a city name with as much state or country as they gave. The place is geocoded; if it cannot be found, nothing is changed and you are told so.',
  parameters: {
    properties: {
      place: {
        type: 'string',
        description: 'The place as they said it, e.g. "Denver", "Lisbon, Portugal", "Bend OR". Required.',
      },
    },
    required: ['place'],
  },
  async run(userId, params) {
    const place = String(params.place ?? '').trim();
    if (!place) return 'No place was given, so nothing changed.';

    const geo = await geocodeCity(place);
    if (!geo) return `"${place}" could not be found; nothing was changed.`;

    const user = await getUser(userId);
    await setHomeLocation(userId, { lat: geo.lat, lon: geo.lon, label: geo.label }, user?.timezone ?? null);

    const after = await getUser(userId);
    const landed =
      after?.home_location?.lat === geo.lat &&
      after?.home_location?.lon === geo.lon &&
      after?.home_location?.label === geo.label;
    if (!landed) {
      return `Home location did NOT get set — the write did not take. Do not say it is done.`;
    }

    return `Home location set to ${geo.label} (${geo.lat}, ${geo.lon}). Weather and daylight for outdoor sessions are read from here from now on.`;
  },
};
