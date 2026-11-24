import {
  drawEarthHorizon,
  drawSolarPanelRect,
  setupHiDPICanvas,
  StarfieldRenderer,
} from '../core/canvas-utils';
import {
  drawAdditiveGlow,
  drawGlassViewport,
  drawSunLensFlare,
  drawTitaniumModule,
  getCarbonPattern,
  getMLIPattern,
} from '../core/materials';
import type { AudioAPI, GameId, GameMeta } from '../core/game-interface';
import type { SaveStore } from '../core/save-store';
import { attachArwesFrame } from './arwes-frames';
import { GAME_ICONS, UI_ICONS } from './icons';

/**
 * Museum-Grade Interactive Space Station Panorama Hub (Tiangong T-Configuration)
 * Combines cinema-grade LEO Earth vista, PBR-like brushed titanium & crinkled gold MLI
 * rendering, orbital sunrise lens flare, Arwes SVG HUD brackets, and Augmented-UI deck cards.
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

    // Interactive Holographic Chamfered Pins anchored onto station modules
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
    const deckReserve = w <= 1120 ? h * 0.34 : 216;
    const topReserve = 104;
    const availH = Math.max(180, h - topReserve - deckReserve);
    const cx = w * 0.5;
    const cy = topReserve + availH * 0.49;
    const scale = Math.min(w / 1060, availH / 335, 1.2);
    return { cx, cy, scale };
  }

  private positionPins(): void {
    if (!this.canvasHandle) return;
    const { width, height } = this.canvasHandle.getSize();
    const { cx, cy, scale } = this.getStationTransform(width, height);
    for (const meta of this.metas) {
      const pin = this.pinEls.get(meta.id);
      if (!pin) continue;
      const px = cx + (meta.hubAnchor.x - 0.5) * 760 * scale;
      const py = cy + (meta.hubAnchor.y - 0.5) * 320 * scale;
      pin.style.left = `${px}px`;
      pin.style.top = `${py}px`;
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

      // 1. Deep Starfield + Cinema Photorealistic LEO Earth Vista
      this.starfield.draw(ctx, width, height, t, t * 3.5, 0);
      drawEarthHorizon(ctx, width, height, t, {
        yRatio: 1.76,
        radiusScale: 1.18,
        sunPhase: t * 0.08,
        darken: 0.16,
      });

      // 2. Orbital Sunrise Lens Flare on Upper-Left Horizon
      drawSunLensFlare(ctx, width * 0.13, height * 0.72, 22, 0.75);

      // 3. Delicate Aerospace CAD Telemetry Crosshair Grid
      ctx.save();
      ctx.strokeStyle = 'rgba(0, 216, 255, 0.055)';
      ctx.lineWidth = 1;
      const { cx, cy, scale } = this.getStationTransform(width, height);
      ctx.beginPath();
      ctx.arc(cx, cy, 240 * scale, 0, Math.PI * 2);
      ctx.arc(cx, cy, 345 * scale, 0, Math.PI * 2);
      ctx.stroke();

      // Rotating orbital telemetry radar sweep cone behind station
      const sweepAngle = (t * 0.45) % (Math.PI * 2);
      const sweepGrad = ctx.createConicGradient(sweepAngle, cx, cy);
      sweepGrad.addColorStop(0, 'rgba(0, 216, 255, 0.13)');
      sweepGrad.addColorStop(0.14, 'rgba(0, 216, 255, 0)');
      sweepGrad.addColorStop(1, 'rgba(0, 216, 255, 0)');
      ctx.fillStyle = sweepGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, 345 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // 4. Museum-Grade PBR-Shaded Tiangong Space Station
      this.drawSpaceStation(ctx, cx, cy, scale, t);

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
    const botanyCleared = this.save.isGameCleared('botany');
    const zeroGCleared = this.save.isGameCleared('zero-g-lab');

    ctx.save();
    const bobY = Math.sin(t * 0.85) * 3.2;
    ctx.translate(cx, cy + bobY);
    ctx.scale(s, s);

    // Subtle atmospheric blue Earth-bounce underglow beneath entire station
    drawAdditiveGlow(ctx, 0, 50, 320, '0, 185, 255', 0.12);

    // ---- Huge Flexible Double GaAs Solar Wings (Wentian Left & Mengtian Right) ----
    const sunLit = 0.72 + 0.3 * Math.sin(t * 0.55) + (solarCleared ? 0.18 : 0);

    // Left Solar Wing Mast + Truss
    this.drawTrussMast(ctx, -238, -26, -238, -148);
    drawSolarPanelRect(ctx, -288, -148, 43, 106, sunLit);
    drawSolarPanelRect(ctx, -231, -148, 43, 106, sunLit);
    this.drawTrussMast(ctx, -238, 26, -238, 148);
    drawSolarPanelRect(ctx, -288, 42, 43, 106, sunLit);
    drawSolarPanelRect(ctx, -231, 42, 43, 106, sunLit);

    // Right Solar Wing Mast + Truss
    this.drawTrussMast(ctx, 238, -26, 238, -148);
    drawSolarPanelRect(ctx, 188, -148, 43, 106, sunLit);
    drawSolarPanelRect(ctx, 245, -148, 43, 106, sunLit);
    this.drawTrussMast(ctx, 238, 26, 238, 148);
    drawSolarPanelRect(ctx, 188, 42, 43, 106, sunLit);
    drawSolarPanelRect(ctx, 245, 42, 43, 106, sunLit);

    // Core Module Aft Solar Wings
    drawSolarPanelRect(ctx, -124, 86, 78, 26, sunLit * 0.92);
    drawSolarPanelRect(ctx, 46, 86, 78, 26, sunLit * 0.92);

    // ---- Wentian Lab Module (Left) with Brushed Titanium + Crinkled Gold MLI ----
    drawTitaniumModule(ctx, -270, -27, 226, 54, {
      mliBands: [0.06, 0.78],
      radius: 9,
    });
    // Recessed Botany Bio-Rack illuminated viewport inside Wentian
    drawGlassViewport(
      ctx,
      -194,
      -13,
      54,
      26,
      5,
      botanyCleared ? 'rgba(168, 85, 247, 0.5)' : 'rgba(14, 46, 84, 0.75)'
    );
    drawAdditiveGlow(ctx, -167, 0, 22, botanyCleared ? '192, 100, 255' : '56, 210, 140', 0.34);
    ctx.fillStyle = '#4ade80';
    ctx.beginPath();
    ctx.arc(-175, 2, 4, 0, Math.PI * 2);
    ctx.arc(-162, -1, 5, 0, Math.PI * 2);
    ctx.arc(-154, 3, 3.5, 0, Math.PI * 2);
    ctx.fill();

    // Airlock Dome on left tip of Wentian
    drawTitaniumModule(ctx, -314, -21, 48, 42, { mliBands: [0.22], radius: 10 });

    // ---- Mengtian Lab Module (Right) ----
    drawTitaniumModule(ctx, 44, -27, 226, 54, {
      mliBands: [0.14, 0.84],
      radius: 9,
    });
    // Zero-G Fluid/Flame Lab viewport inside Mengtian
    drawGlassViewport(
      ctx,
      126,
      -13,
      58,
      26,
      5,
      zeroGCleared ? 'rgba(0, 195, 255, 0.38)' : 'rgba(12, 34, 66, 0.78)'
    );
    drawAdditiveGlow(ctx, 155, Math.sin(t * 2.2) * 3, 18, '0, 216, 255', 0.45);
    ctx.fillStyle = '#bae6fd';
    ctx.beginPath();
    ctx.arc(155, Math.sin(t * 2.2) * 3, 6.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(153, Math.sin(t * 2.2) * 3 - 2, 2, 0, Math.PI * 2);
    ctx.fill();

    // ---- Center Pressurized Node Hub Sphere (Metallic 3D Specular Sphere) ----
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 16;
    const nodeGrad = ctx.createRadialGradient(-14, -14, 4, 0, 0, 42);
    nodeGrad.addColorStop(0, '#ffffff');
    nodeGrad.addColorStop(0.28, '#dbeafe');
    nodeGrad.addColorStop(0.62, '#6c85a3');
    nodeGrad.addColorStop(0.88, '#23344d');
    nodeGrad.addColorStop(1, '#3b5c82');
    ctx.fillStyle = nodeGrad;
    ctx.beginPath();
    ctx.arc(0, 0, 39, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(226, 240, 255, 0.72)';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    // Node docking collar ring
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 24, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // ---- Tianhe Core Module (Lower Spine) ----
    drawTitaniumModule(ctx, -31, 35, 62, 130, {
      vertical: true,
      mliBands: [0.12, 0.78],
      radius: 10,
    });
    // Core ECLSS recessed cutaway glass viewport
    drawGlassViewport(ctx, -18, 60, 36, 50, 5, 'rgba(6, 22, 42, 0.9)');
    drawAdditiveGlow(ctx, 0, 85, 24, '34, 211, 122', 0.25);
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let x = -14; x <= 14; x += 2) {
      const y = 85 + Math.sin(t * 4 + x * 0.42) * 7;
      if (x === -14) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // ---- Forward Docking Port (Top) + Detailed Shenzhou Spacecraft ----
    const carbon = getCarbonPattern(ctx);
    ctx.fillStyle = carbon ?? '#334155';
    ctx.fillRect(-15, -53, 30, 16);
    ctx.strokeStyle = '#00d8ff';
    ctx.lineWidth = 1.4;
    ctx.strokeRect(-15, -53, 30, 16);

    const shipY = dockingCleared ? -74 : -106 + Math.sin(t * 1.35) * 7;
    ctx.save();
    ctx.translate(0, shipY);
    // Spacecraft solar wings
    drawSolarPanelRect(ctx, -48, -4, 30, 11, sunLit);
    drawSolarPanelRect(ctx, 18, -4, 30, 11, sunLit);
    // Detailed metallic Shenzhou hull
    const shipGrad = ctx.createLinearGradient(-18, 0, 18, 0);
    shipGrad.addColorStop(0, '#647b96');
    shipGrad.addColorStop(0.32, '#f8fafc');
    shipGrad.addColorStop(0.75, '#475f7b');
    shipGrad.addColorStop(1, '#1e2f47');
    ctx.fillStyle = shipGrad;
    ctx.beginPath();
    ctx.moveTo(-14, 18);
    ctx.lineTo(-18, -14);
    ctx.lineTo(0, -30);
    ctx.lineTo(18, -14);
    ctx.lineTo(14, 18);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(226, 240, 255, 0.8)';
    ctx.lineWidth = 1.3;
    ctx.stroke();
    // Gold MLI collar on orbital module
    const mli = getMLIPattern(ctx);
    if (mli) {
      ctx.fillStyle = mli;
      ctx.fillRect(-14, 6, 28, 7);
    }
    // Glowing docking alignment beacon
    drawAdditiveGlow(ctx, 0, 19, 14, dockingCleared ? '34, 211, 122' : '245, 166, 35', 0.85);
    ctx.fillStyle = dockingCleared ? '#22d37a' : '#ffd166';
    ctx.beginPath();
    ctx.arc(0, 18, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // ---- Articulated Robotic Arm on Upper Hull (Brushed Titanium + Gold Actuators) ----
    const armAngle1 = -0.55 + Math.sin(t * 0.85) * 0.13;
    const armAngle2 = 0.72 + Math.cos(t * 0.85) * 0.16;
    const ax0 = 56;
    const ay0 = -27;
    const ax1 = ax0 + Math.cos(armAngle1) * 58;
    const ay1 = ay0 + Math.sin(armAngle1) * 58;
    const ax2 = ax1 + Math.cos(armAngle1 + armAngle2) * 52;
    const ay2 = ay1 + Math.sin(armAngle1 + armAngle2) * 52;

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 8;
    ctx.strokeStyle = '#e2ebf7';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(ax0, ay0);
    ctx.lineTo(ax1, ay1);
    ctx.lineTo(ax2, ay2);
    ctx.stroke();
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();

    for (const [jx, jy] of [
      [ax0, ay0],
      [ax1, ay1],
      [ax2, ay2],
    ]) {
      ctx.fillStyle = '#f5a623';
      ctx.beginPath();
      ctx.arc(jx, jy, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fef3c7';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    // ---- EVA Astronaut Tethered near Airlock ----
    const evaX = -328 + Math.cos(t * 1.1) * 6;
    const evaY = -44 + Math.sin(t * 1.3) * 6;
    ctx.strokeStyle = '#f5a623';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 2.5]);
    ctx.beginPath();
    ctx.moveTo(-300, -18);
    ctx.quadraticCurveTo(-324, -18, evaX, evaY + 6);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = evaCleared ? '#f8fafc' : '#cbd5e1';
    ctx.beginPath();
    ctx.roundRect(evaX - 6.5, evaY - 2, 13, 17, 4);
    ctx.fill();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1;
    ctx.stroke();
    // Gold reflective helmet visor
    ctx.fillStyle = '#f5a623';
    ctx.beginPath();
    ctx.arc(evaX, evaY - 6.5, 6.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fffbeb';
    ctx.beginPath();
    ctx.arc(evaX - 2, evaY - 8.2, 1.8, 0, Math.PI * 2);
    ctx.fill();

    // ---- Active Hover Target Reticle on Highlighted Module ----
    if (this.hoveredId) {
      const hm = this.metas.find((m) => m.id === this.hoveredId);
      if (hm) {
        const hx = (hm.hubAnchor.x - 0.5) * 760;
        const hy = (hm.hubAnchor.y - 0.5) * 320;
        const r = 42 + Math.sin(t * 5) * 3.5;
        ctx.save();
        ctx.strokeStyle = hm.accent;
        ctx.lineWidth = 1.8;
        ctx.shadowColor = hm.accent;
        ctx.shadowBlur = 12;
        ctx.setLineDash([8, 5]);
        ctx.beginPath();
        ctx.arc(hx, hy, r, t * 0.8, t * 0.8 + Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    }

    // Precision Aviation Strobe / Navigation LEDs with Additive Bloom
    const leds: [number, number, string][] = [
      [-210, -23, '0, 216, 255'],
      [-110, -23, '0, 216, 255'],
      [96, -23, '0, 216, 255'],
      [205, -23, '0, 216, 255'],
      [0, 158, '245, 166, 35'],
    ];
    for (let i = 0; i < leds.length; i++) {
      const [lx, ly, rgb] = leds[i];
      const pulse = 0.5 + 0.5 * Math.sin(t * 3.2 + i * 1.1);
      if (solarCleared || pulse > 0.35) {
        drawAdditiveGlow(ctx, lx, ly, 10, rgb, 0.55 * pulse);
        ctx.fillStyle = `rgb(${rgb})`;
        ctx.beginPath();
        ctx.arc(lx, ly, 2.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  private drawTrussMast(
    ctx: CanvasRenderingContext2D,
    x1: number,
    y1: number,
    x2: number,
    y2: number
  ): void {
    ctx.save();
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x1 - 1, y1);
    ctx.lineTo(x2 - 1, y2);
    ctx.stroke();
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
