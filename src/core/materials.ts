import { clamp } from './canvas-utils';

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
  const cell = 12;
  const pts: { x: number; y: number }[][] = [];
  const cols = size / cell;
  for (let y = 0; y <= cols; y++) {
    pts[y] = [];
    for (let x = 0; x <= cols; x++) {
      const jx = x === 0 || x === cols ? 0 : (rand() - 0.5) * 7;
      const jy = y === 0 || y === cols ? 0 : (rand() - 0.5) * 7;
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

export function getMLIPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (!mliCanvas) mliCanvas = buildMLICanvas();
  return ctx.createPattern(mliCanvas, 'repeat');
}

export function getTitaniumPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (!titaniumCanvas) titaniumCanvas = buildTitaniumCanvas();
  return ctx.createPattern(titaniumCanvas, 'repeat');
}

export function getCarbonPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (!carbonCanvas) carbonCanvas = buildCarbonCanvas();
  return ctx.createPattern(carbonCanvas, 'repeat');
}

// ---------------- Volumetric Lighting, Bloom & Hard-Surface Renderers ----------------

/** Multi-pass additive bloom glow (creates genuine optical radiance instead of flat circles) */
export function drawAdditiveGlow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  colorRgb: string,
  alpha = 0.65
): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, `rgba(${colorRgb}, ${clamp(alpha, 0, 1)})`);
  g.addColorStop(0.32, `rgba(${colorRgb}, ${clamp(alpha * 0.42, 0, 1)})`);
  g.addColorStop(0.7, `rgba(${colorRgb}, ${clamp(alpha * 0.1, 0, 1)})`);
  g.addColorStop(1, `rgba(${colorRgb}, 0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Cinematic orbital sun with anamorphic streak flare & diffraction halo */
export function drawSunLensFlare(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  intensity = 1
): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // Broad warm corona
  drawAdditiveGlow(ctx, x, y, radius * 5.2, '255, 190, 90', 0.34 * intensity);
  drawAdditiveGlow(ctx, x, y, radius * 2.4, '255, 232, 165', 0.62 * intensity);
  drawAdditiveGlow(ctx, x, y, radius * 1.15, '255, 252, 240', 0.95 * intensity);

  // Horizontal anamorphic blue-gold streak
  const streakW = radius * 9;
  const streak = ctx.createLinearGradient(x - streakW, y, x + streakW, y);
  streak.addColorStop(0, 'rgba(120, 210, 255, 0)');
  streak.addColorStop(0.38, `rgba(140, 220, 255, ${(0.18 * intensity).toFixed(3)})`);
  streak.addColorStop(0.5, `rgba(255, 248, 225, ${(0.55 * intensity).toFixed(3)})`);
  streak.addColorStop(0.62, `rgba(140, 220, 255, ${(0.18 * intensity).toFixed(3)})`);
  streak.addColorStop(1, 'rgba(120, 210, 255, 0)');
  ctx.fillStyle = streak;
  ctx.fillRect(x - streakW, y - Math.max(1.5, radius * 0.12), streakW * 2, Math.max(3, radius * 0.24));

  // Subtle diffraction hex ring
  ctx.strokeStyle = `rgba(255, 225, 160, ${(0.18 * intensity).toFixed(3)})`;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(x, y, radius * 2.9, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}

/**
 * Photorealistic cylindrical spacecraft/station module with:
 * - Multi-stop cylindrical metallic shading (specular highlight ridge + orbital rim light)
 * - Brushed titanium surface micro-grain overlay
 * - Structural bulkheads, recessed seams & precision rivets
 * - Optional crinkled gold MLI thermal insulation bands
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
    mliBands?: number[]; // normalized 0..1 offsets for gold MLI foil wraps
    rivets?: boolean;
    rimGlow?: string;
  }
): void {
  const vertical = options?.vertical ?? false;
  const r = options?.radius ?? 8;

  ctx.save();

  // Subtle ambient shadow behind hull
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 5;

  const grad = vertical
    ? ctx.createLinearGradient(x, y, x + w, y)
    : ctx.createLinearGradient(x, y, x, y + h);

  // Realistic sunlit cylinder falloff (specular band at 22%, soft titanium midtone, deep terminator shadow, subtle earth-albedo bounce at 94%)
  grad.addColorStop(0, '#9fb6d1');
  grad.addColorStop(0.14, '#eef5fc');
  grad.addColorStop(0.24, '#ffffff');
  grad.addColorStop(0.46, '#b7c9de');
  grad.addColorStop(0.76, '#506784');
  grad.addColorStop(0.92, '#22334b');
  grad.addColorStop(1, '#365578'); // Earth blue albedo rim bounce!

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();

  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // Clip interior details strictly to module silhouette
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.clip();

  // Brushed metal surface micro-grain
  const grain = getTitaniumPattern(ctx);
  if (grain) {
    ctx.fillStyle = grain;
    ctx.fillRect(x, y, w, h);
  }

  // Optional Crinkled Gold MLI Thermal Foil bands
  if (options?.mliBands && options.mliBands.length > 0) {
    const mli = getMLIPattern(ctx);
    for (const pos of options.mliBands) {
      if (mli) {
        ctx.fillStyle = mli;
        if (vertical) {
          const by = y + h * pos;
          const bh = Math.max(10, h * 0.11);
          ctx.fillRect(x, by, w, bh);
          // Cylindrical shadow wrap over gold foil
          const wrap = ctx.createLinearGradient(x, by, x + w, by);
          wrap.addColorStop(0, 'rgba(255,245,200,0.22)');
          wrap.addColorStop(0.25, 'rgba(255,255,255,0.28)');
          wrap.addColorStop(0.8, 'rgba(15,10,2,0.52)');
          wrap.addColorStop(1, 'rgba(30,55,95,0.35)');
          ctx.fillStyle = wrap;
          ctx.fillRect(x, by, w, bh);
        } else {
          const bx = x + w * pos;
          const bw = Math.max(12, w * 0.1);
          ctx.fillRect(bx, y, bw, h);
          const wrap = ctx.createLinearGradient(bx, y, bx, y + h);
          wrap.addColorStop(0, 'rgba(255,245,200,0.22)');
          wrap.addColorStop(0.24, 'rgba(255,255,255,0.3)');
          wrap.addColorStop(0.8, 'rgba(15,10,2,0.55)');
          wrap.addColorStop(1, 'rgba(30,55,95,0.35)');
          ctx.fillStyle = wrap;
          ctx.fillRect(bx, y, bw, h);
        }
      }
    }
  }

  // Embossed panel seam lines (dark groove + bright highlight edge)
  const step = vertical ? 30 : 38;
  const limit = vertical ? h : w;
  for (let d = step; d < limit - 10; d += step) {
    ctx.strokeStyle = 'rgba(8, 16, 30, 0.42)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    if (vertical) {
      ctx.moveTo(x, y + d);
      ctx.lineTo(x + w, y + d);
    } else {
      ctx.moveTo(x + d, y);
      ctx.lineTo(x + d, y + h);
    }
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.34)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    if (vertical) {
      ctx.moveTo(x, y + d + 1.2);
      ctx.lineTo(x + w, y + d + 1.2);
    } else {
      ctx.moveTo(x + d + 1.2, y);
      ctx.lineTo(x + d + 1.2, y + h);
    }
    ctx.stroke();

    if (options?.rivets !== false) {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.45)';
      if (vertical) {
        ctx.fillRect(x + 6, y + d - 4, 2, 2);
        ctx.fillRect(x + w - 8, y + d - 4, 2, 2);
      } else {
        ctx.fillRect(x + d - 4, y + 6, 2, 2);
        ctx.fillRect(x + d - 4, y + h - 8, 2, 2);
      }
    }
  }
  ctx.restore();

  // Crisp metallic outer rim stroke
  ctx.strokeStyle = options?.rimGlow ?? 'rgba(226, 240, 255, 0.65)';
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.stroke();

  ctx.restore();
}

/** Recessed optical glass viewport with metallic bezel & diagonal specular reflection */
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
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.fill();

  // Diagonal curved glass specular highlight
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.clip();

  const sheen = ctx.createLinearGradient(x, y, x + w * 0.65, y + h * 0.65);
  sheen.addColorStop(0, 'rgba(255, 255, 255, 0.28)');
  sheen.addColorStop(0.28, 'rgba(255, 255, 255, 0.06)');
  sheen.addColorStop(0.32, 'rgba(255, 255, 255, 0)');
  sheen.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(x, y, w, h);

  // Subtle recessed inner bevel shadow
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.lineWidth = 2.5;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.restore();

  // Crisp metallic outer bezel
  ctx.strokeStyle = 'rgba(148, 197, 255, 0.55)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.stroke();
  ctx.restore();
}

/** Subtle cinema-grade edge vignette + micro-HUD atmosphere to unify Canvas & Sci-Fi UI */
export function drawCinematicVignette(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  strength = 0.38
): void {
  ctx.save();
  const vig = ctx.createRadialGradient(
    w * 0.5,
    h * 0.48,
    Math.min(w, h) * 0.34,
    w * 0.5,
    h * 0.5,
    Math.max(w, h) * 0.78
  );
  vig.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vig.addColorStop(0.75, `rgba(2, 6, 16, ${(strength * 0.45).toFixed(3)})`);
  vig.addColorStop(1, `rgba(2, 5, 14, ${strength.toFixed(3)})`);
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}
