/**
 * Barcode → Food: prefer Cadence cache, else browser OFF product fetch → import.
 */
import { getFoodByOffId, importOffFood, type OffFoodCacheResult } from '../api/foods-off.ts';
import { fetchOffProductByBarcode } from './client.ts';
import { normalizeBarcode } from './map-product.ts';

/**
 * Resolve a barcode to a saved shared Food.
 * Cache-first; only calls OFF on miss. Never uses OFF search.
 */
export async function lookupBarcodeFood(barcode: string): Promise<OffFoodCacheResult> {
  const code = normalizeBarcode(barcode);
  if (!code) return { status: 'error', message: 'Enter a barcode with 8–14 digits.' };

  const cached = await getFoodByOffId(code);
  if (cached.status === 'ok') return cached;
  if (cached.status === 'unavailable') return cached;

  const off = await fetchOffProductByBarcode(code);
  if (off.status === 'not_found') return { status: 'not_found' };
  if (off.status !== 'ok') return { status: off.status, message: off.message };

  return importOffFood(off.food);
}
