import type { GameId } from './game-interface';
import type { PerfPreference } from './perf-profile';

export interface GameProgressRecord {
  stars: [number, number, number];
  bestScores: [number, number, number];
  seenBriefing: boolean;
}

export interface SaveState {
  version: number;
  games: Record<GameId, GameProgressRecord>;
  unlockedCodex: string[];
  muted: boolean;
  perfMode?: PerfPreference;
}

const STORAGE_KEY = 'tiangong_orbital_lab_save_v1';

const ALL_GAME_IDS: GameId[] = [
  'docking',
  'solar',
  'eva',
  'robotic-arm',
  'eclss',
  'debris',
  'botany',
  'zero-g-lab',
];

function createDefaultState(): SaveState {
  const games = {} as Record<GameId, GameProgressRecord>;
  for (const id of ALL_GAME_IDS) {
    games[id] = {
      stars: [0, 0, 0],
      bestScores: [0, 0, 0],
      seenBriefing: false,
    };
  }
  return {
    version: 1,
    games,
    unlockedCodex: ['docking-inertia', 'solar-eclipse', 'eclss-electrolysis', 'zerog-water-lens'],
    muted: false,
    perfMode: 'auto',
  };
}

export class SaveStore {
  private state: SaveState;
  private listeners = new Set<() => void>();

  constructor() {
    this.state = this.load();
  }

  private load(): SaveState {
    const fallback = createDefaultState();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw) as Partial<SaveState>;
      const merged = createDefaultState();
      if (parsed.games) {
        for (const id of ALL_GAME_IDS) {
          const g = parsed.games[id];
          if (g) {
            merged.games[id] = {
              stars: [
                Number(g.stars?.[0] ?? 0),
                Number(g.stars?.[1] ?? 0),
                Number(g.stars?.[2] ?? 0),
              ],
              bestScores: [
                Number(g.bestScores?.[0] ?? 0),
                Number(g.bestScores?.[1] ?? 0),
                Number(g.bestScores?.[2] ?? 0),
              ],
              seenBriefing: Boolean(g.seenBriefing),
            };
          }
        }
      }
      if (Array.isArray(parsed.unlockedCodex)) {
        merged.unlockedCodex = Array.from(new Set([...fallback.unlockedCodex, ...parsed.unlockedCodex]));
      }
      merged.muted = Boolean(parsed.muted);
      if (parsed.perfMode === 'auto' || parsed.perfMode === 'high' || parsed.perfMode === 'low') {
        merged.perfMode = parsed.perfMode;
      }
      return merged;
    } catch {
      return fallback;
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // Ignore storage quota / private mode failures
    }
    this.listeners.forEach((fn) => fn());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getGameProgress(id: GameId): GameProgressRecord {
    return this.state.games[id];
  }

  getGameStars(id: GameId): number {
    const s = this.state.games[id].stars;
    return s[0] + s[1] + s[2];
  }

  isGameCleared(id: GameId): boolean {
    return this.getGameStars(id) > 0;
  }

  getTotalStars(): number {
    return ALL_GAME_IDS.reduce((acc, id) => acc + this.getGameStars(id), 0);
  }

  getClearedGamesCount(): number {
    return ALL_GAME_IDS.filter((id) => this.isGameCleared(id)).length;
  }

  getStationReadiness(): number {
    // 25% baseline orbital station + 75% earned across 72 total stars
    return Math.round(25 + (this.getTotalStars() / 72) * 75);
  }

  recordLevelResult(id: GameId, levelIndex: number, stars: number, score: number): void {
    const rec = this.state.games[id];
    const idx = Math.max(0, Math.min(2, levelIndex));
    if (stars > rec.stars[idx]) rec.stars[idx] = stars;
    if (score > rec.bestScores[idx]) rec.bestScores[idx] = score;
    this.persist();
  }

  markBriefingSeen(id: GameId): void {
    if (!this.state.games[id].seenBriefing) {
      this.state.games[id].seenBriefing = true;
      this.persist();
    }
  }

  isCodexUnlocked(codexId: string): boolean {
    return this.state.unlockedCodex.includes(codexId);
  }

  unlockCodex(codexId: string): void {
    if (!this.state.unlockedCodex.includes(codexId)) {
      this.state.unlockedCodex.push(codexId);
      this.persist();
    }
  }

  getUnlockedCodexCount(): number {
    return this.state.unlockedCodex.length;
  }

  isMuted(): boolean {
    return this.state.muted;
  }

  setMuted(muted: boolean): void {
    this.state.muted = muted;
    this.persist();
  }

  getPerfMode(): PerfPreference {
    return this.state.perfMode ?? 'auto';
  }

  setPerfMode(mode: PerfPreference): void {
    this.state.perfMode = mode;
    this.persist();
  }
}
