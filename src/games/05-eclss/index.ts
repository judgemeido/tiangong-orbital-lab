import { drawFeitianAstronaut3D } from '../../core/aerospace-models';
import {
  clamp,
  drawVectorArrow,
  lerp,
  ParticleSystem,
  setupHiDPICanvas,
  StarfieldRenderer,
} from '../../core/canvas-utils';
import {
  drawBakedBackdrop,
  getMLIPattern,
} from '../../core/materials';
import type {
  GameHostAPI,
  GameInstance,
  GameMeta,
  GameModule,
  GameResult,
  MetricStatus,
  ScienceComparison,
} from '../../core/game-interface';

type UnitId = 'ogs' | 'cdra' | 'sabatier' | 'wrs';

interface UnitConfig {
  id: UnitId;
  name: string;
  shortName: string;
  enCode: string;
  maxKw: number;
  accent: string;
  keyUp: string;
  keyDown: string;
  formula: string;
}

const UNITS: UnitConfig[] = [
  {
    id: 'ogs',
    name: '电解制氧槽',
    shortName: '制氧',
    enCode: 'OGS',
    maxKw: 36,
    accent: '#22c55e',
    keyUp: 'Q',
    keyDown: 'A',
    formula: '2H₂O → 2H₂ + O₂',
  },
  {
    id: 'cdra',
    name: 'CO₂ 分子筛',
    shortName: '除碳',
    enCode: 'CDRA',
    maxKw: 33,
    accent: '#f59e0b',
    keyUp: 'W',
    keyDown: 'S',
    formula: 'Zeolite Ads. CO₂',
  },
  {
    id: 'sabatier',
    name: '萨巴蒂尔反应釜',
    shortName: '萨巴',
    enCode: 'SABATIER',
    maxKw: 30,
    accent: '#a855f7',
    keyUp: 'E',
    keyDown: 'D',
    formula: 'CO₂ + 4H₂ → CH₄ + 2H₂O',
  },
  {
    id: 'wrs',
    name: '冷凝与水再生',
    shortName: '水循',
    enCode: 'WRS',
    maxKw: 30,
    accent: '#38bdf8',
    keyUp: 'T',
    keyDown: 'G',
    formula: 'Vapor + VCD → H₂O',
  },
];

const NOTCHES = [0, 1 / 3, 2 / 3, 1] as const;

interface ExerciseWave {
  start: number;
  end: number;
  multiplier: number;
  label: string;
}

interface EclssLevelConfig {
  duration: number;
  crewCount: number;
  baseMetabolism: number;
  powerCapKw: number;
  hasPowerCap: boolean;
  sieveSatRate: number;
  hasOverheat: boolean;
  initialWater: number;
  initialNotches: Record<UnitId, number>;
  waves: ExerciseWave[];
  codexId: string;
}

const LEVEL_CONFIGS: EclssLevelConfig[] = [
  {
    duration: 45,
    crewCount: 3,
    baseMetabolism: 1.0,
    powerCapKw: 140,
    hasPowerCap: false,
    sieveSatRate: 0,
    hasOverheat: false,
    initialWater: 64,
    initialNotches: { ogs: 2, cdra: 2, sabatier: 1, wrs: 2 },
    waves: [],
    codexId: 'eclss-electrolysis',
  },
  {
    duration: 55,
    crewCount: 3,
    baseMetabolism: 1.05,
    powerCapKw: 140,
    hasPowerCap: false,
    sieveSatRate: 0.048,
    hasOverheat: false,
    initialWater: 60,
    initialNotches: { ogs: 2, cdra: 2, sabatier: 2, wrs: 2 },
    waves: [
      { start: 9, end: 21, multiplier: 1.78, label: '太空跑台有氧训练' },
      { start: 29, end: 41, multiplier: 1.92, label: '高强度单车阻力训练' },
      { start: 46, end: 52, multiplier: 1.62, label: '出舱前体能热身' },
    ],
    codexId: 'eclss-water-cycle',
  },
  {
    duration: 65,
    crewCount: 6,
    baseMetabolism: 1.72,
    powerCapKw: 100,
    hasPowerCap: true,
    sieveSatRate: 0.036,
    hasOverheat: true,
    initialWater: 58,
    initialNotches: { ogs: 2, cdra: 2, sabatier: 2, wrs: 1 },
    waves: [
      { start: 14, end: 26, multiplier: 1.16, label: '乘组交接物资搬运' },
      { start: 36, end: 50, multiplier: 1.22, label: '六人同步在轨作业峰值' },
    ],
    codexId: 'eclss-sabatier',
  },
];

interface FlowPacket {
  pipe: 'w2ogs' | 'ogs2hab' | 'ogs2sab' | 'hab2cdra' | 'cdra2sab' | 'sab2w' | 'hab2wrs' | 'wrs2w' | 'sab2vent';
  t: number;
  speed: number;
  color: string;
  rgb: string;
  radius: number;
}

interface HitBox {
  unit: UnitId;
  x: number;
  y: number;
  w: number;
  h: number;
  minusX: number;
  minusY: number;
  plusX: number;
  plusY: number;
  btnR: number;
  actionRect?: { x: number; y: number; w: number; h: number; kind: 'regen' | 'cool' };
}

const SCIENCE_CARDS: Record<string, ScienceComparison> = {
  'eclss-electrolysis': {
    title: '电解水制氧与氧分压控制',
    gameAction: '你通过实时调节 OGS 电解制氧槽与水循环的配合，把舱内氧分压稳定在了人类最舒适的 19.5–23.5 kPa 绿区。',
    realStationFact: '地面运送高压氧气瓶极其昂贵，天宫核心舱利用再生纯水电解制氧（2H₂O → 2H₂ + O₂），在供氧的同时把副产氢气送入萨巴蒂尔反应釜回收成水。',
    realData: '真实参数：舱内标准氧分压 19.5–23.5 kPa · 1 名航天员日耗 O₂ ≈ 0.84 kg',
    codexId: 'eclss-electrolysis',
  },
  'eclss-water-cycle': {
    title: '冷凝水与尿液蒸馏水循环再生',
    gameAction: '面对太空健身导致的代谢峰值与分子筛饱和，你及时拉高水回收与除碳功率并完成滤芯再生，成功稳住了整个闭环。',
    realStationFact: '失重下汗液与呼吸水汽由冷凝换热器捕集，尿液经真空旋转蒸馏与多级催化提纯后可重新饮用并用于电解制氧，大幅降低货运飞船补给负担。',
    realData: '真实参数：天宫水资源综合回收率 > 95% · 分子筛需定期加热真空解吸再生',
    codexId: 'eclss-water-cycle',
  },
  'eclss-sabatier': {
    title: '萨巴蒂尔反应器：把废气变回净水',
    gameAction: '在六人满载与 100 kW 供电上限的约束下，你让萨巴蒂尔反应釜把呼出的 CO₂ 与电解副产 H₂ 重新合成为纯水，防止了水箱枯竭。',
    realStationFact: '萨巴蒂尔反应（CO₂ + 4H₂ → CH₄ + 2H₂O）是强放热催化过程，需精密控制反应床温度；它让空间站氧气再生闭环率跃升至 90% 以上。',
    realData: '真实参数：催化床工作温度 ~350–450 °C · 反应热 ΔH = -165 kJ/mol',
    codexId: 'eclss-sabatier',
  },
};

const META: GameMeta = {
  id: 'eclss',
  number: '05',
  shortTitle: '环控生保',
  title: '环控生保化学闭环',
  enTitle: 'LIFE SUPPORT LOOP (ECLSS)',
  moduleName: '核心舱生保段',
  genre: '化学管网动态平衡',
  tagline: '调度电解制氧、萨巴蒂尔反应釜与水回收，守住人类生存绿区',
  accent: '#22c55e',
  hubAnchor: { x: 0.5, y: 0.78 },
  briefingSteps: [
    {
      title: '守住三大生命体征绿区',
      desc: '乘组持续消耗 O₂ 并排出 CO₂ 与水汽。动态调节 4 套生保装置功率，确保氧分压 19.5–23.5 kPa、CO₂ < 0.60 kPa、净水 > 20%。',
    },
    {
      title: '打通萨巴蒂尔化学闭环',
      desc: '电解制氧槽消耗纯水并产生 H₂；分子筛捕获的 CO₂ 与 H₂ 进入萨巴蒂尔反应釜，重新合成 2H₂O 回注净水箱！',
    },
    {
      title: '应对代谢峰值与供电限额',
      desc: '太空健身时代谢飙升且分子筛会饱和，点击“滤芯再生”恢复吸附；六人轮换受 100 kW 总功率上限与催化剂过热约束。',
    },
  ],
  controlsHint: '点击设备或底部按键调档 · Q/A 制氧 · W/S 除碳 · E/D 萨巴 · T/G 水循 · Space 维护再生',
  levels: [
    {
      index: 0,
      name: '三人常态驻留',
      subtitle: '45秒常态化学闭环平衡',
      objective: '平衡 4 大生保子系统，使 O₂ (19.5–23.5 kPa)、CO₂ (< 0.60 kPa) 与净水 (> 20%) 全程安全',
    },
    {
      index: 1,
      name: '太空健身代谢峰值',
      subtitle: '55秒运动代谢冲击与滤芯再生',
      objective: '抵御太空健身引发的 O₂/CO₂ 波动，并在分子筛饱和时及时点击“滤芯再生”',
    },
    {
      index: 2,
      name: '六人乘组轮换满载',
      subtitle: '65秒双倍负荷 + 100kW母线限额',
      objective: '在 100 kW 供电上限内调度六人轮换满载，防止萨巴蒂尔催化剂过热并守住生命绿区',
    },
  ],
  codexIds: ['eclss-electrolysis', 'eclss-sabatier', 'eclss-water-cycle'],
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

function evalCubic(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  t: number
): [number, number] {
  const u = 1 - t;
  const x =
    u * u * u * p0[0] +
    3 * u * u * t * p1[0] +
    3 * u * t * t * p2[0] +
    t * t * t * p3[0];
  const y =
    u * u * u * p0[1] +
    3 * u * u * t * p1[1] +
    3 * u * t * t * p2[1] +
    t * t * t * p3[1];
  return [x, y];
}

export const eclssGame: GameModule = {
  meta: META,
  mount(canvasHost: HTMLElement, host: GameHostAPI): GameInstance {
    const canvasHandle = setupHiDPICanvas(canvasHost);
    const { canvas, ctx } = canvasHandle;
    const starfield = new StarfieldRenderer(140, 505);
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

    // Simulation state
    let elapsed = 0;
    let o2 = 21.2; // kPa (nominal 19.5..23.5, fail <= 16.0 or >= 26.5)
    let co2 = 0.30; // kPa (nominal <= 0.48, safe < 0.60, fail >= 0.92)
    let water = 64; // % (nominal >= 35, safe > 20, fail <= 5)
    let h2Buffer = 44; // 0..100
    let co2Buffer = 42; // 0..100
    let wasteWater = 48; // 0..100

    let notches: Record<UnitId, number> = { ogs: 2, cdra: 2, sabatier: 1, wrs: 2 };
    let sieveSat = 0; // 0..1
    let sieveRegenTimer = 0; // seconds remaining in regen purge
    let sabTemp = 360; // °C (nominal 320..440, warn 460, trip 540)
    let sabTripTimer = 0;
    let coolCooldown = 0;

    // Live chemical molar/mass rates for Physics Overlay
    let rateO2MolH = 0;
    let rateCo2MolH = 0;
    let rateSabWaterMolH = 0;
    let rateWrsLH = 0;
    let currentMetabolism = 1.0;
    let activeWaveLabel = '';

    // Scoring & telemetry tracking
    let greenTime = 0;
    let waterConsumed = 0.001;
    let waterRecovered = 0.001;
    let regenCount = 0;
    let coolCount = 0;
    let powerRejectFlash = 0;
    let dangerPulse = 0;
    let alarmCooldown = 0;
    let hoverUnit: UnitId | null = null;
    let selectedUnit: UnitId | null = null;
    let hitBoxes: HitBox[] = [];
    let packets: FlowPacket[] = [];
    let packetSpawnAccum: Record<FlowPacket['pipe'], number> = {
      w2ogs: 0,
      ogs2hab: 0,
      ogs2sab: 0,
      hab2cdra: 0,
      cdra2sab: 0,
      sab2w: 0,
      hab2wrs: 0,
      wrs2w: 0,
      sab2vent: 0,
    };

    // Debounced toasts
    const toastTimestamps = new Map<string, number>();
    const pushDebouncedToast = (
      key: string,
      text: string,
      tone: MetricStatus = 'info',
      tag = '环控生保科普',
      cooldownSec = 10
    ) => {
      const last = toastTimestamps.get(key) ?? -999;
      if (elapsed - last >= cooldownSec) {
        toastTimestamps.set(key, elapsed);
        host.hud.pushToast(text, tone, tag);
      }
    };

    // Tactile deck DOM references
    const deckValEls: Partial<Record<UnitId, HTMLElement>> = {};
    let regenBtnEl: HTMLButtonElement | null = null;
    let coolBtnEl: HTMLButtonElement | null = null;
    let busPillEl: HTMLElement | null = null;

    const getPowerFrac = (u: UnitId): number => NOTCHES[notches[u]] ?? 0;

    const getTotalKw = (): number => {
      let sum = 0;
      for (const u of UNITS) {
        sum += u.maxKw * getPowerFrac(u.id);
      }
      return Math.round(sum);
    };

    const refreshDeckUI = () => {
      for (const u of UNITS) {
        const el = deckValEls[u.id];
        if (el) {
          const pct = Math.round(getPowerFrac(u.id) * 100);
          el.textContent = `${pct}%`;
          el.style.color = pct === 0 ? '#94a3b8' : u.accent;
        }
      }
      if (busPillEl) {
        const kw = getTotalKw();
        busPillEl.textContent = `母线 ${kw}/${cfg.powerCapKw}kW`;
        busPillEl.style.color =
          kw >= cfg.powerCapKw - 4 ? '#fbbf24' : kw >= cfg.powerCapKw * 0.8 ? '#7dd3fc' : '#86efac';
        busPillEl.style.borderColor =
          powerRejectFlash > 0 ? '#ef4444' : kw >= cfg.powerCapKw - 4 ? 'rgba(245,158,11,0.65)' : 'rgba(125,185,255,0.22)';
      }
      if (regenBtnEl) {
        const satPct = Math.round(sieveSat * 100);
        if (sieveRegenTimer > 0) {
          regenBtnEl.textContent = `[再生] 进行中 ${sieveRegenTimer.toFixed(1)}s`;
          regenBtnEl.className = 'deck-ctrl-btn is-active';
        } else {
          regenBtnEl.textContent = `[再生] 滤芯再生 ${satPct}% [Space]`;
          regenBtnEl.className =
            satPct >= 72
              ? 'deck-ctrl-btn is-danger'
              : satPct >= 45
                ? 'deck-ctrl-btn is-gold'
                : 'deck-ctrl-btn';
        }
      }
      if (coolBtnEl) {
        const t = Math.round(sabTemp);
        if (sabTripTimer > 0) {
          coolBtnEl.textContent = `[散热] 过热保护 ${sabTripTimer.toFixed(1)}s`;
          coolBtnEl.className = 'deck-ctrl-btn is-danger';
        } else if (coolCooldown > 0) {
          coolBtnEl.textContent = `[散热] 冷却回充 ${coolCooldown.toFixed(1)}s`;
          coolBtnEl.className = 'deck-ctrl-btn';
        } else {
          coolBtnEl.textContent = `[散热] 催化散热 ${t}°C [Space]`;
          coolBtnEl.className =
            t >= 485 ? 'deck-ctrl-btn is-danger' : t >= 435 ? 'deck-ctrl-btn is-gold' : 'deck-ctrl-btn';
        }
      }
    };

    const setUnitNotch = (id: UnitId, nextNotch: number): boolean => {
      if (paused || completed) return false;
      const clamped = clamp(Math.round(nextNotch), 0, NOTCHES.length - 1);
      if (clamped === notches[id]) return false;

      const unitCfg = UNITS.find((u) => u.id === id)!;
      const oldKw = getTotalKw();
      const deltaKw = Math.round(unitCfg.maxKw * (NOTCHES[clamped] - NOTCHES[notches[id]]));
      if (cfg.hasPowerCap && oldKw + deltaKw > cfg.powerCapKw) {
        powerRejectFlash = 0.7;
        host.audio.playWarning();
        pushDebouncedToast(
          'power-cap',
          `100 kW 供电母线已满载！请先调低其他设备档位，再提升「${unitCfg.name}」功率。`,
          'caution',
          '配电母线约束',
          4.5
        );
        refreshDeckUI();
        return false;
      }

      notches[id] = clamped;
      selectedUnit = id;
      host.audio.playSwitch();
      refreshDeckUI();

      // Contextual chemistry toast when Sabatier starts closing the loop
      if (id === 'sabatier' && clamped >= 2 && h2Buffer > 15 && co2Buffer > 15) {
        pushDebouncedToast(
          'sabatier-active',
          '萨巴蒂尔反应釜加速运转：CO₂ + 4H₂ → CH₄ + 2H₂O，废气正转化为珍贵纯水回注水箱！',
          'nominal',
          '萨巴蒂尔闭环',
          18
        );
      }
      return true;
    };

    const triggerSieveRegen = () => {
      if (paused || completed) return;
      if (cfg.sieveSatRate <= 0) return;
      if (sieveRegenTimer > 0) return;
      if (sieveSat < 0.12) {
        host.audio.playBeep(440, 0.06);
        return;
      }
      sieveRegenTimer = 2.0;
      regenCount++;
      host.audio.playLock();
      pushDebouncedToast(
        'sieve-regen',
        '分子筛开始加热真空解吸再生（约 2 秒），吸附床清理后除碳效率将恢复 100%！',
        'info',
        '分子筛再生',
        6
      );
      const cdraBox = hitBoxes.find((b) => b.unit === 'cdra');
      if (cdraBox) {
        particles.burst(cdraBox.x + cdraBox.w * 0.5, cdraBox.y + cdraBox.h * 0.5, 18, '#fbbf24', 65, 3, 0.7);
      }
      refreshDeckUI();
    };

    const triggerCatalystCool = () => {
      if (paused || completed) return;
      if (!cfg.hasOverheat) return;
      if (coolCooldown > 0) {
        host.audio.playBeep(320, 0.06);
        return;
      }
      sabTemp = Math.max(325, sabTemp - 105);
      sabTripTimer = Math.max(0, sabTripTimer - 2.2);
      coolCooldown = 4.5;
      coolCount++;
      host.audio.playLock();
      pushDebouncedToast(
        'sab-cool',
        '液冷回路旁通开启！萨巴蒂尔放热反应床温度迅速回落至安全催化窗口。',
        'nominal',
        '催化床热控',
        7
      );
      const sabBox = hitBoxes.find((b) => b.unit === 'sabatier');
      if (sabBox) {
        particles.burst(sabBox.x + sabBox.w * 0.5, sabBox.y + sabBox.h * 0.5, 18, '#38bdf8', 75, 3, 0.65);
      }
      refreshDeckUI();
    };

    const buildTactileDeck = () => {
      const deck = host.hud.getTactileDeck();
      host.hud.clearTactileDeck();
      regenBtnEl = null;
      coolBtnEl = null;
      busPillEl = null;

      for (const u of UNITS) {
        const group = document.createElement('div');
        group.className = 'deck-slider-group';
        group.style.gap = '4px';
        group.style.padding = '3px 6px';

        const label = document.createElement('span');
        label.style.fontWeight = '700';
        label.style.color = u.accent;
        label.style.fontSize = '11.5px';
        label.textContent = u.shortName;

        const minusBtn = document.createElement('button');
        minusBtn.type = 'button';
        minusBtn.className = 'deck-ctrl-btn';
        minusBtn.style.minHeight = '28px';
        minusBtn.style.padding = '0 8px';
        minusBtn.textContent = '−';
        minusBtn.title = `调低 ${u.name} (${u.keyDown})`;
        minusBtn.addEventListener('click', () => {
          setUnitNotch(u.id, notches[u.id] - 1);
          minusBtn.blur();
        });

        const valEl = document.createElement('span');
        valEl.className = 'mono-num';
        valEl.style.minWidth = '34px';
        valEl.style.textAlign = 'center';
        valEl.style.fontWeight = '700';
        valEl.style.fontSize = '12px';
        deckValEls[u.id] = valEl;

        const plusBtn = document.createElement('button');
        plusBtn.type = 'button';
        plusBtn.className = 'deck-ctrl-btn';
        plusBtn.style.minHeight = '28px';
        plusBtn.style.padding = '0 8px';
        plusBtn.textContent = '+';
        plusBtn.title = `调高 ${u.name} (${u.keyUp})`;
        plusBtn.addEventListener('click', () => {
          setUnitNotch(u.id, notches[u.id] + 1);
          plusBtn.blur();
        });

        group.append(label, minusBtn, valEl, plusBtn);
        deck.appendChild(group);
      }

      if (cfg.sieveSatRate > 0) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'deck-ctrl-btn';
        btn.style.minHeight = '32px';
        btn.style.fontSize = '11.5px';
        btn.addEventListener('click', () => {
          triggerSieveRegen();
          btn.blur();
        });
        deck.appendChild(btn);
        regenBtnEl = btn;
      }

      if (cfg.hasOverheat) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'deck-ctrl-btn';
        btn.style.minHeight = '32px';
        btn.style.fontSize = '11.5px';
        btn.addEventListener('click', () => {
          triggerCatalystCool();
          btn.blur();
        });
        deck.appendChild(btn);
        coolBtnEl = btn;
      }

      if (cfg.hasPowerCap) {
        const pill = document.createElement('div');
        pill.className = 'deck-slider-group mono-num';
        pill.style.fontWeight = '800';
        pill.style.fontSize = '12px';
        pill.style.padding = '5px 9px';
        deck.appendChild(pill);
        busPillEl = pill;
      }

      refreshDeckUI();
    };

    const getO2Status = (): MetricStatus => {
      if (o2 < 17.8 || o2 > 25.0) return 'critical';
      if (o2 < 19.5 || o2 > 23.5) return 'caution';
      return 'nominal';
    };

    const getCo2Status = (): MetricStatus => {
      if (co2 >= 0.65) return 'critical';
      if (co2 >= 0.48) return 'caution';
      return 'nominal';
    };

    const getWaterStatus = (): MetricStatus => {
      if (water < 20) return 'critical';
      if (water < 34) return 'caution';
      return 'nominal';
    };

    const initMetrics = () => {
      host.hud.setMetrics([
        {
          id: 'o2',
          label: '舱内氧分压 O₂',
          value: `${o2.toFixed(1)} kPa`,
          ratio: clamp((o2 - 15) / 12, 0, 1),
          status: getO2Status(),
        },
        {
          id: 'co2',
          label: '二氧化碳 CO₂',
          value: `${co2.toFixed(2)} kPa`,
          ratio: clamp(co2 / 0.9, 0, 1),
          status: getCo2Status(),
        },
        {
          id: 'water',
          label: '净水储量 H₂O',
          value: `${Math.round(water)}%`,
          ratio: clamp(water / 100, 0, 1),
          status: getWaterStatus(),
        },
        {
          id: 'time',
          label: '驻留倒计时',
          value: `${Math.max(0, cfg.duration - elapsed).toFixed(1)} s`,
          ratio: clamp(elapsed / cfg.duration, 0, 1),
          status: 'info',
        },
      ]);
    };

    const updateHudMetrics = () => {
      host.hud.updateMetric('o2', {
        value: `${o2.toFixed(1)} kPa`,
        ratio: clamp((o2 - 15) / 12, 0, 1),
        status: getO2Status(),
      });
      host.hud.updateMetric('co2', {
        value: `${co2.toFixed(2)} kPa`,
        ratio: clamp(co2 / 0.9, 0, 1),
        status: getCo2Status(),
      });
      host.hud.updateMetric('water', {
        value: `${Math.round(water)}%`,
        ratio: clamp(water / 100, 0, 1),
        status: getWaterStatus(),
      });
      const rem = Math.max(0, cfg.duration - elapsed);
      host.hud.updateMetric('time', {
        value: `${rem.toFixed(1)} s`,
        ratio: clamp(elapsed / cfg.duration, 0, 1),
        status: rem <= 8 ? 'nominal' : 'info',
      });
    };

    const resetLevel = (idx: number) => {
      levelIndex = clamp(idx, 0, LEVEL_CONFIGS.length - 1);
      cfg = LEVEL_CONFIGS[levelIndex];
      completed = false;
      elapsed = 0;
      o2 = 21.2;
      co2 = 0.28;
      water = cfg.initialWater;
      h2Buffer = 44;
      co2Buffer = 42;
      wasteWater = 50;
      notches = { ...cfg.initialNotches };
      sieveSat = 0;
      sieveRegenTimer = 0;
      sabTemp = 365;
      sabTripTimer = 0;
      coolCooldown = 0;
      greenTime = 0;
      waterConsumed = 0.001;
      waterRecovered = 0.001;
      regenCount = 0;
      coolCount = 0;
      powerRejectFlash = 0;
      dangerPulse = 0;
      alarmCooldown = 0;
      activeWaveLabel = '';
      currentMetabolism = cfg.baseMetabolism;
      packets = [];
      particles.clear();
      toastTimestamps.clear();

      host.hud.setObjective(META.levels[levelIndex].objective);
      initMetrics();
      buildTactileDeck();

      if (levelIndex === 0) {
        host.hud.pushToast(
          '点击画布设备或按 Q/A·W/S·E/D·T/G 调档，让电解槽、分子筛与萨巴蒂尔协同闭环！',
          'info',
          '三人常态驻留'
        );
      } else if (levelIndex === 1) {
        host.hud.pushToast(
          '乘组即将开展太空健身！运动期代谢飙升且 CO₂ 分子筛会逐步饱和，注意及时点击“滤芯再生”。',
          'caution',
          '代谢峰值预警'
        );
      } else {
        host.hud.pushToast(
          '六人乘组轮换开启！总配电母线锁定 100 kW 上限，同时留意萨巴蒂尔放热反应床温度！',
          'caution',
          '满载轮换调度'
        );
      }
    };

    const finishMission = (won: boolean, failReason?: string) => {
      if (completed) return;
      completed = true;
      const greenRatio = clamp(greenTime / Math.max(0.1, elapsed), 0, 1);
      const closurePct = clamp((waterRecovered / Math.max(0.01, waterConsumed)) * 100, 0, 99.6);

      let stars: 0 | 1 | 2 | 3 = 0;
      if (won) {
        const star3Closure = levelIndex === 2 ? 80 : 84;
        if (greenRatio >= 0.76 && closurePct >= star3Closure) {
          stars = 3;
        } else if (greenRatio >= 0.52 || closurePct >= 72) {
          stars = 2;
        } else {
          stars = 1;
        }
      }

      const score = won
        ? Math.round(greenRatio * 620 + Math.min(100, closurePct) * 3.8 + (levelIndex + 1) * 100)
        : Math.round((elapsed / cfg.duration) * 350);

      const cardKey = !won
        ? failReason === 'water'
          ? 'eclss-water-cycle'
          : failReason === 'co2'
            ? 'eclss-sabatier'
            : 'eclss-electrolysis'
        : cfg.codexId;

      const summary = won
        ? stars === 3
          ? `完美闭环！全时段绿区保持率 ${Math.round(greenRatio * 100)}%，水资源闭环回收率达 ${closurePct.toFixed(1)}%。`
          : `任务达标！绿区保持率 ${Math.round(greenRatio * 100)}%，可进一步提升萨巴蒂尔与水回收协同度冲击 3★。`
        : failReason === 'o2_low'
          ? '舱内氧分压跌破 16.0 kPa 缺氧红线！需及时提升电解制氧槽 (OGS) 功率并确保纯水充足。'
          : failReason === 'o2_high'
            ? '舱内氧分压超过 26.5 kPa 富氧燃爆红线！氧分压高于 23.0 kPa 时应及时下调电解槽档位。'
            : failReason === 'co2'
              ? '舱内 CO₂ 突破 0.92 kPa 临界浓度！需加大分子筛 (CDRA) 功率并及时再生饱和滤芯。'
              : '净水储箱濒临枯竭！请同步运转萨巴蒂尔反应釜与水再生装置以实现水资源闭环。';

      const extraMetric =
        levelIndex === 0
          ? { label: '终态氧分压 O₂', value: `${o2.toFixed(1)} kPa`, status: getO2Status() }
          : levelIndex === 1
            ? { label: '分子筛再生次数', value: `${regenCount} 次`, status: 'info' as MetricStatus }
            : { label: '催化散热 / 再生', value: `${coolCount} / ${regenCount} 次`, status: 'info' as MetricStatus };

      const result: GameResult = {
        levelIndex,
        won,
        stars,
        score,
        summary,
        metrics: [
          {
            label: '绿区稳定保持率',
            value: `${Math.round(greenRatio * 100)}%`,
            status: greenRatio >= 0.76 ? 'nominal' : greenRatio >= 0.5 ? 'caution' : 'critical',
          },
          {
            label: '水资源闭环回收率',
            value: `${closurePct.toFixed(1)}%`,
            status: closurePct >= 84 ? 'nominal' : closurePct >= 70 ? 'caution' : 'critical',
          },
          {
            label: '净水终态余量',
            value: `${Math.round(water)}%`,
            status: getWaterStatus(),
          },
          extraMetric,
        ],
        scienceCard: SCIENCE_CARDS[cardKey] ?? SCIENCE_CARDS['eclss-electrolysis'],
      };

      host.completeLevel(result);
    };

    const spawnPipePacket = (
      pipe: FlowPacket['pipe'],
      rate: number,
      color: string,
      rgb: string,
      radius: number,
      dt: number
    ) => {
      if (rate <= 0.05) return;
      packetSpawnAccum[pipe] += rate * dt;
      if (packetSpawnAccum[pipe] >= 1) {
        packetSpawnAccum[pipe] -= 1;
        if (packets.length < 150) {
          packets.push({
            pipe,
            t: 0,
            speed: 0.42 + clamp(rate * 0.08, 0, 0.5),
            color,
            rgb,
            radius,
          });
        }
      }
    };

    const stepSimulation = (dt: number) => {
      elapsed += dt;
      powerRejectFlash = Math.max(0, powerRejectFlash - dt);
      alarmCooldown = Math.max(0, alarmCooldown - dt);
      coolCooldown = Math.max(0, coolCooldown - dt);

      // Compute crew metabolic multiplier (including scheduled exercise / handover waves)
      let waveMult = 1.0;
      let waveText = '';
      for (const w of cfg.waves) {
        if (elapsed >= w.start && elapsed <= w.end) {
          // Smooth ramp in/out over 1.5s
          const edgeIn = clamp((elapsed - w.start) / 1.5, 0, 1);
          const edgeOut = clamp((w.end - elapsed) / 1.5, 0, 1);
          const blend = Math.min(edgeIn, edgeOut);
          waveMult = lerp(1.0, w.multiplier, blend);
          waveText = w.label;
          break;
        }
      }

      if (waveText && waveText !== activeWaveLabel) {
        pushDebouncedToast(
          `wave-${waveText}`,
          `${waveText}开始！乘组耗氧与 CO₂ 排放飙升至 ${(cfg.baseMetabolism * waveMult).toFixed(1)}×，请提前增配功率。`,
          'caution',
          '乘组代谢峰值',
          5
        );
      }
      activeWaveLabel = waveText;
      currentMetabolism = cfg.baseMetabolism * waveMult;

      // Unit power levels
      const pOgs = getPowerFrac('ogs');
      const pCdra = getPowerFrac('cdra');
      const pSab = getPowerFrac('sabatier');
      const pWrs = getPowerFrac('wrs');

      // 1. CDRA Molecular Sieve Saturation & Regeneration
      if (sieveRegenTimer > 0) {
        sieveRegenTimer = Math.max(0, sieveRegenTimer - dt);
        sieveSat = Math.max(0, sieveSat - dt * 0.55);
        if (sieveRegenTimer === 0) {
          sieveSat = 0;
          host.audio.playBeep(720, 0.08);
        }
      } else if (cfg.sieveSatRate > 0 && pCdra > 0) {
        sieveSat = clamp(sieveSat + cfg.sieveSatRate * (0.45 + 0.75 * pCdra) * (0.7 + 0.3 * waveMult) * dt, 0, 1);
        if (sieveSat >= 0.76) {
          pushDebouncedToast(
            'sieve-warn',
            'CO₂ 分子筛吸附床接近饱和，除碳效率大幅衰减！请点击“滤芯再生”或按 Space 清理。',
            'critical',
            '滤芯饱和告警',
            7.5
          );
        }
      }

      const cdraEff =
        sieveRegenTimer > 0 ? 0.08 : pCdra * (1 - 0.82 * sieveSat * sieveSat);

      // 2. Sabatier Exothermic Catalyst Temperature (Level 3)
      const sabFeedFactor = clamp(Math.min(h2Buffer / 10, co2Buffer / 10), 0, 1);
      if (sabTripTimer > 0) {
        sabTripTimer = Math.max(0, sabTripTimer - dt);
        sabTemp = Math.max(330, sabTemp - 42 * dt);
      } else if (cfg.hasOverheat) {
        const activeSabLoad = pSab * sabFeedFactor;
        // At 100% power heats up (+28°C/s), at 66% gently warms (+3°C/s), at <=33% cools (-24°C/s)
        const targetHeatRate =
          activeSabLoad >= 0.85
            ? 29
            : activeSabLoad >= 0.55
              ? 4.5
              : activeSabLoad >= 0.2
                ? -16
                : -32;
        sabTemp = clamp(sabTemp + targetHeatRate * dt, 310, 555);
        if (sabTemp >= 485) {
          pushDebouncedToast(
            'sab-hot',
            '萨巴蒂尔反应为强放热过程，催化床突破 485°C！请调低档位或按 Space 启动液冷散热。',
            'critical',
            '催化剂过热',
            6.5
          );
        }
        if (sabTemp >= 545) {
          sabTripTimer = 3.2;
          host.audio.playCritical();
          pushDebouncedToast(
            'sab-trip',
            '萨巴蒂尔催化床过热保护停机 3.2 秒！待降温后将自动重投。',
            'critical',
            '过热跳闸',
            4
          );
        }
      } else {
        sabTemp = lerp(sabTemp, 340 + pSab * 85, dt * 1.5);
      }

      const sabEff = sabTripTimer > 0 ? 0 : pSab * sabFeedFactor;

      // 3. OGS Electrolysis (consumes Water -> produces O2 + H2)
      const waterAvail = clamp(water / 6, 0, 1);
      const ogsEff = pOgs * waterAvail;

      // 4. WRS Water Recovery (consumes WasteWater -> produces Pure Water)
      const wasteAvail = clamp(wasteWater / 8, 0, 1);
      const wrsEff = pWrs * wasteAvail;

      // --- Differential Mass/Pressure Updates ---
      // Crew respiration & hydration
      const o2Demand = 0.42 * currentMetabolism; // kPa/s
      const co2Output = 0.052 * currentMetabolism; // kPa/s
      const crewDrinkWater = 0.62 * currentMetabolism; // %/s
      const crewWasteGen = 3.25 * currentMetabolism; // %/s

      // OGS
      const o2Prod = 0.89 * ogsEff;
      const ogsWaterUse = 2.65 * ogsEff;
      const h2Prod = 9.8 * ogsEff;

      // CDRA
      const co2Scrub = 0.118 * cdraEff;
      const co2Capture = 9.5 * cdraEff;

      // Sabatier (CO2 + 4H2 -> CH4 + 2H2O)
      const sabH2Use = 8.4 * sabEff;
      const sabCo2Use = 7.6 * sabEff;
      const sabWaterReturn = 1.92 * sabEff;

      // WRS
      const wrsWasteUse = 4.7 * wrsEff;
      const wrsWaterReturn = 2.55 * wrsEff;

      // Integrate
      o2 = clamp(o2 + (o2Prod - o2Demand) * dt, 14.5, 27.5);
      co2 = clamp(co2 + (co2Output - co2Scrub) * dt, 0.04, 1.05);

      const dWaterOut = (crewDrinkWater + ogsWaterUse) * dt;
      const dWaterIn = (sabWaterReturn + wrsWaterReturn) * dt;
      waterConsumed += dWaterOut;
      waterRecovered += dWaterIn;
      water = clamp(water + dWaterIn - dWaterOut, 0, 100);

      h2Buffer = clamp(h2Buffer + (h2Prod - sabH2Use) * dt, 0, 100);
      co2Buffer = clamp(co2Buffer + (co2Capture - sabCo2Use) * dt, 0, 100);
      wasteWater = clamp(wasteWater + (crewWasteGen - wrsWasteUse) * dt, 0, 100);

      // Update display molar/flow rates for Physics Overlay
      rateO2MolH = ogsEff * 8.4; // mol/h scaled
      rateCo2MolH = cdraEff * 7.2;
      rateSabWaterMolH = sabEff * 6.8;
      rateWrsLH = wrsEff * 1.45;

      // Check green zone & contextual warning toasts
      const inGreen = o2 >= 19.5 && o2 <= 23.5 && co2 <= 0.55 && water >= 24;
      if (inGreen) greenTime += dt;

      const isCrit =
        getO2Status() === 'critical' ||
        getCo2Status() === 'critical' ||
        getWaterStatus() === 'critical';
      dangerPulse = isCrit ? Math.min(1, dangerPulse + dt * 3) : Math.max(0, dangerPulse - dt * 2.5);

      if (isCrit && alarmCooldown <= 0) {
        host.audio.playWarning();
        alarmCooldown = 2.6;
      }

      if (o2 < 18.8) {
        pushDebouncedToast(
          'o2-low',
          '舱内氧分压偏低！调高「电解制氧槽 (OGS)」档位补充氧气。',
          'caution',
          '氧分压偏低',
          8
        );
      } else if (o2 > 23.8) {
        pushDebouncedToast(
          'o2-high',
          '舱内氧分压过高会带来空间站富氧火灾风险，请适当下调「电解制氧槽 (OGS)」！',
          'caution',
          '富氧安全边界',
          8
        );
      }
      if (co2 > 0.55) {
        pushDebouncedToast(
          'co2-high',
          '舱内 CO₂ 浓度逼近 0.60 kPa 安全上限，请提高「CO₂ 分子筛」功率！',
          'caution',
          '二氧化碳超标',
          8
        );
      }
      if (water < 26) {
        pushDebouncedToast(
          'water-low',
          '纯水储箱告急！同时运行「水再生 WRS」与「萨巴蒂尔反应釜」才能实现 >90% 水闭环。',
          'critical',
          '净水储量告警',
          8
        );
      }

      // Spawn animated flow packets along chemical conduits
      spawnPipePacket('w2ogs', ogsEff * 3.8, '#38bdf8', '56, 189, 248', 3.4, dt);
      spawnPipePacket('ogs2hab', ogsEff * 4.2, '#4ade80', '74, 222, 128', 3.6, dt);
      spawnPipePacket('ogs2sab', ogsEff * 3.4, '#fbbf24', '251, 191, 36', 3.0, dt);
      spawnPipePacket('hab2cdra', cdraEff * 4.0, '#fb923c', '251, 146, 60', 3.4, dt);
      spawnPipePacket('cdra2sab', cdraEff * 3.2, '#f97316', '249, 115, 22', 3.1, dt);
      spawnPipePacket('sab2w', sabEff * 4.0, '#22d3ee', '34, 211, 238', 3.8, dt);
      spawnPipePacket('sab2vent', sabEff * 1.9, '#c084fc', '192, 132, 252', 2.4, dt);
      spawnPipePacket('hab2wrs', currentMetabolism * 2.2, '#60a5fa', '96, 165, 250', 2.8, dt);
      spawnPipePacket('wrs2w', wrsEff * 4.2, '#38bdf8', '56, 189, 248', 3.8, dt);

      for (let i = packets.length - 1; i >= 0; i--) {
        packets[i].t += packets[i].speed * dt;
        if (packets[i].t >= 1) packets.splice(i, 1);
      }

      particles.update(dt);
      updateHudMetrics();
      refreshDeckUI();

      // Check fail conditions
      if (o2 <= 16.0) {
        finishMission(false, 'o2_low');
        return;
      }
      if (o2 >= 26.5) {
        finishMission(false, 'o2_high');
        return;
      }
      if (co2 >= 0.92) {
        finishMission(false, 'co2');
        return;
      }
      if (water <= 5.0) {
        finishMission(false, 'water');
        return;
      }

      // Check win condition
      if (elapsed >= cfg.duration) {
        finishMission(true);
      }
    };

    // --- Canvas Rendering ---
    const drawAstronaut = (
      x: number,
      y: number,
      scale: number,
      exercising: boolean,
      phase: number
    ) => {
      const bob = Math.sin(animTime * (exercising ? 9.5 : 2.1) + phase) * (exercising ? 3.2 : 1.8);
      drawFeitianAstronaut3D(ctx, {
        x,
        y: y + bob,
        scale: scale * 0.78,
        facing: 1,
        tilt: exercising ? Math.sin(animTime * 8 + phase) * 0.09 : Math.sin(animTime * 1.5 + phase) * 0.04,
        simTime: animTime,
        thermalMode: exercising ? 'heat' : 'balance',
        suitTemp: exercising ? 25 : 21,
        exercising,
        posePhase: phase,
      });

      if (exercising) {
        ctx.save();
        ctx.translate(x, y + bob);
        ctx.scale(scale, scale);
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.82)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(0, -18, 5 + ((animTime * 12 + phase) % 5), Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
        ctx.restore();
      }
    };

    const drawGlassPipe = (
      p0: [number, number],
      p1: [number, number],
      p2: [number, number],
      p3: [number, number],
      tint: string,
      activeRatio: number
    ) => {
      ctx.save();
      // Outer metallic/quartz glass casing
      ctx.strokeStyle = 'rgba(148, 197, 245, 0.28)';
      ctx.lineWidth = 11.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(p0[0], p0[1]);
      ctx.bezierCurveTo(p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]);
      ctx.stroke();

      // Inner dark channel
      ctx.strokeStyle = 'rgba(5, 12, 26, 0.9)';
      ctx.lineWidth = 7.2;
      ctx.beginPath();
      ctx.moveTo(p0[0], p0[1]);
      ctx.bezierCurveTo(p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]);
      ctx.stroke();

      // Fluid core proportional to flow rate (flat source-over stroke)
      if (activeRatio > 0.04) {
        ctx.save();
        ctx.strokeStyle = tint;
        ctx.globalAlpha = 0.42 + 0.45 * clamp(activeRatio, 0, 1);
        ctx.lineWidth = 4.2;
        ctx.beginPath();
        ctx.moveTo(p0[0], p0[1]);
        ctx.bezierCurveTo(p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]);
        ctx.stroke();
        ctx.restore();
      }

      // Delicate quartz-glass specular highlight ridge
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(p0[0], p0[1] - 2.6);
      ctx.bezierCurveTo(p1[0], p1[1] - 2.6, p2[0], p2[1] - 2.6, p3[0], p3[1] - 2.6);
      ctx.stroke();
      ctx.restore();
    };

    const drawReactorCard = (
      u: UnitConfig,
      x: number,
      y: number,
      w: number,
      h: number,
      extraTag?: { text: string; color: string; pulse?: boolean },
      actionBtn?: { label: string; kind: 'regen' | 'cool'; urgent: boolean },
      liveSubline?: string
    ): HitBox => {
      const notch = notches[u.id];
      const frac = NOTCHES[notch];
      const isHovered = hoverUnit === u.id;
      const isSelected = selectedUnit === u.id;

      ctx.save();
      // Machined titanium card housing (flat fill, zero shadowBlur/clip/gradient)
      ctx.fillStyle = 'rgba(11, 22, 42, 0.96)';
      roundRectPath(ctx, x, y, w, h, 10);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.fillRect(x + 10, y + 1, w - 20, 1.5);

      // Active glow border
      ctx.strokeStyle =
        actionBtn?.urgent
          ? `rgba(239, 68, 68, ${0.65 + 0.35 * Math.sin(animTime * 9)})`
          : isHovered || isSelected
            ? u.accent
            : frac > 0
              ? `${u.accent}99`
              : 'rgba(125, 185, 255, 0.28)';
      ctx.lineWidth = isHovered || actionBtn?.urgent ? 2.2 : 1.4;
      roundRectPath(ctx, x, y, w, h, 10);
      ctx.stroke();

      // Left accent strip
      ctx.fillStyle = frac > 0 ? u.accent : '#475569';
      roundRectPath(ctx, x + 3, y + 8, 4, h - 16, 2);
      ctx.fill();

      // Animated internal reactor visual (right-side micro-chamber)
      const chX = x + w - 42;
      const chY = y + 12;
      const chW = 30;
      const chH = 32;
      ctx.fillStyle = 'rgba(4, 10, 22, 0.92)';
      roundRectPath(ctx, chX, chY, chW, chH, 5);
      ctx.fill();

      if (u.id === 'ogs') {
        // Electrolysis electrodes + rising bubbles
        ctx.fillStyle = '#94a3b8';
        ctx.fillRect(chX + 6, chY + 6, 3, chH - 12);
        ctx.fillRect(chX + chW - 9, chY + 6, 3, chH - 12);
        if (frac > 0) {
          for (let b = 0; b < 5; b++) {
            const prog = (animTime * (0.9 + frac * 1.4) + b * 0.21) % 1;
            const bx = chX + 9 + (b % 2) * 11 + Math.sin(animTime * 5 + b) * 1.5;
            const by = chY + chH - 4 - prog * (chH - 8);
            ctx.fillStyle = b % 2 === 0 ? '#4ade80' : '#fbbf24';
            ctx.beginPath();
            ctx.arc(bx, by, 1.8, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      } else if (u.id === 'cdra') {
        // Zeolite molecular sieve bed fill (shows saturation)
        const fillH = clamp(sieveSat, 0.08, 1) * (chH - 4);
        ctx.fillStyle =
          sieveRegenTimer > 0
            ? '#38bdf8'
            : sieveSat >= 0.72
              ? '#ef4444'
              : sieveSat >= 0.45
                ? '#f59e0b'
                : 'rgba(245, 158, 11, 0.45)';
        ctx.fillRect(chX + 3, chY + chH - 2 - fillH, chW - 6, fillH);
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        for (let r = 1; r < 4; r++) {
          ctx.beginPath();
          ctx.moveTo(chX + 3, chY + (chH * r) / 4);
          ctx.lineTo(chX + chW - 3, chY + (chH * r) / 4);
          ctx.stroke();
        }
      } else if (u.id === 'sabatier') {
        // Exothermic catalytic reactor core
        const cxm = chX + chW * 0.5;
        const cym = chY + chH * 0.5;
        const heatRatio = clamp((sabTemp - 310) / 230, 0, 1);
        const coreCol =
          sabTripTimer > 0
            ? '#ef4444'
            : heatRatio > 0.7
              ? '#f97316'
              : frac > 0
                ? '#c084fc'
                : '#334155';
        const pulse = Math.sin(animTime * 7) * 1.4;
        const rad = 5 + frac * 5 + pulse * 0.7;
        ctx.fillStyle = coreCol;
        ctx.globalAlpha = 0.45 + frac * 0.5;
        ctx.beginPath();
        ctx.arc(cxm, cym, rad, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(cxm, cym, 3.2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // WRS rotary distillation drum
        const cxm = chX + chW * 0.5;
        const cym = chY + chH * 0.5;
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        const rot = animTime * (frac * 5.5 + 0.3);
        ctx.beginPath();
        ctx.arc(cxm, cym, 9, rot, rot + Math.PI * 1.35);
        ctx.stroke();
        ctx.fillStyle = 'rgba(56, 189, 248, 0.42)';
        ctx.beginPath();
        ctx.arc(cxm, cym, 5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Crisp flange frame over reactor micro-chamber
      ctx.strokeStyle = 'rgba(125, 211, 252, 0.35)';
      ctx.lineWidth = 1;
      roundRectPath(ctx, chX, chY, chW, chH, 5);
      ctx.stroke();
      const mli = getMLIPattern(ctx);
      if (u.id === 'sabatier' && mli) {
        ctx.fillStyle = mli;
        ctx.fillRect(chX + 3, chY - 3, chW - 6, 3);
      }

      // Header text
      ctx.fillStyle = '#edf4ff';
      ctx.font = '700 13px "Noto Sans SC", system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(u.name, x + 13, y + 22);

      const kwNow = Math.round(u.maxKw * frac);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '600 10.5px "JetBrains Mono", monospace';
      ctx.fillText(`${u.enCode} · ${kwNow}kW [${u.keyUp}/${u.keyDown}]`, x + 13, y + 37);

      if (liveSubline) {
        ctx.fillStyle = extraTag ? extraTag.color : '#a6c0e0';
        ctx.font = '600 10.5px "JetBrains Mono", monospace';
        ctx.fillText(liveSubline, x + 13, y + 52);
      }

      // 3-segment tactile power notch bar + clickable - / + buttons
      const barY = y + h - 25;
      const btnR = 11;
      const minusX = x + 22;
      const plusX = x + w - 22;
      const barLeft = minusX + 16;
      const barRight = plusX - 16;
      const segW = (barRight - barLeft - 8) / 3;

      // Minus circle button
      ctx.fillStyle = notch > 0 ? 'rgba(30, 58, 102, 0.92)' : 'rgba(15, 23, 42, 0.6)';
      ctx.beginPath();
      ctx.arc(minusX, barY + 6, btnR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(148, 185, 235, 0.45)';
      ctx.lineWidth = 1.1;
      ctx.stroke();
      ctx.fillStyle = notch > 0 ? '#edf4ff' : '#475569';
      ctx.font = '800 14px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('−', minusX, barY + 10.5);

      // Plus circle button
      ctx.fillStyle = notch < 3 ? 'rgba(30, 58, 102, 0.92)' : 'rgba(15, 23, 42, 0.6)';
      ctx.beginPath();
      ctx.arc(plusX, barY + 6, btnR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = notch < 3 ? u.accent : 'rgba(148, 185, 235, 0.35)';
      ctx.stroke();
      ctx.fillStyle = notch < 3 ? '#edf4ff' : '#475569';
      ctx.fillText('+', plusX, barY + 10.5);

      // 3 power segments
      for (let s = 0; s < 3; s++) {
        const sx = barLeft + s * (segW + 4);
        ctx.fillStyle = s < notch ? u.accent : 'rgba(148, 185, 235, 0.14)';
        roundRectPath(ctx, sx, barY + 1, segW, 10, 3);
        ctx.fill();
      }

      // Percentage readout above center of bar
      ctx.fillStyle = frac > 0 ? '#edf4ff' : '#64748b';
      ctx.font = '700 10.5px "JetBrains Mono", monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`${Math.round(frac * 100)}%`, x + w - 12, y + 54);

      // Optional floating maintenance button (Regen / Cool)
      let actionRect: HitBox['actionRect'];
      if (actionBtn) {
        const aw = w - 20;
        const ah = 24;
        const ax = x + 10;
        const ay = y - ah - 6;
        const pulseA = actionBtn.urgent ? 0.72 + 0.28 * Math.sin(animTime * 10) : 0.9;
        ctx.fillStyle = actionBtn.urgent
          ? `rgba(220, 38, 38, ${pulseA})`
          : 'rgba(217, 119, 6, 0.88)';
        roundRectPath(ctx, ax, ay, aw, ah, 6);
        ctx.fill();
        ctx.strokeStyle = '#fef3c7';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.font = '700 11px "Noto Sans SC", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(actionBtn.label, ax + aw * 0.5, ay + 16);
        actionRect = { x: ax, y: ay, w: aw, h: ah, kind: actionBtn.kind };
      }

      ctx.restore();
      return {
        unit: u.id,
        x,
        y,
        w,
        h,
        minusX,
        minusY: barY + 6,
        plusX,
        plusY: barY + 6,
        btnR: btnR + 4,
        actionRect,
      };
    };

    const render = () => {
      const { width: w, height: h } = canvasHandle.getSize();

      // Baked Opaque Tiangong lab bulkhead backdrop (1 integer drawImage when cached)
      if (!drawBakedBackdrop(ctx, 'lab-interior', w, h, 0.24, 0.34)) {
        starfield.draw(ctx, w, h, animTime, -animTime * 2, 0);
      }

      // Safe Play Area calculation (clear of top-left/right HUD & bottom tactile deck even at 1366x768)
      const compact = h <= 720;
      const safeTop = compact ? Math.max(104, h * 0.16) : Math.max(142, h * 0.195);
      const safeBot = Math.min(h - (compact ? 82 : 118), h * 0.87);
      const safeH = Math.max(245, safeBot - safeTop);
      const cx = w * 0.5;
      const panelW = clamp(w * 0.86, 580, 960);
      const panelX = cx - panelW * 0.5;

      // Cutaway Core Module Hull Container (flat fill, no gradient/clip)
      ctx.save();
      ctx.fillStyle = 'rgba(10, 20, 40, 0.92)';
      roundRectPath(ctx, panelX, safeTop, panelW, safeH, 16);
      ctx.fill();
      ctx.strokeStyle = 'rgba(2, 6, 16, 0.65)';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Engineering schematic grid inside hull
      ctx.strokeStyle = 'rgba(125, 185, 255, 0.055)';
      ctx.lineWidth = 1;
      for (let gx = panelX + 36; gx < panelX + panelW - 10; gx += 36) {
        ctx.beginPath();
        ctx.moveTo(gx, safeTop + 10);
        ctx.lineTo(gx, safeBot - 10);
        ctx.stroke();
      }
      for (let gy = safeTop + 32; gy < safeBot - 10; gy += 32) {
        ctx.beginPath();
        ctx.moveTo(panelX + 10, gy);
        ctx.lineTo(panelX + panelW - 10, gy);
        ctx.stroke();
      }

      // Inner recessed bulkhead channel line
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.09)';
      ctx.lineWidth = 1;
      roundRectPath(ctx, panelX + 4, safeTop + 4, panelW - 8, safeH - 8, 13);
      ctx.stroke();

      // Outer anodized bezel border
      ctx.strokeStyle =
        dangerPulse > 0.1
          ? `rgba(239, 68, 68, ${0.42 + 0.48 * dangerPulse * Math.abs(Math.sin(animTime * 8))})`
          : 'rgba(148, 197, 255, 0.42)';
      ctx.lineWidth = dangerPulse > 0.1 ? 2.4 : 1.6;
      roundRectPath(ctx, panelX, safeTop, panelW, safeH, 16);
      ctx.stroke();

      // Precision metallic corner & flange bolts (flat circles, zero radial gradients)
      const boltCoords: [number, number][] = [
        [panelX + 13, safeTop + 13],
        [panelX + panelW - 13, safeTop + 13],
        [panelX + 13, safeBot - 13],
        [panelX + panelW - 13, safeBot - 13],
        [panelX + 13, safeTop + safeH * 0.5],
        [panelX + panelW - 13, safeTop + safeH * 0.5],
      ];
      for (const [bx, by] of boltCoords) {
        ctx.fillStyle = '#64748b';
        ctx.beginPath();
        ctx.arc(bx, by, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(15, 23, 42, 0.75)';
        ctx.lineWidth = 0.9;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(bx - 2, by);
        ctx.lineTo(bx + 2, by);
        ctx.stroke();
      }
      ctx.restore();

      // Compute key node coordinates inside cutaway hull
      const cardW = clamp(panelW * 0.235, 164, 210);
      const cardH = clamp(safeH * 0.255, 86, 102);

      // Top Center: Crew Habitat Bay
      const habW = clamp(panelW * 0.34, 240, 320);
      const habH = clamp(safeH * 0.235, 78, 96);
      const habX = cx - habW * 0.5;
      const habY = safeTop + 14;

      // Dead Center: Pure Water Reserve Tank
      const tankW = clamp(panelW * 0.175, 120, 152);
      const tankH = clamp(safeH * 0.31, 104, 134);
      const tankX = cx - tankW * 0.5;
      const tankY = safeTop + safeH * 0.47 - tankH * 0.42;

      // Four interactive reactor cards
      const leftX = panelX + clamp(panelW * 0.032, 16, 34);
      const rightX = panelX + panelW - clamp(panelW * 0.032, 16, 34) - cardW;
      const upperY = safeTop + safeH * 0.25;
      const lowerY = safeBot - cardH - 36;

      // Define curved chemical conduit paths
      const pipeCurves: Record<
        FlowPacket['pipe'],
        [[number, number], [number, number], [number, number], [number, number]]
      > = {
        // Pure Water Tank (left side) -> OGS (right side)
        w2ogs: [
          [tankX, tankY + tankH * 0.38],
          [tankX - 42, tankY + tankH * 0.38],
          [leftX + cardW + 38, upperY + cardH * 0.5],
          [leftX + cardW, upperY + cardH * 0.5],
        ],
        // OGS (top) -> Crew Habitat (left)
        ogs2hab: [
          [leftX + cardW * 0.5, upperY],
          [leftX + cardW * 0.5, habY + habH * 0.42],
          [habX - 36, habY + habH * 0.42],
          [habX, habY + habH * 0.42],
        ],
        // OGS (bottom) -> Sabatier (top) [H2]
        ogs2sab: [
          [leftX + cardW * 0.35, upperY + cardH],
          [leftX + cardW * 0.35, (upperY + cardH + lowerY) * 0.5],
          [leftX + cardW * 0.35, (upperY + cardH + lowerY) * 0.5],
          [leftX + cardW * 0.35, lowerY],
        ],
        // Crew Habitat (right) -> CDRA (top) [CO2]
        hab2cdra: [
          [habX + habW, habY + habH * 0.38],
          [rightX + cardW * 0.5, habY + habH * 0.38],
          [rightX + cardW * 0.5, upperY - 24],
          [rightX + cardW * 0.5, upperY],
        ],
        // CDRA (left-bottom) -> Sabatier (top-right) [Captured CO2 cross conduit]
        cdra2sab: [
          [rightX, upperY + cardH * 0.72],
          [cx + 68, tankY + tankH + 22],
          [cx - 68, tankY + tankH + 22],
          [leftX + cardW, lowerY + cardH * 0.26],
        ],
        // Sabatier (right) -> Pure Water Tank (bottom-left) [Synthesized 2H2O]
        sab2w: [
          [leftX + cardW, lowerY + cardH * 0.62],
          [cx - tankW * 0.8, lowerY + cardH * 0.62],
          [tankX + tankW * 0.25, tankY + tankH + 26],
          [tankX + tankW * 0.25, tankY + tankH],
        ],
        // Sabatier (left) -> CH4 harmless space vent
        sab2vent: [
          [leftX, lowerY + cardH * 0.5],
          [leftX - 18, lowerY + cardH * 0.5],
          [panelX + 4, lowerY + cardH * 0.6],
          [panelX - 10, lowerY + cardH * 0.68],
        ],
        // Crew Habitat (right-bottom) -> WRS (top-right) [Humidity/Wastewater]
        hab2wrs: [
          [habX + habW, habY + habH * 0.78],
          [rightX + cardW * 0.86, habY + habH * 0.78],
          [rightX + cardW * 0.86, lowerY - 28],
          [rightX + cardW * 0.86, lowerY],
        ],
        // WRS (left) -> Pure Water Tank (bottom-right) [Recycled H2O]
        wrs2w: [
          [rightX, lowerY + cardH * 0.55],
          [cx + tankW * 0.8, lowerY + cardH * 0.55],
          [tankX + tankW * 0.75, tankY + tankH + 26],
          [tankX + tankW * 0.75, tankY + tankH],
        ],
      };

      const pOgs = getPowerFrac('ogs');
      const pCdra = getPowerFrac('cdra');
      const pSab = getPowerFrac('sabatier');
      const pWrs = getPowerFrac('wrs');

      // Draw all glass pipes first (underneath units)
      drawGlassPipe(...pipeCurves.w2ogs, '#38bdf8', pOgs);
      drawGlassPipe(...pipeCurves.ogs2hab, '#22c55e', pOgs);
      drawGlassPipe(...pipeCurves.ogs2sab, '#f59e0b', pOgs);
      drawGlassPipe(...pipeCurves.hab2cdra, '#fb923c', pCdra);
      drawGlassPipe(...pipeCurves.cdra2sab, '#f97316', pCdra * 0.7 + pSab * 0.3);
      drawGlassPipe(...pipeCurves.sab2w, '#22d3ee', pSab);
      drawGlassPipe(...pipeCurves.sab2vent, '#a855f7', pSab * 0.7);
      drawGlassPipe(...pipeCurves.hab2wrs, '#60a5fa', 0.55);
      drawGlassPipe(...pipeCurves.wrs2w, '#38bdf8', pWrs);

      // Draw animated fluid/gas packets flowing through glass pipes (crisp flat dots)
      for (const pk of packets) {
        const pts = pipeCurves[pk.pipe];
        const [px, py] = evalCubic(pts[0], pts[1], pts[2], pts[3], pk.t);
        ctx.fillStyle = pk.color;
        ctx.beginPath();
        ctx.arc(px, py, pk.radius + 0.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
        ctx.beginPath();
        ctx.arc(px, py, pk.radius * 0.46, 0, Math.PI * 2);
        ctx.fill();
      }

      // --- Crew Habitat Bay (Top Center) ---
      ctx.save();
      const habStatus: MetricStatus =
        getO2Status() === 'critical' || getCo2Status() === 'critical'
          ? 'critical'
          : getO2Status() === 'caution' || getCo2Status() === 'caution'
            ? 'caution'
            : 'nominal';
      const habGlow =
        habStatus === 'critical'
          ? 'rgba(239, 68, 68, 0.22)'
          : habStatus === 'caution'
            ? 'rgba(245, 158, 11, 0.18)'
            : 'rgba(34, 197, 94, 0.14)';
      const habBorder =
        habStatus === 'critical'
          ? '#ef4444'
          : habStatus === 'caution'
            ? '#f59e0b'
            : '#22c55e';

      ctx.fillStyle = 'rgba(10, 24, 46, 0.95)';
      roundRectPath(ctx, habX, habY, habW, habH, 14);
      ctx.fill();

      // Atmospheric interior tint
      ctx.fillStyle = habGlow;
      roundRectPath(ctx, habX + 3, habY + 3, habW - 6, habH - 6, 11);
      ctx.fill();

      // Habitat header
      ctx.fillStyle = '#edf4ff';
      ctx.font = '700 12.5px "Noto Sans SC", system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(
        `乘员生活舱 (${cfg.crewCount}人)`,
        habX + 12,
        habY + 19
      );

      ctx.fillStyle = activeWaveLabel ? '#fbbf24' : '#86efac';
      ctx.font = '700 10.5px "JetBrains Mono", monospace';
      ctx.textAlign = 'right';
      ctx.fillText(
        activeWaveLabel
          ? `[高负荷] ${activeWaveLabel} (${currentMetabolism.toFixed(1)}×)`
          : `代谢负荷 ${currentMetabolism.toFixed(1)}×`,
        habX + habW - 12,
        habY + 19
      );

      // Animated Astronauts inside Habitat
      const astroScale = cfg.crewCount > 3 ? 0.74 : 0.92;
      const astroSpacing = habW / (cfg.crewCount + 1);
      for (let i = 0; i < cfg.crewCount; i++) {
        drawAstronaut(
          habX + astroSpacing * (i + 1),
          habY + habH * 0.56,
          astroScale,
          Boolean(activeWaveLabel),
          i * 1.35
        );
      }

      // Live atmospheric vitals strip at bottom of habitat
      ctx.fillStyle = 'rgba(4, 10, 22, 0.68)';
      roundRectPath(ctx, habX + 10, habY + habH - 20, habW - 20, 15, 4);
      ctx.fill();
      ctx.font = '700 10px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = getO2Status() === 'nominal' ? '#86efac' : getO2Status() === 'caution' ? '#fbbf24' : '#fca5a5';
      ctx.fillText(`O₂ ${o2.toFixed(1)} kPa`, habX + 18, habY + habH - 9);
      ctx.textAlign = 'right';
      ctx.fillStyle = getCo2Status() === 'nominal' ? '#7dd3fc' : getCo2Status() === 'caution' ? '#fbbf24' : '#fca5a5';
      ctx.fillText(`CO₂ ${co2.toFixed(2)} kPa`, habX + habW - 18, habY + habH - 9);

      ctx.strokeStyle = habBorder;
      ctx.lineWidth = 1.8;
      roundRectPath(ctx, habX, habY, habW, habH, 14);
      ctx.stroke();
      ctx.restore();

      // --- Pure Water Reserve Tank (Dead Center) ---
      ctx.save();
      ctx.fillStyle = 'rgba(7, 17, 34, 0.94)';
      roundRectPath(ctx, tankX, tankY, tankW, tankH, 14);
      ctx.fill();

      // Sloshing cyan water fill
      ctx.save();
      roundRectPath(ctx, tankX + 4, tankY + 4, tankW - 8, tankH - 8, 10);
      ctx.clip();
      const fillRatio = clamp(water / 100, 0, 1);
      const waterTopY = tankY + tankH - 4 - fillRatio * (tankH - 12);
      ctx.fillStyle = water < 20 ? 'rgba(220, 38, 38, 0.78)' : 'rgba(14, 165, 233, 0.78)';
      ctx.beginPath();
      ctx.moveTo(tankX, tankY + tankH);
      for (let sx = tankX; sx <= tankX + tankW; sx += 8) {
        const wave = Math.sin(animTime * 3.4 + sx * 0.08) * 2.5;
        ctx.lineTo(sx, waterTopY + wave);
      }
      ctx.lineTo(tankX + tankW, tankY + tankH);
      ctx.closePath();
      ctx.fill();

      // Water meniscus surface crest
      ctx.strokeStyle = water < 20 ? 'rgba(254, 202, 202, 0.8)' : 'rgba(224, 242, 254, 0.85)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let sx = tankX + 4; sx <= tankX + tankW - 4; sx += 8) {
        const wave = Math.sin(animTime * 3.4 + sx * 0.08) * 2.5;
        if (sx === tankX + 4) ctx.moveTo(sx, waterTopY + wave);
        else ctx.lineTo(sx, waterTopY + wave);
      }
      ctx.stroke();

      // 20% critical threshold tick line
      const critLineY = tankY + tankH - 4 - 0.2 * (tankH - 12);
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.78)';
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(tankX + 6, critLineY);
      ctx.lineTo(tankX + tankW - 6, critLineY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // Tank outer pressurized bezel
      ctx.strokeStyle = water < 20 ? '#ef4444' : water < 34 ? '#f59e0b' : '#38bdf8';
      ctx.lineWidth = 1.8;
      roundRectPath(ctx, tankX, tankY, tankW, tankH, 14);
      ctx.stroke();

      // Tank text
      ctx.fillStyle = '#e0f2fe';
      ctx.font = '700 11.5px "Noto Sans SC", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('纯水储箱 H₂O', cx, tankY + 20);

      ctx.fillStyle = '#ffffff';
      ctx.font = '800 22px "JetBrains Mono", monospace';
      ctx.fillText(`${Math.round(water)}%`, cx, tankY + tankH * 0.56);

      const closureNow = clamp((waterRecovered / Math.max(0.01, waterConsumed)) * 100, 0, 99.6);
      ctx.fillStyle = closureNow >= 85 ? '#86efac' : '#fde68a';
      ctx.font = '700 10px "JetBrains Mono", monospace';
      ctx.fillText(`闭环率 ${closureNow.toFixed(0)}%`, cx, tankY + tankH - 12);
      ctx.restore();

      // --- 4 Interactive Reactor Stations ---
      hitBoxes = [];
      hitBoxes.push(
        drawReactorCard(
          UNITS[0],
          leftX,
          upperY,
          cardW,
          cardH,
          undefined,
          undefined,
          `产氧 +${(0.89 * pOgs).toFixed(2)} | H₂ ${Math.round(h2Buffer)}%`
        )
      );

      const needRegen = cfg.sieveSatRate > 0 && sieveSat >= 0.42 && sieveRegenTimer <= 0;
      hitBoxes.push(
        drawReactorCard(
          UNITS[1],
          rightX,
          upperY,
          cardW,
          cardH,
          sieveSat >= 0.72
            ? { text: '饱和', color: '#fca5a5' }
            : undefined,
          needRegen
            ? {
                label: `[再生] 点击再生分子筛 (${Math.round(sieveSat * 100)}%)`,
                kind: 'regen',
                urgent: sieveSat >= 0.7,
              }
            : undefined,
          cfg.sieveSatRate > 0
            ? sieveRegenTimer > 0
              ? `滤芯再生中 ${sieveRegenTimer.toFixed(1)}s`
              : `饱和度 ${Math.round(sieveSat * 100)}% | 存碳 ${Math.round(co2Buffer)}%`
            : `除碳效率 100% | 存碳 ${Math.round(co2Buffer)}%`
        )
      );

      const needCool = cfg.hasOverheat && sabTemp >= 440 && coolCooldown <= 0;
      hitBoxes.push(
        drawReactorCard(
          UNITS[2],
          leftX,
          lowerY,
          cardW,
          cardH,
          sabTemp >= 485 ? { text: '高温', color: '#fca5a5' } : undefined,
          needCool
            ? {
                label: `[散热] 催化床散热 (${Math.round(sabTemp)}°C)`,
                kind: 'cool',
                urgent: sabTemp >= 485,
              }
            : undefined,
          sabTripTimer > 0
            ? `过热停机 ${sabTripTimer.toFixed(1)}s`
            : `床温 ${Math.round(sabTemp)}°C | 原料 ${Math.round(Math.min(h2Buffer, co2Buffer))}%`
        )
      );

      hitBoxes.push(
        drawReactorCard(
          UNITS[3],
          rightX,
          lowerY,
          cardW,
          cardH,
          undefined,
          undefined,
          `废水池 ${Math.round(wasteWater)}% → 净水`
        )
      );

      // --- Bottom Progress / Power Bus Status Bar inside Cutaway ---
      const barW = clamp(panelW * 0.56, 300, 520);
      const barH = 18;
      const barX = cx - barW * 0.5;
      const barY = safeBot - 24;

      ctx.save();
      ctx.fillStyle = 'rgba(7, 15, 29, 0.88)';
      roundRectPath(ctx, barX, barY, barW, barH, 6);
      ctx.fill();
      ctx.strokeStyle = powerRejectFlash > 0 ? '#ef4444' : 'rgba(125, 185, 255, 0.25)';
      ctx.lineWidth = powerRejectFlash > 0 ? 1.8 : 1;
      ctx.stroke();

      if (cfg.hasPowerCap) {
        // Split bar: Left half Power Bus, Right half Mission Progress
        const halfW = barW * 0.48;
        const kw = getTotalKw();
        const kwRatio = clamp(kw / cfg.powerCapKw, 0, 1);
        ctx.fillStyle = kw >= 96 ? '#f59e0b' : '#38bdf8';
        roundRectPath(ctx, barX + 2, barY + 2, (halfW - 4) * kwRatio, barH - 4, 4);
        ctx.fill();
        ctx.fillStyle = '#f8fafc';
        ctx.font = '700 10px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`母线功率 ${kw}/${cfg.powerCapKw} kW`, barX + halfW * 0.5, barY + 12.5);

        const rx = barX + halfW + 8;
        const rw = barW - halfW - 10;
        ctx.fillStyle = 'rgba(34, 197, 94, 0.52)';
        roundRectPath(ctx, rx, barY + 2, rw * clamp(elapsed / cfg.duration, 0, 1), barH - 4, 4);
        ctx.fill();
        ctx.fillStyle = '#e2e8f0';
        ctx.fillText(
          `任务进度 ${Math.round((elapsed / cfg.duration) * 100)}%`,
          rx + rw * 0.5,
          barY + 12.5
        );
      } else {
        // Mission timeline with scheduled exercise wave markers!
        for (const wv of cfg.waves) {
          const wx1 = barX + 2 + (wv.start / cfg.duration) * (barW - 4);
          const wx2 = barX + 2 + (wv.end / cfg.duration) * (barW - 4);
          ctx.fillStyle = 'rgba(245, 158, 11, 0.35)';
          ctx.fillRect(wx1, barY + 2, wx2 - wx1, barH - 4);
        }
        ctx.fillStyle = 'rgba(34, 197, 94, 0.52)';
        roundRectPath(ctx, barX + 2, barY + 2, (barW - 4) * clamp(elapsed / cfg.duration, 0, 1), barH - 4, 4);
        ctx.fill();

        ctx.fillStyle = '#f8fafc';
        ctx.font = '700 10px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(
          cfg.waves.length > 0
            ? `任务进度 ${Math.round((elapsed / cfg.duration) * 100)}%（琥珀色段 = 太空健身代谢峰值）`
            : `任务进度 ${Math.round((elapsed / cfg.duration) * 100)}% · 绿区稳定率 ${Math.round((greenTime / Math.max(0.1, elapsed)) * 100)}%`,
          cx,
          barY + 12.5
        );
      }
      ctx.restore();

      // --- Physics / Chemistry Overlay (`V`) ---
      if (physicsOverlay) {
        ctx.save();
        const drawFormulaBadge = (
          bx: number,
          by: number,
          line1: string,
          line2: string,
          color: string
        ) => {
          ctx.font = '700 10.5px "JetBrains Mono", monospace';
          const tw = Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width) + 16;
          const th = 30;
          ctx.fillStyle = 'rgba(4, 11, 24, 0.9)';
          roundRectPath(ctx, bx - tw * 0.5, by - th * 0.5, tw, th, 6);
          ctx.fill();
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.1;
          ctx.stroke();
          ctx.fillStyle = color;
          ctx.textAlign = 'center';
          ctx.fillText(line1, bx, by - 2);
          ctx.fillStyle = '#cbd5e1';
          ctx.font = '600 9.5px "JetBrains Mono", monospace';
          ctx.fillText(line2, bx, by + 10);
        };

        const midAlleyY = (upperY + cardH + lowerY) * 0.5;
        const leftMidX = clamp((leftX + cardW + tankX) * 0.5, leftX + 76, tankX - 74);
        const rightMidX = clamp((tankX + tankW + rightX) * 0.5, tankX + tankW + 74, rightX + cardW - 76);

        drawFormulaBadge(
          (leftX + habX) * 0.5,
          habY + 26,
          '2H₂O → 2H₂ + O₂',
          `O₂ +${rateO2MolH.toFixed(1)} mol/h`,
          '#4ade80'
        );

        drawFormulaBadge(
          (habX + habW + rightX + cardW) * 0.5,
          habY + 26,
          'CO₂ 分子筛吸附',
          `-${rateCo2MolH.toFixed(1)} mol/h`,
          '#fbbf24'
        );

        drawFormulaBadge(
          leftMidX,
          midAlleyY - 6,
          'CO₂ + 4H₂ → CH₄ + 2H₂O',
          `合成水 +${rateSabWaterMolH.toFixed(1)} mol/h`,
          '#c084fc'
        );

        drawFormulaBadge(
          rightMidX,
          midAlleyY - 6,
          '冷凝 + 尿液蒸馏',
          `回水 +${rateWrsLH.toFixed(2)} L/h`,
          '#38bdf8'
        );

        // Vector flow arrows showing closed-loop direction
        drawVectorArrow(
          ctx,
          leftX + cardW * 0.5,
          upperY - 6,
          leftX + cardW * 0.5,
          upperY - 30,
          '#4ade80',
          'O₂'
        );
        drawVectorArrow(
          ctx,
          rightX + cardW * 0.5,
          upperY - 30,
          rightX + cardW * 0.5,
          upperY - 6,
          '#fb923c',
          'CO₂'
        );
        drawVectorArrow(
          ctx,
          leftX + cardW * 0.35,
          upperY + cardH + 6,
          leftX + cardW * 0.35,
          upperY + cardH + 28,
          '#fbbf24',
          '4H₂'
        );
        ctx.restore();
      }

      particles.draw(ctx);
    };

    // --- Canvas Pointer Interaction ---
    const getCanvasCoords = (e: PointerEvent | MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const handlePointerMove = (e: PointerEvent) => {
      const { x, y } = getCanvasCoords(e);
      let found: UnitId | null = null;
      let overClickable = false;
      for (const box of hitBoxes) {
        if (
          box.actionRect &&
          x >= box.actionRect.x &&
          x <= box.actionRect.x + box.actionRect.w &&
          y >= box.actionRect.y &&
          y <= box.actionRect.y + box.actionRect.h
        ) {
          overClickable = true;
          found = box.unit;
          break;
        }
        if (x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h) {
          found = box.unit;
          overClickable = true;
          break;
        }
      }
      hoverUnit = found;
      canvas.style.cursor = overClickable ? 'pointer' : 'default';
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (paused || completed) return;
      const { x, y } = getCanvasCoords(e);
      for (const box of hitBoxes) {
        if (
          box.actionRect &&
          x >= box.actionRect.x &&
          x <= box.actionRect.x + box.actionRect.w &&
          y >= box.actionRect.y &&
          y <= box.actionRect.y + box.actionRect.h
        ) {
          if (box.actionRect.kind === 'regen') triggerSieveRegen();
          else triggerCatalystCool();
          return;
        }
        if (Math.hypot(x - box.minusX, y - box.minusY) <= box.btnR) {
          setUnitNotch(box.unit, notches[box.unit] - 1);
          return;
        }
        if (Math.hypot(x - box.plusX, y - box.plusY) <= box.btnR) {
          setUnitNotch(box.unit, notches[box.unit] + 1);
          return;
        }
        if (x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h) {
          // Right click steps down; left click cycles 0 -> 33 -> 66 -> 100 -> 0
          if (e.button === 2) {
            setUnitNotch(box.unit, notches[box.unit] - 1);
          } else {
            const next = (notches[box.unit] + 1) % NOTCHES.length;
            if (!setUnitNotch(box.unit, next) && notches[box.unit] > 0) {
              // If power cap blocked increasing, allow cycling down to 0 cleanly on second thought? Keep explicit minus/click
            }
          }
          return;
        }
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    // Keyboard controls (strictly avoiding 1-8, Tab, Esc, V, R, M, F, ?)
    const handleKeyDown = (e: KeyboardEvent) => {
      if (paused || completed) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const k = e.key.toLowerCase();
      if (k === 'q') {
        e.preventDefault();
        setUnitNotch('ogs', notches.ogs + 1);
      } else if (k === 'a') {
        e.preventDefault();
        setUnitNotch('ogs', notches.ogs - 1);
      } else if (k === 'w') {
        e.preventDefault();
        setUnitNotch('cdra', notches.cdra + 1);
      } else if (k === 's') {
        e.preventDefault();
        setUnitNotch('cdra', notches.cdra - 1);
      } else if (k === 'e') {
        e.preventDefault();
        setUnitNotch('sabatier', notches.sabatier + 1);
      } else if (k === 'd') {
        e.preventDefault();
        setUnitNotch('sabatier', notches.sabatier - 1);
      } else if (k === 't' || k === 'z') {
        e.preventDefault();
        setUnitNotch('wrs', notches.wrs + 1);
      } else if (k === 'g' || k === 'x') {
        e.preventDefault();
        setUnitNotch('wrs', notches.wrs - 1);
      } else if (e.code === 'Space') {
        e.preventDefault();
        // Prioritize whichever maintenance action is most urgent
        if (cfg.hasOverheat && sabTemp >= 445 && coolCooldown <= 0) {
          triggerCatalystCool();
        } else if (cfg.sieveSatRate > 0 && sieveSat >= 0.25 && sieveRegenTimer <= 0) {
          triggerSieveRegen();
        } else if (cfg.hasOverheat && coolCooldown <= 0) {
          triggerCatalystCool();
        }
      }
    };

    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('keydown', handleKeyDown);

    resetLevel(levelIndex);

    const loop = (ts: number) => {
      if (destroyed) return;
      const dt = clamp((ts - lastTs) / 1000, 0, 0.05);
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
        canvas.removeEventListener('pointermove', handlePointerMove);
        canvas.removeEventListener('pointerdown', handlePointerDown);
        canvas.removeEventListener('contextmenu', handleContextMenu);
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
