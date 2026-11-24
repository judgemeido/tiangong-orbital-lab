import { clamp } from './canvas-utils';

export type ModelSpriteId =
  | 'tiangong-hub'
  | 'shenzhou-side'
  | 'tianhe-dock-side'
  | 'solar-wing'
  | 'station-core-top'
  | 'eva-station-hull'
  | 'mli-gold-real'
  | 'feitian-eva'
  | 'robot-arm-boom'
  | 'robot-arm-joint'
  | 'robot-arm-effector'
  | 'science-payload';

const MODEL_SPRITE_PATHS: Record<ModelSpriteId, string> = {
  'tiangong-hub': './assets/models/tiangong-hub.png',
  'shenzhou-side': './assets/models/shenzhou-side.png',
  'tianhe-dock-side': './assets/models/tianhe-dock-side.png',
  'solar-wing': './assets/models/solar-wing.png',
  'station-core-top': './assets/models/station-core-top.png',
  'eva-station-hull': './assets/models/eva-station-hull.png',
  'mli-gold-real': './assets/models/mli-gold-real.png',
  'feitian-eva': './assets/models/feitian-eva.png',
  'robot-arm-boom': './assets/models/robot-arm-boom.png',
  'robot-arm-joint': './assets/models/robot-arm-joint.png',
  'robot-arm-effector': './assets/models/robot-arm-effector.png',
  'science-payload': './assets/models/science-payload.png',
};

const spriteCache = new Map<ModelSpriteId, HTMLImageElement>();
const spriteLoaded = new Set<ModelSpriteId>();

export function preloadModelSprites(): void {
  (Object.keys(MODEL_SPRITE_PATHS) as ModelSpriteId[]).forEach((id) => {
    if (spriteCache.has(id)) return;
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (img.naturalWidth > 0) spriteLoaded.add(id);
    };
    img.src = MODEL_SPRITE_PATHS[id];
    spriteCache.set(id, img);
  });
}

preloadModelSprites();

export function getModelSprite(id: ModelSpriteId): HTMLImageElement | null {
  const img = spriteCache.get(id);
  if (!img || !spriteLoaded.has(id) || img.naturalWidth === 0) return null;
  return img;
}

export function isModelSpriteLoaded(id: ModelSpriteId): boolean {
  return getModelSprite(id) !== null;
}

export interface DrawModelSpriteOptions {
  alpha?: number;
  flipX?: boolean;
  flipY?: boolean;
  rotation?: number;
  brightness?: number;
  shadowBlur?: number;
  shadowColor?: string;
}

/**
 * Draws a preloaded transparent 3D-rendered aerospace model sprite inside the given rect
 * (x, y, w, h) with optional rotation around center, flipping, brightness modulation, and shadow.
 */
export function drawModelSprite(
  ctx: CanvasRenderingContext2D,
  id: ModelSpriteId,
  x: number,
  y: number,
  w: number,
  h: number,
  options?: DrawModelSpriteOptions
): boolean {
  const img = getModelSprite(id);
  if (!img) return false;

  const hasAlpha = options?.alpha !== undefined;
  const hasRot = Boolean(options?.rotation);
  const hasFlip = Boolean(options?.flipX || options?.flipY);
  const brightMod = options?.brightness !== undefined && options.brightness < 0.92 && !hasAlpha;

  // Fast path: direct drawImage when no transform/opacity needed
  if (!hasAlpha && !hasRot && !hasFlip && !brightMod) {
    ctx.drawImage(img, x, y, w, h);
    return true;
  }

  ctx.save();
  if (hasAlpha) {
    ctx.globalAlpha = clamp(options!.alpha!, 0, 1);
  } else if (brightMod) {
    ctx.globalAlpha = clamp(0.45 + options!.brightness! * 0.55, 0.45, 1);
  }

  const cx = x + w * 0.5;
  const cy = y + h * 0.5;
  ctx.translate(cx, cy);
  if (hasRot) ctx.rotate(options!.rotation!);
  if (hasFlip) ctx.scale(options?.flipX ? -1 : 1, options?.flipY ? -1 : 1);
  ctx.drawImage(img, -w * 0.5, -h * 0.5, w, h);
  ctx.restore();
  return true;
}
