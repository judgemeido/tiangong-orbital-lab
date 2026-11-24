import 'augmented-ui/augmented-ui.min.css';
import './styles/tokens.css';
import './styles/shell.css';
import './styles/hud.css';

import { AudioEngine } from './core/audio-engine';
import type { GameHostAPI, GameId, GameInstance, GameModule, GameResult } from './core/game-interface';
import { GAME_MODULES, getGameModule } from './core/game-registry';
import { SaveStore } from './core/save-store';
import { buildCodexModal } from './ui/codex-modal';
import { buildBriefingModal, buildResultModal, GameHudShell } from './ui/hud-kit';
import { QuickDock } from './ui/quick-dock';
import { ScreenStack } from './ui/screen-stack';
import { StationHub } from './ui/station-hub';

class OrbitalLabApp {
  private root: HTMLElement;
  private stage: HTMLElement;
  private save = new SaveStore();
  private audio = new AudioEngine();
  private dock: QuickDock;
  private stack: ScreenStack;

  private activeHub: StationHub | null = null;
  private activeGameShell: HTMLElement | null = null;
  private activeHud: GameHudShell | null = null;
  private activeGameInstance: GameInstance | null = null;
  private activeGameModule: GameModule | null = null;
  private currentLevel = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    this.audio.setMuted(this.save.isMuted());

    const metas = GAME_MODULES.map((m) => m.meta);

    this.dock = new QuickDock(metas, this.save, this.audio, {
      onSelectHub: () => this.showHub(),
      onSelectGame: (id) => this.launchGame(id),
      onOpenCodex: () => this.openCodex(),
      onToggleMute: () => this.toggleMute(),
      onToggleFullscreen: () => this.toggleFullscreen(),
    });

    this.stage = document.createElement('main');
    this.stage.className = 'viewport-stage';

    this.root.innerHTML = '';
    this.root.append(this.dock.element, this.stage);

    this.stack = new ScreenStack(this.root, (hasOverlay) => {
      this.activeGameInstance?.setPaused(hasOverlay);
    });

    window.addEventListener('keydown', this.handleGlobalKeys);

    // Support optional URL hash deep-link e.g. #docking
    const hash = window.location.hash.replace(/^#/, '') as GameId;
    if (GAME_MODULES.some((m) => m.meta.id === hash)) {
      this.launchGame(hash);
    } else {
      this.showHub();
    }
  }

  private clearActiveView(): void {
    this.stack.clear();
    if (this.activeHub) {
      this.activeHub.destroy();
      this.activeHub = null;
    }
    if (this.activeGameInstance) {
      this.activeGameInstance.destroy();
      this.activeGameInstance = null;
    }
    if (this.activeHud) {
      this.activeHud.destroy();
      this.activeHud = null;
    }
    if (this.activeGameShell) {
      this.activeGameShell.remove();
      this.activeGameShell = null;
    }
    this.activeGameModule = null;
    this.stage.innerHTML = '';
  }

  showHub(): void {
    this.clearActiveView();
    window.history.replaceState(null, '', '#hub');
    this.dock.setActive('hub');

    const metas = GAME_MODULES.map((m) => m.meta);
    this.activeHub = new StationHub(metas, this.save, this.audio, (id) => {
      this.launchGame(id);
    });
    this.stage.appendChild(this.activeHub.element);
  }

  launchGame(id: GameId, levelIndex = 0): void {
    const mod = getGameModule(id);
    this.clearActiveView();
    window.history.replaceState(null, '', `#${id}`);
    this.dock.setActive(id);

    this.activeGameModule = mod;
    this.currentLevel = Math.max(0, Math.min(mod.meta.levels.length - 1, levelIndex));

    const shell = document.createElement('div');
    shell.className = 'game-shell';
    const canvasHost = document.createElement('div');
    canvasHost.className = 'game-canvas-host';
    shell.appendChild(canvasHost);

    const hud = new GameHudShell(mod.meta, this.save, this.audio, {
      onSelectLevel: (idx) => {
        this.currentLevel = idx;
        this.stack.clear();
        this.activeGameInstance?.setLevel(idx);
      },
      onRestart: () => {
        this.stack.clear();
        this.activeGameInstance?.restart();
      },
      onOpenBriefing: () => {
        this.openBriefing(mod);
      },
      onTogglePhysicsOverlay: (enabled) => {
        this.activeGameInstance?.setPhysicsOverlay?.(enabled);
      },
    });
    hud.setActiveLevel(this.currentLevel);
    shell.appendChild(hud.element);

    this.stage.appendChild(shell);
    this.activeGameShell = shell;
    this.activeHud = hud;

    const hostApi: GameHostAPI = {
      hud,
      audio: this.audio,
      getLevel: () => this.currentLevel,
      completeLevel: (result) => this.handleLevelComplete(mod, result),
      unlockCodex: (codexId) => this.save.unlockCodex(codexId),
      openCodex: (codexId) => this.openCodex(mod.meta.id, codexId),
      isPaused: () => this.stack.hasOverlay(),
    };

    this.activeGameInstance = mod.mount(canvasHost, hostApi);
    this.activeGameInstance.setPhysicsOverlay?.(hud.isPhysicsOverlayEnabled());

    // Show concise skippable briefing only on first visit to this module
    if (!this.save.getGameProgress(id).seenBriefing) {
      this.openBriefing(mod);
    }
  }

  private openBriefing(mod: GameModule): void {
    const modal = buildBriefingModal(mod.meta, this.audio, () => {
      this.save.markBriefingSeen(mod.meta.id);
      this.stack.pop(false);
    });
    this.stack.push('briefing', modal, () => {
      this.save.markBriefingSeen(mod.meta.id);
    });
  }

  private handleLevelComplete(mod: GameModule, result: GameResult): void {
    if (result.won) {
      this.audio.playSuccess();
      this.save.recordLevelResult(mod.meta.id, result.levelIndex, result.stars, result.score);
      this.save.unlockCodex(result.scienceCard.codexId);
      // Also unlock module's corresponding level codex entry
      const levelCodex = mod.meta.codexIds[result.levelIndex];
      if (levelCodex) this.save.unlockCodex(levelCodex);
    } else {
      this.audio.playCritical();
    }

    const hasNext = result.levelIndex < mod.meta.levels.length - 1;
    const modal = buildResultModal(mod.meta, result, this.audio, {
      onRetry: () => {
        this.stack.pop(false);
        this.activeGameInstance?.restart();
      },
      onNextLevel: hasNext
        ? () => {
            this.stack.pop(false);
            this.currentLevel = result.levelIndex + 1;
            this.activeHud?.setActiveLevel(this.currentLevel);
            this.activeGameInstance?.setLevel(this.currentLevel);
          }
        : undefined,
      onOpenCodex: (codexId) => {
        this.stack.pop(false);
        this.openCodex(mod.meta.id, codexId);
      },
      onReturnHub: () => {
        this.showHub();
      },
    });
    this.stack.push('result', modal);
  }

  private openCodex(filter: GameId | 'all' = 'all', highlightId?: string): void {
    if (this.stack.topId() === 'codex') {
      this.stack.pop(true);
      return;
    }
    const initialFilter =
      filter !== 'all' ? filter : this.activeGameModule?.meta.id ?? 'all';
    const modal = buildCodexModal(
      GAME_MODULES.map((m) => m.meta),
      this.save,
      this.audio,
      () => this.stack.pop(true),
      initialFilter,
      highlightId
    );
    this.stack.push('codex', modal);
  }

  private toggleMute(): void {
    const next = !this.audio.isMuted();
    this.audio.setMuted(next);
    this.save.setMuted(next);
    this.dock.refreshMute();
  }

  private toggleFullscreen(): void {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }

  private handleGlobalKeys = (e: KeyboardEvent): void => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    // Tab opens/closes Orbital Codex (when no other modal is trapping focus)
    if (e.key === 'Tab' && !this.stack.hasOverlay()) {
      e.preventDefault();
      this.audio.playClick();
      this.openCodex();
      return;
    }

    // If a modal is open, ScreenStack handles Esc & Tab
    if (this.stack.hasOverlay()) return;

    if (e.key === 'Escape') {
      if (this.activeGameModule) {
        e.preventDefault();
        this.audio.playClick();
        this.showHub();
      }
      return;
    }

    // Quick-switch keys 1..8
    if (/^[1-8]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const idx = Number(e.key) - 1;
      const mod = GAME_MODULES[idx];
      if (mod && this.activeGameModule?.meta.id !== mod.meta.id) {
        e.preventDefault();
        this.audio.playSwitch();
        this.launchGame(mod.meta.id);
      }
      return;
    }

    const k = e.key.toLowerCase();
    if (k === 'm') {
      this.toggleMute();
    } else if (k === 'f') {
      this.toggleFullscreen();
    } else if (k === 'v' && this.activeHud && this.activeGameInstance) {
      this.audio.playSwitch();
      const next = !this.activeHud.isPhysicsOverlayEnabled();
      this.activeHud.setPhysicsOverlayEnabled(next);
      this.activeGameInstance.setPhysicsOverlay?.(next);
    } else if (k === 'r' && this.activeGameInstance) {
      this.audio.playClick();
      this.activeGameInstance.restart();
    } else if (e.key === '?' && this.activeGameModule) {
      this.audio.playClick();
      this.openBriefing(this.activeGameModule);
    }
  };
}

const appRoot = document.getElementById('app');
if (appRoot) {
  new OrbitalLabApp(appRoot);
}
