import { clamp } from './canvas-utils';
import { getModelSprite } from './model-sprites';
import { isLowPerf } from './perf-profile';

/**
 * Aerospace PBR-Like Procedural Material, Texture & Cinema Backdrop Engine
 * Provides cached hi-res procedural textures (crinkled Kapton MLI gold foil,
 * brushed titanium alloy, carbon composite, GaAs solar wafer cells),
 * async-loaded cinema-grade space/lab backdrops, and additive volumetric lighting helpers.
 */

export type BackdropId = 'leo-earth' | 'earth-night' | 'lab-interior';

const BACKDROP_PATHS: Record<BackdropId, string> = {
  'leo-earth': './assets/leo-earth-vista.jpg',
  'earth-night': './assets/earth-orbital-night.jpg',
  'lab-interior': './assets/lab-interior-hull.jpg',
};

const imageCache = new Map<BackdropId, HTMLImageElement>();
const imageLoaded = new Set<BackdropId>();
const glowSpriteCache = new Map<string, HTMLCanvasElement>();
const bakedBackdropCache = new Map<string, HTMLCanvasElement>();
const MAX_BAKED_BACKDROPS = 4;

export function preloadAerospaceAssets(): void {
  (Object.keys(BACKDROP_PATHS) as BackdropId[]).forEach((id) => {
    if (imageCache.has(id)) return;
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => imageLoaded.add(id);
    img.src = BACKDROP_PATHS[id];
    imageCache.set(id, img);
  });
}

// Kick off preload immediately on module import
preloadAerospaceAssets();

/**
 * Draws a cinema-grade backdrop image with aspect-cover scaling, subtle parallax drift,
 * and controllable atmospheric opacity over the underlying procedural canvas sky.
 */
export function drawBackdropImage(
  ctx: CanvasRenderingContext2D,
  id: BackdropId,
  w: number,
  h: number,
  options?: { alpha?: number; offsetX?: number; offsetY?: number; darken?: number }
): boolean {
  const img = imageCache.get(id);
  if (!img || !imageLoaded.has(id) || img.naturalWidth === 0) return false;

  const alpha = options?.alpha ?? 1;
  const ox = options?.offsetX ?? 0;
  const oy = options?.offsetY ?? 0;
  const darken = options?.darken ?? 0;

  const pad = Math.max(Math.abs(ox), Math.abs(oy)) + 6;
  const targetW = w + pad * 2;
  const targetH = h + pad * 2;
  const imgRatio = img.naturalWidth / img.naturalHeight;
  const boxRatio = targetW / targetH;

  let dw = targetW;
  let dh = targetH;
  if (imgRatio > boxRatio) {
    dw = targetH * imgRatio;
  } else {
    dh = targetW / imgRatio;
  }

  const dx = (w - dw) * 0.5 + ox;
  const dy = (h - dh) * 0.5 + oy;

  ctx.save();
  ctx.globalAlpha = clamp(alpha, 0, 1);
  ctx.drawImage(img, dx, dy, dw, dh);
  if (darken > 0) {
    ctx.fillStyle = `rgba(3, 7, 18, ${clamp(darken, 0, 0.92)})`;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
  return true;
}

/**
 * Ultra-low-GPU pre-baked 1:1 static backdrop cache:
 * Composites the JPEG + dark tint + radial vignette ONCE per (id, width, height) onto an opaque
 * offscreen canvas, so every 60fps animation frame is 1 single 1:1 integer pixel copy (`drawImage`).
 */
export function drawBakedBackdrop(
  ctx: CanvasRenderingContext2D,
  id: BackdropId,
  w: number,
  h: number,
  darken = 0.2,
  vignette = 0.3
): boolean {
  const img = imageCache.get(id);
  if (!img || !imageLoaded.has(id) || img.naturalWidth === 0) return false;

  const cw = Math.max(1, Math.floor(w));
  const ch = Math.max(1, Math.floor(h));
  const dk = Math.round(clamp(darken, 0, 0.92) * 20);
  const vk = Math.round(clamp(vignette, 0, 0.9) * 20);
  const key = `${id}_${cw}x${ch}_${dk}_${vk}`;

  let baked = bakedBackdropCache.get(key);
  if (baked) {
    // Refresh LRU order
    bakedBackdropCache.delete(key);
    bakedBackdropCache.set(key, baked);
    ctx.drawImage(baked, 0, 0, w, h);
    return true;
  }

  baked = document.createElement('canvas');
  baked.width = cw;
  baked.height = ch;
  const bctx = baked.getContext('2d', { alpha: false })!;
  bctx.fillStyle = '#030711';
  bctx.fillRect(0, 0, cw, ch);

  const imgRatio = img.naturalWidth / img.naturalHeight;
  const boxRatio = cw / ch;
  let dw = cw;
  let dh = ch;
  if (imgRatio > boxRatio) {
    dw = ch * imgRatio;
  } else {
    dh = cw / imgRatio;
  }
  bctx.drawImage(img, (cw - dw) * 0.5, (ch - dh) * 0.5, dw, dh);

  if (dk > 0) {
    bctx.fillStyle = `rgba(3, 7, 18, ${(dk / 20).toFixed(2)})`;
    bctx.fillRect(0, 0, cw, ch);
  }
  if (vk > 0) {
    drawCinematicVignette(bctx, cw, ch, vk / 20);
  }

  if (bakedBackdropCache.size >= MAX_BAKED_BACKDROPS) {
    const oldestKey = bakedBackdropCache.keys().next().value;
    if (oldestKey !== undefined) bakedBackdropCache.delete(oldestKey);
  }
  bakedBackdropCache.set(key, baked);
  ctx.drawImage(baked, 0, 0, w, h);
  return true;
}

// ---------------- Cached Procedural Offscreen Surface Textures ----------------

let mliCanvas: HTMLCanvasElement | null = null;
let titaniumCanvas: HTMLCanvasElement | null = null;
let carbonCanvas: HTMLCanvasElement | null = null;

function seededRand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/** Generates crinkled multi-layer insulation (MLI) Kapton gold foil with crystalline specular facets */
function buildMLICanvas(): HTMLCanvasElement {
  const size = 96;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d')!;
  const rand = seededRand(7721);

  g.fillStyle = '#9a6510';
  g.fillRect(0, 0, size, size);

  // Faceted crinkle triangles simulating real gold Kapton blanket reflections
  const cell = 8;
  const pts: { x: number; y: number }[][] = [];
  const cols = size / cell;
  for (let y = 0; y <= cols; y++) {
    pts[y] = [];
    for (let x = 0; x <= cols; x++) {
      const jx = x === 0 || x === cols ? 0 : (rand() - 0.5) * 5;
      const jy = y === 0 || y === cols ? 0 : (rand() - 0.5) * 5;
      pts[y][x] = { x: x * cell + jx, y: y * cell + jy };
    }
  }

  const shades = ['#5c3807', '#7c4c0a', '#a16612', '#c78519', '#e5a92b', '#f8d068', '#fff0b3'];
  for (let y = 0; y < cols; y++) {
    for (let x = 0; x < cols; x++) {
      const p00 = pts[y][x];
      const p10 = pts[y][x + 1];
      const p01 = pts[y + 1][x];
      const p11 = pts[y + 1][x + 1];

      const drawTri = (a: { x: number; y: number }, b: { x: number; y: number }, d: { x: number; y: number }) => {
        const idx = Math.floor(Math.pow(rand(), 0.85) * shades.length);
        g.fillStyle = shades[clamp(idx, 0, shades.length - 1)];
        g.beginPath();
        g.moveTo(a.x, a.y);
        g.lineTo(b.x, b.y);
        g.lineTo(d.x, d.y);
        g.closePath();
        g.fill();
      };
      drawTri(p00, p10, p11);
      drawTri(p00, p11, p01);
    }
  }
  return c;
}

/** Generates fine anisotropic brushed aerospace titanium alloy grain */
function buildTitaniumCanvas(): HTMLCanvasElement {
  const size = 96;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d')!;
  const rand = seededRand(4099);

  g.fillStyle = 'rgba(226, 232, 240, 0)';
  g.fillRect(0, 0, size, size);

  for (let i = 0; i < 240; i++) {
    const y = rand() * size;
    const x = rand() * size;
    const len = 14 + rand() * 44;
    const bright = rand() > 0.5;
    g.strokeStyle = bright ? 'rgba(255, 255, 255, 0.09)' : 'rgba(15, 23, 42, 0.1)';
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + len, y);
    g.stroke();
  }
  return c;
}

/** Generates dark micro carbon-fiber weave pattern */
function buildCarbonCanvas(): HTMLCanvasElement {
  const size = 16;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0e1726';
  g.fillRect(0, 0, size, size);
  g.fillStyle = '#19263c';
  g.fillRect(0, 0, 8, 8);
  g.fillRect(8, 8, 8, 8);
  g.fillStyle = 'rgba(255,255,255,0.04)';
  g.fillRect(0, 0, 8, 2);
  g.fillRect(8, 8, 8, 2);
  return c;
}

interface CtxPatternCache {
  mliReal?: CanvasPattern | null;
  mliProc?: CanvasPattern | null;
  titanium?: CanvasPattern | null;
  carbon?: CanvasPattern | null;
}

const patternCacheMap = new WeakMap<CanvasRenderingContext2D, CtxPatternCache>();
const vignetteCacheMap = new Map<number, HTMLCanvasElement>();

function getPatternBucket(ctx: CanvasRenderingContext2D): CtxPatternCache {
  let bucket = patternCacheMap.get(ctx);
  if (!bucket) {
    bucket = {};
    patternCacheMap.set(ctx, bucket);
  }
  return bucket;
}

export function getMLIPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  const bucket = getPatternBucket(ctx);
  const realMli = getModelSprite('mli-gold-real');
  if (realMli) {
    if (bucket.mliReal === undefined) {
      bucket.mliReal = ctx.createPattern(realMli, 'repeat');
    }
    return bucket.mliReal;
  }
  if (bucket.mliProc === undefined) {
    if (!mliCanvas) mliCanvas = buildMLICanvas();
    bucket.mliProc = ctx.createPattern(mliCanvas, 'repeat');
  }
  return bucket.mliProc;
}

export function getTitaniumPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  const bucket = getPatternBucket(ctx);
  if (bucket.titanium === undefined) {
    if (!titaniumCanvas) titaniumCanvas = buildTitaniumCanvas();
    bucket.titanium = ctx.createPattern(titaniumCanvas, 'repeat');
  }
  return bucket.titanium;
}

export function getCarbonPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  const bucket = getPatternBucket(ctx);
  if (bucket.carbon === undefined) {
    if (!carbonCanvas) carbonCanvas = buildCarbonCanvas();
    bucket.carbon = ctx.createPattern(carbonCanvas, 'repeat');
  }
  return bucket.carbon;
}

// ---------------- Volumetric Lighting, Bloom & Hard-Surface Renderers ----------------

/** Cached 32x32 radial halo sprite per RGB tuple (zero per-frame gradients or 'lighter' passes) */
function getGlowSprite(colorRgb: string): HTMLCanvasElement {
  let tex = glowSpriteCache.get(colorRgb);
  if (tex) return tex;

  const s = 32;
  tex = document.createElement('canvas');
  tex.width = s;
  tex.height = s;
  const gctx = tex.getContext('2d')!;
  const g = gctx.createRadialGradient(s * 0.5, s * 0.5, 0, s * 0.5, s * 0.5, s * 0.5);
  g.addColorStop(0, `rgba(${colorRgb}, 1)`);
  g.addColorStop(0.35, `rgba(${colorRgb}, 0.42)`);
  g.addColorStop(0.72, `rgba(${colorRgb}, 0.1)`);
  g.addColorStop(1, `rgba(${colorRgb}, 0)`);
  gctx.fillStyle = g;
  gctx.fillRect(0, 0, s, s);
  glowSpriteCache.set(colorRgb, tex);
  return tex;
}

/** Ultra-fast cached sprite halo in 'source-over' (zero GPU gradient allocations or blend-mode flushes) */
export function drawAdditiveGlow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  colorRgb: string,
  alpha = 0.65
): void {
  if (radius <= 0.5 || alpha <= 0.01) return;
  if (isLowPerf() && radius < 18 && alpha < 0.55) return;

  const tex = getGlowSprite(colorRgb);
  ctx.save();
  ctx.globalAlpha = clamp(alpha * 0.72, 0, 0.75);
  ctx.drawImage(tex, x - radius, y - radius, radius * 2, radius * 2);
  ctx.restore();
}

/** Lightweight orbital sun disc (zero gradients, zero anamorphic streaks) */
export function drawSunLensFlare(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  intensity = 1
): void {
  if (isLowPerf()) return;
  ctx.save();
  ctx.fillStyle = `rgba(255, 210, 120, ${(0.22 * intensity).toFixed(3)})`;
  ctx.beginPath();
  ctx.arc(x, y, radius * 2.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = `rgba(255, 248, 225, ${(0.88 * intensity).toFixed(3)})`;
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.75, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Lightweight cylindrical spacecraft/station module without shadowBlur, clip(), or full-rect grain passes.
 */
export function drawTitaniumModule(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  options?: {
    vertical?: boolean;
    radius?: number;
    mliBands?: number[];
    rivets?: boolean;
    rimGlow?: string;
  }
): void {
  const vertical = options?.vertical ?? false;
  const r = options?.radius ?? 8;

  ctx.save();
  const grad = vertical
    ? ctx.createLinearGradient(x, y, x + w, y)
    : ctx.createLinearGradient(x, y, x, y + h);

  grad.addColorStop(0, '#9fb6d1');
  grad.addColorStop(0.22, '#ffffff');
  grad.addColorStop(0.5, '#b7c9de');
  grad.addColorStop(0.85, '#3b516e');
  grad.addColorStop(1, '#365578');

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();

  // Flat gold Kapton MLI bands without clip/pattern allocations
  if (options?.mliBands && options.mliBands.length > 0) {
    ctx.fillStyle = 'rgba(217, 148, 28, 0.78)';
    for (const pos of options.mliBands) {
      if (vertical) {
        ctx.fillRect(x + 1, y + h * pos, Math.max(0, w - 2), Math.max(8, h * 0.1));
      } else {
        ctx.fillRect(x + w * pos, y + 1, Math.max(10, w * 0.1), Math.max(0, h - 2));
      }
    }
  }

  // Subtle seam strokes
  const step = vertical ? 32 : 40;
  const limit = vertical ? h : w;
  ctx.strokeStyle = 'rgba(8, 16, 30, 0.36)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let d = step; d < limit - 10; d += step) {
    if (vertical) {
      ctx.moveTo(x + 1, y + d);
      ctx.lineTo(x + w - 1, y + d);
    } else {
      ctx.moveTo(x + d, y + 1);
      ctx.lineTo(x + d, y + h - 1);
    }
  }
  ctx.stroke();

  ctx.strokeStyle = options?.rimGlow ?? 'rgba(226, 240, 255, 0.65)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.stroke();
  ctx.restore();
}

/** Lightweight optical glass viewport bezel without clip() or gradient sheen */
export function drawGlassViewport(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius = 6,
  tintColor = 'rgba(56, 189, 248, 0.16)'
): void {
  ctx.save();
  ctx.fillStyle = tintColor;
  ctx.strokeStyle = 'rgba(148, 197, 255, 0.55)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** Subtle cinema-grade edge vignette cached into a compact offscreen texture (zero per-frame gradient allocation) */
export function drawCinematicVignette(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  strength = 0.38
): void {
  const key = Math.round(clamp(strength, 0.05, 0.9) * 20);
  let vigCanvas = vignetteCacheMap.get(key);
  if (!vigCanvas) {
    const s = 256;
    vigCanvas = document.createElement('canvas');
    vigCanvas.width = s;
    vigCanvas.height = s;
    const vctx = vigCanvas.getContext('2d')!;
    const st = key / 20;
    const vig = vctx.createRadialGradient(s * 0.5, s * 0.48, s * 0.28, s * 0.5, s * 0.5, s * 0.72);
    vig.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vig.addColorStop(0.75, `rgba(2, 6, 16, ${(st * 0.45).toFixed(3)})`);
    vig.addColorStop(1, `rgba(2, 5, 14, ${st.toFixed(3)})`);
    vctx.fillStyle = vig;
    vctx.fillRect(0, 0, s, s);
    vignetteCacheMap.set(key, vigCanvas);
  }
  ctx.drawImage(vigCanvas, 0, 0, w, h);
}
