/**
 * Barcode decode engine selection. Native BarcodeDetector where it exists (Chrome/Edge/Android);
 * zxing-wasm everywhere else — which is every iPhone, so the WASM path is the primary one in
 * practice, not the fallback. Typed digits remain only for devices with no camera at all.
 */

import { createWasmBarcodeDetector } from './wasmBarcodeReader.ts';

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
  // The decoder is always available (zxing-wasm ships in the bundle); the only real question is
  // whether this device can open a camera stream.
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

export function createBarcodeDetector(): BarcodeDetectorLike | null {
  const Ctor = getBarcodeDetectorCtor();
  if (Ctor) {
    try {
      return new Ctor({ formats: [...PREFERRED_FORMATS] });
    } catch {
      try {
        return new Ctor();
      } catch {
        /* fall through to the WASM engine */
      }
    }
  }
  // WebKit (every iPhone): the bundled WASM reader, behind the same interface. Creating it is
  // cheap — the megabyte of WASM loads inside detect(), on the first frame, never before.
  return createWasmBarcodeDetector();
}
