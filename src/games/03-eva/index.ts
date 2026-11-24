import { drawFeitianAstronaut3D } from '../../core/aerospace-models';
import {
  ParticleSystem,
  StarfieldRenderer,
  clamp,
  dist,
  drawEarthHorizon,
  drawSolarPanelRect,
  drawVectorArrow,
  lerp,
  setupHiDPICanvas,
} from '../../core/canvas-utils';
import {
  drawBakedBackdrop,
  drawTitaniumModule,
  getMLIPattern,
} from '../../core/materials';
import { drawModelSprite } from '../../core/model-sprites';
import type {
  GameHostAPI,
  GameInstance,
  GameMeta,
  GameModule,
  GameResult,
  MetricStatus,
  ScienceComparison,
} from '../../core/game-interface';

// ============================================================================
// Virtual World Dimensions (mapped inside Safe Play Area: y in [120, h - 135])
// ============================================================================
const WORLD_W = 960;
const WORLD_H = 380;
const PX_PER_METER = 18;

type ThermalMode = 'cool' | 'balance' | 'heat';

interface HandrailSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface TetherAnchor {
  id: string;
  label: string;
  x: number;
  y: number;
  maxLen: number;
}

interface RepairNode {
  id: string;
  label: string;
  x: number;
  y: number;
  progress: number;
  repaired: boolean;
  sparkTimer: number;
}

interface LevelConfig {
  oxygenSeconds: number;
  terminatorMode: 'mild' | 'static' | 'moving';
  staticTerminatorX: number;
  hasTrusses: boolean;
  handrails: HandrailSegment[];
  anchors: TetherAnchor[];
  nodes: Omit<RepairNode, 'progress' | 'repaired' | 'sparkTimer'>[];
  airlock: { x: number; y: number };
  startPos: { x: number; y: number };
  initialAnchorId: string;
}

const BASE_HANDRAILS: HandrailSegment[] = [
  // Upper hull handrails
  { x1: -372, y1: -56, x2: -182, y2: -56 },
  { x1: -148, y1: -56, x2: 86, y2: -56 },
  { x1: 118, y1: -56, x2: 372, y2: -56 },
  // Lower hull handrails
  { x1: -240, y1: 60, x2: 64, y2: 60 },
  { x1: 98, y1: 60, x2: 360, y2: 60 },
  // Vertical surface transfer rails across exterior cylinder skin
  { x1: -235, y1: -52, x2: -235, y2: 56 },
  { x1: 92, y1: -52, x2: 92, y2: 56 },
  { x1: 355, y1: -52, x2: 355, y2: 56 },
];

const TRUSS_HANDRAILS: HandrailSegment[] = [
  // Upper science truss rails
  { x1: -140, y1: -126, x2: 265, y2: -126 },
  { x1: -120, y1: -126, x2: -120, y2: -58 },
  { x1: 120, y1: -126, x2: 120, y2: -58 },
  // Lower radiator truss rails
  { x1: -40, y1: 124, x2: 290, y2: 124 },
  { x1: 92, y1: 62, x2: 92, y2: 124 },
  { x1: 255, y1: 62, x2: 255, y2: 124 },
];

const LEVEL_CONFIGS: LevelConfig[] = [
  // L1: Airlock Inspection
  {
    oxygenSeconds: 155,
    terminatorMode: 'mild',
    staticTerminatorX: 600,
    hasTrusses: false,
    handrails: BASE_HANDRAILS,
    anchors: [
      { id: 'A0', label: '气闸锚环 A0', x: -340, y: -56, maxLen: 295 },
      { id: 'A1', label: '中段锚环 A1', x: -72, y: -56, maxLen: 295 },
      { id: 'A2', label: '前端锚环 A2', x: 175, y: -56, maxLen: 290 },
    ],
    nodes: [
      { id: 'R1', label: '姿态敏感器箱', x: -102, y: -50 },
      { id: 'R2', label: '暴露电源接线盒', x: 245, y: -48 },
    ],
    airlock: { x: -350, y: -48 },
    startPos: { x: -345, y: -74 },
    initialAnchorId: 'A0',
  },
  // L2: Terminator Thermal Repair (+120C Sun / -100C Shadow)
  {
    oxygenSeconds: 140,
    terminatorMode: 'static',
    staticTerminatorX: -15,
    hasTrusses: false,
    handrails: BASE_HANDRAILS,
    anchors: [
      { id: 'A0', label: '气闸锚环 A0', x: -340, y: -56, maxLen: 285 },
      { id: 'A1', label: '向阳锚环 A1', x: -115, y: -56, maxLen: 275 },
      { id: 'A2', label: '背阴上锚 A2', x: 105, y: -56, maxLen: 275 },
      { id: 'A3', label: '背阴下锚 A3', x: 105, y: 60, maxLen: 270 },
    ],
    nodes: [
      { id: 'R1', label: '向阳面热控阀', x: -145, y: -50 },
      { id: 'R2', label: '背阴面中继天线盒', x: 258, y: 54 },
    ],
    airlock: { x: -350, y: -48 },
    startPos: { x: -345, y: -74 },
    initialAnchorId: 'A0',
  },
  // L3: Micrometeoroid Breach (Moving Terminator + Upper/Lower Trusses)
  {
    oxygenSeconds: 125,
    terminatorMode: 'moving',
    staticTerminatorX: -220,
    hasTrusses: true,
    handrails: [...BASE_HANDRAILS, ...TRUSS_HANDRAILS],
    anchors: [
      { id: 'A0', label: '气闸锚环 A0', x: -340, y: -56, maxLen: 265 },
      { id: 'A1', label: '左桁锚环 A1', x: -120, y: -56, maxLen: 265 },
      { id: 'A2', label: '中枢锚环 A2', x: 118, y: -56, maxLen: 265 },
      { id: 'A3', label: '下桁锚环 A3', x: 118, y: 60, maxLen: 265 },
      { id: 'A4', label: '远端锚环 A4', x: 275, y: -56, maxLen: 265 },
    ],
    nodes: [
      { id: 'R1', label: '上桁架穿孔漏点', x: -8, y: -124 },
      { id: 'R2', label: '下桁架冷却管渗漏', x: 182, y: 122 },
      { id: 'R3', label: '末端暴露载荷破损', x: 358, y: -48 },
    ],
    airlock: { x: -350, y: -48 },
    startPos: { x: -345, y: -74 },
    initialAnchorId: 'A0',
  },
];

function buildScienceCard(levelIndex: number, stats: {
  reclips: number;
  peakTemp: number;
  minTemp: number;
  oxygenLeftPct: number;
}): ScienceComparison {
  if (levelIndex === 0) {
    return {
      title: '出舱安全系绳与三点固定原则',
      gameAction: `你完成了 ${stats.reclips} 次安全绳锚环转挂，依靠扶手抓握消除微重力惯性滑行，顺利抢修并返航。`,
      realStationFact:
        '在近地轨道舱外作业时，任何一次脱手都可能造成永久漂离。航天员穿着约 130 kg 的“飞天”舱外服，始终使用双挂钩安全绳交替扣锁在舱外扶手上，确保任何时刻至少有一条刚性系绳连接空间站。',
      realData: '真实天宫参数：飞天舱外服质量 ~130 kg ｜ 金属编织伸缩安全绳 + 双安全挂钩',
      codexId: 'eva-tether',
    };
  }
  if (levelIndex === 1) {
    return {
      title: '向阳 +120 °C 与背阴 -100 °C 舱外热控',
      gameAction: `你在明暗交界线两侧动态切换液冷降温/加热模式，将宇航服核心温度维持在 ${stats.minTemp.toFixed(1)}°C ～ ${stats.peakTemp.toFixed(1)}°C 区间。`,
      realStationFact:
        '太空真空中没有空气对流散热，太阳直射舱壁温度高达 +120 °C，而转入地球阴影区会骤降至 -100 °C。飞天舱外服依靠多层真空隔热层、内置超 90 米毛细水管的液冷服与水升华器实时平衡极端热流。',
      realData: '真实天宫参数：舱外温差 > 220 °C ｜ 液冷服毛细管总长 > 90 m',
      codexId: 'eva-thermal',
    };
  }
  return {
    title: '气闸舱泄压、氧气窗口与舱外应急堵漏',
    gameAction: `面对移动晨昏线与多点受损，你通过 ${stats.reclips} 次锚点接力完成全部 3 处抢修，带着 ${stats.oxygenLeftPct}% 剩余氧气安全返回气闸。`,
    realStationFact:
      '问天实验舱主气闸舱是航天员高频出舱的门户。出舱前需吸纯氧排氮防减压病并将舱内抽至真空，舱外服以约 40 kPa 纯氧低压运行以兼顾关节灵活度与长达 6–8 小时的作业生命保障。',
    realData: '真实天宫参数：问天主气闸舱 ｜ 舱外服工作气压 ~40 kPa 纯氧 ｜ 续航 6–8 h',
    codexId: 'eva-airlock',
  };
}

function closestPointOnSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): { x: number; y: number; d: number } {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) {
    return { x: x1, y: y1, d: dist(px, py, x1, y1) };
  }
  const t = clamp(((px - x1) * dx + (py - y1) * dy) / lenSq, 0, 1);
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return { x: cx, y: cy, d: dist(px, py, cx, cy) };
}

export const evaMeta: GameMeta = {
  id: 'eva',
  number: '03',
  shortTitle: '舱外漫步',
  title: '舱外 EVA 太空漫步',
  enTitle: 'EVA TETHER WALK',
  moduleName: '气闸舱外表面',
  genre: '物理系绳攀爬',
  tagline: '在+120°C/-100°C极端温差与安全绳约束下完成舱外抢修',
  accent: '#22d3ee',
  hubAnchor: { x: 0.08, y: 0.44 },
  briefingSteps: [
    {
      title: '无重力扶手攀爬与安全绳',
      desc: '用 WASD/方向键（或按住画面拖动方向）点喷微推滑行；靠近黄色扶手按 Space 抓稳制动。安全绳拉满时会自动拉回，靠近新锚环按 C（或点击锚环）可转挂延长作业半径。',
    },
    {
      title: '跨越明暗交界线控温',
      desc: '阳光直射面达 +120°C、背阴阴影区低至 -100°C。按 Q 制冷、X 平衡、E 加热（或点击底部控制台），维持宇航服核心温度在绿色安全区间。',
    },
    {
      title: '故障抢修与返航气闸',
      desc: '靠近电弧闪烁的故障节点，长按 Space（或长按节点/修复键）约 1.8 秒完成更换；修复全部节点后迅速返回发光的绿色气闸舱门。',
    },
  ],
  controlsHint:
    'WASD/方向键 微推移动 ｜ Space 抓扶手/长按维修 ｜ Q 制冷 / X 平衡 / E 加热 ｜ C 挂扣锚点 ｜ 鼠标可直接点击锚点或长按推进',
  levels: [
    {
      index: 0,
      name: '气闸舱外巡检',
      subtitle: '掌握扶手抓握、安全绳转挂与舱外维修',
      objective: '沿扶手前往 2 处故障传感器长按修复，完成后返回绿色气闸舱门',
    },
    {
      index: 1,
      name: '明暗交界线抢修',
      subtitle: '+120°C 阳照与 -100°C 阴影热控切换',
      objective: '切换液冷制冷/加热模式，横跨明暗交界线修复 2 处节点并返航',
    },
    {
      index: 2,
      name: '微流星撞击堵漏',
      subtitle: '移动晨昏线、全舱锚点接力与限时抢修',
      objective: '多锚点接力修复上下桁架共 3 处破损点，并在氧气耗尽前返回气闸',
    },
  ],
  codexIds: ['eva-tether', 'eva-thermal', 'eva-airlock'],
};

export const evaGame: GameModule = {
  meta: evaMeta,

  mount(canvasHost: HTMLElement, host: GameHostAPI): GameInstance {
    let viewW = 1280;
    let viewH = 720;
    let scale = 1;
    let originX = 640;
    let originY = 360;

    const recomputeViewport = (w: number, h: number) => {
      viewW = w;
      viewH = h;
      const compact = h <= 720;
      const safeTop = compact ? 100 : 122;
      const safeBottom = Math.max(safeTop + 180, h - (compact ? 94 : 138));
      const safeW = Math.max(420, w - 96);
      const safeH = Math.max(180, safeBottom - safeTop);
      scale = Math.min(safeW / WORLD_W, safeH / WORLD_H);
      originX = w * 0.5;
      originY = (safeTop + safeBottom) * 0.5;
    };

    const handle = setupHiDPICanvas(canvasHost, recomputeViewport);
    const { canvas, ctx } = handle;
    const initSize = handle.getSize();
    recomputeViewport(initSize.width, initSize.height);

    const starfield = new StarfieldRenderer(155, 303);
    const particles = new ParticleSystem();

    const screenToWorld = (sx: number, sy: number) => ({
      x: (sx - originX) / scale,
      y: (sy - originY) / scale,
    });

    // ---- Simulation State ----
    let levelIndex = host.getLevel();
    let cfg: LevelConfig = LEVEL_CONFIGS[levelIndex] ?? LEVEL_CONFIGS[0];
    let paused = host.isPaused();
    let physicsOverlay = host.hud.isPhysicsOverlayEnabled();
    let finished = false;
    let destroyed = false;

    let simTime = 0;
    let levelTime = 0;

    // Astronaut state
    let astroX = 0;
    let astroY = 0;
    let astroVx = 0;
    let astroVy = 0;
    let astroFacing = 1; // 1 right, -1 left
    let astroTilt = 0;

    // Tether & Anchor
    let activeAnchorId = 'A0';
    let tetherTensionN = 0;
    let tetherFx = 0;
    let tetherFy = 0;
    let tetherRatio = 0;
    let reclipsCount = 0;

    // Handrail & Repair
    let nearRailPt: { x: number; y: number; d: number } | null = null;
    let grabbingRail = false;
    let nodes: RepairNode[] = [];
    let repairingNodeId: string | null = null;
    let repairBeepTimer = 0;
    let thrusterSoundTimer = 0;
    let warnSoundTimer = 0;

    // Thermal & Life Support
    let oxygen = 150;
    let maxOxygen = 150;
    let thermalMode: ThermalMode = 'balance';
    let suitTemp = 22.0;
    let ambientTemp = 22.0;
    let terminatorX = 600;
    let thermalViolationTime = 0;
    let peakSuitTemp = 22.0;
    let minSuitTemp = 22.0;

    // Input state
    const keys = new Set<string>();
    let pointerDown = false;
    let pointerWorldX = 0;
    let pointerWorldY = 0;
    let deckRepairHeld = false;

    // Toast debounce map
    const toastCooldowns = new Map<string, number>();
    const pushDebouncedToast = (
      key: string,
      text: string,
      tone: MetricStatus = 'info',
      tag = '舱外遥测科普',
      cooldownSec = 7
    ) => {
      const prev = toastCooldowns.get(key) ?? -999;
      if (simTime - prev < cooldownSec) return;
      toastCooldowns.set(key, simTime);
      host.hud.pushToast(text, tone, tag);
    };

    // ---- Tactile Deck Controls ----
    let btnCool!: HTMLButtonElement;
    let btnBalance!: HTMLButtonElement;
    let btnHeat!: HTMLButtonElement;
    let btnReclip!: HTMLButtonElement;
    let btnAction!: HTMLButtonElement;

    const syncDeckButtons = () => {
      if (!btnCool) return;
      btnCool.classList.toggle('is-active', thermalMode === 'cool');
      btnBalance.classList.toggle('is-active', thermalMode === 'balance');
      btnHeat.classList.toggle('is-active', thermalMode === 'heat');
      btnHeat.classList.toggle('is-gold', thermalMode === 'heat');

      const candidate = findBestReclipAnchor();
      btnReclip.classList.toggle('is-gold', candidate !== null);
      btnReclip.textContent = candidate
        ? `◈ 挂扣 ${candidate.id} (C)`
        : '◈ 挂扣锚点 (C)';

      const nearNode = findRepairableNode();
      if (nearNode) {
        btnAction.classList.add('is-gold');
        btnAction.textContent = '◆ 长按修复节点 (Space)';
      } else {
        btnAction.classList.remove('is-gold');
        btnAction.classList.toggle('is-active', grabbingRail || deckRepairHeld);
        btnAction.textContent = nearRailPt ? '◇ 抓稳扶手 (Space)' : '◇ 抓握 / 修复 (Space)';
      }
    };

    const setThermalMode = (mode: ThermalMode, userTriggered = true) => {
      if (thermalMode === mode) return;
      thermalMode = mode;
      if (userTriggered) {
        host.audio.playSwitch();
      }
      syncDeckButtons();
      if (userTriggered) {
        if (mode === 'cool') {
          pushDebouncedToast(
            'mode-cool',
            '液冷服与水升华器进入强效制冷档位，可抵消 +120°C 阳光直射热流。',
            'info',
            '宇航服热控',
            5
          );
        } else if (mode === 'heat') {
          pushDebouncedToast(
            'mode-heat',
            '电热保温回路启动，可抵御地球阴影区 -100°C 极端深空冷辐射。',
            'info',
            '宇航服热控',
            5
          );
        }
      }
    };

    const mountTactileDeck = () => {
      host.hud.clearTactileDeck();
      const deck = host.hud.getTactileDeck();

      btnCool = document.createElement('button');
      btnCool.type = 'button';
      btnCool.className = 'deck-ctrl-btn';
      btnCool.textContent = '▼ 制冷 (Q)';
      btnCool.title = '切换至液冷制冷模式，应对 +120°C 阳照区 (快捷键 Q)';
      btnCool.addEventListener('click', () => setThermalMode('cool', true));

      btnBalance = document.createElement('button');
      btnBalance.type = 'button';
      btnBalance.className = 'deck-ctrl-btn';
      btnBalance.textContent = '◎ 平衡 (X)';
      btnBalance.title = '切换至常规平衡模式 (快捷键 X)';
      btnBalance.addEventListener('click', () => setThermalMode('balance', true));

      btnHeat = document.createElement('button');
      btnHeat.type = 'button';
      btnHeat.className = 'deck-ctrl-btn';
      btnHeat.textContent = '▲ 加热 (E)';
      btnHeat.title = '切换至电加热保温模式，应对 -100°C 阴影区 (快捷键 E)';
      btnHeat.addEventListener('click', () => setThermalMode('heat', true));

      btnReclip = document.createElement('button');
      btnReclip.type = 'button';
      btnReclip.className = 'deck-ctrl-btn';
      btnReclip.textContent = '◈ 挂扣锚点 (C)';
      btnReclip.title = '将安全绳转挂至附近的舱外锚环，延长作业半径 (快捷键 C)';
      btnReclip.addEventListener('click', () => {
        attemptReclipAnchor();
      });

      btnAction = document.createElement('button');
      btnAction.type = 'button';
      btnAction.className = 'deck-ctrl-btn';
      btnAction.textContent = '◇ 抓握 / 修复 (Space)';
      btnAction.title = '长按抓握附近扶手制动，或在故障节点旁长按执行维修 (快捷键 Space)';

      const startDeckHold = (e: Event) => {
        e.preventDefault();
        deckRepairHeld = true;
        host.audio.playClick();
      };
      const endDeckHold = () => {
        deckRepairHeld = false;
      };
      btnAction.addEventListener('pointerdown', startDeckHold);
      btnAction.addEventListener('pointerup', endDeckHold);
      btnAction.addEventListener('pointerleave', endDeckHold);
      btnAction.addEventListener('pointercancel', endDeckHold);

      deck.append(btnCool, btnBalance, btnHeat, btnReclip, btnAction);
      syncDeckButtons();
    };

    // ---- Helpers ----
    const getActiveAnchor = (): TetherAnchor =>
      cfg.anchors.find((a) => a.id === activeAnchorId) ?? cfg.anchors[0];

    const findBestReclipAnchor = (): TetherAnchor | null => {
      let best: TetherAnchor | null = null;
      let bestD = 96;
      for (const a of cfg.anchors) {
        if (a.id === activeAnchorId) continue;
        const d = dist(astroX, astroY, a.x, a.y);
        if (d < bestD) {
          bestD = d;
          best = a;
        }
      }
      return best;
    };

    const findRepairableNode = (): RepairNode | null => {
      let best: RepairNode | null = null;
      let bestD = 58;
      for (const n of nodes) {
        if (n.repaired) continue;
        const d = dist(astroX, astroY, n.x, n.y);
        if (d < bestD) {
          bestD = d;
          best = n;
        }
      }
      return best;
    };

    const attemptReclipAnchor = (targetId?: string): boolean => {
      if (finished || paused) return false;
      const target = targetId
        ? cfg.anchors.find(
            (a) => a.id === targetId && a.id !== activeAnchorId && dist(astroX, astroY, a.x, a.y) < 106
          )
        : findBestReclipAnchor();

      if (!target) {
        host.audio.playBeep(260, 0.06);
        pushDebouncedToast(
          'no-anchor',
          '需靠近发光的舱外锚环（约 5 米内）才可安全转挂系绳。',
          'caution',
          '三点固定原则',
          4
        );
        return false;
      }

      activeAnchorId = target.id;
      reclipsCount++;
      host.audio.playLock();
      particles.burst(target.x, target.y, 16, '#22d3ee', 80, 3, 0.55);
      particles.spawn({
        x: target.x,
        y: target.y,
        vx: 0,
        vy: 0,
        life: 0.45,
        size: 22,
        color: '#38bdf8',
        kind: 'ring',
      });
      pushDebouncedToast(
        'reclip-ok',
        `安全系绳已双钩交替转挂至 ${target.label}！新的安全作业半径已展开。`,
        'nominal',
        '双钩交替挂扣',
        4
      );
      syncDeckButtons();
      return true;
    };

    const computeAmbientTemp = (x: number): number => {
      if (cfg.terminatorMode === 'mild') {
        // Gentle sunlit-to-mild gradient across station
        const t = clamp((x + 420) / 840, 0, 1);
        return lerp(38, 12, t);
      }
      // Sharp orbital terminator: left side is +120°C sunlit, right side is -100°C shadow
      const blend = clamp((x - terminatorX + 34) / 68, 0, 1);
      return lerp(120, -100, blend);
    };

    const loadLevel = (idx: number) => {
      levelIndex = clamp(idx, 0, LEVEL_CONFIGS.length - 1);
      cfg = LEVEL_CONFIGS[levelIndex];
      finished = false;
      levelTime = 0;

      astroX = cfg.startPos.x;
      astroY = cfg.startPos.y;
      astroVx = 0;
      astroVy = 0;
      astroFacing = 1;
      astroTilt = 0;

      activeAnchorId = cfg.initialAnchorId;
      tetherTensionN = 0;
      tetherFx = 0;
      tetherFy = 0;
      tetherRatio = 0;
      reclipsCount = 0;

      nearRailPt = null;
      grabbingRail = false;
      repairingNodeId = null;
      deckRepairHeld = false;
      pointerDown = false;
      keys.clear();

      nodes = cfg.nodes.map((n) => ({
        ...n,
        progress: 0,
        repaired: false,
        sparkTimer: Math.random() * 0.5,
      }));

      maxOxygen = cfg.oxygenSeconds;
      oxygen = maxOxygen;
      thermalMode = cfg.terminatorMode !== 'mild' ? 'cool' : 'balance';
      suitTemp = 22.0;
      terminatorX = cfg.staticTerminatorX;
      ambientTemp = computeAmbientTemp(astroX);
      thermalViolationTime = 0;
      peakSuitTemp = 22.0;
      minSuitTemp = 22.0;

      particles.clear();
      toastCooldowns.clear();

      const levelMeta = evaMeta.levels[levelIndex];
      if (levelMeta) host.hud.setObjective(levelMeta.objective);

      host.hud.setMetrics([
        {
          id: 'o2',
          label: '氧气余量',
          value: `100% · ${Math.ceil(oxygen)}s`,
          ratio: 1,
          status: 'nominal',
        },
        {
          id: 'temp',
          label: '服内核心温度',
          value: '22.0 °C',
          ratio: 0.5,
          status: 'nominal',
        },
        {
          id: 'tether',
          label: '系绳长度 / 锚点',
          value: `1.0/${(getActiveAnchor().maxLen / PX_PER_METER).toFixed(0)}m · ${activeAnchorId}`,
          ratio: 0.08,
          status: 'info',
        },
        {
          id: 'tasks',
          label: '抢修进度',
          value: `0 / ${nodes.length} 节点`,
          ratio: 0,
          status: 'info',
        },
      ]);

      mountTactileDeck();

      if (levelIndex === 0) {
        pushDebouncedToast(
          'l1-intro',
          '欢迎出舱！先用 WASD 点喷滑行并按 Space 抓扶手制动，途中可在锚环按 C 转挂安全绳。',
          'info',
          '气闸出舱指令',
          2
        );
      } else if (levelIndex === 1) {
        pushDebouncedToast(
          'l2-intro',
          '左侧为 +120°C 阳光直射区（已预置制冷），跨越白色晨昏线进入右侧 -100°C 阴影区后请按 E 切换加热！',
          'caution',
          '极端热控警告',
          2
        );
      } else {
        pushDebouncedToast(
          'l3-intro',
          '微流星击穿多处舱外设施！晨昏线正沿轨道缓缓推移，注意随时切换温控并用锚点接力抢修 3 处漏点。',
          'caution',
          '应急出舱警报',
          2
        );
      }
    };

    const finishMission = (won: boolean, failReason?: string) => {
      if (finished) return;
      finished = true;
      deckRepairHeld = false;
      pointerDown = false;
      keys.clear();

      const oxygenPct = Math.round((oxygen / maxOxygen) * 100);
      const repairedCount = nodes.filter((n) => n.repaired).length;
      let stars: 0 | 1 | 2 | 3 = 0;
      if (won) {
        if (oxygen / maxOxygen >= 0.42 && thermalViolationTime < 2.5) {
          stars = 3;
        } else if (oxygen / maxOxygen >= 0.2 && thermalViolationTime < 7.5) {
          stars = 2;
        } else {
          stars = 1;
        }
      }

      const score = won
        ? Math.round(
            450 +
              (oxygen / maxOxygen) * 350 +
              Math.max(0, 200 - thermalViolationTime * 22)
          )
        : Math.round(repairedCount * 120);

      const summary = won
        ? stars === 3
          ? '教科书级出舱作业！热控与系绳衔接完美无瑕，提前安全返回气闸舱。'
          : '成功修复舱外全部故障并安全返航，进一步优化温控与路径可冲击 3★ 评价。'
        : failReason ?? '出舱任务中止，请重新调整温控策略与作业路线。';

      const result: GameResult = {
        levelIndex,
        won,
        stars,
        score,
        summary,
        metrics: [
          {
            label: '完成维修节点',
            value: `${repairedCount} / ${nodes.length}`,
            status: repairedCount === nodes.length ? 'nominal' : 'caution',
          },
          {
            label: '返航剩余氧气',
            value: `${oxygenPct}% (${Math.max(0, Math.round(oxygen))}s)`,
            status: oxygenPct >= 40 ? 'nominal' : oxygenPct > 15 ? 'caution' : 'critical',
          },
          {
            label: '服温极值范围',
            value: `${minSuitTemp.toFixed(1)}°C ～ ${peakSuitTemp.toFixed(1)}°C`,
            status: thermalViolationTime < 2.5 ? 'nominal' : 'caution',
          },
          {
            label: '安全绳转挂次数',
            value: `${reclipsCount} 次`,
            status: 'info',
          },
        ],
        scienceCard: buildScienceCard(levelIndex, {
          reclips: reclipsCount,
          peakTemp: peakSuitTemp,
          minTemp: minSuitTemp,
          oxygenLeftPct: oxygenPct,
        }),
      };

      host.completeLevel(result);
    };

    // ---- Input Listeners ----
    const onKeyDown = (e: KeyboardEvent) => {
      if (destroyed || paused || finished) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const k = e.key.toLowerCase();
      // Strictly never intercept global shell keys: 1-8, Tab, Esc, V, R, M, F, ?
      if (
        /^[1-8]$/.test(e.key) ||
        e.key === 'Tab' ||
        e.key === 'Escape' ||
        k === 'v' ||
        k === 'r' ||
        k === 'm' ||
        k === 'f' ||
        e.key === '?'
      ) {
        return;
      }

      if (
        k === 'w' ||
        k === 'a' ||
        k === 's' ||
        k === 'd' ||
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown' ||
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight' ||
        e.key === ' '
      ) {
        e.preventDefault();
        keys.add(k === ' ' ? 'space' : k);
      } else if (k === 'q') {
        e.preventDefault();
        setThermalMode('cool', true);
      } else if (k === 'x') {
        e.preventDefault();
        setThermalMode('balance', true);
      } else if (k === 'e') {
        e.preventDefault();
        setThermalMode('heat', true);
      } else if (k === 'c') {
        e.preventDefault();
        attemptReclipAnchor();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      keys.delete(k === ' ' ? 'space' : k);
    };

    const onBlur = () => {
      keys.clear();
      pointerDown = false;
      deckRepairHeld = false;
    };

    const onPointerDown = (e: PointerEvent) => {
      if (destroyed || paused || finished || e.button !== 0) return;
      const rect = canvas.getBoundingClientRect();
      const wp = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      pointerWorldX = wp.x;
      pointerWorldY = wp.y;

      // 1) Clicking directly on a nearby unclipped anchor re-clips tether immediately!
      for (const a of cfg.anchors) {
        if (a.id !== activeAnchorId && dist(wp.x, wp.y, a.x, a.y) < 30) {
          if (attemptReclipAnchor(a.id)) {
            return;
          }
        }
      }

      // 2) Clicking directly on a nearby unrepaired fault node holds repair!
      for (const n of nodes) {
        if (!n.repaired && dist(wp.x, wp.y, n.x, n.y) < 38 && dist(astroX, astroY, n.x, n.y) < 62) {
          deckRepairHeld = true;
          host.audio.playClick();
          return;
        }
      }

      // 3) Otherwise hold-thrust gently toward cursor
      pointerDown = true;
      canvas.setPointerCapture?.(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (destroyed) return;
      const rect = canvas.getBoundingClientRect();
      const wp = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      pointerWorldX = wp.x;
      pointerWorldY = wp.y;
    };

    const onPointerUp = () => {
      pointerDown = false;
      deckRepairHeld = false;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    // ---- Simulation Step ----
    const step = (dt: number) => {
      simTime += dt;
      if (paused || host.isPaused() || finished) return;
      levelTime += dt;

      // 1. Update orbital terminator (L3 moves slowly back and forth)
      if (cfg.terminatorMode === 'moving') {
        terminatorX = Math.sin(levelTime * 0.12 - 0.85) * 305;
      }

      // 2. Oxygen consumption (slightly faster if thermal loop works hard or heavy jetting)
      const o2Rate = thermalMode === 'balance' ? 0.95 : 1.05;
      oxygen = Math.max(0, oxygen - dt * o2Rate);
      if (oxygen <= 0) {
        finishMission(false, '舱外服纯氧储备已耗尽，气闸紧急召回系统已触发。');
        return;
      }
      if (oxygen < 25) {
        pushDebouncedToast(
          'low-o2',
          '氧气余量低于 25 秒！请抓紧完成作业并沿扶手快速返回气闸舱门。',
          'critical',
          '生命保障告警',
          8
        );
      }

      // 3. Nearest handrail detection
      let bestRail: { x: number; y: number; d: number } | null = null;
      for (const seg of cfg.handrails) {
        const pt = closestPointOnSegment(astroX, astroY, seg.x1, seg.y1, seg.x2, seg.y2);
        if (!bestRail || pt.d < bestRail.d) {
          bestRail = pt;
        }
      }
      nearRailPt = bestRail && bestRail.d <= 36 ? bestRail : null;

      // 4. Directional input (Keyboard + optional mouse thrust)
      let inX = 0;
      let inY = 0;
      if (keys.has('a') || keys.has('arrowleft')) inX -= 1;
      if (keys.has('d') || keys.has('arrowright')) inX += 1;
      if (keys.has('w') || keys.has('arrowup')) inY -= 1;
      if (keys.has('s') || keys.has('arrowdown')) inY += 1;

      if (inX === 0 && inY === 0 && pointerDown) {
        const dx = pointerWorldX - astroX;
        const dy = pointerWorldY - astroY;
        const d = Math.hypot(dx, dy);
        if (d > 14) {
          inX = dx / d;
          inY = dy / d;
        }
      } else {
        const mag = Math.hypot(inX, inY);
        if (mag > 1) {
          inX /= mag;
          inY /= mag;
        }
      }

      const actionHeld = keys.has('space') || deckRepairHeld;
      const nearRepairNode = findRepairableNode();

      // 5. Repair interaction
      repairingNodeId = null;
      if (actionHeld && nearRepairNode) {
        repairingNodeId = nearRepairNode.id;
        grabbingRail = true;
        // Stabilize astronaut beside fault node while working with power tool
        astroVx *= Math.exp(-8.5 * dt);
        astroVy *= Math.exp(-8.5 * dt);
        astroX = lerp(astroX, nearRepairNode.x, clamp(dt * 2.2, 0, 1));
        astroY = lerp(astroY, nearRepairNode.y - 12, clamp(dt * 2.2, 0, 1));

        nearRepairNode.progress = clamp(nearRepairNode.progress + dt / 1.8, 0, 1);
        repairBeepTimer -= dt;
        if (repairBeepTimer <= 0) {
          repairBeepTimer = 0.24;
          host.audio.playBeep(520 + nearRepairNode.progress * 380, 0.05);
          particles.burst(nearRepairNode.x, nearRepairNode.y, 4, '#38bdf8', 55, 2.2, 0.35);
        }

        if (nearRepairNode.progress >= 1) {
          nearRepairNode.repaired = true;
          host.audio.playLock();
          particles.burst(nearRepairNode.x, nearRepairNode.y, 24, '#22c55e', 110, 3.2, 0.7);
          particles.spawn({
            x: nearRepairNode.x,
            y: nearRepairNode.y,
            vx: 0,
            vy: 0,
            life: 0.55,
            size: 28,
            color: '#4ade80',
            kind: 'ring',
          });

          const left = nodes.filter((n) => !n.repaired).length;
          if (left === 0) {
            host.hud.setObjective('所有舱外故障已修复！沿扶手安全返回绿色气闸舱门');
            pushDebouncedToast(
              'all-repaired',
              '全部故障模块已恢复正常状态！请沿安全扶手返回左侧发光气闸舱门完成出舱任务。',
              'nominal',
              '抢修完毕',
              2
            );
          } else {
            pushDebouncedToast(
              `rep-${nearRepairNode.id}`,
              `${nearRepairNode.label} 修复完成！还剩 ${left} 处故障点待检修。`,
              'nominal',
              '模块就绪',
              2
            );
          }
        }
      } else {
        // 6. Movement: Handrail Crawl vs Zero-G Micro-Jet Drift
        grabbingRail = Boolean(actionHeld && nearRailPt);

        if (grabbingRail && nearRailPt) {
          // Pull gently toward handrail and allow crisp controlled hand-over-hand crawling
          const pullX = (nearRailPt.x - astroX) * 6.5;
          const pullY = (nearRailPt.y - astroY) * 6.5;
          const targetVx = inX * 128 + pullX * 0.35;
          const targetVy = inY * 128 + pullY * 0.35;
          astroVx = lerp(astroVx, targetVx, clamp(dt * 9.5, 0, 1));
          astroVy = lerp(astroVy, targetVy, clamp(dt * 9.5, 0, 1));
        } else {
          // True Zero-G inertia with PLSS micro-thruster jets
          const thrustAcc = 172;
          if (Math.hypot(inX, inY) > 0.05) {
            astroVx += inX * thrustAcc * dt;
            astroVy += inY * thrustAcc * dt;

            // Emit cold-gas puff opposite thrust vector
            if (Math.random() < 0.7) {
              particles.spawn({
                x: astroX - inX * 14 + (Math.random() - 0.5) * 4,
                y: astroY - inY * 14 + (Math.random() - 0.5) * 4,
                vx: -inX * (75 + Math.random() * 45) + astroVx * 0.25,
                vy: -inY * (75 + Math.random() * 45) + astroVy * 0.25,
                life: 0.28 + Math.random() * 0.14,
                size: 2.8,
                color: 'rgba(203, 240, 255, 0.85)',
              });
            }

            thrusterSoundTimer -= dt;
            if (thrusterSoundTimer <= 0) {
              thrusterSoundTimer = 0.17;
              host.audio.playThruster(0.28);
            }
          }

          // Subtle handrail passive brush damping if sliding right over rail
          if (nearRailPt && nearRailPt.d < 16) {
            astroVx *= Math.exp(-0.55 * dt);
            astroVy *= Math.exp(-0.55 * dt);
          } else {
            // Almost zero drag in vacuum
            astroVx *= Math.pow(0.996, dt * 60);
            astroVy *= Math.pow(0.996, dt * 60);
          }
        }

        // Speed cap
        const spd = Math.hypot(astroVx, astroVy);
        const maxSpd = 215;
        if (spd > maxSpd) {
          astroVx = (astroVx / spd) * maxSpd;
          astroVy = (astroVy / spd) * maxSpd;
        }

        astroX += astroVx * dt;
        astroY += astroVy * dt;
      }

      if (Math.abs(astroVx) > 8) {
        astroFacing = astroVx >= 0 ? 1 : -1;
      }
      astroTilt = lerp(astroTilt, clamp(astroVx * 0.0022, -0.32, 0.32), clamp(dt * 6, 0, 1));

      // 7. Physical Safety Tether Constraint
      const anchor = getActiveAnchor();
      const tdx = astroX - anchor.x;
      const tdy = astroY - anchor.y;
      const tDist = Math.hypot(tdx, tdy);
      tetherRatio = clamp(tDist / anchor.maxLen, 0, 1.15);
      tetherTensionN = 0;
      tetherFx = 0;
      tetherFy = 0;

      if (tDist > anchor.maxLen && tDist > 0.001) {
        const nx = tdx / tDist;
        const ny = tdy / tDist;
        const stretch = tDist - anchor.maxLen;

        // Pull back smoothly + cancel outward radial velocity (elastic cable snap-back)
        astroX = anchor.x + nx * anchor.maxLen;
        astroY = anchor.y + ny * anchor.maxLen;

        const radVel = astroVx * nx + astroVy * ny;
        if (radVel > 0) {
          astroVx -= nx * radVel * 1.38;
          astroVy -= ny * radVel * 1.38;
        }
        // Spring restoring impulse
        astroVx -= nx * Math.min(stretch * 8, 28);
        astroVy -= ny * Math.min(stretch * 8, 28);

        tetherTensionN = clamp(35 + stretch * 14 + Math.max(0, radVel) * 0.9, 30, 260);
        tetherFx = -nx * tetherTensionN;
        tetherFy = -ny * tetherTensionN;

        pushDebouncedToast(
          'tether-taut',
          '安全系绳已拉至极限！系绳张力阻止你漂离空间站；靠近前方锚环按 C 可转挂延长作业半径。',
          'caution',
          '物理系绳约束',
          6
        );
      }

      // Soft playfield bounds
      const boundX = 446;
      const boundY = 160;
      if (astroX < -boundX) {
        astroX = -boundX;
        astroVx = Math.abs(astroVx) * 0.4;
      } else if (astroX > boundX) {
        astroX = boundX;
        astroVx = -Math.abs(astroVx) * 0.4;
      }
      if (astroY < -boundY) {
        astroY = -boundY;
        astroVy = Math.abs(astroVy) * 0.4;
      } else if (astroY > boundY) {
        astroY = boundY;
        astroVy = -Math.abs(astroVy) * 0.4;
      }

      // 8. Thermal Physics Simulation (+120°C sunlit / -100°C shadow vs Feitian Liquid Cooling/Heater)
      ambientTemp = computeAmbientTemp(astroX);
      const envFlux = (ambientTemp - 22) * 0.029; // +2.84 °C/s at +120°C; -3.54 °C/s at -100°C

      let loopRate = 0;
      if (thermalMode === 'cool') {
        if (ambientTemp > 45) {
          // Water sublimator actively rejects solar heat and stabilizes near 20°C
          loopRate = -envFlux + (20.2 - suitTemp) * 0.58;
        } else {
          // Leaving max cooling on in cold zone chills the suit!
          loopRate = -2.15;
        }
      } else if (thermalMode === 'heat') {
        if (ambientTemp < -20) {
          // Electric heater actively offsets shadow chill and stabilizes near 23.5°C
          loopRate = -envFlux + (23.6 - suitTemp) * 0.58;
        } else {
          // Leaving heater on in warm/sunlit zone overheats the suit!
          loopRate = +2.15;
        }
      } else {
        // Balance mode: mild passive regulation (handles L1 easily, struggles in extreme ±100°C!)
        loopRate = (22.0 - suitTemp) * 0.34;
      }

      suitTemp += (envFlux + loopRate) * dt;
      peakSuitTemp = Math.max(peakSuitTemp, suitTemp);
      minSuitTemp = Math.min(minSuitTemp, suitTemp);

      if (suitTemp > 30 || suitTemp < 14) {
        thermalViolationTime += dt;
        warnSoundTimer -= dt;
        if (warnSoundTimer <= 0) {
          warnSoundTimer = 1.15;
          host.audio.playWarning();
        }
        if (suitTemp > 30) {
          pushDebouncedToast(
            'hot-warn',
            '向阳面太阳辐射热流飙升（+120°C）！请立刻按 Q 开启液冷制冷模式降温！',
            'critical',
            '高温热控告警',
            5
          );
        } else {
          pushDebouncedToast(
            'cold-warn',
            '进入地球本影冷黑区（-100°C）！请立刻按 E 开启电热保温模式防失温！',
            'critical',
            '低温热控告警',
            5
          );
        }
      }

      if (suitTemp >= 42) {
        finishMission(false, '宇航服核心温度突破 +42°C 红线！向阳区未及时开启液冷降温导致热过载。');
        return;
      }
      if (suitTemp <= 5) {
        finishMission(false, '宇航服核心温度跌破 +5°C 红线！阴影区未及时切换加热保温导致失温告警。');
        return;
      }

      // 9. Ambient fault sparks
      for (const n of nodes) {
        if (n.repaired) continue;
        n.sparkTimer -= dt;
        if (n.sparkTimer <= 0) {
          n.sparkTimer = 0.25 + Math.random() * 0.45;
          particles.burst(n.x, n.y, 3, Math.random() < 0.5 ? '#fbbf24' : '#38bdf8', 48, 2.0, 0.32);
        }
      }

      // 10. Check Mission Completion (all repaired + reached Airlock Hatch)
      const repairedCount = nodes.filter((n) => n.repaired).length;
      if (repairedCount === nodes.length) {
        const dAirlock = dist(astroX, astroY, cfg.airlock.x, cfg.airlock.y);
        if (dAirlock <= 48) {
          particles.burst(cfg.airlock.x, cfg.airlock.y, 28, '#22c55e', 120, 3.5, 0.8);
          finishMission(true);
          return;
        }
      }

      particles.update(dt);

      // 11. Event-driven HUD telemetry updates
      const o2Ratio = oxygen / maxOxygen;
      const o2Status: MetricStatus = o2Ratio > 0.4 ? 'nominal' : o2Ratio > 0.2 ? 'caution' : 'critical';
      host.hud.updateMetric('o2', {
        value: `${Math.round(o2Ratio * 100)}% · ${Math.ceil(oxygen)}s`,
        ratio: o2Ratio,
        status: o2Status,
      });

      const tempStatus: MetricStatus =
        suitTemp >= 16 && suitTemp <= 28
          ? 'nominal'
          : suitTemp >= 10 && suitTemp <= 35
            ? 'caution'
            : 'critical';
      host.hud.updateMetric('temp', {
        value: `${suitTemp.toFixed(1)}°C (外 ${ambientTemp >= 0 ? '+' : ''}${Math.round(ambientTemp)}°C)`,
        ratio: clamp((suitTemp - 5) / 37, 0, 1),
        status: tempStatus,
      });

      const tMeters = (tDist / PX_PER_METER).toFixed(1);
      const tMaxMeters = (anchor.maxLen / PX_PER_METER).toFixed(0);
      host.hud.updateMetric('tether', {
        value: `${tMeters}/${tMaxMeters}m · ${activeAnchorId}`,
        ratio: clamp(tetherRatio, 0, 1),
        status: tetherRatio > 0.94 ? 'caution' : 'info',
      });

      host.hud.updateMetric('tasks', {
        value:
          repairedCount === nodes.length
            ? '返航气闸舱门!'
            : `${repairedCount} / ${nodes.length} 节点`,
        ratio: repairedCount / Math.max(1, nodes.length),
        status: repairedCount === nodes.length ? 'nominal' : 'info',
      });

      syncDeckButtons();
    };

    // ---- Rendering ----
    const drawThermalBackdrop = () => {
      if (cfg.terminatorMode === 'mild') {
        ctx.fillStyle = 'rgba(253, 224, 71, 0.045)';
        ctx.fillRect(-WORLD_W * 0.6, -WORLD_H * 0.65, WORLD_W * 0.62, WORLD_H * 1.3);
        return;
      }

      // Bright +120°C Sunlight Zone (left) & Deep -100°C Shadow Zone (right), flat fills (zero gradients/lighter)
      const leftW = Math.max(0, terminatorX + WORLD_W * 0.7);
      if (leftW > 0) {
        ctx.fillStyle = 'rgba(253, 224, 71, 0.065)';
        ctx.fillRect(-WORLD_W * 0.7, -WORLD_H * 0.75, leftW, WORLD_H * 1.5);
      }

      ctx.fillStyle = 'rgba(2, 8, 26, 0.56)';
      ctx.fillRect(terminatorX, -WORLD_H * 0.75, WORLD_W * 1.4, WORLD_H * 1.5);

      ctx.save();
      ctx.strokeStyle = 'rgba(226, 240, 255, 0.72)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([7, 6]);
      ctx.beginPath();
      ctx.moveTo(terminatorX, -172);
      ctx.lineTo(terminatorX, 168);
      ctx.stroke();
      ctx.setLineDash([]);

      // Zone headers
      ctx.font = '700 11.5px "JetBrains Mono", monospace';
      ctx.textAlign = 'right';
      ctx.fillStyle = '#fde047';
      ctx.fillText('◈ 阳照区 +120°C', terminatorX - 12, -152);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#7dd3fc';
      ctx.fillText('◐ 阴影区 -100°C', terminatorX + 12, -152);
      ctx.restore();
    };

    const drawStationHull = () => {
      ctx.save();
      const mli = getMLIPattern(ctx);

      // Background recessed Solar Wings for Tiangong silhouette depth
      ctx.globalAlpha = 0.5;
      drawSolarPanelRect(ctx, -185, -162, 72, 108, cfg.terminatorMode === 'mild' ? 0.92 : 0.88);
      drawSolarPanelRect(ctx, -185, 58, 72, 104, cfg.terminatorMode === 'mild' ? 0.85 : 0.75);
      drawSolarPanelRect(ctx, 210, -158, 66, 104, cfg.terminatorMode === 'mild' ? 0.85 : 0.34);
      drawSolarPanelRect(ctx, 210, 56, 66, 102, cfg.terminatorMode === 'mild' ? 0.8 : 0.28);
      ctx.globalAlpha = 1;

      // Optional Level 3 Upper & Lower Exposed Metallic Truss Frames
      if (cfg.hasTrusses) {
        const drawTrussGirder = (x: number, y: number, w: number, h: number) => {
          ctx.strokeStyle = '#94a3b8';
          ctx.lineWidth = 3.2;
          ctx.strokeRect(x, y, w, h);

          ctx.strokeStyle = 'rgba(203, 213, 225, 0.55)';
          ctx.lineWidth = 1.5;
          for (let tx = x; tx < x + w - 18; tx += 34) {
            ctx.beginPath();
            ctx.moveTo(tx, y);
            ctx.lineTo(tx + 34, y + h);
            ctx.moveTo(tx + 34, y);
            ctx.lineTo(tx, y + h);
            ctx.stroke();
          }
        };

        drawTrussGirder(-142, -132, 412, 18);
        drawTitaniumModule(ctx, -123, -114, 6, 70, { vertical: true, radius: 2, rivets: false });
        drawTitaniumModule(ctx, 117, -114, 6, 70, { vertical: true, radius: 2, rivets: false });

        drawTrussGirder(-44, 114, 338, 18);
        drawTitaniumModule(ctx, 89, 48, 6, 66, { vertical: true, radius: 2, rivets: false });
        drawTitaniumModule(ctx, 252, 48, 6, 66, { vertical: true, radius: 2, rivets: false });
      }

      // 3D Studio-Rendered Pressurized Station Module Hull Segments (preserving exact 960:342 ratio)
      const hullSeg1 = drawModelSprite(ctx, 'eva-station-hull', -412, -48, 276, 98);
      const hullSeg2 = drawModelSprite(ctx, 'eva-station-hull', -138, -48, 276, 98, {
        flipX: true,
      });
      const hullSeg3 = drawModelSprite(ctx, 'eva-station-hull', 136, -48, 276, 98);

      // Machined titanium bulkhead coupler collars joining hull segments seamlessly
      if (hullSeg1 && hullSeg2 && hullSeg3) {
        drawTitaniumModule(ctx, -149, -35, 24, 72, {
          radius: 4,
          mliBands: [0.28],
          rivets: false,
          rimGlow: 'rgba(186, 230, 253, 0.72)',
        });
        drawTitaniumModule(ctx, 126, -35, 22, 72, {
          radius: 4,
          mliBands: [0.3],
          rivets: false,
          rimGlow: 'rgba(186, 230, 253, 0.72)',
        });
      }

      if (!hullSeg1 || !hullSeg2 || !hullSeg3) {
        drawTitaniumModule(ctx, -412, -36, 164, 78, {
          radius: 12,
          mliBands: [0.07],
          rivets: true,
          rimGlow: 'rgba(226, 242, 255, 0.78)',
        });
        drawTitaniumModule(ctx, -248, -44, 412, 92, {
          radius: 10,
          mliBands: [0.03, 0.45, 0.88],
          rivets: true,
          rimGlow: 'rgba(241, 248, 255, 0.84)',
        });
        drawTitaniumModule(ctx, 164, -38, 248, 82, {
          radius: 10,
          mliBands: [0.16, 0.78],
          rivets: true,
          rimGlow: 'rgba(226, 242, 255, 0.78)',
        });
      }
      void mli;

      // Airlock Hatch Beacon
      const allRepaired = nodes.every((n) => n.repaired);
      const ax = cfg.airlock.x;
      const ay = cfg.airlock.y;
      const strobeCol = allRepaired ? '#4ade80' : '#38bdf8';

      drawTitaniumModule(ctx, ax - 24, ay - 9, 48, 20, {
        radius: 5,
        rivets: false,
        rimGlow: strobeCol,
      });
      ctx.fillStyle = allRepaired ? 'rgba(34, 197, 94, 0.56)' : 'rgba(14, 165, 233, 0.46)';
      ctx.beginPath();
      ctx.roundRect(ax - 17, ay - 5, 34, 12, 3.5);
      ctx.fill();

      // Twin status strobe LEDs on hatch corners
      ctx.fillStyle = strobeCol;
      ctx.beginPath();
      ctx.arc(ax - 21, ay, 2.2, 0, Math.PI * 2);
      ctx.arc(ax + 21, ay, 2.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = '700 10px "JetBrains Mono", monospace';
      ctx.fillStyle = allRepaired ? '#4ade80' : '#7dd3fc';
      ctx.textAlign = 'center';
      ctx.fillText(allRepaired ? '✓ 返航气闸舱门' : '气闸舱门', ax, ay - 17);

      ctx.restore();
    };

    const drawHandrails = () => {
      ctx.save();
      for (const seg of cfg.handrails) {
        const isHoriz = Math.abs(seg.y2 - seg.y1) < Math.abs(seg.x2 - seg.x1);

        // Machined titanium standoff brackets with highlight edge
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 3.2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(seg.x1, seg.y1);
        ctx.lineTo(seg.x1, seg.y1 + (seg.y1 < 0 ? 10 : -10));
        ctx.moveTo(seg.x2, seg.y2);
        ctx.lineTo(seg.x2, seg.y2 + (seg.y2 < 0 ? 10 : -10));
        ctx.stroke();

        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(seg.x1 - 0.6, seg.y1);
        ctx.lineTo(seg.x1 - 0.6, seg.y1 + (seg.y1 < 0 ? 10 : -10));
        ctx.moveTo(seg.x2 - 0.6, seg.y2);
        ctx.lineTo(seg.x2 - 0.6, seg.y2 + (seg.y2 < 0 ? 10 : -10));
        ctx.stroke();

        // Ambient cast shadow behind rail
        ctx.strokeStyle = 'rgba(4, 10, 22, 0.55)';
        ctx.lineWidth = 6.2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(seg.x1, seg.y1 + 1.8);
        ctx.lineTo(seg.x2, seg.y2 + 1.8);
        ctx.stroke();

        // Subtle warm golden aura halo
        ctx.strokeStyle = 'rgba(250, 204, 21, 0.22)';
        ctx.lineWidth = 8.5;
        ctx.beginPath();
        ctx.moveTo(seg.x1, seg.y1);
        ctx.lineTo(seg.x2, seg.y2);
        ctx.stroke();

        // Beveled anodized gold EVA tubular rail (shadow underside -> gold body -> top specular ridge)
        ctx.strokeStyle = '#a16207';
        ctx.lineWidth = 4.4;
        ctx.beginPath();
        ctx.moveTo(seg.x1, seg.y1 + (isHoriz ? 0.7 : 0));
        ctx.lineTo(seg.x2, seg.y2 + (isHoriz ? 0.7 : 0));
        ctx.stroke();

        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 3.0;
        ctx.beginPath();
        ctx.moveTo(seg.x1, seg.y1);
        ctx.lineTo(seg.x2, seg.y2);
        ctx.stroke();

        ctx.strokeStyle = '#fef9c3';
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(seg.x1 + (isHoriz ? 0 : -0.8), seg.y1 + (isHoriz ? -1.0 : 0));
        ctx.lineTo(seg.x2 + (isHoriz ? 0 : -0.8), seg.y2 + (isHoriz ? -1.0 : 0));
        ctx.stroke();
      }

      // Highlight nearest handrail grip indicator
      if (nearRailPt && !repairingNodeId) {
        ctx.strokeStyle = grabbingRail ? '#22c55e' : 'rgba(56, 189, 248, 0.78)';
        ctx.lineWidth = grabbingRail ? 2.4 : 1.5;
        ctx.setLineDash(grabbingRail ? [] : [4, 4]);
        ctx.beginPath();
        ctx.moveTo(astroX, astroY);
        ctx.lineTo(nearRailPt.x, nearRailPt.y);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = grabbingRail ? '#86efac' : '#7dd3fc';
        ctx.beginPath();
        ctx.arc(nearRailPt.x, nearRailPt.y, 4.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    };

    const drawAnchorsAndTether = () => {
      const active = getActiveAnchor();
      const candidate = findBestReclipAnchor();

      ctx.save();
      // Draw Anchor Rings (flat metallic ring, zero gradients/additive glow)
      for (const a of cfg.anchors) {
        const isActive = a.id === activeAnchorId;
        const isCand = candidate?.id === a.id;

        if (isCand) {
          const p = 0.5 + 0.5 * Math.sin(simTime * 7);
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(a.x, a.y, 14 + p * 6, 0, Math.PI * 2);
          ctx.stroke();

          ctx.font = '700 10px "JetBrains Mono", monospace';
          ctx.fillStyle = '#7dd3fc';
          ctx.textAlign = 'center';
          ctx.fillText(`[C] 转挂 ${a.id}`, a.x, a.y - 21);
        }

        ctx.fillStyle = isActive ? '#16a34a' : isCand ? '#0284c7' : '#334155';
        ctx.strokeStyle = isActive ? '#bbf7d0' : isCand ? '#7dd3fc' : '#94a3b8';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(a.x, a.y, 7.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#091120';
        ctx.beginPath();
        ctx.arc(a.x, a.y, 2.9, 0, Math.PI * 2);
        ctx.fill();

        if (!isCand) {
          ctx.font = '700 9.5px "JetBrains Mono", monospace';
          ctx.fillStyle = isActive ? '#86efac' : '#cbd5e1';
          ctx.textAlign = 'center';
          ctx.fillText(a.id, a.x, a.y + (a.y < 0 ? -13 : 19));
        }
      }

      // Draw Crisp Braided Metallic/Kevlar Safety Tether Cable
      const d = dist(active.x, active.y, astroX, astroY);
      const slack = Math.max(0, active.maxLen - d);
      const sag = Math.min(58, slack * 0.24);
      const mx = (active.x + astroX) * 0.5;
      const my = (active.y + astroY) * 0.5;
      const sway = Math.sin(simTime * 2.4) * Math.min(12, slack * 0.06);
      const cpx = mx + sway;
      const cpy = my + sag;

      const tautColor =
        tetherRatio > 0.96 ? '#ef4444' : tetherRatio > 0.82 ? '#f59e0b' : '#eab308';

      // Tension warning collar when cable approaches max radius
      if (tetherRatio > 0.82) {
        const tRgb = tetherRatio > 0.96 ? '239, 68, 68' : '245, 158, 11';
        ctx.strokeStyle = `rgba(${tRgb}, 0.28)`;
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.moveTo(active.x, active.y);
        ctx.quadraticCurveTo(cpx, cpy, astroX, astroY + 4);
        ctx.stroke();
      }

      // Deep shadow backing
      ctx.strokeStyle = 'rgba(2, 6, 16, 0.62)';
      ctx.lineWidth = 4.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(active.x, active.y + 1);
      ctx.quadraticCurveTo(cpx, cpy + 1.2, astroX, astroY + 5);
      ctx.stroke();

      // Braided aerospace steel-core base
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      ctx.moveTo(active.x, active.y);
      ctx.quadraticCurveTo(cpx, cpy, astroX, astroY + 4);
      ctx.stroke();

      // Interleaved gold/tension braided Kevlar strand
      ctx.strokeStyle = tautColor;
      ctx.lineWidth = 2.4;
      ctx.setLineDash([4.5, 3.5]);
      ctx.lineDashOffset = 0;
      ctx.beginPath();
      ctx.moveTo(active.x, active.y);
      ctx.quadraticCurveTo(cpx, cpy, astroX, astroY + 4);
      ctx.stroke();

      // Counter-phase fine specular metallic fiber glint
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.72)';
      ctx.lineWidth = 0.95;
      ctx.setLineDash([2.5, 5.5]);
      ctx.lineDashOffset = -3.2;
      ctx.beginPath();
      ctx.moveTo(active.x, active.y - 0.5);
      ctx.quadraticCurveTo(cpx, cpy - 0.5, astroX, astroY + 3.5);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;

      ctx.restore();
    };

    const drawRepairNodes = () => {
      ctx.save();
      for (const n of nodes) {
        const pulse = 0.5 + 0.5 * Math.sin(simTime * 6 + n.x);
        const arcFlicker = 0.5 + 0.5 * Math.sin(simTime * 27 + n.x * 1.7);
        const isNear = !n.repaired && dist(astroX, astroY, n.x, n.y) < 58;

        // Brushed titanium recessed equipment housing
        drawTitaniumModule(ctx, n.x - 15, n.y - 13, 30, 26, {
          radius: 4.5,
          rivets: false,
          rimGlow: n.repaired ? '#22c55e' : isNear ? '#38bdf8' : '#f59e0b',
        });
        ctx.fillStyle = n.repaired ? 'rgba(6, 78, 59, 0.82)' : 'rgba(12, 20, 38, 0.9)';
        ctx.beginPath();
        ctx.roundRect(n.x - 11, n.y - 9, 22, 18, 3);
        ctx.fill();

        // Inner Status Icon or live electric fault arc
        if (n.repaired) {
          ctx.strokeStyle = '#4ade80';
          ctx.lineWidth = 2.6;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(n.x - 6, n.y);
          ctx.lineTo(n.x - 1, n.y + 5);
          ctx.lineTo(n.x + 7, n.y - 5);
          ctx.stroke();
        } else {
          const jx = (arcFlicker - 0.5) * 3.2;
          ctx.strokeStyle = pulse > 0.5 ? '#fde047' : '#38bdf8';
          ctx.lineWidth = 3;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(n.x - 6, n.y - 6);
          ctx.lineTo(n.x + 2 + jx, n.y - 1);
          ctx.lineTo(n.x - 3 - jx, n.y + 1);
          ctx.lineTo(n.x + 6, n.y + 6);
          ctx.stroke();

          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.1;
          ctx.stroke();
        }

        // Repair progress ring
        if (!n.repaired && n.progress > 0) {
          ctx.strokeStyle = '#22d3ee';
          ctx.lineWidth = 3.6;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.arc(
            n.x,
            n.y,
            22,
            -Math.PI / 2,
            -Math.PI / 2 + Math.PI * 2 * n.progress
          );
          ctx.stroke();
        }

        // Label
        ctx.font = '700 10.5px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = n.repaired ? '#86efac' : isNear ? '#7dd3fc' : '#fde68a';
        const labelY = n.y < 0 ? n.y - 26 : n.y + 34;
        ctx.fillText(
          n.repaired ? `✓ ${n.label}` : isNear ? `[长按 Space] ${n.label}` : `△ ${n.label}`,
          n.x,
          labelY
        );
      }
      ctx.restore();
    };

    const drawAstronaut = () => {
      drawFeitianAstronaut3D(ctx, {
        x: astroX,
        y: astroY,
        facing: astroFacing >= 0 ? 1 : -1,
        tilt: astroTilt,
        simTime,
        thermalMode,
        suitTemp,
        grabbing: grabbingRail,
        showAura: true,
      });
    };

    const drawPhysicsOverlay = () => {
      if (!physicsOverlay) return;
      const active = getActiveAnchor();

      ctx.save();
      // 1. Active Tether Max Radius Circle
      ctx.strokeStyle =
        tetherRatio > 0.92 ? 'rgba(239, 68, 68, 0.7)' : 'rgba(34, 211, 238, 0.42)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.arc(active.x, active.y, active.maxLen, 0, Math.PI * 2);
      ctx.stroke();

      // Nearby candidate anchor reach preview
      const cand = findBestReclipAnchor();
      if (cand) {
        ctx.strokeStyle = 'rgba(125, 211, 252, 0.28)';
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.arc(cand.x, cand.y, cand.maxLen, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // 2. Astronaut Velocity Vector
      const spd = Math.hypot(astroVx, astroVy);
      if (spd > 6) {
        drawVectorArrow(
          ctx,
          astroX,
          astroY,
          astroX + astroVx * 0.42,
          astroY + astroVy * 0.42,
          '#38bdf8',
          `v=${(spd / PX_PER_METER).toFixed(2)}m/s`,
          2.2
        );
      }

      // 3. Tether Tension Force Vector when taut
      if (tetherTensionN > 5) {
        const fScale = 0.35;
        drawVectorArrow(
          ctx,
          astroX,
          astroY,
          astroX + tetherFx * fScale,
          astroY + tetherFy * fScale,
          '#f59e0b',
          `T=${Math.round(tetherTensionN)}N`,
          2.6
        );
      }

      // 4. Thermal Radiation Heat-Flux Arrows
      if (cfg.terminatorMode !== 'mild') {
        const sunX = clamp(terminatorX - 135, -390, 320);
        for (let i = 0; i < 3; i++) {
          const rx = sunX - 50 + i * 50;
          drawVectorArrow(
            ctx,
            rx - 18,
            -145,
            rx + 4,
            -102,
            'rgba(251, 191, 36, 0.75)',
            i === 1 ? 'q_sun +1361 W/m²' : undefined,
            1.6
          );
        }
        const coldX = clamp(terminatorX + 125, -240, 380);
        drawVectorArrow(
          ctx,
          coldX,
          -104,
          coldX,
          -144,
          'rgba(125, 211, 252, 0.75)',
          'IR 辐射散热 (-100°C)',
          1.6
        );
      }

      ctx.restore();
    };

    const render = () => {
      if (!drawBakedBackdrop(ctx, levelIndex >= 1 ? 'earth-night' : 'leo-earth', viewW, viewH, 0.25, 0.32)) {
        starfield.draw(ctx, viewW, viewH, simTime, -simTime * 3.5, 0);
        drawEarthHorizon(ctx, viewW, viewH, simTime, {
          yRatio: 1.78,
          radiusScale: 1.18,
          sunPhase: cfg.terminatorMode === 'moving' ? 0.5 + levelTime * 0.05 : 0.4,
          nightMode: levelIndex >= 1,
          darken: 0.25,
        });
      }

      ctx.save();
      ctx.translate(originX, originY);
      ctx.scale(scale, scale);

      drawThermalBackdrop();
      drawStationHull();
      drawHandrails();
      drawAnchorsAndTether();
      drawRepairNodes();
      particles.draw(ctx);
      drawAstronaut();
      drawPhysicsOverlay();

      ctx.restore();
    };

    // ---- Main Animation Loop ----
    let rafId = 0;
    let lastTs = performance.now();

    const frame = (ts: number) => {
      if (destroyed) return;
      const dt = clamp((ts - lastTs) / 1000, 0, 0.05);
      lastTs = ts;

      step(dt);
      render();
      rafId = requestAnimationFrame(frame);
    };

    loadLevel(levelIndex);
    rafId = requestAnimationFrame(frame);

    return {
      destroy() {
        destroyed = true;
        cancelAnimationFrame(rafId);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onBlur);
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        host.hud.clearTactileDeck();
        handle.destroy();
      },
      setLevel(idx: number) {
        loadLevel(idx);
      },
      restart() {
        loadLevel(levelIndex);
      },
      setPaused(p: boolean) {
        paused = p;
        if (p) {
          keys.clear();
          pointerDown = false;
          deckRepairHeld = false;
        }
      },
      setPhysicsOverlay(enabled: boolean) {
        physicsOverlay = enabled;
      },
    };
  },
};
