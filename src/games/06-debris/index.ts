import { drawDebrisModel3D } from '../../core/aerospace-models';
import {
  clamp,
  drawEarthHorizon,
  drawSolarPanelRect,
  drawVectorArrow,
  lerp,
  ParticleSystem,
  setupHiDPICanvas,
  StarfieldRenderer,
} from '../../core/canvas-utils';
import {
  drawBakedBackdrop,
  drawTitaniumModule,
} from '../../core/materials';
import { drawModelSprite } from '../../core/model-sprites';
import { getMaxDpr, isLowPerf, reportFrameDelta } from '../../core/perf-profile';
import type {
  GameHostAPI,
  GameInstance,
  GameMeta,
  GameModule,
  GameResult,
  MetricStatus,
  ScienceComparison,
} from '../../core/game-interface';

interface DebrisTemplate {
  tArrival: number;
  alt: number;
  relSpeed: number; // km/s
  massGrams: number;
  redHalfAlt: number; // km
  yellowHalfAlt: number; // km
  label: string;
}

interface DebrisEntity extends DebrisTemplate {
  id: number;
  passed: boolean;
  breachedRed: boolean;
  breachedYellow: boolean;
  closestDh: number;
  seed: number;
}

interface StormWindow {
  start: number;
  end: number;
  mult: number;
  label: string;
}

interface DebrisLevelConfig {
  duration: number;
  fuelPerBurn: number;
  deltaVPerBurn: number; // m/s
  baseDragKmPerSec: number;
  storms: StormWindow[];
  debris: DebrisTemplate[];
  codexId: string;
}

const ALT_VIEW_MIN = 374;
const ALT_VIEW_MAX = 426;
const ALT_FLOOR = 380.0;
const ALT_CEIL = 425.0;
const RADAR_LEAD_SEC = 10.0;
const RADAR_TRAIL_SEC = 2.6;
const PREDICT_SEC = 8.4;

const LEVEL_CONFIGS: DebrisLevelConfig[] = [
  {
    duration: 42,
    fuelPerBurn: 4.4,
    deltaVPerBurn: 0.55,
    baseDragKmPerSec: 0.025,
    storms: [],
    codexId: 'debris-hohmann',
    debris: [
      { tArrival: 9.2, alt: 400.0, relSpeed: 9.8, massGrams: 42, redHalfAlt: 2.3, yellowHalfAlt: 4.4, label: 'CZ 残骸-01' },
      { tArrival: 16.8, alt: 408.0, relSpeed: 10.6, massGrams: 18, redHalfAlt: 2.2, yellowHalfAlt: 4.3, label: '微陨石-02' },
      { tArrival: 24.4, alt: 393.5, relSpeed: 11.4, massGrams: 95, redHalfAlt: 2.4, yellowHalfAlt: 4.5, label: '末级碎片-03' },
      { tArrival: 31.8, alt: 404.5, relSpeed: 10.2, massGrams: 30, redHalfAlt: 2.3, yellowHalfAlt: 4.4, label: '铝珠碎片-04' },
      { tArrival: 38.6, alt: 398.5, relSpeed: 12.1, massGrams: 65, redHalfAlt: 2.4, yellowHalfAlt: 4.5, label: '整流罩片-05' },
    ],
  },
  {
    duration: 52,
    fuelPerBurn: 3.8,
    deltaVPerBurn: 0.55,
    baseDragKmPerSec: 0.04,
    storms: [],
    codexId: 'debris-kinetic',
    debris: [
      { tArrival: 8.2, alt: 400.5, relSpeed: 10.8, massGrams: 35, redHalfAlt: 2.3, yellowHalfAlt: 4.3, label: '先导碎片' },
      // Cluster A: upper + lower -> thread middle ~401 km
      { tArrival: 14.8, alt: 413.5, relSpeed: 11.5, massGrams: 120, redHalfAlt: 2.4, yellowHalfAlt: 4.4, label: '星体残骸-A1' },
      { tArrival: 15.6, alt: 390.5, relSpeed: 10.4, massGrams: 75, redHalfAlt: 2.3, yellowHalfAlt: 4.3, label: '星体残骸-A2' },
      // Cluster B: mid + low -> climb to ~413 km
      { tArrival: 22.4, alt: 401.5, relSpeed: 12.6, massGrams: 28, redHalfAlt: 2.3, yellowHalfAlt: 4.4, label: '解体云-B1' },
      { tArrival: 23.4, alt: 389.0, relSpeed: 11.1, massGrams: 82, redHalfAlt: 2.3, yellowHalfAlt: 4.2, label: '解体云-B2' },
      // Cluster C: high + upper-mid -> dive to ~393 km
      { tArrival: 30.2, alt: 416.0, relSpeed: 13.1, massGrams: 54, redHalfAlt: 2.4, yellowHalfAlt: 4.4, label: '高速弹片-C1' },
      { tArrival: 31.1, alt: 405.5, relSpeed: 12.2, massGrams: 46, redHalfAlt: 2.3, yellowHalfAlt: 4.2, label: '高速弹片-C2' },
      // Fast single low-mid shard
      { tArrival: 37.8, alt: 393.5, relSpeed: 13.8, massGrams: 16, redHalfAlt: 2.4, yellowHalfAlt: 4.4, label: '超高速铝珠' },
      // Final Cluster D
      { tArrival: 44.2, alt: 414.5, relSpeed: 11.9, massGrams: 140, redHalfAlt: 2.4, yellowHalfAlt: 4.4, label: '云团末波-D1' },
      { tArrival: 45.2, alt: 390.5, relSpeed: 10.9, massGrams: 60, redHalfAlt: 2.3, yellowHalfAlt: 4.2, label: '云团末波-D2' },
      { tArrival: 49.4, alt: 403.0, relSpeed: 12.4, massGrams: 40, redHalfAlt: 2.2, yellowHalfAlt: 4.1, label: '尾随残骸' },
    ],
  },
  {
    duration: 60,
    fuelPerBurn: 3.4,
    deltaVPerBurn: 0.6,
    baseDragKmPerSec: 0.30,
    storms: [
      { start: 13, end: 27, mult: 2.25, label: 'G4 地磁暴 · 大气膨胀阻力 ×2.3' },
      { start: 36, end: 52, mult: 2.5, label: '太阳质子事件 · 轨高急剧衰减' },
    ],
    codexId: 'debris-drag',
    debris: [
      { tArrival: 9.0, alt: 402.0, relSpeed: 10.4, massGrams: 52, redHalfAlt: 2.3, yellowHalfAlt: 4.3, label: '风暴前锋-01' },
      { tArrival: 16.0, alt: 412.5, relSpeed: 11.6, massGrams: 36, redHalfAlt: 2.3, yellowHalfAlt: 4.3, label: '残骸-02' },
      { tArrival: 22.0, alt: 395.5, relSpeed: 12.2, massGrams: 85, redHalfAlt: 2.3, yellowHalfAlt: 4.2, label: '残骸-03' },
      { tArrival: 23.2, alt: 415.5, relSpeed: 11.3, massGrams: 44, redHalfAlt: 2.2, yellowHalfAlt: 4.1, label: '残骸-04' },
      { tArrival: 30.0, alt: 403.5, relSpeed: 12.9, massGrams: 26, redHalfAlt: 2.3, yellowHalfAlt: 4.3, label: '高速碎片-05' },
      { tArrival: 36.2, alt: 392.0, relSpeed: 10.9, massGrams: 110, redHalfAlt: 2.3, yellowHalfAlt: 4.2, label: '低轨残骸-06' },
      { tArrival: 42.4, alt: 411.0, relSpeed: 13.4, massGrams: 22, redHalfAlt: 2.3, yellowHalfAlt: 4.3, label: '质子云-07' },
      { tArrival: 43.8, alt: 397.0, relSpeed: 11.8, massGrams: 70, redHalfAlt: 2.2, yellowHalfAlt: 4.1, label: '质子云-08' },
      { tArrival: 50.6, alt: 406.5, relSpeed: 12.5, massGrams: 48, redHalfAlt: 2.3, yellowHalfAlt: 4.2, label: '高危碎片-09' },
      { tArrival: 56.4, alt: 395.0, relSpeed: 13.2, massGrams: 92, redHalfAlt: 2.3, yellowHalfAlt: 4.3, label: '末波残骸-10' },
    ],
  },
];

const SCIENCE_CARDS: Record<string, ScienceComparison> = {
  'debris-hohmann': {
    title: '霍曼变轨与 Δv 轨控避碰策略',
    gameAction: '你提前数秒施加切向 ±Δv 脉冲并结合圆化平飞，沿着平滑的霍曼变轨预测线优雅绕过了高危碎片交会盒。',
    realStationFact: '近地轨道空间站无法像战斗机一样急拐弯，通常需提前半圈甚至数圈由主发动机短暂点火（Δv 仅 0.5–1.5 m/s）抬升或降低轨道高度，精准错开碎片时空窗口。',
    realData: '真实参数：典型规避 Δv ≈ 0.5–1.5 m/s · 提前半圈（~45 min）启动轨道机动',
    codexId: 'debris-hohmann',
  },
  'debris-kinetic': {
    title: '第一宇宙速度下的毫米级杀伤力',
    gameAction: '面对多高度碎片云与 10+ km/s 相对交会速度，你果断避开了所有红黄高危包络，化解了灾难性动能撞击。',
    realStationFact: '依据动能公式 Ek = ½mv²，一颗 1 厘米铝珠在 10 km/s 相对速度下的撞击动能可达数兆焦耳，堪比一辆高速行驶的小轿车，毫米级碎片即可洞穿舱壁。',
    realData: '真实参数：近地轨道速度 7.67 km/s · 相对交会速度最高达 14 km/s',
    codexId: 'debris-kinetic',
  },
  'debris-drag': {
    title: '高层大气阻力与轨道维持再抬升',
    gameAction: '在太阳风暴引发高层大气膨胀、轨道持续沉降的危机下，你一边穿行碎片云一边实施 +Δv 再抬升，成功守住了 380 km 安全底线！',
    realStationFact: '400 km 高度并非绝对真空，地磁暴期间高层热层受热膨胀会使稀薄大气阻力翻倍，空间站必须定期由轨控发动机或电推进实施再抬升（Reboost）维持轨高。',
    realData: '真实参数：400 km 轨高日均衰减 50–100 m · 太阳活动峰年可达数百米/日',
    codexId: 'debris-drag',
  },
};

const META: GameMeta = {
  id: 'debris',
  number: '06',
  shortTitle: '碎片避碰',
  title: '空间碎片避碰与轨道机动',
  enTitle: 'DEBRIS AVOIDANCE',
  moduleName: '测控与推进舱',
  genre: '轨道雷达策略',
  tagline: '预判7.8 km/s碎片交会窗口，实施Δv霍曼升轨/降轨规避',
  accent: '#f43f5e',
  hubAnchor: { x: 0.83, y: 0.78 },
  briefingSteps: [
    {
      title: '观察雷达交会窗口与预警盒',
      desc: '右侧来袭碎片正以 10–14 km/s 相对速度迫近。红色盒为高危碰撞包络，黄色盒为警戒错开带，绿色虚线为空间站未来 8 秒预测轨迹。',
    },
    {
      title: '提前施加 ±Δv 脉冲并圆化稳态',
      desc: '轨道机动存在惯性延迟！按 W/↑ 升轨或 S/↓ 降轨提前变轨，待绿色预测线安全绕过红盒后，按 Space 圆化平飞停靠在目标高度。',
    },
    {
      title: '节约推进剂并抗御大气衰减',
      desc: '减少反复折返可大幅节省 Δv 推进剂；关卡 3 太阳风暴会加剧高层大气阻力，务必定期 +Δv 再抬升严防跌破 380 km 红线！',
    },
  ],
  controlsHint: 'W / ↑ 升轨 (+Δv) · S / ↓ 降轨 (-Δv) · Space 轨道圆化平飞 · 点击雷达上下区域亦可点火',
  levels: [
    {
      index: 0,
      name: '单星高危交会',
      subtitle: '42秒霍曼变轨避碰入门',
      objective: '预判 5 批单星高危交会，提前 ±Δv 变轨并圆化稳态，守住 380–425 km 走廊',
    },
    {
      index: 1,
      name: '碎片云密集过境',
      subtitle: '52秒多高度碎片群连续穿越',
      objective: '规划升轨/降轨顺序高效穿越密集碎片云，兼顾零红盒侵入与推进剂余量',
    },
    {
      index: 2,
      name: '太阳风暴大气衰减',
      subtitle: '60秒地磁暴阻力衰减 + 再抬升',
      objective: '对抗太阳风暴导致的高层大气沉降，穿行碎片云并定期 +Δv 再抬升守住 380 km 底线',
    },
  ],
  codexIds: ['debris-kinetic', 'debris-hohmann', 'debris-drag'],
};

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rr = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export const debrisGame: GameModule = {
  meta: META,
  mount(canvasHost: HTMLElement, host: GameHostAPI): GameInstance {
    const canvasHandle = setupHiDPICanvas(canvasHost);
    const { canvas, ctx } = canvasHandle;
    const starfield = new StarfieldRenderer(160, 606);
    const particles = new ParticleSystem();

    let levelIndex = host.getLevel();
    let cfg = LEVEL_CONFIGS[levelIndex] ?? LEVEL_CONFIGS[0];
    let paused = host.isPaused();
    let physicsOverlay = host.hud.isPhysicsOverlayEnabled();
    let destroyed = false;
    let completed = false;
    let rafId = 0;
    let lastTs = performance.now();
    let animTime = 0;

    // Orbital state
    let elapsed = 0;
    let alt = 400.0; // km
    let vz = 0.0; // km/s (in sim time)
    let fuel = 100.0; // %
    let deltaVUsed = 0.0; // m/s
    let burnMode: 'none' | 'up' | 'down' | 'circ' = 'none';
    let burnTimer = 0;
    let burnCooldown = 0;
    let minAltSeen = 400.0;
    let maxAltSeen = 400.0;
    let redBreaches = 0;
    let yellowBreaches = 0;
    let cleanDodges = 0;
    let currentStormLabel = '';
    let currentDragRate = 0;
    let screenShake = 0;
    let statusBanner: { text: string; color: string; timer: number } | null = null;
    let historyTrail: { t: number; alt: number }[] = [];
    let debrisList: DebrisEntity[] = [];

    // Radar layout & static offscreen scope cache (eliminates per-frame text, grid & gradient cost)
    let radarRect = { left: 40, right: 800, top: 130, bottom: 520, stationX: 200 };
    let radarCacheCanvas: HTMLCanvasElement | null = null;
    let radarCacheW = 0;
    let radarCacheH = 0;
    let radarCacheDpr = 0;
    let radarCacheStorm = false;
    let radarCacheLow = false;

    // Tactile deck DOM refs
    let upBtnEl: HTMLButtonElement | null = null;
    let circBtnEl: HTMLButtonElement | null = null;
    let downBtnEl: HTMLButtonElement | null = null;
    let fuelChipEl: HTMLElement | null = null;

    // Debounced toasts
    const toastTimestamps = new Map<string, number>();
    const pushDebouncedToast = (
      key: string,
      text: string,
      tone: MetricStatus = 'info',
      tag = '轨道测控科普',
      cooldownSec = 9
    ) => {
      const last = toastTimestamps.get(key) ?? -999;
      if (elapsed - last >= cooldownSec) {
        toastTimestamps.set(key, elapsed);
        host.hud.pushToast(text, tone, tag);
      }
    };

    const getStormInfo = (simTime: number): { mult: number; label: string } => {
      let mult = 1.0;
      let label = '';
      for (const s of cfg.storms) {
        if (simTime >= s.start && simTime <= s.end) {
          const edgeIn = clamp((simTime - s.start) / 1.5, 0, 1);
          const edgeOut = clamp((s.end - simTime) / 1.5, 0, 1);
          const blend = Math.min(edgeIn, edgeOut);
          const m = lerp(1.0, s.mult, blend);
          if (m > mult) {
            mult = m;
            label = s.label;
          }
        }
      }
      return { mult, label };
    };

    const computeDragKmPerSec = (altKm: number, simTime: number): number => {
      const altScale = Math.exp(-clamp(altKm - ALT_FLOOR, 0, 48) / 18);
      const { mult } = getStormInfo(simTime);
      return cfg.baseDragKmPerSec * (0.68 + 0.85 * altScale) * mult;
    };

    // Exact forward kinematics step shared by live sim and 8.4s predictor
    const integrateOrbitalStep = (
      state: { alt: number; vz: number; burnMode: 'none' | 'up' | 'down' | 'circ'; burnTimer: number },
      simTime: number,
      dt: number
    ) => {
      if (state.burnTimer > 0) {
        const activeDt = Math.min(dt, state.burnTimer);
        if (state.burnMode === 'up') {
          state.vz = clamp(state.vz + 6.9 * activeDt, -5.8, 5.8);
        } else if (state.burnMode === 'down') {
          state.vz = clamp(state.vz - 6.9 * activeDt, -5.8, 5.8);
        } else if (state.burnMode === 'circ') {
          state.vz *= Math.exp(-9.5 * activeDt);
        }
        state.burnTimer = Math.max(0, state.burnTimer - dt);
        if (state.burnTimer === 0) state.burnMode = 'none';
      }

      // Natural orbital Hohmann transfer curve damping
      state.vz *= Math.exp(-0.22 * dt);
      if (Math.abs(state.vz) < 0.015) state.vz = 0;

      const drag = computeDragKmPerSec(state.alt, simTime);
      state.alt += (state.vz - drag) * dt;
      return drag;
    };

    const refreshDeckUI = () => {
      if (upBtnEl) upBtnEl.classList.toggle('is-active', burnMode === 'up' && burnTimer > 0);
      if (downBtnEl) downBtnEl.classList.toggle('is-active', burnMode === 'down' && burnTimer > 0);
      if (circBtnEl) circBtnEl.classList.toggle('is-active', burnMode === 'circ' && burnTimer > 0);
      if (fuelChipEl) {
        fuelChipEl.textContent = `推进剂 ${Math.round(fuel)}% · Δv ${deltaVUsed.toFixed(1)} m/s`;
        fuelChipEl.style.color = fuel < 20 ? '#fca5a5' : fuel < 42 ? '#fde68a' : '#7dd3fc';
      }
    };

    const fireBurn = (kind: 'up' | 'down' | 'circ') => {
      if (paused || completed) return;
      if (burnCooldown > 0 && kind !== 'circ') return;

      if (kind === 'circ') {
        if (Math.abs(vz) < 0.14 && burnMode === 'none') {
          host.audio.playBeep(520, 0.05);
          return;
        }
        const circCost = clamp(Math.abs(vz) * 0.9, 0.8, 2.8);
        if (fuel < circCost) {
          host.audio.playWarning();
          pushDebouncedToast('no-fuel', '推进剂已耗尽！无法继续执行轨道圆化或变轨机动。', 'critical', '推进剂告急', 5);
          return;
        }
        fuel = Math.max(0, fuel - circCost);
        deltaVUsed += circCost * 0.11;
        burnMode = 'circ';
        burnTimer = 0.36;
        burnCooldown = 0.14;
        host.audio.playLock();
        pushDebouncedToast(
          'circ-tip',
          '执行轨道圆化脉冲：抵消径向变轨速率，让空间站平稳停靠在目标安全轨高。',
          'nominal',
          '霍曼圆化稳态',
          16
        );
      } else {
        if (fuel < cfg.fuelPerBurn) {
          host.audio.playWarning();
          pushDebouncedToast('no-fuel', '推进剂不足，无法点火！提前规划变轨可大幅节省 Δv。', 'critical', '推进剂告急', 5);
          return;
        }
        fuel = Math.max(0, fuel - cfg.fuelPerBurn);
        deltaVUsed += cfg.deltaVPerBurn;
        burnMode = kind;
        burnTimer = 0.35;
        burnCooldown = 0.22;
        host.audio.playThruster(0.75);

        if (kind === 'up') {
          pushDebouncedToast(
            'prograde-tip',
            '顺行点火 (+Δv)：加速抬高轨道远地点，注意绿色预测曲线的平滑延迟特性！',
            'info',
            '霍曼升轨机动',
            18
          );
        } else {
          pushDebouncedToast(
            'retrograde-tip',
            '逆行点火 (-Δv)：减速降低轨道近地点，从高危碎片下方安全掠过！',
            'info',
            '霍曼降轨机动',
            18
          );
        }
      }
      refreshDeckUI();
    };

    const buildTactileDeck = () => {
      const deck = host.hud.getTactileDeck();
      host.hud.clearTactileDeck();

      const upBtn = document.createElement('button');
      upBtn.type = 'button';
      upBtn.className = 'deck-ctrl-btn';
      upBtn.innerHTML = `<span>▲ 升轨脉冲 (+Δv)</span><span class="mono-num" style="opacity:.7">W/↑</span>`;
      upBtn.addEventListener('click', () => {
        fireBurn('up');
        upBtn.blur();
      });

      const circBtn = document.createElement('button');
      circBtn.type = 'button';
      circBtn.className = 'deck-ctrl-btn is-gold';
      circBtn.innerHTML = `<span>▬ 轨道圆化平飞</span><span class="mono-num" style="opacity:.8">Space</span>`;
      circBtn.addEventListener('click', () => {
        fireBurn('circ');
        circBtn.blur();
      });

      const downBtn = document.createElement('button');
      downBtn.type = 'button';
      downBtn.className = 'deck-ctrl-btn is-danger';
      downBtn.innerHTML = `<span>▼ 降轨脉冲 (-Δv)</span><span class="mono-num" style="opacity:.8">S/↓</span>`;
      downBtn.addEventListener('click', () => {
        fireBurn('down');
        downBtn.blur();
      });

      const chip = document.createElement('div');
      chip.className = 'deck-slider-group mono-num';
      chip.style.fontWeight = '700';
      chip.style.fontSize = '12px';

      deck.append(upBtn, circBtn, downBtn, chip);
      upBtnEl = upBtn;
      circBtnEl = circBtn;
      downBtnEl = downBtn;
      fuelChipEl = chip;
      refreshDeckUI();
    };

    const getAltStatus = (): MetricStatus => {
      if (alt <= ALT_FLOOR + 3.2 || alt >= ALT_CEIL - 2.2) return 'critical';
      if (alt <= ALT_FLOOR + 7.5 || alt >= ALT_CEIL - 5.0) return 'caution';
      return 'nominal';
    };

    const getFuelStatus = (): MetricStatus => {
      if (fuel < 18) return 'critical';
      if (fuel < 38) return 'caution';
      return 'nominal';
    };

    const findNearestUpcomingDebris = (): DebrisEntity | null => {
      let best: DebrisEntity | null = null;
      let bestT = Infinity;
      for (const d of debrisList) {
        const dt = d.tArrival - elapsed;
        if (dt > -0.25 && dt < bestT) {
          bestT = dt;
          best = d;
        }
      }
      return best;
    };

    const initMetrics = () => {
      host.hud.setMetrics([
        {
          id: 'alt',
          label: '轨道高度 ALT',
          value: `${alt.toFixed(1)} km`,
          ratio: clamp((alt - ALT_FLOOR) / (ALT_CEIL - ALT_FLOOR), 0, 1),
          status: getAltStatus(),
        },
        {
          id: 'fuel',
          label: '推进剂余量',
          value: `${Math.round(fuel)}%`,
          ratio: clamp(fuel / 100, 0, 1),
          status: getFuelStatus(),
        },
        {
          id: 'threat',
          label: '最近交会预警',
          value: '雷达扫描中',
          status: 'nominal',
        },
        {
          id: 'time',
          label: '过境倒计时',
          value: `${cfg.duration.toFixed(1)} s`,
          ratio: 0,
          status: 'info',
        },
      ]);
    };

    const updateHudMetrics = () => {
      host.hud.updateMetric('alt', {
        value: `${alt.toFixed(1)} km`,
        ratio: clamp((alt - ALT_FLOOR) / (ALT_CEIL - ALT_FLOOR), 0, 1),
        status: getAltStatus(),
      });
      host.hud.updateMetric('fuel', {
        value: `${Math.round(fuel)}%`,
        ratio: clamp(fuel / 100, 0, 1),
        status: getFuelStatus(),
      });

      const nearest = findNearestUpcomingDebris();
      if (nearest && nearest.tArrival - elapsed <= RADAR_LEAD_SEC) {
        const dtRem = Math.max(0, nearest.tArrival - elapsed);
        const dh = Math.abs(alt - nearest.alt);
        const st: MetricStatus =
          dh < nearest.redHalfAlt
            ? 'critical'
            : dh < nearest.yellowHalfAlt
              ? 'caution'
              : 'nominal';
        host.hud.updateMetric('threat', {
          value: `T-${dtRem.toFixed(1)}s Δh${dh.toFixed(1)}km`,
          status: st,
        });
      } else {
        host.hud.updateMetric('threat', {
          value: '空域净空',
          status: 'nominal',
        });
      }

      const rem = Math.max(0, cfg.duration - elapsed);
      host.hud.updateMetric('time', {
        value: `${rem.toFixed(1)} s`,
        ratio: clamp(elapsed / cfg.duration, 0, 1),
        status: rem <= 7 ? 'nominal' : 'info',
      });
    };

    const resetLevel = (idx: number) => {
      levelIndex = clamp(idx, 0, LEVEL_CONFIGS.length - 1);
      cfg = LEVEL_CONFIGS[levelIndex];
      completed = false;
      elapsed = 0;
      alt = 400.0;
      vz = 0;
      fuel = 100.0;
      deltaVUsed = 0;
      burnMode = 'none';
      burnTimer = 0;
      burnCooldown = 0;
      minAltSeen = 400.0;
      maxAltSeen = 400.0;
      redBreaches = 0;
      yellowBreaches = 0;
      cleanDodges = 0;
      currentStormLabel = '';
      currentDragRate = computeDragKmPerSec(alt, 0);
      screenShake = 0;
      statusBanner = null;
      historyTrail = [{ t: 0, alt: 400.0 }];
      particles.clear();
      toastTimestamps.clear();

      debrisList = cfg.debris.map((d, i) => ({
        ...d,
        id: i + 1,
        passed: false,
        breachedRed: false,
        breachedYellow: false,
        closestDh: 99,
        seed: (i + 1) * 37.3,
      }));

      host.hud.setObjective(META.levels[levelIndex].objective);
      initMetrics();
      buildTactileDeck();

      if (levelIndex === 0) {
        host.hud.pushToast(
          '观察右侧袭来的红色交会盒与绿色预测线，提前按 W/↑ 升轨或 S/↓ 降轨，就位后按 Space 平飞！',
          'info',
          '交会雷达就绪'
        );
      } else if (levelIndex === 1) {
        host.hud.pushToast(
          '密集碎片云即将过境！提前看清下一组双高度走廊，减少折返能大幅节省 Δv 推进剂。',
          'caution',
          '碎片云预警'
        );
      } else {
        host.hud.pushToast(
          '太阳地磁暴警报！高层大气阻力大幅倍增，轨高将持续衰减，务必定期 +Δv 再抬升守住 380 km！',
          'critical',
          '太阳风暴衰减'
        );
      }
    };

    const finishMission = (won: boolean, failReason?: 'impact' | 'floor' | 'ceil', hitDebris?: DebrisEntity) => {
      if (completed) return;
      completed = true;

      let stars: 0 | 1 | 2 | 3 = 0;
      if (won) {
        const star3Fuel = levelIndex === 2 ? 30 : 42;
        if (redBreaches === 0 && fuel >= star3Fuel && minAltSeen >= ALT_FLOOR + 3.5) {
          stars = 3;
        } else if (redBreaches <= 1 && fuel >= 18) {
          stars = 2;
        } else {
          stars = 1;
        }
      }

      const score = won
        ? Math.round(
            480 +
              fuel * 3.8 +
              cleanDodges * 26 -
              redBreaches * 120 -
              yellowBreaches * 25 +
              (levelIndex + 1) * 100
          )
        : Math.round((elapsed / cfg.duration) * 340);

      const cardKey = !won
        ? failReason === 'impact'
          ? 'debris-kinetic'
          : failReason === 'floor'
            ? 'debris-drag'
            : 'debris-hohmann'
        : cfg.codexId;

      const hitEkMj = hitDebris
        ? (0.5 * (hitDebris.massGrams / 1000) * Math.pow(hitDebris.relSpeed * 1000, 2)) / 1e6
        : 0;

      const summary = won
        ? stars === 3
          ? `完美规避！零红盒侵入，累计消耗 Δv ${deltaVUsed.toFixed(2)} m/s，剩余推进剂 ${Math.round(fuel)}%。`
          : `安全过境！共规避 ${debrisList.length} 批空间碎片，减少红盒侵入并节约燃料可斩获 3★。`
        : failReason === 'impact' && hitDebris
          ? `遭「${hitDebris.label}」以 ${hitDebris.relSpeed.toFixed(1)} km/s 撞击（动能 ${hitEkMj.toFixed(2)} MJ）！请提前 4–6 秒施加 ±Δv 规避。`
          : failReason === 'floor'
            ? '轨道高度跌破 380 km 稠密大气临界下限！需及时施加 +Δv 再抬升脉冲抵消大气衰减。'
            : '轨道高度突破 425 km 任务上限！进入安全走廊后请按 Space 圆化稳态。';

      const baseScienceCard = SCIENCE_CARDS[cardKey] ?? SCIENCE_CARDS['debris-hohmann'];
      const scienceCard = won
        ? baseScienceCard
        : {
            ...baseScienceCard,
            gameAction:
              failReason === 'impact' && hitDebris
                ? `本次任务中空间站未能及时错开「${hitDebris.label}」的交会高度，在 ${hitDebris.relSpeed.toFixed(1)} km/s 超高速下发生撞击。下次可在 T-5s 前施加 ±Δv 脉冲并观察绿色预测线提前规避。`
                : failReason === 'floor'
                  ? '本次任务中受高层大气阻力持续影响，轨道高度跌破了 380 km 安全底线。下次请及时施加 +Δv 升轨脉冲实施再抬升。'
                  : '本次任务中连续升轨导致轨道突破了 425 km 任务走廊上限。进入目标高度后按 Space 即可圆化平飞稳住轨高。',
          };

      const result: GameResult = {
        levelIndex,
        won,
        stars,
        score: Math.max(0, score),
        summary,
        metrics: [
          {
            label: '推进剂余量',
            value: `${Math.round(fuel)}% (Δv ${deltaVUsed.toFixed(1)} m/s)`,
            status: getFuelStatus(),
          },
          {
            label: '红盒高危侵入',
            value: `${redBreaches} 次`,
            status: redBreaches === 0 ? 'nominal' : redBreaches === 1 ? 'caution' : 'critical',
          },
          {
            label: '安全净空规避',
            value: `${cleanDodges} / ${debrisList.length}`,
            status: cleanDodges >= debrisList.length - 1 ? 'nominal' : 'caution',
          },
          {
            label: '最低轨高记录',
            value: `${minAltSeen.toFixed(1)} km`,
            status: minAltSeen >= 384 ? 'nominal' : minAltSeen >= 381 ? 'caution' : 'critical',
          },
        ],
        scienceCard,
      };

      host.completeLevel(result);
    };

    const altToY = (a: number): number => {
      const ratio = (a - ALT_VIEW_MIN) / (ALT_VIEW_MAX - ALT_VIEW_MIN);
      return radarRect.bottom - ratio * (radarRect.bottom - radarRect.top);
    };

    const timeToX = (tRemaining: number): number => {
      const spanRight = radarRect.right - radarRect.stationX;
      return radarRect.stationX + (tRemaining / RADAR_LEAD_SEC) * spanRight;
    };

    const stepSimulation = (dt: number) => {
      elapsed += dt;
      burnCooldown = Math.max(0, burnCooldown - dt);
      screenShake = Math.max(0, screenShake - dt * 2.5);
      if (statusBanner) {
        statusBanner.timer -= dt;
        if (statusBanner.timer <= 0) statusBanner = null;
      }

      // Storm notification
      const stormInfo = getStormInfo(elapsed);
      if (stormInfo.label && stormInfo.label !== currentStormLabel) {
        pushDebouncedToast(
          `storm-${stormInfo.label}`,
          `${stormInfo.label}！高层大气受热膨胀，请留意绿色预测线向下弯曲趋势并及时 +Δv 再抬升！`,
          'critical',
          '空间天气告警',
          8
        );
      }
      currentStormLabel = stormInfo.label;

      // Integrate station orbital state
      const st = { alt, vz, burnMode, burnTimer };
      currentDragRate = integrateOrbitalStep(st, elapsed, dt);
      alt = st.alt;
      vz = st.vz;
      burnMode = st.burnMode;
      burnTimer = st.burnTimer;

      minAltSeen = Math.min(minAltSeen, alt);
      maxAltSeen = Math.max(maxAltSeen, alt);

      // Record orbital wake trail
      if (historyTrail.length === 0 || elapsed - historyTrail[historyTrail.length - 1].t >= 0.08) {
        historyTrail.push({ t: elapsed, alt });
        while (historyTrail.length > 0 && elapsed - historyTrail[0].t > RADAR_TRAIL_SEC + 0.5) {
          historyTrail.shift();
        }
      }

      // Engine plume particles
      const stY = altToY(alt);
      if (burnTimer > 0) {
        if (burnMode === 'up') {
          particles.spawn({
            x: radarRect.stationX - 24,
            y: stY + (Math.random() - 0.5) * 4,
            vx: -140 - Math.random() * 80,
            vy: 25 + (Math.random() - 0.5) * 24,
            life: 0.34,
            size: 3.4,
            color: '#7dd3fc',
          });
        } else if (burnMode === 'down') {
          particles.spawn({
            x: radarRect.stationX + 24,
            y: stY + (Math.random() - 0.5) * 4,
            vx: 110 + Math.random() * 65,
            vy: -22 + (Math.random() - 0.5) * 22,
            life: 0.32,
            size: 3.1,
            color: '#fbbf24',
          });
        } else if (burnMode === 'circ') {
          particles.spawn({
            x: radarRect.stationX + (Math.random() - 0.5) * 16,
            y: stY + (vz > 0 ? -12 : 12),
            vx: -30 + (Math.random() - 0.5) * 20,
            vy: vz > 0 ? -70 : 70,
            life: 0.25,
            size: 2.5,
            color: '#e0f2fe',
          });
        }
      }

      // Solar storm plasma wind streaks along atmospheric floor
      if (cfg.baseDragKmPerSec >= 0.15 && Math.random() < (stormInfo.mult > 1.3 ? 0.55 : 0.22)) {
        const floorY = altToY(ALT_FLOOR);
        particles.spawn({
          x: radarRect.right,
          y: floorY + Math.random() * (radarRect.bottom - floorY),
          vx: -260 - Math.random() * 140,
          vy: (Math.random() - 0.5) * 12,
          life: 1.4,
          size: 2.2,
          color: stormInfo.mult > 1.3 ? '#f97316' : '#fbbf24',
        });
      }

      // Check floor/ceiling bounds
      if (alt <= ALT_FLOOR + 4.5 && alt > ALT_FLOOR) {
        pushDebouncedToast(
          'low-alt',
          '轨道高度逼近 380 km 稠密大气下限！立即按 W/↑ 施加 +Δv 再抬升脉冲！',
          'critical',
          '轨高衰减告警',
          6
        );
      }

      if (alt <= ALT_FLOOR) {
        screenShake = 1.0;
        particles.burst(radarRect.stationX, altToY(ALT_FLOOR), 28, '#f97316', 110, 4, 0.8);
        finishMission(false, 'floor');
        return;
      }
      if (alt >= ALT_CEIL) {
        finishMission(false, 'ceil');
        return;
      }

      // Check conjunctions & collisions with debris
      for (const d of debrisList) {
        const tRem = d.tArrival - elapsed;
        if (Math.abs(tRem) <= 0.45) {
          const dh = Math.abs(alt - d.alt);
          d.closestDh = Math.min(d.closestDh, dh);

          // Direct catastrophic collision inside inner lethal core
          if (Math.abs(tRem) <= 0.24 && dh < d.redHalfAlt * 0.68) {
            screenShake = 1.2;
            particles.burst(radarRect.stationX, stY, 45, '#ef4444', 180, 4.5, 0.9);
            particles.burst(radarRect.stationX, stY, 22, '#fbbf24', 120, 3.2, 0.7);
            finishMission(false, 'impact', d);
            return;
          }

          if (dh < d.redHalfAlt && !d.breachedRed) {
            d.breachedRed = true;
            redBreaches++;
            screenShake = 0.55;
            host.audio.playWarning();
            statusBanner = {
              text: `⚠ 红盒贴近擦过！最小错开 Δh = ${dh.toFixed(1)} km`,
              color: '#ef4444',
              timer: 2.3,
            };
            pushDebouncedToast(
              `red-${d.id}`,
              `极险！侵入「${d.label}」红色预警盒（Δh=${dh.toFixed(1)} km），在轨真实任务中此距离已触发紧急撤离红线！`,
              'critical',
              '高危贴近告警',
              4
            );
          } else if (dh < d.yellowHalfAlt && !d.breachedYellow) {
            d.breachedYellow = true;
            yellowBreaches++;
          }
        }

        if (!d.passed && tRem < -0.45) {
          d.passed = true;
          if (!d.breachedRed) {
            cleanDodges++;
            host.audio.playBeep(d.breachedYellow ? 560 : 760, 0.08);
            statusBanner = {
              text: d.breachedYellow
                ? `▲ 警戒区通过 ${d.label} · Δh ${d.closestDh.toFixed(1)} km`
                : `✓ 安全规避 ${d.label} · 错开 Δh ${d.closestDh.toFixed(1)} km`,
              color: d.breachedYellow ? '#fbbf24' : '#4ade80',
              timer: 2.0,
            };
          }
        }
      }

      particles.update(dt);
      updateHudMetrics();
      refreshDeckUI();

      if (elapsed >= cfg.duration) {
        finishMission(true);
      }
    };

    const drawStation = (x: number, y: number, pitchRad: number) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(pitchRad);

      // Flat translucent thruster plumes & crisp nozzle flames (zero additive/gradients)
      if (burnTimer > 0) {
        if (burnMode === 'up') {
          const fl = 26 + Math.sin(animTime * 45) * 6;
          ctx.fillStyle = 'rgba(56, 189, 248, 0.72)';
          ctx.beginPath();
          ctx.moveTo(-19, -5.5);
          ctx.lineTo(-19 - fl, 0);
          ctx.lineTo(-19, 5.5);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = 'rgba(240, 249, 255, 0.9)';
          ctx.beginPath();
          ctx.moveTo(-19, -2.5);
          ctx.lineTo(-19 - fl * 0.52, 0);
          ctx.lineTo(-19, 2.5);
          ctx.closePath();
          ctx.fill();
        } else if (burnMode === 'down') {
          const fl = 20 + Math.sin(animTime * 45) * 5;
          ctx.fillStyle = 'rgba(251, 191, 36, 0.78)';
          ctx.beginPath();
          ctx.moveTo(18, -6);
          ctx.lineTo(18 + fl, -3);
          ctx.lineTo(18, -1);
          ctx.moveTo(18, 1);
          ctx.lineTo(18 + fl, 3);
          ctx.lineTo(18, 6);
          ctx.fill();
        } else if (burnMode === 'circ') {
          ctx.strokeStyle = 'rgba(186, 230, 253, 0.9)';
          ctx.lineWidth = 2.4;
          ctx.beginPath();
          ctx.moveTo(0, -10);
          ctx.lineTo(0, -23);
          ctx.moveTo(0, 10);
          ctx.lineTo(0, 23);
          ctx.stroke();
        }
      }

      // Studio-rendered 3D Tiangong T-Configuration Space Station rotated to face +X orbital flight vector
      const usedStation3D = drawModelSprite(ctx, 'tiangong-hub', -29, -22, 58, 44, {
        rotation: Math.PI * 0.5,
      });
      if (!usedStation3D) {
        drawSolarPanelRect(ctx, -10, -29, 17, 17, 0.92);
        drawSolarPanelRect(ctx, -10, 12, 17, 17, 0.92);
        ctx.fillStyle = '#94a3b8';
        ctx.fillRect(-3, -12, 4, 24);
        ctx.fillStyle = '#334155';
        ctx.beginPath();
        ctx.moveTo(-18, -4.5);
        ctx.lineTo(-23, -6);
        ctx.lineTo(-23, 6);
        ctx.lineTo(-18, 4.5);
        ctx.closePath();
        ctx.fill();
        drawTitaniumModule(ctx, -18, -7, 34, 14, {
          radius: 4,
          mliBands: [0.18, 0.72],
          rivets: true,
          rimGlow: 'rgba(125, 211, 252, 0.8)',
        });
        ctx.fillStyle = '#cbd5e1';
        ctx.beginPath();
        ctx.arc(16.5, 0, 5.4, 0, Math.PI * 2);
        ctx.fill();
      }

      // Navigation strobe
      const strobeOn = Math.sin(animTime * 5.2) > 0.25;
      ctx.fillStyle = strobeOn ? '#ffffff' : '#22c55e';
      ctx.beginPath();
      ctx.arc(16.5, -5.5, 2.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    };

    const ensureRadarStaticCache = (
      w: number,
      h: number,
      dpr: number,
      rLeft: number,
      rTop: number,
      rRight: number,
      rBot: number,
      rW: number,
      rH: number,
      stX: number,
      stormActive: boolean,
      lowPerf: boolean
    ): HTMLCanvasElement => {
      if (
        radarCacheCanvas &&
        radarCacheW === w &&
        radarCacheH === h &&
        radarCacheDpr === dpr &&
        radarCacheStorm === stormActive &&
        radarCacheLow === lowPerf
      ) {
        return radarCacheCanvas;
      }

      if (!radarCacheCanvas) radarCacheCanvas = document.createElement('canvas');
      radarCacheCanvas.width = Math.max(1, Math.floor(w * dpr));
      radarCacheCanvas.height = Math.max(1, Math.floor(h * dpr));
      radarCacheW = w;
      radarCacheH = h;
      radarCacheDpr = dpr;
      radarCacheStorm = stormActive;
      radarCacheLow = lowPerf;

      const sctx = radarCacheCanvas.getContext('2d')!;
      sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sctx.clearRect(0, 0, w, h);

      const altToYStatic = (aKm: number) => {
        const norm = (aKm - ALT_VIEW_MIN) / (ALT_VIEW_MAX - ALT_VIEW_MIN);
        return rBot - norm * rH;
      };
      const timeToXStatic = (tSec: number) => {
        if (tSec >= 0) {
          return stX + (tSec / RADAR_LEAD_SEC) * (rRight - stX);
        }
        return stX + (tSec / RADAR_TRAIL_SEC) * (stX - rLeft);
      };

      // Translucent Military/CNSA Aerospace Radar Scope Frame
      sctx.save();
      sctx.fillStyle = lowPerf ? 'rgba(4, 13, 28, 0.72)' : 'rgba(4, 13, 28, 0.56)';
      roundRectPath(sctx, rLeft, rTop, rW, rH, 14);
      sctx.fill();

      sctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
      sctx.lineWidth = 1.5;
      roundRectPath(sctx, rLeft, rTop, rW, rH, 14);
      sctx.stroke();

      roundRectPath(sctx, rLeft + 1, rTop + 1, rW - 2, rH - 2, 13);
      sctx.clip();

      // Upper 425 km Ceiling Zone
      const ceilY = altToYStatic(ALT_CEIL);
      sctx.fillStyle = 'rgba(244, 63, 94, 0.14)';
      sctx.fillRect(rLeft, rTop, rW, Math.max(0, ceilY - rTop));

      // Lower 380 km Atmospheric Decay Hazard Floor (flat translucent fill, no gradient)
      const floorY = altToYStatic(ALT_FLOOR);
      sctx.fillStyle = stormActive ? 'rgba(239, 68, 68, 0.34)' : 'rgba(249, 115, 22, 0.24)';
      sctx.fillRect(rLeft, floorY, rW, rBot - floorY);

      // Horizontal Altitude Grid Lines & Labels (380..425 km)
      const gridAlts = [380, 390, 400, 410, 420, 425];
      sctx.font = '700 10.5px "JetBrains Mono", monospace';
      sctx.textAlign = 'left';
      for (const ga of gridAlts) {
        const gy = altToYStatic(ga);
        const isFloor = ga === 380;
        const isCeil = ga === 425;
        const isNom = ga === 400;
        sctx.strokeStyle = isFloor
          ? 'rgba(239, 68, 68, 0.85)'
          : isCeil
            ? 'rgba(244, 63, 94, 0.55)'
            : isNom
              ? 'rgba(56, 189, 248, 0.36)'
              : 'rgba(148, 185, 235, 0.13)';
        sctx.lineWidth = isFloor ? 2 : isNom ? 1.3 : 1;
        if (isFloor || isCeil) sctx.setLineDash([7, 5]);
        else sctx.setLineDash([]);
        sctx.beginPath();
        sctx.moveTo(rLeft, gy);
        sctx.lineTo(rRight, gy);
        sctx.stroke();

        sctx.fillStyle = isFloor ? '#fca5a5' : isNom ? '#7dd3fc' : '#708db0';
        const tag = isFloor ? '380 km 大气坠毁红线' : isNom ? '400 km 标准轨高' : `${ga} km`;
        sctx.fillText(tag, rLeft + 10, isCeil ? gy + 12 : gy - 4);
      }
      sctx.setLineDash([]);

      // Vertical Time-to-Conjunction Grid Lines & Labels (T-0 .. T-10s)
      sctx.font = '600 10px "JetBrains Mono", monospace';
      for (let ts = 0; ts <= 10; ts += 2) {
        const tx = timeToXStatic(ts);
        sctx.strokeStyle = ts === 0 ? 'rgba(56, 189, 248, 0.34)' : 'rgba(148, 185, 235, 0.09)';
        sctx.lineWidth = ts === 0 ? 1.4 : 1;
        sctx.beginPath();
        sctx.moveTo(tx, rTop);
        sctx.lineTo(tx, rBot);
        sctx.stroke();

        sctx.fillStyle = ts === 0 ? '#7dd3fc' : '#64748b';
        sctx.textAlign = ts === 10 ? 'right' : 'center';
        sctx.fillText(ts === 0 ? '空间站位置 (T-0)' : `T-${ts}s`, ts === 10 ? tx - 4 : tx, rTop + 14);
      }
      sctx.restore();
      return radarCacheCanvas;
    };

    const render = () => {
      const { width: w, height: h } = canvasHandle.getSize();
      const lowPerf = isLowPerf();
      const dpr = Math.min(window.devicePixelRatio || 1, getMaxDpr());

      ctx.save();
      if (screenShake > 0.01) {
        const mag = screenShake * 6;
        ctx.translate((Math.random() - 0.5) * mag, (Math.random() - 0.5) * mag);
      }

      // Baked Opaque Night-Earth Backdrop (1 integer drawImage when cached)
      if (!drawBakedBackdrop(ctx, 'earth-night', w, h, 0.34, 0.28)) {
        starfield.draw(ctx, w, h, animTime, -animTime * 28, 0);
        drawEarthHorizon(ctx, w, h, animTime, {
          yRatio: 1.78,
          radiusScale: 1.18,
          sunPhase: 0.28,
          nightMode: true,
          darken: 0.34,
        });
      }

      // Safe Play Area radar viewport (compact-aware for 1366x768 & 1366x653!)
      const compact = h <= 720;
      const rTop = compact ? Math.max(104, h * 0.16) : Math.max(152, h * 0.195);
      const rBot = Math.min(h - (compact ? 82 : 138), h * 0.865);
      const rLeft = Math.max(24, w * 0.032);
      const rRight = w - Math.max(24, w * 0.032);
      const rW = rRight - rLeft;
      const rH = rBot - rTop;
      const stX = rLeft + rW * 0.21;
      radarRect = { left: rLeft, right: rRight, top: rTop, bottom: rBot, stationX: stX };

      const stormInfo = getStormInfo(elapsed);
      const cachedScope = ensureRadarStaticCache(
        w,
        h,
        dpr,
        rLeft,
        rTop,
        rRight,
        rBot,
        rW,
        rH,
        stX,
        stormInfo.mult > 1.2,
        lowPerf
      );
      ctx.drawImage(cachedScope, 0, 0, w, h);

      // Storm border pulse alert overlay (only when solar storm active)
      if (currentStormLabel) {
        ctx.save();
        ctx.strokeStyle = `rgba(249, 115, 22, ${0.52 + 0.35 * Math.sin(animTime * 7)})`;
        ctx.lineWidth = 2.2;
        roundRectPath(ctx, rLeft, rTop, rW, rH, 14);
        ctx.stroke();
        ctx.restore();
      }

      // Clip interior of live dynamic radar overlays
      ctx.save();
      roundRectPath(ctx, rLeft + 1, rTop + 1, rW - 2, rH - 2, 13);
      ctx.clip();

      // Flat Translucent Sweeping Conic Radar Wedge + Leading Scan Line (no gradient/lighter)
      const stY = altToY(alt);
      const maxBeamR = rW * 0.96;
      const sweepLead = Math.sin(animTime * 1.15) * 0.46;
      const sweepDir = Math.cos(animTime * 1.15) >= 0 ? 1 : -1;
      const aTail = sweepLead - sweepDir * 0.32;

      ctx.fillStyle = 'rgba(56, 189, 248, 0.08)';
      ctx.beginPath();
      ctx.moveTo(stX, stY);
      ctx.arc(stX, stY, maxBeamR, Math.min(aTail, sweepLead), Math.max(aTail, sweepLead));
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = 'rgba(125, 211, 252, 0.55)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(stX, stY);
      ctx.lineTo(stX + Math.cos(sweepLead) * maxBeamR, stY + Math.sin(sweepLead) * maxBeamR);
      ctx.stroke();

      const sweepR = ((animTime * 190) % (rW * 0.95));
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.16)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(stX, stY, sweepR, -Math.PI * 0.42, Math.PI * 0.42);
      ctx.stroke();

      // Batched concentric range rings around station (1 path instead of 6 strokes)
      ctx.strokeStyle = 'rgba(125, 185, 255, 0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let rr = 140; rr < rW; rr += 140) {
        ctx.moveTo(stX + Math.cos(-Math.PI * 0.46) * rr, stY + Math.sin(-Math.PI * 0.46) * rr);
        ctx.arc(stX, stY, rr, -Math.PI * 0.46, Math.PI * 0.46);
      }
      ctx.stroke();

      // Historical wake trail behind station
      if (historyTrail.length > 1) {
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        historyTrail.forEach((pt, idx) => {
          const px = timeToX(pt.t - elapsed);
          const py = altToY(pt.alt);
          if (idx === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.stroke();
      }

      // --- Live Predictive Trajectory Curve (8.4s forward integration) ---
      const simPred = { alt, vz, burnMode, burnTimer };
      const predPoints: { tau: number; x: number; y: number; alt: number; danger: boolean }[] = [];
      let predictedImpactPoint: { x: number; y: number; label: string } | null = null;
      const stepDt = 0.12;
      for (let i = 0; i <= Math.round(PREDICT_SEC / stepDt); i++) {
        const tau = i * stepDt;
        const px = timeToX(tau);
        const py = altToY(simPred.alt);

        let danger = simPred.alt <= ALT_FLOOR + 0.5 || simPred.alt >= ALT_CEIL - 0.5;
        for (const d of debrisList) {
          const dRem = d.tArrival - elapsed;
          if (Math.abs(dRem - tau) <= 0.45 && Math.abs(simPred.alt - d.alt) < d.redHalfAlt) {
            danger = true;
            if (!predictedImpactPoint) {
              predictedImpactPoint = { x: px, y: py, label: `⚠ 预计与 ${d.label} 交会` };
            }
          }
        }
        predPoints.push({ tau, x: px, y: py, alt: simPred.alt, danger });
        integrateOrbitalStep(simPred, elapsed + tau, stepDt);
      }

      // Draw batched dashed green/red predicted trajectory polylines (1-3 strokes instead of 84!)
      ctx.save();
      ctx.lineWidth = 2.4;
      ctx.setLineDash([7, 5]);
      if (predPoints.length > 1) {
        let segStart = 0;
        while (segStart < predPoints.length - 1) {
          const isDanger = predPoints[segStart + 1].danger;
          ctx.strokeStyle = isDanger ? '#ef4444' : '#4ade80';
          ctx.beginPath();
          ctx.moveTo(predPoints[segStart].x, predPoints[segStart].y);
          let j = segStart + 1;
          while (j < predPoints.length && predPoints[j].danger === isDanger) {
            ctx.lineTo(predPoints[j].x, predPoints[j].y);
            j++;
          }
          ctx.stroke();
          segStart = j - 1;
        }
      }
      ctx.setLineDash([]);

      // Draw 2s interval dots along prediction curve
      for (const pt of predPoints) {
        if (Math.abs(pt.tau % 2) < 0.05 && pt.tau > 0.5) {
          ctx.fillStyle = pt.danger ? '#f87171' : '#86efac';
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 3.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Conjunction alert diamond marker
      if (predictedImpactPoint) {
        const pulse = 9 + Math.sin(animTime * 12) * 2.8;
        ctx.strokeStyle = '#fb7185';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(predictedImpactPoint.x, predictedImpactPoint.y - pulse);
        ctx.lineTo(predictedImpactPoint.x + pulse, predictedImpactPoint.y);
        ctx.lineTo(predictedImpactPoint.x, predictedImpactPoint.y + pulse);
        ctx.lineTo(predictedImpactPoint.x - pulse, predictedImpactPoint.y);
        ctx.closePath();
        ctx.stroke();

        // Inner pulsing alert core diamond
        const innerP = pulse * 0.52;
        ctx.fillStyle = 'rgba(239, 68, 68, 0.85)';
        ctx.beginPath();
        ctx.moveTo(predictedImpactPoint.x, predictedImpactPoint.y - innerP);
        ctx.lineTo(predictedImpactPoint.x + innerP, predictedImpactPoint.y);
        ctx.lineTo(predictedImpactPoint.x, predictedImpactPoint.y + innerP);
        ctx.lineTo(predictedImpactPoint.x - innerP, predictedImpactPoint.y);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = 'rgba(127, 29, 29, 0.9)';
        const msg = predictedImpactPoint.label;
        ctx.font = '700 10.5px "Noto Sans SC", system-ui, sans-serif';
        const mw = ctx.measureText(msg).width + 12;
        roundRectPath(ctx, predictedImpactPoint.x - mw * 0.5, predictedImpactPoint.y - 30, mw, 18, 4);
        ctx.fill();
        ctx.strokeStyle = 'rgba(252, 165, 165, 0.65)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = '#fecaca';
        ctx.textAlign = 'center';
        ctx.fillText(msg, predictedImpactPoint.x, predictedImpactPoint.y - 17.5);
      }
      ctx.restore();

      // --- Incoming Orbital Debris & Conjunction Warning Boxes ---
      for (const d of debrisList) {
        const tRem = d.tArrival - elapsed;
        if (tRem > RADAR_LEAD_SEC + 0.6 || tRem < -RADAR_TRAIL_SEC) continue;

        const dx = timeToX(tRem);
        const dy = altToY(d.alt);
        const pxPerSec = (rRight - stX) / RADAR_LEAD_SEC;
        const pxPerKm = rH / (ALT_VIEW_MAX - ALT_VIEW_MIN);

        const yw = 0.78 * 2 * pxPerSec;
        const yh = d.yellowHalfAlt * 2 * pxPerKm;
        const rw = 0.42 * 2 * pxPerSec;
        const rh = d.redHalfAlt * 2 * pxPerKm;

        const fadeAlpha = tRem < 0 ? clamp(1 + tRem / RADAR_TRAIL_SEC, 0.15, 1) : 1;

        ctx.save();
        ctx.globalAlpha = fadeAlpha;

        // Yellow Caution Box
        ctx.fillStyle = 'rgba(245, 158, 11, 0.09)';
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.52)';
        ctx.lineWidth = 1.1;
        ctx.setLineDash([4, 3]);
        ctx.fillRect(dx - yw * 0.5, dy - yh * 0.5, yw, yh);
        ctx.strokeRect(dx - yw * 0.5, dy - yh * 0.5, yw, yh);
        ctx.setLineDash([]);

        // Red High-Probability Conjunction Warning Box
        const redPulse = 0.2 + 0.12 * Math.sin(animTime * 8 + d.seed);
        ctx.fillStyle = `rgba(239, 68, 68, ${redPulse})`;
        ctx.strokeStyle = '#f43f5e';
        ctx.lineWidth = 1.6;
        ctx.fillRect(dx - rw * 0.5, dy - rh * 0.5, rw, rh);
        ctx.strokeRect(dx - rw * 0.5, dy - rh * 0.5, rw, rh);

        // Corner brackets on Red Warning Box
        const br = 6;
        const rx1 = dx - rw * 0.5;
        const ry1 = dy - rh * 0.5;
        const rx2 = dx + rw * 0.5;
        const ry2 = dy + rh * 0.5;
        ctx.strokeStyle = '#fda4af';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(rx1, ry1 + br); ctx.lineTo(rx1, ry1); ctx.lineTo(rx1 + br, ry1);
        ctx.moveTo(rx2 - br, ry1); ctx.lineTo(rx2, ry1); ctx.lineTo(rx2, ry1 + br);
        ctx.moveTo(rx1, ry2 - br); ctx.lineTo(rx1, ry2); ctx.lineTo(rx1 + br, ry2);
        ctx.moveTo(rx2 - br, ry2); ctx.lineTo(rx2, ry2); ctx.lineTo(rx2, ry2 - br);
        ctx.stroke();

        // Crisp plasma/ionization tail streak (flat lines, no gradients/lighter)
        const tailLen = 34 + (d.relSpeed - 8) * 8;
        ctx.strokeStyle = 'rgba(251, 113, 133, 0.38)';
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(dx, dy);
        ctx.lineTo(dx + tailLen, dy);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(254, 202, 202, 0.8)';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(dx, dy);
        ctx.lineTo(dx + tailLen * 0.72, dy);
        ctx.stroke();

        // 3D Derelict Orbital Satellite / Debris Fragment Model
        drawDebrisModel3D(ctx, {
          x: dx,
          y: dy,
          radius: 10 + clamp(d.relSpeed - 7.5, 0, 4) * 1.4,
          angle: animTime * 3.8 + d.seed,
          seed: d.seed,
          danger: true,
        });

        // Live Conjunction Countdown & Velocity Label
        if (tRem > -0.2) {
          ctx.fillStyle = '#fecdd3';
          ctx.font = '700 10.5px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText(
            `T-${Math.max(0, tRem).toFixed(1)}s · ${d.relSpeed.toFixed(1)} km/s`,
            dx,
            dy - rh * 0.5 - 6
          );
          ctx.fillStyle = '#fde68a';
          ctx.font = '600 9.5px "JetBrains Mono", monospace';
          ctx.fillText(`${d.alt.toFixed(0)} km`, dx, dy + rh * 0.5 + 12);
        }

        ctx.restore();
      }

      // --- Space Station ---
      const pitch = clamp(-vz * 0.055, -0.22, 0.22);
      drawStation(stX, stY, pitch);

      // Station live altitude tag
      ctx.save();
      ctx.fillStyle = 'rgba(7, 17, 34, 0.86)';
      roundRectPath(ctx, stX - 78, stY - 36, 108, 20, 5);
      ctx.fill();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#e0f2fe';
      ctx.font = '700 10.5px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(
        `${alt.toFixed(1)}km (${vz >= 0 ? '+' : ''}${vz.toFixed(1)})`,
        stX - 24,
        stY - 22.5
      );
      ctx.restore();

      // --- Physics Overlay (`V`) ---
      if (physicsOverlay) {
        ctx.save();
        // Vertical transfer velocity vector
        if (Math.abs(vz) > 0.12) {
          drawVectorArrow(
            ctx,
            stX,
            stY,
            stX,
            stY - clamp(vz * 16, -64, 64),
            '#4ade80',
            `v_z ${vz >= 0 ? '+' : ''}${vz.toFixed(1)}`
          );
        }

        // Atmospheric drag acceleration vector (visibly grows during Level 3 Solar Storm!)
        const dragLen = clamp(currentDragRate * 68, 12, 68);
        drawVectorArrow(
          ctx,
          stX + 26,
          stY,
          stX + 26,
          stY + dragLen,
          stormInfo.mult > 1.2 ? '#ef4444' : '#f59e0b',
          `大气阻力 -${currentDragRate.toFixed(2)} km/s`
        );

        // Hohmann transfer formula badge near prediction curve
        const midPt = predPoints[Math.min(predPoints.length - 1, 36)];
        if (midPt) {
          ctx.fillStyle = 'rgba(4, 11, 24, 0.88)';
          roundRectPath(ctx, midPt.x - 86, midPt.y - 34, 172, 22, 5);
          ctx.fill();
          ctx.strokeStyle = 'rgba(74, 222, 128, 0.55)';
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle = '#86efac';
          ctx.font = '600 10px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText('霍曼变轨 Δv ≈ (v/4)·(Δr/r)', midPt.x, midPt.y - 19.5);
        }

        // Nearest debris Kinetic Energy Ek = ½mv² & Miss Distance Δh readout
        const nearest = findNearestUpcomingDebris();
        if (nearest && nearest.tArrival - elapsed <= RADAR_LEAD_SEC) {
          const ekMj =
            (0.5 * (nearest.massGrams / 1000) * Math.pow(nearest.relSpeed * 1000, 2)) / 1e6;
          const dh = Math.abs(alt - nearest.alt);
          const cardW = 248;
          const cardH = 54;
          const cxCard = rRight - cardW - 14;
          const cyCard = rTop + 22;

          ctx.fillStyle = 'rgba(6, 13, 28, 0.9)';
          roundRectPath(ctx, cxCard, cyCard, cardW, cardH, 8);
          ctx.fill();
          ctx.strokeStyle = dh < nearest.redHalfAlt ? '#ef4444' : 'rgba(244, 63, 94, 0.55)';
          ctx.lineWidth = 1.2;
          ctx.stroke();

          ctx.fillStyle = '#fda4af';
          ctx.font = '700 10.5px "JetBrains Mono", monospace';
          ctx.textAlign = 'left';
          ctx.fillText(
            `最近目标 ${nearest.label} (${nearest.massGrams}g @ ${nearest.relSpeed.toFixed(1)} km/s)`,
            cxCard + 10,
            cyCard + 17
          );
          ctx.fillStyle = '#fde68a';
          ctx.fillText(
            `Ek = ½mv² = ${ekMj >= 1 ? `${ekMj.toFixed(2)} MJ` : `${(ekMj * 1000).toFixed(0)} kJ`}`,
            cxCard + 10,
            cyCard + 33
          );
          ctx.fillStyle = dh >= nearest.yellowHalfAlt ? '#86efac' : dh >= nearest.redHalfAlt ? '#fbbf24' : '#fca5a5';
          ctx.fillText(`当前错开 Δh = ${dh.toFixed(1)} km`, cxCard + 10, cyCard + 47);

          // Dashed miss-distance vertical bracket if close
          const nx = timeToX(Math.max(0, nearest.tArrival - elapsed));
          const ny = altToY(nearest.alt);
          ctx.strokeStyle = 'rgba(253, 224, 71, 0.45)';
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(nx, ny);
          ctx.lineTo(nx, stY);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.restore();
      }

      // Solar Storm Active Banner inside top center of Radar
      if (currentStormLabel) {
        ctx.save();
        const bw = 320;
        const bx = (rLeft + rRight) * 0.5 - bw * 0.5;
        const by = rTop + 22;
        ctx.fillStyle = `rgba(154, 52, 18, ${0.82 + 0.14 * Math.sin(animTime * 8)})`;
        roundRectPath(ctx, bx, by, bw, 24, 6);
        ctx.fill();
        ctx.strokeStyle = '#fb923c';
        ctx.lineWidth = 1.3;
        ctx.stroke();
        ctx.fillStyle = '#ffedd5';
        ctx.font = '700 11.5px "Noto Sans SC", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`太阳风暴 · ${currentStormLabel}`, (rLeft + rRight) * 0.5, by + 16);
        ctx.restore();
      }

      // Clean-pass / Close-call floating status banner
      if (statusBanner) {
        ctx.save();
        const bw = 270;
        const bx = (rLeft + rRight) * 0.5 - bw * 0.5;
        const by = rBot - 36;
        ctx.fillStyle = 'rgba(7, 15, 29, 0.9)';
        roundRectPath(ctx, bx, by, bw, 24, 6);
        ctx.fill();
        ctx.strokeStyle = statusBanner.color;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.fillStyle = statusBanner.color;
        ctx.font = '700 11.5px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(statusBanner.text, (rLeft + rRight) * 0.5, by + 16);
        ctx.restore();
      }

      particles.draw(ctx);
      ctx.restore(); // end radar clip
      ctx.restore(); // end screenShake
    };

    // --- Direct Canvas Pointer Controls ---
    const handlePointerDown = (e: PointerEvent) => {
      if (paused || completed) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (
        x < radarRect.left ||
        x > radarRect.right ||
        y < radarRect.top ||
        y > radarRect.bottom
      ) {
        return;
      }
      const stY = altToY(alt);
      if (Math.abs(y - stY) <= 28) {
        fireBurn('circ');
      } else if (y < stY) {
        fireBurn('up');
      } else {
        fireBurn('down');
      }
    };

    // Keyboard controls (strictly avoiding 1-8, Tab, Esc, V, R, M, F, ?)
    const handleKeyDown = (e: KeyboardEvent) => {
      if (paused || completed) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const k = e.key.toLowerCase();
      if (k === 'w' || e.key === 'ArrowUp') {
        e.preventDefault();
        fireBurn('up');
      } else if (k === 's' || e.key === 'ArrowDown') {
        e.preventDefault();
        fireBurn('down');
      } else if (e.code === 'Space') {
        e.preventDefault();
        if (e.repeat) return;
        fireBurn('circ');
      }
    };

    canvas.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);

    resetLevel(levelIndex);

    const loop = (ts: number) => {
      if (destroyed) return;
      const rawDtMs = ts - lastTs;
      reportFrameDelta(rawDtMs);
      const dt = clamp(rawDtMs / 1000, 0, 0.05);
      lastTs = ts;
      animTime += dt;

      if (!paused && !completed) {
        stepSimulation(dt);
      }
      render();
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);

    return {
      destroy() {
        destroyed = true;
        cancelAnimationFrame(rafId);
        canvas.removeEventListener('pointerdown', handlePointerDown);
        window.removeEventListener('keydown', handleKeyDown);
        host.hud.clearTactileDeck();
        canvasHandle.destroy();
      },
      setLevel(idx: number) {
        resetLevel(idx);
      },
      restart() {
        resetLevel(levelIndex);
      },
      setPaused(p: boolean) {
        paused = p;
        lastTs = performance.now();
      },
      setPhysicsOverlay(enabled: boolean) {
        physicsOverlay = enabled;
      },
    };
  },
};
