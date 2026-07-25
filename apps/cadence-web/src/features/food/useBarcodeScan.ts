/**
 * Camera barcode scan via BarcodeDetector + getUserMedia.
 * Stops tracks on detect / unmount. Digits remain the fallback UI.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createBarcodeDetector, isBarcodeScanSupported } from './barcodeDetectorSupport.ts';
import { normalizeBarcode } from '../../lib/off/map-product.ts';

const SCAN_INTERVAL_MS = 280;

export type BarcodeScanStatus = 'idle' | 'starting' | 'scanning' | 'unsupported' | 'denied' | 'error';

export function useBarcodeScan(onCode: (barcode: string) => void) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const busyRef = useRef(false);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  const [status, setStatus] = useState<BarcodeScanStatus>(() => (isBarcodeScanSupported() ? 'idle' : 'unsupported'));
  const [statusNote, setStatusNote] = useState('');

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const stream = streamRef.current;
    streamRef.current = null;
    if (stream) for (const t of stream.getTracks()) t.stop();
    const video = videoRef.current;
    if (video) {
      video.srcObject = null;
    }
    busyRef.current = false;
    setStatus((s) => (s === 'unsupported' ? s : 'idle'));
  }, []);

  useEffect(() => () => stop(), [stop]);

  const start = useCallback(async () => {
    if (!isBarcodeScanSupported()) {
      setStatus('unsupported');
      setStatusNote("Camera scan isn't available here — type the digits under the barcode.");
      return;
    }
    if (busyRef.current || status === 'scanning' || status === 'starting') return;
    busyRef.current = true;
    setStatus('starting');
    setStatusNote('');

    const detector = createBarcodeDetector();
    if (!detector) {
      setStatus('unsupported');
      setStatusNote("Camera scan isn't available here — type the digits under the barcode.");
      busyRef.current = false;
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        for (const t of stream.getTracks()) t.stop();
        streamRef.current = null;
        setStatus('error');
        setStatusNote("Couldn't start the camera — try typing the digits instead.");
        busyRef.current = false;
        return;
      }
      video.srcObject = stream;
      await video.play();
      setStatus('scanning');
      busyRef.current = false;

      timerRef.current = setInterval(() => {
        void (async () => {
          if (busyRef.current) return;
          const el = videoRef.current;
          if (!el || el.readyState < 2) return;
          try {
            const codes = await detector.detect(el);
            const raw = codes[0]?.rawValue?.trim();
            if (!raw) return;
            const normalized = normalizeBarcode(raw);
            if (!normalized) return;
            busyRef.current = true;
            stop();
            onCodeRef.current(normalized);
          } catch {
            // transient detect failures are fine; keep scanning
          }
        })();
      }, SCAN_INTERVAL_MS);
    } catch (err) {
      busyRef.current = false;
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setStatus('denied');
        setStatusNote('Camera permission was blocked — type the digits under the barcode instead.');
      } else {
        setStatus('error');
        setStatusNote("Couldn't open the camera — type the digits under the barcode instead.");
      }
      console.warn('[barcode-scan] getUserMedia failed:', name || err);
    }
  }, [status, stop]);

  return {
    videoRef,
    status,
    statusNote,
    supported: isBarcodeScanSupported(),
    start,
    stop,
  };
}
