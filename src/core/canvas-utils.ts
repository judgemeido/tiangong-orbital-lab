import {
  drawBakedBackdrop,
  drawCinematicVignette,
} from './materials';
import { getModelSprite } from './model-sprites';
import { getMaxDpr, isLowPerf, subscribePerf } from './perf-profile';

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

  const ctx = canvas.getContext('2d', { alpha: false })!;
  let width = Math.max(320, container.clientWidth || window.innerWidth);
  let height = Math.max(240, container.clientHeight || window.innerHeight);

  const resize = () => {
    const rect = container.getBoundingClientRect();
    width = Math.max(320, Math.floor(rect.width));
    height = Math.max(240, Math.floor(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, getMaxDpr());
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    onResize?.(width, height);
  };

  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  const unsubPerf = subscribePerf(() => resize());

  return {
    canvas,
    ctx,
    getSize: () => ({ width, height }),
    destroy: () => {
      unsubPerf();
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

/** Lightweight starfield fallback rendered as solid dark void + max 45 fast fillRect stars */
export class StarfieldRenderer {
  private stars: Star[] = [];

  constructor(count = 175, seed = 42) {
    const cap = Math.min(count, 45);
    let s = seed;
    const rand = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0xffffffff;
    };
    const tints = ['#ffffff', '#e0f2fe', '#bae6fd', '#fef3c7'];
    for (let i = 0; i < cap; i++) {
      this.stars.push({
        x: rand(),
        y: rand(),
        r: 0.7 + rand() * 1.1,
        alpha: 0.4 + rand() * 0.55,
        twinklePhase: 0,
        twinkleSpeed: 0,
        tint: tints[Math.floor(rand() * tints.length)],
        depth: 0.25 + rand() * 0.65,
        flare: false,
      });
    }
  }

  draw(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    _time: number,
    offsetX = 0,
    offsetY = 0
  ): void {
    ctx.fillStyle = '#030711';
    ctx.fillRect(0, 0, w, h);

    for (let i = 0; i < this.stars.length; i++) {
      const st = this.stars[i];
      const px = (((st.x * w + offsetX * st.depth) % w) + w) % w;
      const py = (((st.y * h + offsetY * st.depth) % h) + h) % h;
      ctx.globalAlpha = st.alpha;
      ctx.fillStyle = st.tint;
      ctx.fillRect(px, py, st.r * 1.6, st.r * 1.6);
    }
    ctx.globalAlpha = 1;
  }
}

/**
 * Low-Earth-Orbit horizon renderer:
 * Uses pre-baked 1:1 offscreen backdrop cache (1 integer drawImage per frame).
 */
export function drawEarthHorizon(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  _time: number,
  options?: { yRatio?: number; radiusScale?: number; sunPhase?: number; nightMode?: boolean; darken?: number }
): void {
  const nightMode = options?.nightMode ?? false;
  const backdropId = nightMode ? 'earth-night' : 'leo-earth';
  const painted = drawBakedBackdrop(
    ctx,
    backdropId,
    w,
    h,
    options?.darken ?? (nightMode ? 0.14 : 0.16),
    0.32
  );
  if (painted) return;

  const time = _time;
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
    const cap = isLowPerf() ? 36 : 64;
    if (this.particles.length >= cap) this.particles.shift();
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
    const n = isLowPerf() ? Math.min(count, 6) : Math.min(count, 10);
    for (let i = 0; i < n; i++) {
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
        kind: 'dot',
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
    if (this.particles.length === 0) return;
    ctx.save();
    for (const p of this.particles) {
      const t = clamp(p.life / p.maxLife, 0, 1);
      if (p.kind === 'ring') {
        ctx.globalAlpha = t * 0.85;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (2.0 - t * 0.9), 0, Math.PI * 2);
        ctx.stroke();
      } else {
        const s = Math.max(1.5, p.size * t * 1.9);
        ctx.globalAlpha = t * 0.9;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - s * 0.5, p.y - s * 0.5, s, s);
      }
    }
    ctx.restore();
  }

  clear(): void {
    this.particles.length = 0;
  }
}

/** Draws a crisp physics vector arrow without shadowBlur overhead */
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
 * Triple-Junction GaAs Photovoltaic Solar Wing Array:
 * Pure sprite blit + lightweight incidence dark overlay + 1px border (zero shadowBlur/gradients).
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
  const wingImg = getModelSprite('solar-wing');

  if (wingImg) {
    if (h > w) {
      ctx.save();
      ctx.translate(x + w * 0.5, y + h * 0.5);
      ctx.rotate(Math.PI * 0.5);
      ctx.drawImage(wingImg, -h * 0.5, -w * 0.5, h, w);
      ctx.restore();
    } else {
      ctx.drawImage(wingImg, x, y, w, h);
    }

    if (lit < 0.92) {
      ctx.fillStyle = `rgba(4, 10, 24, ${clamp((1 - lit) * 0.72, 0, 0.72).toFixed(2)})`;
      ctx.fillRect(x, y, w, h);
    }
    ctx.strokeStyle = `rgba(226, 238, 255, ${(0.36 + lit * 0.34).toFixed(2)})`;
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);
    return;
  }

  ctx.save();
  ctx.fillStyle = lit > 0.6 ? '#1e3a5f' : '#0f1f38';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = `rgba(226, 236, 248, ${(0.55 + lit * 0.3).toFixed(2)})`;
  ctx.lineWidth = 1.2;
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}
