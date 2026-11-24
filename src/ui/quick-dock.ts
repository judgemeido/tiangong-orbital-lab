import type { AudioAPI, GameId, GameMeta } from '../core/game-interface';
import { getEffectiveQuality, subscribePerf } from '../core/perf-profile';
import type { SaveStore } from '../core/save-store';
import { GAME_ICONS, UI_ICONS } from './icons';

export interface QuickDockCallbacks {
  onSelectHub: () => void;
  onSelectGame: (id: GameId) => void;
  onOpenCodex: () => void;
  onToggleMute: () => void;
  onToggleFullscreen: () => void;
  onTogglePerf: () => void;
}

export class QuickDock {
  readonly element: HTMLElement;
  private metas: GameMeta[];
  private save: SaveStore;
  private audio: AudioAPI;
  private cb: QuickDockCallbacks;
  private homeBtn!: HTMLButtonElement;
  private pillButtons = new Map<GameId, HTMLButtonElement>();
  private statEl!: HTMLElement;
  private perfBtn!: HTMLButtonElement;
  private muteBtn!: HTMLButtonElement;
  private unsubscribe: () => void;
  private unsubPerf: () => void;

  constructor(
    metas: GameMeta[],
    save: SaveStore,
    audio: AudioAPI,
    cb: QuickDockCallbacks
  ) {
    this.metas = metas;
    this.save = save;
    this.audio = audio;
    this.cb = cb;

    this.element = document.createElement('header');
    this.element.className = 'quick-dock';
    this.element.setAttribute('role', 'navigation');
    this.element.setAttribute('aria-label', '空间站全舱段任务切换栏');
    this.render();
    this.unsubscribe = this.save.subscribe(() => this.refreshProgress());
    this.unsubPerf = subscribePerf(() => this.refreshPerf());
  }

  private render(): void {
    this.element.innerHTML = '';

    // Brand / Hub Home button (Augmented-UI Chamfered Frame)
    this.homeBtn = document.createElement('button');
    this.homeBtn.className = 'dock-brand is-active';
    this.homeBtn.type = 'button';
    this.homeBtn.setAttribute('data-augmented-ui', 'tl-clip br-clip border inlay');
    this.homeBtn.title = '返回空间站全景中枢 (Esc)';
    this.homeBtn.innerHTML = `
      <span class="dock-brand-emblem">${UI_ICONS.station}</span>
      <span class="dock-brand-text">
        <span class="dock-brand-title">天宫·轨道站</span>
        <span class="dock-brand-sub">STATION HUB · ESC</span>
      </span>
    `;
    this.homeBtn.addEventListener('click', () => {
      this.audio.playClick();
      this.cb.onSelectHub();
    });
    this.element.appendChild(this.homeBtn);

    // 8 Game Quick-Switch Pills (Augmented-UI + Custom SVG Icons)
    const modulesRow = document.createElement('div');
    modulesRow.className = 'dock-modules';
    for (const meta of this.metas) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dock-pill';
      btn.setAttribute('data-augmented-ui', 'tl-clip br-clip border inlay');
      btn.style.setProperty('--pill-accent', meta.accent);
      btn.dataset.gameId = meta.id;
      btn.title = `${meta.number} ${meta.title}（${meta.moduleName}）· 快捷键 ${Number(meta.number)}`;
      btn.innerHTML = `
        <span class="dock-pill-led"></span>
        <span class="ui-svg-icon dock-pill-icon">${GAME_ICONS[meta.id]}</span>
        <span class="dock-pill-num">${meta.number}</span>
        <span>${meta.shortTitle}</span>
        <span class="dock-pill-stars"></span>
      `;
      btn.addEventListener('click', () => {
        this.audio.playClick();
        this.cb.onSelectGame(meta.id);
      });
      modulesRow.appendChild(btn);
      this.pillButtons.set(meta.id, btn);
    }
    this.element.appendChild(modulesRow);

    // Right Action Cluster
    const actions = document.createElement('div');
    actions.className = 'dock-actions';

    this.statEl = document.createElement('div');
    this.statEl.className = 'dock-stat-chip mono-num';
    this.statEl.setAttribute('data-augmented-ui', 'tl-clip br-clip border inlay');
    this.statEl.title = '总收集航天勋章星级与空间站运行就绪度';
    actions.appendChild(this.statEl);

    const codexBtn = document.createElement('button');
    codexBtn.type = 'button';
    codexBtn.className = 'dock-icon-btn is-accent';
    codexBtn.setAttribute('data-augmented-ui', 'tl-clip br-clip border inlay');
    codexBtn.title = '打开航天科普档案馆 (Tab)';
    codexBtn.innerHTML = `<span class="ui-svg-icon">${UI_ICONS.codex}</span><span>科普档案</span><span class="mono-num dock-key-hint" style="opacity:.75;font-size:10.5px">TAB</span>`;
    codexBtn.addEventListener('click', () => {
      this.audio.playClick();
      this.cb.onOpenCodex();
    });
    actions.appendChild(codexBtn);

    this.perfBtn = document.createElement('button');
    this.perfBtn.type = 'button';
    this.perfBtn.className = 'dock-icon-btn dock-perf-btn';
    this.perfBtn.setAttribute('data-augmented-ui', 'tl-clip br-clip border inlay');
    this.perfBtn.addEventListener('click', () => {
      this.audio.playSwitch();
      this.cb.onTogglePerf();
      this.refreshPerf();
    });
    actions.appendChild(this.perfBtn);

    this.muteBtn = document.createElement('button');
    this.muteBtn.type = 'button';
    this.muteBtn.className = 'dock-icon-btn';
    this.muteBtn.setAttribute('data-augmented-ui', 'tl-clip br-clip border inlay');
    this.muteBtn.title = '切换音效静音 (M)';
    this.muteBtn.addEventListener('click', () => {
      this.cb.onToggleMute();
      this.refreshMute();
    });
    actions.appendChild(this.muteBtn);

    const fsBtn = document.createElement('button');
    fsBtn.type = 'button';
    fsBtn.className = 'dock-icon-btn';
    fsBtn.setAttribute('data-augmented-ui', 'tl-clip br-clip border inlay');
    fsBtn.title = '切换全屏沉浸模式 (F)';
    fsBtn.setAttribute('aria-label', '全屏模式');
    fsBtn.innerHTML = `<span class="ui-svg-icon">${UI_ICONS.fullscreen}</span>`;
    fsBtn.addEventListener('click', () => {
      this.audio.playClick();
      this.cb.onToggleFullscreen();
    });
    actions.appendChild(fsBtn);

    this.element.appendChild(actions);
    this.refreshProgress();
    this.refreshPerf();
    this.refreshMute();
  }

  setActive(target: GameId | 'hub'): void {
    this.homeBtn.classList.toggle('is-active', target === 'hub');
    for (const [id, btn] of this.pillButtons) {
      btn.classList.toggle('is-active', id === target);
      if (id === target) {
        btn.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
      }
    }
  }

  refreshProgress(): void {
    const totalStars = this.save.getTotalStars();
    const readiness = this.save.getStationReadiness();
    this.statEl.innerHTML = `<span class="ui-svg-icon">${UI_ICONS.star}</span><span>${totalStars}/72 · ${readiness}%</span>`;

    for (const [id, btn] of this.pillButtons) {
      const stars = this.save.getGameStars(id);
      const led = btn.querySelector('.dock-pill-led');
      const starEl = btn.querySelector('.dock-pill-stars');
      if (led) led.classList.toggle('is-cleared', stars > 0);
      if (starEl) {
        starEl.innerHTML = stars > 0 ? `${UI_ICONS.star}<span>${stars}</span>` : '';
      }
    }
  }

  refreshPerf(): void {
    const q = getEffectiveQuality();
    const isLow = q === 'low';
    this.perfBtn.classList.toggle('is-accent', !isLow);
    this.perfBtn.innerHTML = `<span class="ui-svg-icon">${UI_ICONS.perf}</span><span>${isLow ? '极速' : '高清'}</span>`;
    this.perfBtn.title = `当前性能档位：${isLow ? '极速模式 (最低显卡开销, 1x渲染)' : '高清模式 (1.25x缩放)'}（点击切换）`;
  }

  refreshMute(): void {
    const muted = this.audio.isMuted();
    this.muteBtn.innerHTML = `<span class="ui-svg-icon">${muted ? UI_ICONS.soundOff : UI_ICONS.soundOn}</span>`;
    this.muteBtn.setAttribute('aria-label', muted ? '取消静音' : '静音');
  }

  destroy(): void {
    this.unsubscribe();
    this.unsubPerf();
  }
}
