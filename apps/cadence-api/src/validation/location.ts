import { z } from 'zod';

/**
 * POST /me/location — either coarse lat/lon, or a city label (server geocodes via OWM).
 * Timezone is optional IANA (browser usually sends it).
 */
export const homeLocationBodySchema = z
  .object({
    lat: z.number().min(-90).max(90).optional(),
    lon: z.number().min(-180).max(180).optional(),
    label: z.string().trim().max(120).optional(),
    city: z.string().trim().max(120).optional(),
    timezone: z
      .string()
      .trim()
      .max(80)
      .regex(/^[A-Za-z0-9_+\-/]+$/, 'timezone must be an IANA name like America/New_York')
      .optional(),
  })
  .refine((b) => (b.lat != null && b.lon != null) || !!(b.city?.trim() || b.label?.trim()), {
    message: 'provide lat+lon or a city/label',
  });

export type HomeLocationBody = z.infer<typeof homeLocationBodySchema>;

/**
 * POST /me/current-location — where you ARE (A21). Coordinates only, and that is deliberate: this
 * route exists for a device that has just measured a position it has already dwelt at. A TYPED
 * city is a statement about where you live, and it keeps going through the home route.
 */
export const currentLocationBodySchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

export type CurrentLocationBody = z.infer<typeof currentLocationBodySchema>;
