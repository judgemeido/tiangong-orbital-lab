import type {
  AudioAPI,
  GameMeta,
  GameResult,
  HudController,
  MetricSpec,
  MetricStatus,
} from '../core/game-interface';
import type { SaveStore } from '../core/save-store';
import { attachArwesFrame } from './arwes-frames';
import { GAME_ICONS, UI_ICONS } from './icons';

const STATUS_BADGE: Record<MetricStatus, { icon: string; label: string }> = {
  info: { icon: UI_ICONS.tele, label: 'TELE' },
  nominal: { icon: UI_ICONS.check, label: 'OK' },
  caution: { icon: UI_ICONS.warn, label: 'WARN' },
  critical: { icon: UI_ICONS.crit, label: 'CRIT' },
};

interface CachedMetricDom {
  card: HTMLElement;
  valEl: HTMLElement;
  statusEl: HTMLElement;
  barEl: HTMLElement | null;
  lastValue: string;
  lastStatus: MetricStatus;
  lastRatio: number | undefined;
}

export interface HudShellCallbacks {
  onSelectLevel: (levelIndex: number) => void;
  onRestart: () => void;
  onOpenBriefing: () => void;
  onTogglePhysicsOverlay: (enabled: boolean) => void;
}

/**
 * Event-driven AAA Aerospace Game HUD:
 * - Powered by @arwes/frames SVG architectural brackets + augmented-ui chamfered telemetry
 * - Caches values so DOM writes happen ONLY when telemetry changes
 * - Zero raw emoji; bespoke dual-tone SVG status badges (color-blind safe)
 */
export class GameHudShell implements HudController {
  readonly element: HTMLElement;
  private meta: GameMeta;
  private save: SaveStore;
  private audio: AudioAPI;
  private cb: HudShellCallbacks;

  private levelButtons: HTMLButtonElement[] = [];
  private objectiveEl!: HTMLElement;
  private telemetryGrid!: HTMLElement;
  private physicsBtn!: HTMLButtonElement;
  private controlsHintEl!: HTMLElement;
  private tactileDeck!: HTMLElement;
  private toastHost!: HTMLElement;

  private metricsMap = new Map<string, CachedMetricDom>();
  private physicsEnabled = true;
  private unsubscribeSave: () => void;
  private frameCleanups: (() => void)[] = [];

  constructor(
    meta: GameMeta,
    save: SaveStore,
    audio: AudioAPI,
    cb: HudShellCallbacks
  ) {
    this.meta = meta;
    this.save = save;
    this.audio = audio;
    this.cb = cb;

    this.element = document.createElement('div');
    this.element.className = 'hud-layer';
    this.element.style.setProperty('--game-accent', meta.accent);

    this.render();
    this.unsubscribeSave = this.save.subscribe(() => this.refreshLevelStars());
  }

  private render(): void {
    // ---- Top Left: Mission header + Level switcher + Objective ----
    const topLeft = document.createElement('div');
    topLeft.className = 'hud-top-left';

    const missionBox = document.createElement('div');
    missionBox.className = 'hud-mission-box';
    missionBox.innerHTML = `
      <div class="hud-mission-row">
        <span class="hud-mission-title">
          <span class="ui-svg-icon" style="color:var(--game-accent)">${GAME_ICONS[this.meta.id]}</span>
          <span>${this.meta.number} ${this.meta.title}</span>
        </span>
        <span class="hud-mission-module">${this.meta.moduleName}</span>
      </div>
    `;
    this.frameCleanups.push(attachArwesFrame(missionBox, 'nefrex', { strokeWidth: 1.4, squareSize: 10 }));

    const levelBar = document.createElement('div');
    levelBar.className = 'hud-level-bar';
    const shortRank = ['教学', '标准', '硬核'];
    this.meta.levels.forEach((lvl, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `hud-level-btn${idx === 0 ? ' is-active' : ''}`;
      btn.setAttribute('data-augmented-ui', 'tl-clip br-clip border inlay');
      btn.title = `L${idx + 1} ${lvl.name}：${lvl.subtitle}`;
      btn.innerHTML = `<span>L${idx + 1} ${shortRank[idx] ?? ''}</span><span class="hud-level-stars"></span>`;
      btn.addEventListener('click', () => {
        this.audio.playClick();
        this.setActiveLevel(idx);
        this.cb.onSelectLevel(idx);
      });
      levelBar.appendChild(btn);
      this.levelButtons.push(btn);
    });
    missionBox.appendChild(levelBar);
    topLeft.appendChild(missionBox);

    const objPill = document.createElement('div');
    objPill.className = 'hud-objective-pill';
    objPill.setAttribute('data-augmented-ui', 'tl-clip br-clip border inlay');
    objPill.innerHTML = `<span class="hud-objective-tag"><span class="ui-svg-icon">${UI_ICONS.target}</span><span>目标</span></span>`;
    this.objectiveEl = document.createElement('span');
    this.objectiveEl.textContent = this.meta.levels[0]?.objective ?? this.meta.tagline;
    objPill.appendChild(this.objectiveEl);
    topLeft.appendChild(objPill);

    // ---- Top Right: Event-Driven Telemetry Grid ----
    const topRight = document.createElement('div');
    topRight.className = 'hud-top-right';
    this.telemetryGrid = document.createElement('div');
    this.telemetryGrid.className = 'hud-telemetry-grid';
    topRight.appendChild(this.telemetryGrid);

    // ---- Bottom Left: Tool Row & Controls Hint ----
    const bottomLeft = document.createElement('div');
    bottomLeft.className = 'hud-bottom-left';

    const toolRow = document.createElement('div');
    toolRow.className = 'hud-tool-row';

    this.physicsBtn = document.createElement('button');
    this.physicsBtn.type = 'button';
    this.physicsBtn.className = 'hud-btn is-toggled';
    this.physicsBtn.setAttribute('data-augmented-ui', 'tl-clip br-clip border inlay');
    this.physicsBtn.title = '切换物理矢量与科学原理叠加显示 (V)';
    this.physicsBtn.innerHTML = `<span class="ui-svg-icon">${UI_ICONS.physics}</span><span>原理剖视</span><span class="mono-num" style="opacity:.7">V</span>`;
    this.physicsBtn.addEventListener('click', () => {
      this.audio.playSwitch();
      this.setPhysicsOverlayEnabled(!this.physicsEnabled);
      this.cb.onTogglePhysicsOverlay(this.physicsEnabled);
    });
    toolRow.appendChild(this.physicsBtn);

    const restartBtn = document.createElement('button');
    restartBtn.type = 'button';
    restartBtn.className = 'hud-btn';
    restartBtn.setAttribute('data-augmented-ui', 'tl-clip br-clip border inlay');
    restartBtn.title = '重新开始当前关卡 (R)';
    restartBtn.innerHTML = `<span class="ui-svg-icon">${UI_ICONS.restart}</span><span>重开</span><span class="mono-num" style="opacity:.7">R</span>`;
    restartBtn.addEventListener('click', () => {
      this.audio.playClick();
      this.cb.onRestart();
    });
    toolRow.appendChild(restartBtn);

    const helpBtn = document.createElement('button');
    helpBtn.type = 'button';
    helpBtn.className = 'hud-btn';
    helpBtn.setAttribute('data-augmented-ui', 'tl-clip br-clip border inlay');
    helpBtn.title = '查看任务简报与操作说明 (?)';
    helpBtn.innerHTML = `<span class="ui-svg-icon">${UI_ICONS.briefing}</span><span>简报</span>`;
    helpBtn.addEventListener('click', () => {
      this.audio.playClick();
      this.cb.onOpenBriefing();
    });
    toolRow.appendChild(helpBtn);

    bottomLeft.appendChild(toolRow);

    this.controlsHintEl = document.createElement('div');
    this.controlsHintEl.className = 'hud-controls-chip';
    this.controlsHintEl.setAttribute('data-augmented-ui', 'tl-clip br-clip border inlay');
    this.controlsHintEl.textContent = this.meta.controlsHint;
    bottomLeft.appendChild(this.controlsHintEl);

    // ---- Bottom Center: Cockpit Tactile Control Deck ----
    const bottomCenter = document.createElement('div');
    bottomCenter.className = 'hud-bottom-center';
    this.tactileDeck = document.createElement('div');
    this.tactileDeck.className = 'hud-tactile-deck';
    this.tactileDeck.setAttribute('data-augmented-ui', 'tl-clip tr-clip bl-clip br-clip border inlay');
    bottomCenter.appendChild(this.tactileDeck);

    // ---- Bottom Right: Contextual Science Toast Queue ----
    const bottomRight = document.createElement('div');
    bottomRight.className = 'hud-bottom-right';
    this.toastHost = bottomRight;

    this.element.append(topLeft, topRight, bottomLeft, bottomCenter, bottomRight);
    this.refreshLevelStars();
  }

  setActiveLevel(levelIndex: number): void {
    this.levelButtons.forEach((btn, idx) => {
      btn.classList.toggle('is-active', idx === levelIndex);
    });
    const lvl = this.meta.levels[levelIndex];
    const modEl = this.element.querySelector('.hud-mission-module');
    if (modEl && lvl) {
      modEl.textContent = `L${levelIndex + 1} · ${lvl.name}`;
    }
    if (lvl) this.setObjective(lvl.objective);
  }

  refreshLevelStars(): void {
    const rec = this.save.getGameProgress(this.meta.id);
    this.levelButtons.forEach((btn, idx) => {
      const s = rec.stars[idx] ?? 0;
      const el = btn.querySelector('.hud-level-stars');
      if (el) {
        el.innerHTML = s > 0 ? UI_ICONS.star.repeat(s) : '';
      }
    });
  }

  setObjective(text: string): void {
    if (this.objectiveEl.textContent !== text) {
      this.objectiveEl.textContent = text;
    }
  }

  setControlsHint(text: string): void {
    if (this.controlsHintEl.textContent !== text) {
      this.controlsHintEl.textContent = text;
    }
  }

  setMetrics(specs: MetricSpec[]): void {
    this.telemetryGrid.innerHTML = '';
    this.metricsMap.clear();
    for (const spec of specs) {
      const status: MetricStatus = spec.status ?? 'info';
      const card = document.createElement('div');
      card.className = 'hud-metric-card';
      card.setAttribute('data-augmented-ui', 'tl-clip br-clip border inlay');
      card.dataset.status = status;

      const head = document.createElement('div');
      head.className = 'hud-metric-head';
      const labelEl = document.createElement('span');
      labelEl.textContent = spec.label;
      const statusEl = document.createElement('span');
      statusEl.className = 'hud-metric-status';
      const badge = STATUS_BADGE[status];
      statusEl.innerHTML = `${badge.icon}<span>${badge.label}</span>`;
      head.append(labelEl, statusEl);

      const valEl = document.createElement('div');
      valEl.className = 'hud-metric-val';
      valEl.textContent = spec.value;

      card.append(head, valEl);

      let barEl: HTMLElement | null = null;
      if (spec.ratio !== undefined) {
        const barTrack = document.createElement('div');
        barTrack.className = 'hud-metric-bar';
        barEl = document.createElement('div');
        barEl.className = 'hud-metric-bar-fill';
        barEl.style.width = `${Math.round(Math.max(0, Math.min(1, spec.ratio)) * 100)}%`;
        barTrack.appendChild(barEl);
        card.appendChild(barTrack);
      }

      this.telemetryGrid.appendChild(card);
      this.metricsMap.set(spec.id, {
        card,
        valEl,
        statusEl,
        barEl,
        lastValue: spec.value,
        lastStatus: status,
        lastRatio: spec.ratio,
      });
    }
  }

  updateMetric(id: string, patch: Partial<Omit<MetricSpec, 'id'>>): void {
    const cached = this.metricsMap.get(id);
    if (!cached) return;

    if (patch.value !== undefined && patch.value !== cached.lastValue) {
      cached.valEl.textContent = patch.value;
      cached.lastValue = patch.value;
    }

    if (patch.status !== undefined && patch.status !== cached.lastStatus) {
      cached.card.dataset.status = patch.status;
      const badge = STATUS_BADGE[patch.status];
      cached.statusEl.innerHTML = `${badge.icon}<span>${badge.label}</span>`;
      cached.lastStatus = patch.status;
    }

    if (patch.ratio !== undefined && cached.barEl) {
      const clamped = Math.round(Math.max(0, Math.min(1, patch.ratio)) * 100);
      if (clamped !== cached.lastRatio) {
        cached.barEl.style.width = `${clamped}%`;
        cached.lastRatio = clamped;
      }
    }
  }

  pushToast(text: string, tone: MetricStatus = 'info', tag = '轨道遥测科普'): void {
    while (this.toastHost.children.length >= 1) {
      this.toastHost.firstElementChild?.remove();
    }
    const toast = document.createElement('div');
    toast.className = 'science-toast';
    toast.setAttribute('data-augmented-ui', 'tl-clip br-clip border inlay');
    toast.dataset.tone = tone;
    toast.innerHTML = `
      <div class="science-toast-tag">${tag}</div>
      <div class="science-toast-text">${text}</div>
    `;
    this.toastHost.appendChild(toast);

    window.setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 280ms ease';
      window.setTimeout(() => toast.remove(), 300);
    }, 5200);
  }

  getTactileDeck(): HTMLElement {
    return this.tactileDeck;
  }

  clearTactileDeck(): void {
    this.tactileDeck.innerHTML = '';
  }

  isPhysicsOverlayEnabled(): boolean {
    return this.physicsEnabled;
  }

  setPhysicsOverlayEnabled(enabled: boolean): void {
    this.physicsEnabled = enabled;
    this.physicsBtn.classList.toggle('is-toggled', enabled);
  }

  destroy(): void {
    this.frameCleanups.forEach((fn) => fn());
    this.frameCleanups = [];
    this.unsubscribeSave();
    this.element.remove();
  }
}

export function buildBriefingModal(
  meta: GameMeta,
  audio: AudioAPI,
  onStart: () => void
): HTMLElement {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-label', `${meta.title} 任务简报`);

  const panel = document.createElement('div');
  panel.className = 'modal-panel';
  panel.style.maxWidth = '760px';

  panel.innerHTML = `
    <div class="modal-header">
      <div class="modal-title-group">
        <h2>${meta.number} ${meta.title} · ${meta.enTitle}</h2>
        <p>${meta.moduleName} ｜ ${meta.genre} ｜ ${meta.tagline}</p>
      </div>
    </div>
    <div class="modal-body">
      <div class="briefing-steps">
        ${meta.briefingSteps
          .map(
            (st, idx) => `
          <div class="briefing-step-card" data-augmented-ui="tl-clip br-clip border inlay">
            <div class="briefing-step-num">STEP 0${idx + 1}</div>
            <h3>${st.title}</h3>
            <p>${st.desc}</p>
          </div>
        `
          )
          .join('')}
      </div>
      <div class="hud-objective-pill" data-augmented-ui="tl-clip br-clip border inlay" style="margin-top:14px">
        <span class="hud-objective-tag">操作提示</span>
        <span>${meta.controlsHint}</span>
      </div>
    </div>
  `;

  const footer = document.createElement('div');
  footer.className = 'modal-footer';
  const startBtn = document.createElement('button');
  startBtn.type = 'button';
  startBtn.className = 'btn-primary';
  startBtn.setAttribute('data-augmented-ui', 'tl-clip br-clip border inlay');
  startBtn.innerHTML = `<span>进入舱段执行任务</span><span class="ui-svg-icon">${UI_ICONS.arrowRight}</span>`;
  startBtn.addEventListener('click', () => {
    audio.playClick();
    onStart();
  });
  footer.appendChild(startBtn);
  panel.appendChild(footer);

  attachArwesFrame(panel, 'kranox', { strokeWidth: 1.6, squareSize: 16 });
  backdrop.appendChild(panel);
  return backdrop;
}

export function buildResultModal(
  meta: GameMeta,
  result: GameResult,
  audio: AudioAPI,
  actions: {
    onRetry: () => void;
    onNextLevel?: () => void;
    onOpenCodex: (codexId: string) => void;
    onReturnHub: () => void;
  }
): HTMLElement {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-label', '任务评估与科普对照');

  const panel = document.createElement('div');
  panel.className = 'modal-panel';

  const starsHtml = result.won
    ? UI_ICONS.star.repeat(result.stars) + UI_ICONS.starEmpty.repeat(3 - result.stars)
    : UI_ICONS.starEmpty.repeat(3);
  const headline = result.won ? '任务圆满完成 · MISSION NOMINAL' : '任务中止 · MISSION ABORTED';

  panel.innerHTML = `
    <div class="modal-header">
      <div class="modal-title-group">
        <h2>${headline}</h2>
        <p>${meta.title} · L${result.levelIndex + 1} ${meta.levels[result.levelIndex]?.name ?? ''}</p>
      </div>
    </div>
    <div class="modal-body">
      <div class="result-grid">
        <div class="result-score-box" data-augmented-ui="tl-clip br-clip border inlay">
          <div class="result-stars-display" aria-label="${result.stars} 星评价">${starsHtml}</div>
          <div class="mono-num" style="font-size:13px;color:var(--accent-cyan-bright)">工程评分：${result.score}</div>
          <p style="margin:8px 0 0;color:var(--text-secondary);font-size:13px">${result.summary}</p>
          <div class="result-metrics-list">
            ${result.metrics
              .map(
                (m) => `
              <div class="result-metric-row">
                <span style="color:var(--text-secondary)">${m.label}</span>
                <span class="mono-num" style="font-weight:700">${m.value}</span>
              </div>
            `
              )
              .join('')}
          </div>
        </div>
        <div class="result-science-box" data-augmented-ui="tl-clip br-clip border inlay">
          <div class="result-science-label">REAL STATION SCIENCE · 真实空间站对照卡</div>
          <h3 class="result-science-title">${result.scienceCard.title}</h3>
          <div class="result-compare-block">
            <strong>你刚才在游戏中的操作</strong>
            ${result.scienceCard.gameAction}
          </div>
          <div class="result-compare-block">
            <strong>真实空间站的科学机制</strong>
            ${result.scienceCard.realStationFact}
          </div>
          <div class="codex-card-param">${result.scienceCard.realData}</div>
        </div>
      </div>
    </div>
  `;

  const footer = document.createElement('div');
  footer.className = 'modal-footer';

  const codexBtn = document.createElement('button');
  codexBtn.type = 'button';
  codexBtn.className = 'btn-secondary';
  codexBtn.setAttribute('data-augmented-ui', 'tl-clip br-clip border inlay');
  codexBtn.innerHTML = `<span class="ui-svg-icon">${UI_ICONS.codex}</span><span>查看完整科普档案</span>`;
  codexBtn.addEventListener('click', () => {
    audio.playClick();
    actions.onOpenCodex(result.scienceCard.codexId);
  });

  const hubBtn = document.createElement('button');
  hubBtn.type = 'button';
  hubBtn.className = 'btn-secondary';
  hubBtn.setAttribute('data-augmented-ui', 'tl-clip br-clip border inlay');
  hubBtn.textContent = '返回全景大厅';
  hubBtn.addEventListener('click', () => {
    audio.playClick();
    actions.onReturnHub();
  });

  const retryBtn = document.createElement('button');
  retryBtn.type = 'button';
  retryBtn.className = result.won ? 'btn-secondary' : 'btn-primary';
  retryBtn.setAttribute('data-augmented-ui', 'tl-clip br-clip border inlay');
  retryBtn.textContent = result.won ? '再玩一次冲击3星' : '重新挑战本关';
  retryBtn.addEventListener('click', () => {
    audio.playClick();
    actions.onRetry();
  });

  footer.append(codexBtn, hubBtn, retryBtn);

  if (result.won && actions.onNextLevel) {
    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'btn-gold';
    nextBtn.setAttribute('data-augmented-ui', 'tl-clip br-clip border inlay');
    nextBtn.innerHTML = `<span>进入下一关 L${result.levelIndex + 2}</span><span class="ui-svg-icon">${UI_ICONS.arrowRight}</span>`;
    nextBtn.addEventListener('click', () => {
      audio.playClick();
      actions.onNextLevel!();
    });
    footer.appendChild(nextBtn);
  }

  panel.appendChild(footer);
  attachArwesFrame(panel, 'kranox', { strokeWidth: 1.6, squareSize: 16 });
  backdrop.appendChild(panel);
  return backdrop;
}
