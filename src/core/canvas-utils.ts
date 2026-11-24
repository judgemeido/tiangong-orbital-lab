import {
  drawAdditiveGlow,
  drawBackdropImage,
  drawCinematicVignette,
} from './materials';

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function dist(x1: number, y1: number, x2: number, y2: number): number {
  return Math.hypot(x2 - x1, y2 - y1);
}

/** Shortest signed angle difference in radians (-PI..PI) */
export function angleDiff(target: number, current: number): number {
  let d = (target - current) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export interface HiDPICanvasHandle {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  getSize: () => { width: number; height: number };
  destroy: () => void;
}

/**
 * Creates a crisp devicePixelRatio-aware Canvas 2D bound to a container's ResizeObserver.
 */
export function setupHiDPICanvas(
  container: HTMLElement,
  onResize?: (width: number, height: number) => void
): HiDPICanvasHandle {
  const canvas = document.createElement('canvas');
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  container.innerHTML = '';
  container.appendChild(canvas);

  const ctx = canvas.getContext('2d')!;
  let width = Math.max(320, container.clientWidth || window.innerWidth);
  let height = Math.max(240, container.clientHeight || window.innerHeight);

  const resize = () => {
    const rect = container.getBoundingClientRect();
    width = Math.max(320, Math.floor(rect.width));
    height = Math.max(240, Math.floor(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    onResize?.(width, height);
  };

  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  return {
    canvas,
    ctx,
    getSize: () => ({ width, height }),
    destroy: () => {
      ro.disconnect();
      canvas.remove();
    },
  };
}

interface Star {
  x: number;
  y: number;
  r: number;
  alpha: number;
  twinklePhase: number;
  twinkleSpeed: number;
  tint: string;
  depth: number;
  flare: boolean;
}

/** Cinema-grade deep-space starfield with cosmic dust bands, parallax twinkle & diffraction stars */
export class StarfieldRenderer {
  private stars: Star[] = [];

  constructor(count = 175, seed = 42) {
    let s = seed;
    const rand = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0xffffffff;
    };
    const tints = ['#ffffff', '#e0f2fe', '#bae6fd', '#fef3c7', '#c7d2fe', '#93c5fd'];
    for (let i = 0; i < count; i++) {
      const r = 0.45 + Math.pow(rand(), 1.6) * 1.85;
      this.stars.push({
        x: rand(),
        y: rand(),
        r,
        alpha: 0.35 + rand() * 0.65,
        twinklePhase: rand() * Math.PI * 2,
        twinkleSpeed: 0.8 + rand() * 2.1,
        tint: tints[Math.floor(rand() * tints.length)],
        depth: 0.25 + rand() * 0.75,
        flare: r > 1.75,
      });
    }
  }

  draw(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    time: number,
    offsetX = 0,
    offsetY = 0
  ): void {
    // Rich ink-black orbital cosmos with faint astronomical nebula dust
    const bg = ctx.createRadialGradient(w * 0.24, h * 0.16, 15, w * 0.52, h * 0.55, Math.max(w, h) * 0.95);
    bg.addColorStop(0, '#0a162b');
    bg.addColorStop(0.42, '#050c1a');
    bg.addColorStop(0.82, '#030711');
    bg.addColorStop(1, '#02040a');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // Subtle cosmic dust ribbon
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const dust1 = ctx.createRadialGradient(w * 0.72, h * 0.26, 10, w * 0.72, h * 0.26, w * 0.36);
    dust1.addColorStop(0, 'rgba(30, 80, 150, 0.11)');
    dust1.addColorStop(0.6, 'rgba(18, 42, 94, 0.04)');
    dust1.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = dust1;
    ctx.fillRect(0, 0, w, h);

    const dust2 = ctx.createRadialGradient(w * 0.22, h * 0.34, 10, w * 0.22, h * 0.34, w * 0.3);
    dust2.addColorStop(0, 'rgba(56, 130, 180, 0.08)');
    dust2.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = dust2;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    for (const st of this.stars) {
      const px = (((st.x * w + offsetX * st.depth) % w) + w) % w;
      const py = (((st.y * h + offsetY * st.depth) % h) + h) % h;
      const tw = 0.68 + 0.32 * Math.sin(time * st.twinkleSpeed + st.twinklePhase);
      ctx.globalAlpha = st.alpha * tw;
      ctx.fillStyle = st.tint;
      ctx.beginPath();
      ctx.arc(px, py, st.r, 0, Math.PI * 2);
      ctx.fill();

      // Delicate astronomical 4-point diffraction spike on hero stars
      if (st.flare) {
        const sp = st.r * 3.8 * tw;
        ctx.strokeStyle = st.tint;
        ctx.lineWidth = 0.6;
        ctx.globalAlpha = st.alpha * tw * 0.45;
        ctx.beginPath();
        ctx.moveTo(px - sp, py);
        ctx.lineTo(px + sp, py);
        ctx.moveTo(px, py - sp);
        ctx.lineTo(px, py + sp);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }
}

/**
 * Cinema-grade Low-Earth-Orbit horizon renderer:
 * Uses photorealistic IMAX-style LEO backdrop when loaded (cross-fading seamlessly with orbital
 * night vista or procedural Rayleigh fallback) plus subtle animated cloud shimmer & vignette.
 */
export function drawEarthHorizon(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  time: number,
  options?: { yRatio?: number; radiusScale?: number; sunPhase?: number; nightMode?: boolean; darken?: number }
): void {
  const nightMode = options?.nightMode ?? false;
  const backdropId = nightMode ? 'earth-night' : 'leo-earth';
  const driftX = Math.sin(time * 0.06) * 8;
  const driftY = Math.cos(time * 0.05) * 3;

  // Attempt photorealistic cinema backdrop first
  const painted = drawBackdropImage(ctx, backdropId, w, h, {
    alpha: 0.94,
    offsetX: driftX,
    offsetY: driftY,
    darken: options?.darken ?? (nightMode ? 0.12 : 0.14),
  });

  if (painted) {
    // Subtle dynamic atmospheric shimmer along limb + soft vignette
    drawAdditiveGlow(ctx, w * 0.18 + driftX, h * 0.78, Math.min(w, h) * 0.34, '255, 195, 110', 0.12);
    drawCinematicVignette(ctx, w, h, 0.36);
    return;
  }

  // Fallback high-craft procedural curved Earth horizon
  const yRatio = options?.yRatio ?? 1.72;
  const radius = Math.max(w, h) * (options?.radiusScale ?? 1.15);
  const cx = w * 0.5;
  const cy = h * yRatio;
  const sunPhase = options?.sunPhase ?? 0.25;

  ctx.save();
  const halo = ctx.createRadialGradient(cx, cy, radius * 0.96, cx, cy, radius * 1.14);
  halo.addColorStop(0, 'rgba(56, 189, 248, 0.65)');
  halo.addColorStop(0.32, 'rgba(14, 165, 233, 0.25)');
  halo.addColorStop(1, 'rgba(3, 7, 18, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 1.14, Math.PI * 1.05, Math.PI * 1.95);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();

  const ocean = ctx.createLinearGradient(cx - radius * 0.6, cy - radius, cx + radius * 0.6, cy - radius * 0.35);
  ocean.addColorStop(0, '#072448');
  ocean.addColorStop(0.45, '#0b5394');
  ocean.addColorStop(0.75, '#093464');
  ocean.addColorStop(1, '#031224');
  ctx.fillStyle = ocean;
  ctx.fillRect(0, cy - radius - 20, w, radius + 40);

  ctx.strokeStyle = 'rgba(224, 242, 254, 0.26)';
  for (let i = 0; i < 7; i++) {
    const aStart = Math.PI * 1.12 + ((time * 0.008 + i * 0.18) % 0.85) - 0.15;
    ctx.lineWidth = 5 + (i % 3) * 5;
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 14 - i * 16, aStart, aStart + 0.2 + (i % 2) * 0.1);
    ctx.stroke();
  }

  const termX = cx + Math.cos(sunPhase) * radius * 0.55;
  const night = ctx.createLinearGradient(termX - 240, cy - radius, termX + 260, cy - radius + 120);
  night.addColorStop(0, 'rgba(2, 6, 15, 0)');
  night.addColorStop(0.55, 'rgba(2, 6, 15, 0.5)');
  night.addColorStop(1, 'rgba(2, 6, 15, 0.88)');
  ctx.fillStyle = night;
  ctx.fillRect(0, cy - radius - 20, w, radius + 40);

  ctx.strokeStyle = 'rgba(125, 211, 252, 0.85)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, radius - 1.5, Math.PI * 1.1, Math.PI * 1.9);
  ctx.stroke();
  ctx.restore();

  drawCinematicVignette(ctx, w, h, 0.35);
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  kind?: 'dot' | 'ring' | 'glow';
}

export class ParticleSystem {
  particles: Particle[] = [];

  spawn(p: Omit<Particle, 'maxLife'> & { maxLife?: number }): void {
    if (this.particles.length > 420) this.particles.shift();
    this.particles.push({ ...p, maxLife: p.maxLife ?? p.life });
  }

  burst(
    x: number,
    y: number,
    count: number,
    color: string,
    speed = 70,
    size = 3,
    life = 0.6
  ): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = speed * (0.35 + Math.random() * 0.85);
      this.spawn({
        x,
        y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        life: life * (0.6 + Math.random() * 0.6),
        size: size * (0.6 + Math.random() * 0.7),
        color,
        kind: i % 3 === 0 ? 'glow' : 'dot',
      });
    }
  }

  update(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    for (const p of this.particles) {
      const t = clamp(p.life / p.maxLife, 0, 1);
      if (p.kind === 'ring') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = t * 0.85;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (2.0 - t * 0.9), 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.kind === 'glow') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = t * 0.55;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(1, p.size * t * 2.1), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = t * 0.95;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.5, p.size * t * 0.6), 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = t * 0.9;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.5, p.size * t), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  clear(): void {
    this.particles.length = 0;
  }
}

/** Draws a crisp luminous physics vector arrow with subtle glow & readable badge */
export function drawVectorArrow(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  label?: string,
  lineWidth = 2
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 3) return;
  const ang = Math.atan2(dy, dx);
  const head = Math.min(10, len * 0.35);

  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 7;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - Math.cos(ang - 0.42) * head, y2 - Math.sin(ang - 0.42) * head);
  ctx.lineTo(x2 - Math.cos(ang + 0.42) * head, y2 - Math.sin(ang + 0.42) * head);
  ctx.closePath();
  ctx.fill();

  if (label) {
    ctx.shadowBlur = 0;
    ctx.font = '700 10.5px "JetBrains Mono", monospace';
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(4, 10, 22, 0.82)';
    ctx.beginPath();
    ctx.roundRect(x2 + 4, y2 - 8, tw + 8, 16, 3);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillText(label, x2 + 8, y2 + 3.5);
  }
  ctx.restore();
}

/**
 * Museum-grade Triple-Junction GaAs Photovoltaic Solar Wing Array:
 * Deep obsidian-cobalt / sunlit amber-gold wafer cells, micro silver busbars,
 * diagonal sun-glint specular reflection sweep, and brushed titanium edge frame.
 */
export function drawSolarPanelRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  litRatio = 1
): void {
  const lit = clamp(litRatio, 0.14, 1.15);
  ctx.save();

  // Subtle drop shadow
  ctx.shadowColor = 'rgba(0, 0, 0, 0.48)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;

  // Base metallic photovoltaic wafer gradient (deep space navy -> warm gold specular sheen when sunlit)
  const grad = ctx.createLinearGradient(x, y, x + w, y + h);
  const g1r = Math.round(18 + 150 * lit);
  const g1g = Math.round(32 + 102 * lit);
  const g1b = Math.round(68 - 32 * Math.min(1, lit));
  const g2r = Math.round(12 + 95 * lit);
  const g2g = Math.round(24 + 68 * lit);
  const g2b = Math.round(58 - 18 * Math.min(1, lit));
  grad.addColorStop(0, `rgb(${g1r}, ${g1g}, ${g1b})`);
  grad.addColorStop(0.45, `rgb(${g2r}, ${g2g}, ${g2b})`);
  grad.addColorStop(1, `rgb(${Math.round(g2r * 0.65)}, ${Math.round(g2g * 0.72)}, ${Math.round(g2b * 0.88)})`);

  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;

  // Clip interior wafer details
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  // Fine silver busbars + wafer cell grid
  const cols = Math.max(2, Math.floor(w / 12));
  const rows = Math.max(2, Math.floor(h / 11));
  ctx.strokeStyle = `rgba(255, 238, 185, ${(0.18 + lit * 0.2).toFixed(3)})`;
  ctx.lineWidth = 0.75;
  for (let c = 1; c < cols; c++) {
    const gx = x + (w * c) / cols;
    ctx.beginPath();
    ctx.moveTo(gx, y);
    ctx.lineTo(gx, y + h);
    ctx.stroke();
  }
  for (let r = 1; r < rows; r++) {
    const gy = y + (h * r) / rows;
    ctx.beginPath();
    ctx.moveTo(x, gy);
    ctx.lineTo(x + w, gy);
    ctx.stroke();
  }

  // Diagonal sunlit specular glass sheen across photovoltaic array
  const sheen = ctx.createLinearGradient(x, y, x + w, y + h * 0.8);
  sheen.addColorStop(0, 'rgba(255, 255, 255, 0)');
  sheen.addColorStop(0.32, `rgba(255, 245, 200, ${(0.22 * lit).toFixed(3)})`);
  sheen.addColorStop(0.48, `rgba(255, 255, 255, ${(0.34 * lit).toFixed(3)})`);
  sheen.addColorStop(0.56, 'rgba(255, 255, 255, 0)');
  sheen.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(x, y, w, h);

  // Center structural spine strut
  ctx.fillStyle = 'rgba(203, 213, 225, 0.55)';
  if (h > w) {
    ctx.fillRect(x + w * 0.5 - 1, y, 2, h);
  } else {
    ctx.fillRect(x, y + h * 0.5 - 1, w, 2);
  }
  ctx.restore();

  // Crisp anodized titanium perimeter frame
  ctx.strokeStyle = `rgba(226, 236, 248, ${(0.55 + lit * 0.3).toFixed(3)})`;
  ctx.lineWidth = 1.4;
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}
