import { drawFeitianAstronaut3D, drawRoboticArm3D } from '../core/aerospace-models';
import {
  drawEarthHorizon,
  setupHiDPICanvas,
  StarfieldRenderer,
} from '../core/canvas-utils';
import { drawBakedBackdrop } from '../core/materials';
import { drawModelSprite } from '../core/model-sprites';
import type { AudioAPI, GameId, GameMeta } from '../core/game-interface';
import type { SaveStore } from '../core/save-store';
import { attachArwesFrame } from './arwes-frames';
import { GAME_ICONS, UI_ICONS } from './icons';

interface StationCallout {
  mx: number;
  my: number;
  cx: number;
  cy: number;
}

/**
 * Unobstructed perimeter callout anchors in station-local coordinates:
 * Keeps all 8 chamfered holographic pins cleanly outside the 3D Tiangong Space Station silhouette
 * while connecting each pin to its target cabin via luminous cyan leader lines.
 */
const STATION_CALLOUTS: Record<GameId, StationCallout> = {
  docking: { mx: 0, my: -102, cx: 120, cy: -168 },
  solar: { mx: -234, my: -94, cx: -372, cy: -136 },
  eva: { mx: -158, my: -48, cx: -386, cy: -12 },
  botany: { mx: -118, my: -4, cx: -372, cy: 118 },
  eclss: { mx: 0, my: 112, cx: -178, cy: 168 },
  'robotic-arm': { mx: 114, my: -58, cx: 372, cy: -136 },
  'zero-g-lab': { mx: 122, my: -4, cx: 386, cy: -12 },
  debris: { mx: 44, my: 160, cx: 368, cy: 118 },
};

/**
 * Museum-Grade Interactive Space Station Panorama Hub (Tiangong T-Configuration)
 * Features studio-rendered 3D Tiangong & Shenzhou spacecraft models, sculpted Feitian EVA astronaut,
 * IMAX LEO Earth vista, Arwes SVG HUD brackets, Augmented-UI deck cards, and unobscured holographic leader pins.
 */
export class StationHub {
  readonly element: HTMLElement;
  private metas: GameMeta[];
  private save: SaveStore;
  private audio: AudioAPI;
  private onLaunchGame: (id: GameId) => void;

  private rafId = 0;
  private starfield = new StarfieldRenderer(190, 108);
  private canvasHandle!: ReturnType<typeof setupHiDPICanvas>;
  private hoveredId: GameId | null = null;
  private pinEls = new Map<GameId, HTMLButtonElement>();
  private cardEls = new Map<GameId, HTMLButtonElement>();
  private pinPositions = new Map<GameId, { px: number; py: number }>();
  private readinessValEl!: HTMLElement;
  private starsValEl!: HTMLElement;
  private codexValEl!: HTMLElement;
  private unsubscribeSave: () => void;
  private frameCleanups: (() => void)[] = [];

  constructor(
    metas: GameMeta[],
    save: SaveStore,
    audio: AudioAPI,
    onLaunchGame: (id: GameId) => void
  ) {
    this.metas = metas;
    this.save = save;
    this.audio = audio;
    this.onLaunchGame = onLaunchGame;

    this.element = document.createElement('section');
    this.element.className = 'hub-root';
    this.element.setAttribute('aria-label', '空间站全景交互大厅');
    this.render();
    this.unsubscribeSave = this.save.subscribe(() => this.refreshStatus());
    this.startLoop();
  }

  private render(): void {
    const canvasLayer = document.createElement('div');
    canvasLayer.className = 'hub-canvas-layer';
    this.element.appendChild(canvasLayer);

    this.canvasHandle = setupHiDPICanvas(canvasLayer, () => this.positionPins());

    // Top Hero & Telemetry Banner (Framed with @arwes/frames)
    const header = document.createElement('div');
    header.className = 'hub-overlay-header';
    header.innerHTML = `
      <div class="hub-hero-badge" data-arwes-hero>
        <div class="hub-hero-eyebrow"><span class="hub-live-dot"></span>ORBITAL ALT 402 KM · INCLINATION 41.5° · LEO</div>
        <h1 class="hub-hero-title">天宫·轨道实验室 · 8 舱段互动科普站</h1>
        <p class="hub-hero-desc">点击空间站任意全息舱段热点、下方任务卡片或顶部切换栏（快捷键 1–8），实时切入 8 款硬核航天 2D 科普仿真任务。</p>
      </div>
      <div class="hub-telemetry-card" data-arwes-tele>
        <div class="hub-tele-item">
          <span class="hub-tele-label">空间站就绪度</span>
          <span class="hub-tele-value" data-hub-readiness style="color:var(--status-nominal)">25%</span>
        </div>
        <div class="hub-tele-item">
          <span class="hub-tele-label">航天勋章星级</span>
          <span class="hub-tele-value" data-hub-stars style="color:var(--accent-gold-bright)">0/72</span>
        </div>
        <div class="hub-tele-item">
          <span class="hub-tele-label">科普档案收录</span>
          <span class="hub-tele-value" data-hub-codex style="color:var(--accent-cyan-bright)">4/24</span>
        </div>
      </div>
    `;
    const heroBox = header.querySelector<HTMLElement>('[data-arwes-hero]')!;
    const teleBox = header.querySelector<HTMLElement>('[data-arwes-tele]')!;
    this.frameCleanups.push(attachArwesFrame(heroBox, 'nefrex', { strokeWidth: 1.5, squareSize: 12 }));
    this.frameCleanups.push(attachArwesFrame(teleBox, 'corners', { strokeWidth: 1.6, cornerLength: 14 }));

    this.readinessValEl = header.querySelector('[data-hub-readiness]')!;
    this.starsValEl = header.querySelector('[data-hub-stars]')!;
    this.codexValEl = header.querySelector('[data-hub-codex]')!;
    this.element.appendChild(header);

    // Interactive Holographic Chamfered Pins anchored around station perimeter
    const pinsLayer = document.createElement('div');
    pinsLayer.className = 'hub-pins-layer';
    for (const meta of this.metas) {
      const pin = document.createElement('button');
      pin.type = 'button';
      pin.className = 'hub-pin';
      pin.setAttribute('data-augmented-ui', 'tl-clip br-clip border inlay');
      pin.style.setProperty('--pin-accent', meta.accent);
      pin.innerHTML = `
        <span class="hub-pin-badge">${GAME_ICONS[meta.id]}</span>
        <span class="hub-pin-title"><span class="mono-num" style="opacity:.78;margin-right:4px">${meta.number}</span>${meta.shortTitle}</span>
        <span class="hub-pin-stars"></span>
      `;
      pin.addEventListener('mouseenter', () => this.setHover(meta.id));
      pin.addEventListener('mouseleave', () => this.setHover(null));
      pin.addEventListener('focus', () => this.setHover(meta.id));
      pin.addEventListener('blur', () => this.setHover(null));
      pin.addEventListener('click', () => {
        this.audio.playClick();
        this.onLaunchGame(meta.id);
      });
      pinsLayer.appendChild(pin);
      this.pinEls.set(meta.id, pin);
    }
    this.element.appendChild(pinsLayer);

    // Bottom 8-Game Augmented-UI Mission Deck
    const deck = document.createElement('div');
    deck.className = 'hub-mission-deck';
    for (const meta of this.metas) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'hub-card';
      card.setAttribute('data-augmented-ui', 'tl-clip br-clip border inlay');
      card.style.setProperty('--card-accent', meta.accent);
      card.innerHTML = `
        <div class="hub-card-top">
          <span class="hub-card-code"><span class="ui-svg-icon">${GAME_ICONS[meta.id]}</span><span>${meta.number} · ${meta.moduleName}</span></span>
          <span class="hub-card-genre">${meta.genre}</span>
        </div>
        <div class="hub-card-name">${meta.title}</div>
        <div class="hub-card-tagline">${meta.tagline}</div>
        <div class="hub-card-foot">
          <span>3 关卡 · KEY ${Number(meta.number)}</span>
          <span class="hub-card-stars"></span>
        </div>
      `;
      card.addEventListener('mouseenter', () => this.setHover(meta.id));
      card.addEventListener('mouseleave', () => this.setHover(null));
      card.addEventListener('focus', () => this.setHover(meta.id));
      card.addEventListener('blur', () => this.setHover(null));
      card.addEventListener('click', () => {
        this.audio.playClick();
        this.onLaunchGame(meta.id);
      });
      deck.appendChild(card);
      this.cardEls.set(meta.id, card);
    }
    this.element.appendChild(deck);

    this.positionPins();
    this.refreshStatus();
  }

  private setHover(id: GameId | null): void {
    if (this.hoveredId === id) return;
    this.hoveredId = id;
    if (id) this.audio.playHover();
    for (const m of this.metas) {
      const isH = m.id === id;
      this.pinEls.get(m.id)?.classList.toggle('is-highlighted', isH);
      this.cardEls.get(m.id)?.classList.toggle('is-highlighted', isH);
    }
  }

  private getStationTransform(w: number, h: number) {
    const ultraCompact = h <= 650;
    const compact = h <= 760 || w <= 1440;
    const deckReserve = w <= 1120 ? h * 0.34 : ultraCompact ? 148 : compact ? 188 : 216;
    const topReserve = ultraCompact ? 68 : compact ? 84 : 104;
    const availH = Math.max(180, h - topReserve - deckReserve);
    const cx = w * 0.5;
    const cy = topReserve + availH * 0.49;
    const scale = Math.max(0.45, Math.min(w / 1060, availH / 410, 1.15));
    return { cx, cy, scale, topReserve, deckReserve };
  }

  private positionPins(): void {
    if (!this.canvasHandle) return;
    const { width, height } = this.canvasHandle.getSize();
    const { cx, cy, scale, topReserve, deckReserve } = this.getStationTransform(width, height);
    const padX = Math.min(84, width * 0.14);
    const minY = topReserve + 20;
    const maxY = Math.max(minY + 40, height - deckReserve - 20);

    for (const meta of this.metas) {
      const pin = this.pinEls.get(meta.id);
      if (!pin) continue;
      const callout = STATION_CALLOUTS[meta.id];
      const px = Math.max(padX, Math.min(width - padX, cx + callout.cx * scale));
      const py = Math.max(minY, Math.min(maxY, cy + callout.cy * scale));
      pin.style.left = `${px}px`;
      pin.style.top = `${py}px`;
      this.pinPositions.set(meta.id, { px, py });
    }
  }

  refreshStatus(): void {
    this.readinessValEl.textContent = `${this.save.getStationReadiness()}%`;
    this.starsValEl.innerHTML = `<span class="ui-svg-icon" style="vertical-align:-1px;margin-right:4px">${UI_ICONS.star}</span>${this.save.getTotalStars()}/72`;
    this.codexValEl.textContent = `${this.save.getUnlockedCodexCount()}/24`;

    for (const meta of this.metas) {
      const stars = this.save.getGameStars(meta.id);
      const pinStar = this.pinEls.get(meta.id)?.querySelector('.hub-pin-stars');
      const cardStar = this.cardEls.get(meta.id)?.querySelector('.hub-card-stars');
      if (pinStar) pinStar.innerHTML = stars > 0 ? `${UI_ICONS.star}<span>${stars}</span>` : '';
      if (cardStar) {
        cardStar.innerHTML =
          stars > 0
            ? `${UI_ICONS.star}<span>${stars}/9</span>`
            : `<span style="color:var(--text-muted)">待探索</span>`;
      }
    }
  }

  private startLoop(): void {
    const renderFrame = (now: number) => {
      const t = now * 0.001;
      const { width, height } = this.canvasHandle.getSize();
      const ctx = this.canvasHandle.ctx;

      // 1. Baked Opaque LEO Backdrop (1 integer drawImage when cached; fallback to starfield + horizon)
      if (!drawBakedBackdrop(ctx, 'leo-earth', width, height, 0.16, 0.34)) {
        this.starfield.draw(ctx, width, height, t, t * 3.5, 0);
        drawEarthHorizon(ctx, width, height, t, {
          yRatio: 1.76,
          radiusScale: 1.18,
          sunPhase: t * 0.08,
          darken: 0.16,
        });
      }

      // 2. Crisp Orbital Telemetry Crosshair Rings (no gradients / no lens flare)
      ctx.save();
      ctx.strokeStyle = 'rgba(0, 216, 255, 0.055)';
      ctx.lineWidth = 1;
      const { cx, cy, scale } = this.getStationTransform(width, height);
      const bobY = Math.sin(t * 0.85) * 3.0;

      ctx.beginPath();
      ctx.arc(cx, cy, 240 * scale, 0, Math.PI * 2);
      ctx.arc(cx, cy, 345 * scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // 4. Studio 3D Tiangong Space Station + Animated Shenzhou + Feitian EVA Astronaut
      this.drawSpaceStation(ctx, cx, cy + bobY, scale, t);

      // 5. Holographic Cyan Leader Lines connecting Perimeter Pins to 3D Station Modules
      this.drawCalloutLeaders(ctx, cx, cy, scale, bobY, t);

      this.rafId = requestAnimationFrame(renderFrame);
    };
    this.rafId = requestAnimationFrame(renderFrame);
  }

  private drawSpaceStation(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    s: number,
    t: number
  ): void {
    const dockingCleared = this.save.isGameCleared('docking');
    const solarCleared = this.save.isGameCleared('solar');
    const evaCleared = this.save.isGameCleared('eva');

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(s, s);

    // ---- Studio-Rendered 3D Tiangong T-Configuration Space Station ----
    const hubW = 540;
    const hubH = 409; // exact 1024:776 natural ratio
    const paintedHub = drawModelSprite(ctx, 'tiangong-hub', -hubW * 0.5, -190, hubW, hubH);
    if (!paintedHub) {
      ctx.strokeStyle = 'rgba(0, 216, 255, 0.45)';
      ctx.strokeRect(-240, -25, 480, 50);
    }

    // ---- Approaching / Docked 3D Shenzhou Spacecraft at Forward Port ----
    const shipW = 88;
    const shipH = 71; // exact 512:415 natural ratio
    const shipY = dockingCleared ? -102 : -132 + Math.sin(t * 1.35) * 6;
    drawModelSprite(ctx, 'shenzhou-side', -shipW * 0.5, shipY - shipH * 0.5, shipW, shipH, {
      rotation: Math.PI * 0.5, // +X probe points straight DOWN (-Y -> +Y) toward forward collar
    });
    ctx.fillStyle = dockingCleared ? '#22d37a' : '#ffd166';
    ctx.beginPath();
    ctx.arc(0, shipY + 42, 3.2, 0, Math.PI * 2);
    ctx.fill();

    // ---- 3D Modular Space Robotic Arm on Upper Mengtian Hull ----
    const armAngle1 = -0.62 + Math.sin(t * 0.85) * 0.12;
    const armAngle2 = 0.78 + Math.cos(t * 0.85) * 0.15;
    const ax0 = 86;
    const ay0 = -24;
    const ax1 = ax0 + Math.cos(armAngle1) * 44;
    const ay1 = ay0 + Math.sin(armAngle1) * 44;
    const ax2 = ax1 + Math.cos(armAngle1 + armAngle2) * 38;
    const ay2 = ay1 + Math.sin(armAngle1 + armAngle2) * 38;

    drawRoboticArm3D(ctx, {
      baseX: ax0,
      baseY: ay0,
      elbowX: ax1,
      elbowY: ay1,
      tipX: ax2,
      tipY: ay2,
      boomThickness: 9.5,
      jointRadius: 8,
      effectorSize: 18,
      stress: 12,
      showLaserCone: false,
    });

    // ---- Sculpted 2.5D Feitian EVA Astronaut Tethered Above Wentian ----
    const evaX = -160 + Math.cos(t * 1.1) * 5;
    const evaY = -50 + Math.sin(t * 1.3) * 5;
    ctx.strokeStyle = '#f5a623';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([4, 2.5]);
    ctx.beginPath();
    ctx.moveTo(-138, -20);
    ctx.quadraticCurveTo(-162, -26, evaX, evaY + 6);
    ctx.stroke();
    ctx.setLineDash([]);

    drawFeitianAstronaut3D(ctx, {
      x: evaX,
      y: evaY,
      scale: 0.72,
      facing: 1,
      tilt: Math.sin(t * 0.9) * 0.08,
      simTime: t,
      thermalMode: evaCleared ? 'balance' : 'cool',
      grabbing: false,
    });

    // Precision Aviation Strobe / Navigation LEDs (flat dots, no additive halos)
    const leds: [number, number, string][] = [
      [-236, -186, '#00d8ff'],
      [-236, 178, '#00d8ff'],
      [236, -186, '#00d8ff'],
      [236, 178, '#00d8ff'],
      [0, 212, '#f5a623'],
    ];
    for (let i = 0; i < leds.length; i++) {
      const [lx, ly, color] = leds[i];
      const pulse = 0.5 + 0.5 * Math.sin(t * 3.2 + i * 1.1);
      if (solarCleared || pulse > 0.35) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(lx, ly, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  private drawCalloutLeaders(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    s: number,
    bobY: number,
    t: number
  ): void {
    ctx.save();

    for (const meta of this.metas) {
      const callout = STATION_CALLOUTS[meta.id];
      const pinPos = this.pinPositions.get(meta.id);
      if (!pinPos) continue;

      const mx = cx + callout.mx * s;
      const my = cy + callout.my * s + bobY;
      const dx = pinPos.px - mx;
      const dy = pinPos.py - my;
      const isHovered = this.hoveredId === meta.id;

      const elbowX =
        Math.abs(dx) > Math.abs(dy) + 18
          ? mx + Math.sign(dx) * Math.min(Math.abs(dy), Math.abs(dx) * 0.45)
          : mx + Math.sign(dx || 1) * Math.min(Math.abs(dx), Math.abs(dy) * 0.35);
      const elbowY = pinPos.py;

      ctx.strokeStyle = isHovered ? meta.accent : 'rgba(0, 216, 255, 0.36)';
      ctx.lineWidth = isHovered ? 1.9 : 1.05;
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.lineTo(elbowX, elbowY);
      ctx.lineTo(pinPos.px, pinPos.py);
      ctx.stroke();

      // Anchor dot on module
      ctx.fillStyle = isHovered ? meta.accent : '#7beeff';
      ctx.beginPath();
      ctx.arc(mx, my, isHovered ? 4 : 2.6, 0, Math.PI * 2);
      ctx.fill();

      // Active Hover Target Reticle on Highlighted Module
      if (isHovered) {
        const r = 34 * s + Math.sin(t * 5) * 3;
        ctx.save();
        ctx.strokeStyle = meta.accent;
        ctx.lineWidth = 1.8;
        ctx.setLineDash([8, 5]);
        ctx.beginPath();
        ctx.arc(mx, my, r, t * 0.85, t * 0.85 + Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    }

    ctx.restore();
  }

  destroy(): void {
    cancelAnimationFrame(this.rafId);
    this.frameCleanups.forEach((fn) => fn());
    this.frameCleanups = [];
    this.unsubscribeSave();
    this.canvasHandle.destroy();
    this.element.remove();
  }
}
