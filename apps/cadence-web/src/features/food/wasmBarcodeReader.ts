/**
 * The WebKit half of barcode scanning.
 *
 * `BarcodeDetector` exists on Chrome/Android and simply does not exist in WebKit — which is every
 * iPhone, which is where this app lives. So on the one platform that matters most, "Scan" fell
 * through to "type the digits under the barcode", which is not a scanner (owner, 2026-08-15).
 *
 * zxing-wasm fills the gap: same detect-a-frame contract, decoded in WASM. The module and its
 * ~1MB of WASM are loaded lazily on first use — nobody pays for it until they point the camera at
 * something — and the binary ships IN the bundle (`?url` import) because the shell serves from
 * capacitor://localhost where a CDN fetch is both a CSP hole and an offline failure.
 */
import type { BarcodeDetectorLike, DetectedBarcodeLike } from './barcodeDetectorSupport.ts';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

/** Same retail formats the native detector asks for (barcodeDetectorSupport.PREFERRED_FORMATS). */
const FORMATS = ['EAN-13', 'EAN-8', 'UPCA', 'UPCE', 'Code128'] as const;

let readerPromise: Promise<typeof import('zxing-wasm/reader')> | null = null;

function loadReader() {
  if (!readerPromise) {
    readerPromise = import('zxing-wasm/reader').then((mod) => {
      mod.prepareZXingModule({ overrides: { locateFile: () => wasmUrl } });
      return mod;
    });
  }
  return readerPromise;
}

/**
 * A `BarcodeDetectorLike` over zxing-wasm, so `useBarcodeScan` cannot tell which engine it got.
 * Frames arrive as video elements; ImageData is extracted here because the WASM reader wants
 * pixels, not a DOM node.
 */
/** Decode frames at most this wide — EAN-13 reads fine at this size, and WASM time scales with
 *  pixels. A 1280-wide frame roughly quadruples the work for no extra reads. */
const MAX_DECODE_WIDTH = 800;

export function createWasmBarcodeDetector(): BarcodeDetectorLike {
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  /** One decode at a time. The scan loop ticks on a fixed interval, and a WASM decode can outlast
   *  the tick — overlapping calls would pile up work and stutter the preview. */
  let inFlight = false;

  return {
    async detect(source: ImageBitmapSource): Promise<DetectedBarcodeLike[]> {
      if (inFlight || !canvas || !(source instanceof HTMLVideoElement)) return [];
      const vw = source.videoWidth;
      const vh = source.videoHeight;
      if (!vw || !vh) return [];
      inFlight = true;
      try {
        const scale = Math.min(1, MAX_DECODE_WIDTH / vw);
        const w = Math.round(vw * scale);
        const h = Math.round(vh * scale);
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return [];
        ctx.drawImage(source, 0, 0, w, h);
        const image = ctx.getImageData(0, 0, w, h);
        const { readBarcodes } = await loadReader();
        const results = await readBarcodes(image, { formats: [...FORMATS], maxNumberOfSymbols: 1, tryHarder: true });
        return results
          .filter((r) => r.isValid && r.text)
          .map((r) => ({ rawValue: r.text, format: r.format?.toLowerCase() }));
      } finally {
        inFlight = false;
      }
    },
  };
}
