# Weather skies on the trail

_2026-09-07. Owner ask: "It would be great if the background of a day on the Plan screen reflected
the forecast. Today is good for sunny and clear, but we should have other backgrounds for other
weather conditions … basically all the different kinds of weather Apple Weather reports."_

## The ruling

Tiled CSS patterns (repeating rain streaks, dot grids) were shown first and rejected as cheap
artwork. The owner chose **illustrated vector weather in the trail's own visual language**: clouds
drawn the way the discs are drawn — a rounded silhouette, a top-left glint, a solid bottom edge
(the disc's `0 8px 0 edge` shadow) — rain and snow scattered by hand rather than tiled, the bolt in
the sun's own yellow with a terracotta edge, leaves in the brand accent. The Linen sky underneath
is untouched; the weather is a layer over it.

The approved artboards (the "vector pass") are the source of truth for every position, colour and
seed; the web port reproduces them rather than re-drawing.

## The categories

`skyCategory(conditions)` in `apps/cadence-web/src/features/today/skyCategory.ts` routes the API's
humanized condition string — a WeatherKit code CamelCase-split and lowercased
(`humanizeConditionCode`), or an OpenWeatherMap description as it comes — to one of eleven skies.
Checks run most-specific first (a storm outranks the rain it carries; hail outranks snow and rain;
heavy before light), and `skyCategory.test.ts` tables the positives and the near-misses.

| Category        | Conditions                                                                                        | Wash | Sun  | Dark type |
| --------------- | ------------------------------------------------------------------------------------------------- | ---- | ---- | --------- |
| `clear`         | clear, mostly clear, hot, frigid, few clouds, anything unknown or empty                            | none | 1    | no        |
| `partly-cloudy` | partly cloudy, mostly cloudy, scattered clouds, broken clouds                                     | none | 1    | no        |
| `overcast`      | cloudy, overcast (clouds)                                                                         | grey | 0.25 | no        |
| `light-rain`    | drizzle, rain, light rain, sun showers, freezing drizzle, shower …                                | grey | 0.15 | no        |
| `heavy-rain`    | heavy rain, very heavy rain, heavy intensity (shower) rain, extreme rain, freezing rain           | slate| 0    | **yes**   |
| `thunderstorm`  | anything with thunder / storm / hurricane / tropical — "thunderstorm with heavy rain" lands here  | slate| 0    | **yes**   |
| `windy`         | breezy, windy, blowing dust                                                                       | none | 0.95 | no        |
| `hail`          | hail, sleet, wintry mix                                                                           | slate| 0.1  | **yes**   |
| `light-snow`    | flurries, snow, light snow, sun flurries, scattered snow showers, rain and snow                    | pale | 0.35 | no        |
| `heavy-snow`    | heavy snow, blizzard, blowing snow, heavy shower snow                                             | pale | 0.1  | no        |
| `fog`           | fog, foggy, haze, mist, smoky, smoke                                                              | cream| 0.15 | no        |

## The layer

Per day (`TodayTrail.tsx` → `DaySky.tsx`), after the sun / horizon / moon / stars and before the
day label, an absolutely positioned `pointer-events: none` layer (`.trail-sky`):

1. **The wash** — a `linear-gradient` tint over the Linen gradient (`.trail-sky-wash`). The Linen
   stops in `FIRST_SKY` / `LATER_SKY` never change; a sky with no wash (`clear`, `partly-cloudy`,
   `windy`) renders no element.
2. **The sunrise glow's opacity** — the scene's `sun` value, set on the section as `--sky-sun` and
   applied to `.trail-sun`, `.trail-horizon`, `.trail-sundisc`. The sun fades with the cloud rather
   than shining through a storm.
3. **The decor** — one `<svg viewBox="0 0 390 560" preserveAspectRatio="xMidYMin meet">` at the
   day's full width, carrying the vector art (`skyArt.tsx`: `cloud`, `rain`, `snow`, `hail`,
   `bolt`, `wind`, `leaf`, `fog`). Every scatter is drawn by a seeded generator and the element
   trees are built **once at module load** (`skyScenes.tsx`), so the art is identical on every
   render and on every day that shares a sky. Cloud positions are the artboards' after the
   `cl(x, y, w) = (x·0.92, y−48, w·0.8)` lift that frames the day label instead of the first node.

A `clear` day renders no layer at all — exactly what the trail drew before the forecast reached
it, and therefore also what an absent forecast looks like. Nothing on the trail waits for weather.

**Type.** Three skies (`heavy-rain`, `thunderstorm`, `hail`) are dim enough that dark text fails
on them. Such a day carries `is-dark-sky`: the day label and empty/locked lines flip in the
stylesheet, and `TrailNode` flips its label and meta to the light variants the night ramp stops
already use (`dark = ramp.dark || darkSky`). Every day also carries `is-sky-<category>`.

**Why `skyTint` needs the dark flag.** The floating header samples the Linen gradient's lightness
under its own bottom edge and turns to night chrome below `DARK_SKY_L`. A dark wash covers the
whole day, so the sampled gradient is no longer what is on screen — a cream band would sit on a
storm. `bandsIn` now reads `.is-dark-sky` into the band, and `skyLightnessUnder` clamps such a
band to `DARK_WASH_L` (0.5, below the seam). Bright washes (snow, fog, overcast) are not flagged:
they lighten or barely tint, and the gradient stays the right guide.

**Locked days** (the check-in wall, `.is-locked`) keep their sky; the lock's dimming sits on top.

## Where the forecast comes from

No new request. `useDaySkies` (`features/today/useDaySkies.ts`) watches the two ambient queries the
header already fills — the current reading under `queryKeys.weather` (observer only,
`enabled: false`, so it never races the header's imperative location → weather refresh) and the
forecast via the same `useForecast` subscription the weather sheet uses. `daySkies()` builds
`Record<date, SkyCategory>`: today from the current reading's `conditions` (falling back to the
forecast row for the date), later days from the matching `daily[].date`, everything else `clear`.
`PlanView` hands the record to `TodayTrail` as the optional `skies` prop.

## Raster skies, later

The image spec (one 1290×2280 JPEG per category, `cover` / top-anchored, files
`sky-<category>.jpg`) can replace the SVG layer per category behind the same `skyCategory` router:
`DaySky` would swap its `<svg>` for the image for any category that has one, and nothing above
the layer — the router, the class marks, the dark flag, `skyTint` — changes.
