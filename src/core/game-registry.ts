import type { GameId, GameModule } from './game-interface';
import { dockingGame } from '../games/01-docking';
import { solarGame } from '../games/02-solar';
import { evaGame } from '../games/03-eva';
import { roboticArmGame } from '../games/04-robotic-arm';
import { eclssGame } from '../games/05-eclss';
import { debrisGame } from '../games/06-debris';
import { botanyGame } from '../games/07-botany';
import { zeroGLabGame } from '../games/08-zero-g-lab';

export const GAME_MODULES: GameModule[] = [
  dockingGame,
  solarGame,
  evaGame,
  roboticArmGame,
  eclssGame,
  debrisGame,
  botanyGame,
  zeroGLabGame,
];

export function getGameModule(id: GameId): GameModule {
  const found = GAME_MODULES.find((m) => m.meta.id === id);
  if (!found) {
    throw new Error(`Unknown game module: ${id}`);
  }
  return found;
}
