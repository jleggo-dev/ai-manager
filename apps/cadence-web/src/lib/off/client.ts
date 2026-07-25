/**
 * Browser Open Food Facts client — product-by-barcode only.
 * Calls OFF directly (per-user egress). Never proxy through cadence-api.
 * Prefer cache hits via cadence-api before calling this.
 */
import { OFF_API_BASE, OFF_PRODUCT_FIELDS, OFF_USER_AGENT } from './constants.ts';
import { mapOffProductToFood, normalizeBarcode, type OffMappedFood } from './map-product.ts';

export type OffLookupResult =
  | { status: 'ok'; food: OffMappedFood }
  | { status: 'not_found' }
  | { status: 'unavailable'; message: string }
  | { status: 'error'; message: string };

function productFromBody(body: unknown): unknown | null {
  if (!body || typeof body !== 'object') return null;
  const o = body as Record<string, unknown>;
  // v3: status "success" + product; v2: status 1 + product
  if (o.product && typeof o.product === 'object') {
    if (o.status === 'success' || o.status === 1 || o.status === 'product_found') return o.product;
    const result = o.result;
    if (result && typeof result === 'object' && (result as { id?: string }).id === 'product_found') return o.product;
  }
  return null;
}

/**
 * GET /api/v3/product/{barcode} with X-User-Agent.
 * Does not search — OFF search rate limits are harsh for typeahead.
 */
export async function fetchOffProductByBarcode(barcode: string): Promise<OffLookupResult> {
  const code = normalizeBarcode(barcode);
  if (!code) {
    return { status: 'error', message: 'Enter a barcode with 8–14 digits.' };
  }

  const url = `${OFF_API_BASE}/api/v3/product/${encodeURIComponent(code)}?fields=${OFF_PRODUCT_FIELDS}`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-User-Agent': OFF_USER_AGENT,
      },
    });
    if (res.status === 404) return { status: 'not_found' };
    if (res.status === 429 || res.status === 503) {
      return {
        status: 'unavailable',
        message: 'Open Food Facts is busy right now — try again in a minute, or snap the label instead.',
      };
    }
    if (!res.ok) {
      return {
        status: 'error',
        message: "Couldn't look up that barcode just now — try again, or snap the label.",
      };
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { status: 'error', message: "Couldn't read that product response — try again." };
    }
    const product = productFromBody(body);
    if (!product) return { status: 'not_found' };
    const food = mapOffProductToFood(code, product);
    if (!food) {
      return {
        status: 'error',
        message: "Found the product, but it doesn't have enough nutrition data to save yet.",
      };
    }
    return { status: 'ok', food };
  } catch {
    return {
      status: 'unavailable',
      message: "Couldn't reach Open Food Facts — check your connection, or snap the label instead.",
    };
  }
}
