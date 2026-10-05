import { paintDeepField, resetDeepField } from "./deep-field.ts";
import { paintMeteorField } from "./meteor-field.ts";
import { paintStellarPoint } from "./stellar-light.ts";
import { fieldHash } from "./stellar-field-model.ts";
import { STELLAR_PALETTE } from "./stellar-palette.ts";
import { ATLAS_SOURCE_STARS, createNebulaMotion, type NebulaMotion } from "./nebula-motion.ts";
import { atlasSourceCrop } from "./atlas-camera.ts";

/** A small typed adapter also lets offline diagnostics supply a decoded image. */
export interface CinematicImageResource {
  readonly source: CanvasImageSource;
  readonly width: number;
  readonly height: number;
  readonly ready: boolean;
  /** Return a function that detaches events and releases the pending source. */
  load(url: string, onLoad: () => void, onError: () => void): () => void;
}

export interface CinematicBackdropOptions {
  /** Request a frame from the existing runtime, including while it is paused. */
  onReady?: () => void;
  imageFactory?: () => CinematicImageResource;
  motionFactory?: typeof createNebulaMotion;
}

const ASSET_URL = "/assets/community/atlas-space.webp";
const SOURCE_WIDTH = 1672, SOURCE_HEIGHT = 941;

function browserImage(): CinematicImageResource {
  const image = new Image();
  image.decoding = "async";
  return {
    source: image,
    get width() { return image.naturalWidth; },
    get height() { return image.naturalHeight; },
    get ready() { return image.complete && image.naturalWidth > 0 && image.naturalHeight > 0; },
    load(url, onLoad, onError) {
      const detach = () => {
        image.removeEventListener("load", onLoad);
        image.removeEventListener("error", onError);
        image.removeAttribute("src");
      };
      image.addEventListener("load", onLoad);
      image.addEventListener("error", onError);
      try { image.src = url; } catch (error) { detach(); throw error; }
      return detach;
    },
  };
}

/**
 * The caller clears and paints the constellation first. This scene then fills
 * only the space behind it, without owning RAF, camera movement, or copy layers.
 */
export function createCinematicBackdrop(
  ctx: CanvasRenderingContext2D,
  options: CinematicBackdropOptions = {},
): { paint(width: number, height: number, time: number): void; dispose(): void } {
  let disposed = false, imageReady = false;
  let image: CinematicImageResource | undefined;
  let cancelLoad: (() => void) | undefined;
  let motion: NebulaMotion | null = null;
  let motionAttempted = false;
  let usedFineField = false;
  const releaseMotion = () => {
    motion?.dispose();
    motion = null;
  };
  const validImage = (resource: CinematicImageResource) => resource.ready &&
    Number.isFinite(resource.width + resource.height) && resource.width > 0 && resource.height > 0;
  const ready = (value: boolean) => {
    if (disposed || value === imageReady) return;
    imageReady = value;
    if (!value) { releaseMotion(); motionAttempted = false; }
    options.onReady?.();
  };
  try {
    image = (options.imageFactory ?? browserImage)();
    imageReady = validImage(image);
    cancelLoad = image.load(ASSET_URL, () => {
      if (!disposed && image) ready(validImage(image));
    }, () => ready(false));
  } catch {
    imageReady = false;
    image = undefined;
  }

  return {
    paint(width, height, time) {
      if (disposed || !Number.isFinite(width + height) || width <= 0 || height <= 0) return;
      const seconds = Number.isFinite(time) ? Math.max(0, time) : 0;
      const sourceWidth = imageReady && image ? image.width : SOURCE_WIDTH;
      const sourceHeight = imageReady && image ? image.height : SOURCE_HEIGHT;
      const crop = atlasSourceCrop(width, height, sourceWidth, sourceHeight);
      const scale = width / (crop.width * sourceWidth);
      if (imageReady && image && !motionAttempted) {
        motionAttempted = true;
        try {
          motion = (options.motionFactory ?? createNebulaMotion)(image.source, image.width, image.height, {
            onChange() { if (!disposed) options.onReady?.(); },
          });
        } catch { motion = null; }
      }
      ctx.save();
      try {
        ctx.globalCompositeOperation = "destination-over";
        ctx.globalAlpha = 1;
        paintMeteorField(ctx, width, height, seconds);
        ATLAS_SOURCE_STARS.forEach(([sourceX, sourceY, radius, warm], index) => {
          const x = (sourceX / SOURCE_WIDTH - crop.x) / crop.width * width;
          const y = (sourceY / SOURCE_HEIGHT - crop.y) / crop.height * height;
          if (x < -20 || y < -20 || x > width + 20 || y > height + 20) return;
          // The source artwork already contains these stars. Add only restrained
          // local light at their centres, never a second star beside the original.
          paintStellarPoint(ctx, {
            x, y, radius: Math.max(.65, Math.min(2, radius * scale)),
            opacity: (imageReady ? .22 : .5) + fieldHash(index * 91 + 809) * .12,
            color: warm ? STELLAR_PALETTE.warmStar : STELLAR_PALETTE.coolStar,
            seed: 4501 + index * 117.31,
            prominence: index === 0 ? .76 : 0,
            corona: index === 0 ? undefined : .2,
          }, seconds);
        });
        if (imageReady && image) {
          let paintedMotion = false;
          if (motion) {
            try {
              const frame = motion.render(width, height, seconds);
              if (frame) { ctx.drawImage(frame, 0, 0, width, height); paintedMotion = true; }
            } catch { releaseMotion(); }
          }
          try {
            if (!paintedMotion) ctx.drawImage(image.source, crop.x * sourceWidth, crop.y * sourceHeight,
              crop.width * sourceWidth, crop.height * sourceHeight, 0, 0, width, height);
            if (usedFineField) { resetDeepField(ctx); usedFineField = false; }
          } catch {
            ready(false);
          }
        }
        if (!imageReady) {
          // The loaded artwork already has fine stars. Do not double that field
          // into white noise; the pure-code fine layer is the loading/error state.
          paintDeepField(ctx, width, height, seconds);
          usedFineField = true;
        }
        ctx.fillStyle = "#020710";
        ctx.fillRect(0, 0, width, height);
      } finally {
        ctx.restore();
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      releaseMotion();
      cancelLoad?.();
      cancelLoad = undefined;
      image = undefined;
      imageReady = false;
      if (usedFineField) resetDeepField(ctx);
      usedFineField = false;
    },
  };
}
