/**
 * Open Food Facts client constants (browser → OFF directly).
 * No secrets. Fill the OFF API usage form before production volume:
 * https://openfoodfacts.org/api — attribution: ODbL.
 */

/** Product-by-barcode host (world). Prefer v3 product endpoint over search. */
export const OFF_API_BASE = 'https://world.openfoodfacts.org';

/**
 * Identify Cadence to OFF. Browsers cannot set User-Agent; OFF CORS allows X-User-Agent.
 * Update the contact when the API usage form is filed.
 */
export const OFF_USER_AGENT = 'Cadence/1.0 (https://github.com/jleggo-dev/ai-manager)';

/** Fields needed to map an OFF product into a Cadence Food. */
export const OFF_PRODUCT_FIELDS = [
  'code',
  'product_name',
  'generic_name',
  'brands',
  'nutriments',
  'serving_size',
  'serving_quantity',
  'serving_quantity_unit',
  'quantity',
  'product_quantity',
  'product_quantity_unit',
  'nutrition_data_per',
].join(',');
