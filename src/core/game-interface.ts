export type GameId =
  | 'docking'
  | 'solar'
  | 'eva'
  | 'robotic-arm'
  | 'eclss'
  | 'debris'
  | 'botany'
  | 'zero-g-lab';

export type MetricStatus = 'info' | 'nominal' | 'caution' | 'critical';

export interface MetricSpec {
  id: string;
  label: string;
  value: string;
  /** 0..1 progress bar ratio; omit to hide bar */
  ratio?: number;
  status?: MetricStatus;
}

export interface LevelMeta {
  index: number;
  name: string;
  subtitle: string;
  objective: string;
}

export interface ScienceComparison {
  title: string;
  gameAction: string;
  realStationFact: string;
  realData: string;
  codexId: string;
}

export interface GameResult {
  levelIndex: number;
  won: boolean;
  stars: 0 | 1 | 2 | 3;
  score: number;
  summary: string;
  metrics: { label: string; value: string; status?: MetricStatus }[];
  scienceCard: ScienceComparison;
}

export interface GameMeta {
  id: GameId;
  number: string;
  shortTitle: string;
  title: string;
  enTitle: string;
  moduleName: string;
  genre: string;
  tagline: string;
  accent: string;
  /** Normalized 0..1 coordinates on the Station Hub panorama */
  hubAnchor: { x: number; y: number };
  briefingSteps: { title: string; desc: string }[];
  controlsHint: string;
  levels: LevelMeta[];
  codexIds: string[];
}

export interface HudController {
  setObjective(text: string): void;
  setMetrics(specs: MetricSpec[]): void;
  updateMetric(id: string, patch: Partial<Omit<MetricSpec, 'id'>>): void;
  pushToast(text: string, tone?: MetricStatus, tag?: string): void;
  getTactileDeck(): HTMLElement;
  clearTactileDeck(): void;
  setControlsHint(text: string): void;
  isPhysicsOverlayEnabled(): boolean;
  setPhysicsOverlayEnabled(enabled: boolean): void;
}

export interface AudioAPI {
  playClick(): void;
  playHover(): void;
  playSwitch(): void;
  playThruster(intensity?: number): void;
  playLock(): void;
  playBeep(freq?: number, duration?: number): void;
  playWarning(): void;
  playCritical(): void;
  playSuccess(): void;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
}

export interface GameHostAPI {
  hud: HudController;
  audio: AudioAPI;
  getLevel(): number;
  completeLevel(result: GameResult): void;
  unlockCodex(codexId: string): void;
  openCodex(codexId?: string): void;
  isPaused(): boolean;
}

export interface GameInstance {
  destroy(): void;
  setLevel(levelIndex: number): void;
  restart(): void;
  setPaused(paused: boolean): void;
  setPhysicsOverlay?(enabled: boolean): void;
}

export interface GameModule {
  meta: GameMeta;
  mount(canvasHost: HTMLElement, host: GameHostAPI): GameInstance;
}
