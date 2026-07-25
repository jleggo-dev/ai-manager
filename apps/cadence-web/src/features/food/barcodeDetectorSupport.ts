/**
 * Feature detection for native BarcodeDetector (Chrome/Edge/Android).
 * Safari and older browsers fall back to typed digit entry.
 */

export interface DetectedBarcodeLike {
  rawValue: string;
  format?: string;
}

export interface BarcodeDetectorLike {
  detect(source: ImageBitmapSource): Promise<DetectedBarcodeLike[]>;
}

export type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

const PREFERRED_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] as const;

export function getBarcodeDetectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === 'undefined') return null;
  const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  return typeof ctor === 'function' ? ctor : null;
}

export function isBarcodeScanSupported(): boolean {
  return !!getBarcodeDetectorCtor() && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

export function createBarcodeDetector(): BarcodeDetectorLike | null {
  const Ctor = getBarcodeDetectorCtor();
  if (!Ctor) return null;
  try {
    return new Ctor({ formats: [...PREFERRED_FORMATS] });
  } catch {
    try {
      return new Ctor();
    } catch {
      return null;
    }
  }
}
