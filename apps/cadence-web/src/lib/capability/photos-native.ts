import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { IMAGE_MAX_EDGE_PX } from '@cadence/shared';
import type { PhotosCapability } from './index.ts';

/**
 * The phone's own camera and photo picker (@capacitor/camera), opened straight at the source the
 * person tapped. What comes back is turned into an ordinary File, so every caller hands it to the
 * same pipeline a browser pick goes through (the chat's upload tray, the meal's photo read) and
 * nothing downstream knows which door it came from.
 *
 * Sized on the phone, not after: a full 48 MP shot crossing the bridge as base64 is tens of MB
 * of memory for nothing. It stops at the chat's own long edge (IMAGE_MAX_EDGE_PX, shared — the
 * tray's shrinkImage uses the same number) at a quality a notch above the tray's 0.85, so a photo
 * that comes back under the tray's pass-through size is not JPEG-encoded a second time.
 *
 * Backing out of the camera or the picker rejects inside the plugin; that is not a fault, so it
 * answers null. Anything else is logged and also answers null — a broken picker costs the photo,
 * never the message being written.
 */
const QUALITY = 90;

export async function dataUrlToFile(dataUrl: string, name: string): Promise<File> {
  const blob = await (await fetch(dataUrl)).blob();
  return new File([blob], name, { type: blob.type || 'image/jpeg' });
}

export const nativePhotos: PhotosCapability = {
  isAvailable: () => true,

  pick: async (source) => {
    try {
      const photo = await Camera.getPhoto({
        source: source === 'camera' ? CameraSource.Camera : CameraSource.Photos,
        resultType: CameraResultType.DataUrl,
        quality: QUALITY,
        width: IMAGE_MAX_EDGE_PX,
        height: IMAGE_MAX_EDGE_PX,
        correctOrientation: true,
      });
      if (!photo.dataUrl) return null;
      const ext = photo.format === 'png' ? 'png' : 'jpg';
      return await dataUrlToFile(photo.dataUrl, `photo-${Date.now()}.${ext}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/cancel/i.test(msg)) console.warn('[photos] pick failed', msg);
      return null;
    }
  },
};
