import {
  clamp,
  dist,
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
} from '../../core/game-interface';

interface StemNode {
  xNorm: number; // 0..1 inside cabinet width
  yNorm: number; // 0 (root tray) .. 1 (top growth ceiling)
  growthAt: number; // 0..1
  leafSeed: number;
}

interface WaterGlobule {
  id: number;
  xNorm: number;
  yNorm: number; // 0 (tray) .. 1 (top rail)
  vx: number;
  vy: number;
  radius: number;
  phase: number;
  age: number;
  capturing: boolean;
}

interface StageSpec {
  name: string;
  minGrowth: number;
  idealRedMin: number;
  idealRedMax: number;
  spectrumHint: string;
}

const WHEAT_STAGES: StageSpec[] = [
  {
    name: '萌发',
    minGrowth: 0,
    idealRedMin: 0.12,
    idealRedMax: 0.44,
    spectrumHint: '蓝光主导 (450nm) 促萌发壮茎',
  },
  {
    name: '拔节',
    minGrowth: 0.25,
    idealRedMin: 0.18,
    idealRedMax: 0.48,
    spectrumHint: '蓝光偏高 (450nm) 防止徒长',
  },
  {
    name: '抽穗开花',
    minGrowth: 0.55,
    idealRedMin: 0.58,
    idealRedMax: 0.92,
    spectrumHint: '切换红光主导 (660nm) 促抽穗开花',
  },
  {
    name: '成熟结籽',
    minGrowth: 0.80,
    idealRedMin: 0.62,
    idealRedMax: 0.96,
    spectrumHint: '红光主导 (660nm) 加速灌浆结籽',
  },
];

const ARABIDOPSIS_STAGES: StageSpec[] = [
  {
    name: '萌发',
    minGrowth: 0,
    idealRedMin: 0.18,
    idealRedMax: 0.62,
    spectrumHint: '蓝红均衡光谱 促定向萌发',
  },
  {
    name: '抽薹',
    minGrowth: 0.35,
    idealRedMin: 0.25,
    idealRedMax: 0.68,
    spectrumHint: '移动灯架利用向光性引导茎尖',
  },
  {
    name: '现蕾开花',
    minGrowth: 0.70,
    idealRedMin: 0.42,
    idealRedMax: 0.85,
    spectrumHint: '适量红光促拟南芥白花盛放',
  },
];

interface CabinetRect {
  x: number;
  y: number;
  w: number;
  h: number;
  innerX: number;
  innerY: number;
  innerW: number;
  innerH: number;
  railY: number;
  trayY: number;
  trayH: number;
}

const META: GameMeta = {
  id: 'botany',
  number: '07',
  shortTitle: '太空植物',
  title: '微重力太空植物工坊',
  enTitle: 'MICROGRAVITY BOTANY',
  moduleName: '问天生物生态柜',
  genre: '微生态策略培育',
  tagline: '调控红蓝LED光谱、毛细滴灌与强制气流，完成太空从种子到种子培育',
  accent: '#4ade80',
  hubAnchor: { x: 0.27, y: 0.52 },
  briefingSteps: [
    {
      title: '向光性定向 + 红蓝光谱',
      desc: '失重下植物失去重力方向感，移动顶部 LED 灯架以向光性引导茎尖生长；营养期偏蓝光(450nm)，开花结籽期切红光(660nm)。',
    },
    {
      title: '多孔基质毛细微量滴灌',
      desc: '将根部湿度保持在 45%–75% 绿区。切忌短时间狂按滴灌，否则表面张力会形成失重漂浮水球并闷坏根系；点击水球可抽吸回收。',
    },
    {
      title: '强制循环风机破除气膜',
      desc: '微重力没有自然对流，叶片周围易形成缺 CO₂ 的灰白静止边界层；开启风机可吹散气膜恢复光合，但会略微加快水分蒸发。',
    },
  ],
  controlsHint:
    'A/D 或拖动灯架：移灯 ｜ Q/C 或滑块：红蓝光谱 ｜ Space：毛细滴灌 ｜ E：循环风机 ｜ 点击水球：抽吸回收',
  levels: [
    {
      index: 0,
      name: '拟南芥定向萌发',
      subtitle: '向光性引导 + 毛细湿度稳控',
      objective:
        '移动顶部 LED 灯架，利用向光性引导拟南芥茎尖沿绿色光学通道生长，保持湿度 45–75% 培育至 100%',
    },
    {
      index: 1,
      name: '矮秆小麦全周期结穗',
      subtitle: '四阶段光谱切换 + 破除静止边界层',
      objective:
        '萌发/拔节期用蓝光壮苗，抽穗/结籽期切换红光促熟；及时开启循环风机吹散叶片灰白 CO₂ 静止气膜',
    },
    {
      index: 2,
      name: '密闭氧碳共生挑战',
      subtitle: '动态热控蒸发 + 游离水球捕获',
      objective:
        '应对高代谢与舱温波动，及时点击回收漂浮水球、协调光谱与通风，以 >70% 活力收获 100% 成熟种子',
    },
  ],
  codexIds: ['botany-phototropism', 'botany-capillary', 'botany-convection'],
};

function getCorridorCenterX(level: number, progress: number): number {
  if (level === 0) {
    // Graceful S-curve corridor that makes L1 phototropism steering genuinely interactive & visible
    if (progress < 0.5) {
      const t = progress / 0.5;
      return 0.5 + Math.sin(t * Math.PI * 0.5) * 0.21;
    }
    const t = (progress - 0.5) / 0.5;
    return 0.71 - Math.sin(t * Math.PI * 0.5) * 0.34;
  }
  return 0.5;
}

export const botanyGame: GameModule = {
  meta: META,

  mount(canvasHost: HTMLElement, host: GameHostAPI): GameInstance {
    const hi = setupHiDPICanvas(canvasHost);
    const { canvas, ctx } = hi;
    const starfield = new StarfieldRenderer(130, 707);
    const particles = new ParticleSystem();

    let rafId = 0;
    let lastTs = performance.now();
    let elapsed = 0;
    let levelIndex = host.getLevel();
    let paused = host.isPaused();
    let physicsOverlay = host.hud.isPhysicsOverlayEnabled();
    let finished = false;
    let destroyed = false;

    // Plant & chamber simulation state
    let growth = 0; // 0..1
    let vitality = 100; // 0..100
    let moisture = 58; // 0..100 (%)
    let lampXNorm = 0.5; // 0.14..0.86
    let redRatio = 0.32; // 0 (100% 450nm Blue) .. 1 (100% 660nm Red)
    let fanOn = false;
    let fanAngle = 0;
    let fanSpeed = 0;
    let boundaryLayer = 0; // 0..1 stagnant CO2 shell thickness
    let photosynRate = 0.75; // 0..1
    let chamberTemp = 23.5; // °C (fluctuates in L3)
    let o2Produced = 0; // L cumulative
    let stageIndex = 0;

    // Interaction & scoring stats
    let lastWaterTime = -5;
    let waterBurstCount = 0;
    let globulesSpawned = 0;
    let globulesCaptured = 0;
    let straySpawnTimer = 7.5;
    let nextGlobuleId = 1;
    let corridorTimeGood = 0;
    let corridorTimeTotal = 0;
    let spectrumTimeGood = 0;
    let spectrumTimeTotal = 0;
    let runSeconds = 0;
    let dripPulseAnim = 0;
    let warnBeepCooldown = 0;
    let draggingLamp = false;
    let hoverGlobuleId: number | null = null;
    let hoverLamp = false;

    const keysHeld = new Set<string>();
    const toastCooldowns = new Map<string, number>();

    let nodes: StemNode[] = [];
    let globules: WaterGlobule[] = [];

    // Tactile deck DOM references
    let lampSlider: HTMLInputElement | null = null;
    let lampValSpan: HTMLElement | null = null;
    let specSlider: HTMLInputElement | null = null;
    let specValSpan: HTMLElement | null = null;
    let waterBtn: HTMLButtonElement | null = null;
    let fanBtn: HTMLButtonElement | null = null;
    let vacuumBtn: HTMLButtonElement | null = null;

    function pushDebouncedToast(
      key: string,
      text: string,
      tone: MetricStatus = 'info',
      tag = '问天生态遥测',
      cooldownSec = 8
    ): void {
      const last = toastCooldowns.get(key) ?? -999;
      if (elapsed - last < cooldownSec) return;
      toastCooldowns.set(key, elapsed);
      host.hud.pushToast(text, tone, tag);
    }

    function getStages(): StageSpec[] {
      return levelIndex === 0 ? ARABIDOPSIS_STAGES : WHEAT_STAGES;
    }

    function getCurrentStage(): StageSpec {
      const stages = getStages();
      let cur = stages[0];
      for (const st of stages) {
        if (growth >= st.minGrowth) cur = st;
      }
      return cur;
    }

    function getCabinetRect(w: number, h: number): CabinetRect {
      const compact = h <= 720;
      const topSafe = compact ? Math.max(100, h * 0.15) : Math.max(122, h * 0.16);
      const bottomSafe = Math.min(h - (compact ? 86 : 138), h * 0.875);
      const availH = Math.max(245, bottomSafe - topSafe);
      const cabW = clamp(w * 0.58, 430, 740);
      const cabH = clamp(availH, 245, 500);
      const x = (w - cabW) * 0.5;
      const y = topSafe + (availH - cabH) * 0.5;
      const padX = 28;
      const padTop = 34;
      const padBottom = 18;
      const innerX = x + padX;
      const innerY = y + padTop;
      const innerW = cabW - padX * 2;
      const innerH = cabH - padTop - padBottom;
      const trayH = Math.max(46, innerH * 0.17);
      const trayY = innerY + innerH - trayH;
      const railY = innerY + 14;
      return { x, y, w: cabW, h: cabH, innerX, innerY, innerW, innerH, railY, trayY, trayH };
    }

    function plantPosToScreen(cab: CabinetRect, xNorm: number, yNorm: number): { x: number; y: number } {
      const topCeiling = cab.railY + 34;
      const rootSurface = cab.trayY + 3;
      return {
        x: cab.innerX + xNorm * cab.innerW,
        y: lerp(rootSurface, topCeiling, yNorm),
      };
    }

    function spawnWaterGlobule(xNorm: number, yNorm: number, vyUp = 0.08): void {
      const angle = (Math.random() - 0.5) * 1.4;
      globules.push({
        id: nextGlobuleId++,
        xNorm: clamp(xNorm, 0.12, 0.88),
        yNorm: clamp(yNorm, 0.08, 0.78),
        vx: Math.sin(angle) * (0.05 + Math.random() * 0.05),
        vy: vyUp + Math.random() * 0.04,
        radius: 13 + Math.random() * 7,
        phase: Math.random() * Math.PI * 2,
        age: 0,
        capturing: false,
      });
      globulesSpawned += 1;
    }

    function captureGlobule(g: WaterGlobule, cab: CabinetRect): void {
      if (g.capturing) return;
      g.capturing = true;
      globulesCaptured += 1;
      const p = plantPosToScreen(cab, g.xNorm, g.yNorm);
      particles.burst(p.x, p.y, 14, '#38bdf8', 85, 3.2, 0.5);
      moisture = clamp(moisture + 4, 0, 100);
      host.audio.playLock();
      pushDebouncedToast(
        'globule-captured',
        '已通过微重力毛细抽吸回收悬浮水球，防止自由水淹闷根系或飘入电路！',
        'nominal',
        '表面张力管控',
        9
      );
      globules = globules.filter((item) => item.id !== g.id);
    }

    function triggerCapillaryDrip(): void {
      if (paused || finished) return;
      const dtSinceLast = elapsed - lastWaterTime;
      lastWaterTime = elapsed;
      if (dtSinceLast < 1.05) {
        waterBurstCount += 1;
      } else {
        waterBurstCount = 1;
      }

      dripPulseAnim = 1;
      moisture = clamp(moisture + 10.5, 0, 100);
      host.audio.playBeep(520 + moisture * 2.5, 0.065);

      const { width, height } = hi.getSize();
      const cab = getCabinetRect(width, height);
      const rootPt = plantPosToScreen(cab, 0.5, 0.02);
      particles.burst(rootPt.x, rootPt.y - 4, 7, '#38bdf8', 42, 2.4, 0.4);

      if (moisture > 78 || waterBurstCount >= 3) {
        const count = moisture > 88 ? 2 : 1;
        for (let i = 0; i < count; i++) {
          spawnWaterGlobule(0.35 + Math.random() * 0.3, 0.1 + Math.random() * 0.08, 0.07);
        }
        host.audio.playWarning();
        pushDebouncedToast(
          'overwater-globule',
          '滴灌过猛！微重力下多余水分不往下渗，而是受表面张力聚成悬浮水球并造成根系缺氧，快点击水球回收！',
          'caution',
          '毛细过饱和告警',
          6
        );
      }
    }

    function toggleFan(force?: boolean): void {
      if (paused || finished) return;
      fanOn = force !== undefined ? force : !fanOn;
      host.audio.playSwitch();
      if (fanBtn) {
        fanBtn.classList.toggle('is-active', fanOn);
        fanBtn.textContent = fanOn ? '循环风机: 开 [E]' : '循环风机: 关 [E]';
      }
      if (fanOn && boundaryLayer > 0.3) {
        pushDebouncedToast(
          'fan-clear',
          '微型强制循环气流已启动，正在吹散叶片周围的静止 CO₂ 边界层，光合效率迅速回升！',
          'nominal',
          '微重力强制对流',
          10
        );
      }
    }

    function syncDeckInputs(): void {
      if (lampSlider) lampSlider.value = String(Math.round(lampXNorm * 100));
      if (lampValSpan) lampValSpan.textContent = `${Math.round(lampXNorm * 100)}%`;
      if (specSlider) specSlider.value = String(Math.round(redRatio * 100));
      if (specValSpan) {
        const b = Math.round((1 - redRatio) * 100);
        const r = Math.round(redRatio * 100);
        specValSpan.textContent = `蓝${b}/红${r}`;
      }
      if (fanBtn) {
        fanBtn.classList.toggle('is-active', fanOn);
        fanBtn.textContent = fanOn ? '循环风机: 开 [E]' : '循环风机: 关 [E]';
      }
      if (vacuumBtn) {
        const cnt = globules.length;
        vacuumBtn.textContent = cnt > 0 ? `回收水球 (${cnt})` : '回收水球: 净空';
        vacuumBtn.classList.toggle('is-gold', cnt > 0);
      }
    }

    function buildTactileDeck(): void {
      const deck = host.hud.getTactileDeck();
      host.hud.clearTactileDeck();

      // Lamp position slider
      const lampGroup = document.createElement('label');
      lampGroup.className = 'deck-slider-group';
      lampGroup.innerHTML = `<span>灯位</span>`;
      lampSlider = document.createElement('input');
      lampSlider.type = 'range';
      lampSlider.min = '14';
      lampSlider.max = '86';
      lampSlider.value = String(Math.round(lampXNorm * 100));
      lampSlider.addEventListener('input', () => {
        lampXNorm = clamp(Number(lampSlider!.value) / 100, 0.14, 0.86);
        syncDeckInputs();
      });
      lampValSpan = document.createElement('span');
      lampValSpan.className = 'mono-num';
      lampValSpan.style.minWidth = '34px';
      lampGroup.append(lampSlider, lampValSpan);

      // Spectrum slider
      const specGroup = document.createElement('label');
      specGroup.className = 'deck-slider-group';
      specGroup.innerHTML = `<span>光谱</span>`;
      specSlider = document.createElement('input');
      specSlider.type = 'range';
      specSlider.min = '0';
      specSlider.max = '100';
      specSlider.value = String(Math.round(redRatio * 100));
      specSlider.addEventListener('input', () => {
        redRatio = clamp(Number(specSlider!.value) / 100, 0, 1);
        syncDeckInputs();
      });
      specValSpan = document.createElement('span');
      specValSpan.className = 'mono-num';
      specValSpan.style.minWidth = '64px';
      specGroup.append(specSlider, specValSpan);

      // Capillary drip button
      waterBtn = document.createElement('button');
      waterBtn.type = 'button';
      waterBtn.className = 'deck-ctrl-btn';
      waterBtn.textContent = '毛细滴灌 [Space]';
      waterBtn.addEventListener('click', () => {
        waterBtn?.blur();
        triggerCapillaryDrip();
      });

      // Micro Circulation Fan toggle
      fanBtn = document.createElement('button');
      fanBtn.type = 'button';
      fanBtn.className = 'deck-ctrl-btn';
      fanBtn.textContent = '循环风机: 关 [E]';
      fanBtn.addEventListener('click', () => {
        fanBtn?.blur();
        toggleFan();
      });

      deck.append(lampGroup, specGroup, waterBtn, fanBtn);

      if (levelIndex === 2) {
        vacuumBtn = document.createElement('button');
        vacuumBtn.type = 'button';
        vacuumBtn.className = 'deck-ctrl-btn';
        vacuumBtn.textContent = '回收水球: 净空';
        vacuumBtn.addEventListener('click', () => {
          vacuumBtn?.blur();
          if (paused || finished) return;
          if (globules.length > 0) {
            const { width, height } = hi.getSize();
            captureGlobule(globules[0], getCabinetRect(width, height));
            syncDeckInputs();
          } else {
            host.audio.playClick();
          }
        });
        deck.appendChild(vacuumBtn);
      } else {
        vacuumBtn = null;
      }

      syncDeckInputs();
    }

    function initLevel(idx: number): void {
      levelIndex = clamp(idx, 0, META.levels.length - 1);
      finished = false;
      growth = 0.04;
      vitality = 100;
      moisture = levelIndex === 2 ? 54 : 58;
      lampXNorm = levelIndex === 0 ? 0.34 : 0.5;
      redRatio = levelIndex === 0 ? 0.36 : 0.25;
      fanOn = false;
      fanSpeed = 0;
      boundaryLayer = 0.06;
      photosynRate = 0.7;
      chamberTemp = 23.5;
      o2Produced = 0;
      stageIndex = 0;
      lastWaterTime = -5;
      waterBurstCount = 0;
      globulesSpawned = 0;
      globulesCaptured = 0;
      straySpawnTimer = 6.5;
      corridorTimeGood = 0;
      corridorTimeTotal = 0;
      spectrumTimeGood = 0;
      spectrumTimeTotal = 0;
      runSeconds = 0;
      dripPulseAnim = 0;
      warnBeepCooldown = 0;
      draggingLamp = false;
      hoverGlobuleId = null;

      nodes = [
        { xNorm: 0.5, yNorm: 0.0, growthAt: 0, leafSeed: 0.7 },
        { xNorm: 0.5, yNorm: 0.035, growthAt: 0.04, leafSeed: 1.9 },
      ];
      globules = [];
      particles.clear();
      toastCooldowns.clear();

      host.hud.setObjective(META.levels[levelIndex].objective);
      host.hud.setMetrics([
        { id: 'growth', label: '培育进度', value: '4% · 萌发', ratio: 0.04, status: 'info' },
        { id: 'vitality', label: '株体活力', value: '100%', ratio: 1, status: 'nominal' },
        { id: 'moisture', label: '基质含水', value: '58%', ratio: 0.58, status: 'nominal' },
        {
          id: 'photosyn',
          label: levelIndex === 0 ? '向光对准' : '光合 / 气膜',
          value: '72%',
          ratio: 0.72,
          status: 'nominal',
        },
      ]);

      buildTactileDeck();

      if (levelIndex === 0) {
        pushDebouncedToast(
          'l1-intro',
          '失重环境没有“上下”之分！向右拖动顶部 LED 灯架，利用植物向光性把拟南芥引导进绿色光学通道。',
          'info',
          '问天生物实验 L1',
          20
        );
      } else if (levelIndex === 1) {
        pushDebouncedToast(
          'l2-intro',
          '小麦全周期培育启动：萌发与拔节期保持蓝光主导(450nm)，同时留意叶片灰白 CO₂ 静止气膜并开启循环风机！',
          'info',
          '问天生物实验 L2',
          20
        );
      } else {
        pushDebouncedToast(
          'l3-intro',
          '密闭共生挑战：高代谢叠加舱温热波动，随时点击回收游离悬浮水球，在 >70% 活力下冲刺 100% 结籽收获！',
          'info',
          '问天生物实验 L3',
          20
        );
      }
    }

    function finishAttempt(won: boolean, failReason?: string): void {
      if (finished) return;
      finished = true;

      const corridorPct =
        corridorTimeTotal > 0 ? Math.round((corridorTimeGood / corridorTimeTotal) * 100) : 100;
      const specPct =
        spectrumTimeTotal > 0 ? Math.round((spectrumTimeGood / spectrumTimeTotal) * 100) : 100;

      let stars: 0 | 1 | 2 | 3 = 0;
      if (won) {
        if (levelIndex === 0) {
          stars = vitality >= 86 && corridorPct >= 72 ? 3 : vitality >= 70 ? 2 : 1;
        } else if (levelIndex === 1) {
          stars = vitality >= 84 && specPct >= 70 ? 3 : vitality >= 68 ? 2 : 1;
        } else {
          stars = vitality >= 86 && globules.length === 0 ? 3 : vitality >= 76 ? 2 : 1;
        }
      }

      const score = won
        ? Math.round(
            420 +
              vitality * 3.8 +
              (levelIndex === 0 ? corridorPct * 1.8 : specPct * 1.8) +
              clamp(120 - runSeconds * 1.5, 0, 120)
          )
        : Math.round(growth * 320);

      const scienceCards = [
        {
          title: '微重力下以“向光性”替代向地性',
          gameAction: '你通过左右移动顶部红蓝 LED 灯架，牵引失去重力方向感的拟南芥茎尖沿预定光学通道生长并顺利开花。',
          realStationFact:
            '在轨失重环境中，植物平衡石不再沉降，失去了向地性指引；问天实验舱生命生态柜通过定向 LED 照明激发向光素信号，让茎叶朝光源定向舒展。',
          realData: '真实参数：蓝光 450 nm 主导向光性与株型紧凑 | 问天实验柜拟南芥在轨开花结实',
          codexId: 'botany-phototropism',
        },
        {
          title: '无对流静止边界层与四阶段光谱调控',
          gameAction: '你在萌发拔节期以蓝光壮苗、抽穗结籽期切换红光加速灌浆，并用微型循环风机吹散了叶片周围缺 CO₂ 的静止气膜。',
          realStationFact:
            '失重下冷热气体不会浮力对流，植物叶片周围迅速形成缺 CO₂ 的静止扩散边界层；问天生物柜通过强制微循环通风与动态红蓝光谱，在国际上首次完成水稻“从种子到种子”全生命周期培育。',
          realData: '真实参数：红光 660 nm 促进光合与成花 | 空间水稻全周期培育 120 天收获再生稻种',
          codexId: 'botany-convection',
        },
        {
          title: '表面张力主导与闭环毛细供水生态',
          gameAction: '你在温度与蒸腾波动中少量多次毛细供水，并及时回收了表面张力聚成的失重游离水球，守住了根系呼吸与密闭产氧平衡。',
          realStationFact:
            '空间站无法用常规水壶浇花，自由水会包裹根系造成窒息或飘入精密仪器；太空植物栽培盒采用多孔陶粒基质依靠毛细力精准稳水，为未来月球/火星基地受控生态生保奠基。',
          realData: '真实参数：多孔介质毛细张力稳水 45–75% | 植物光合产氧同步吸收乘组 CO₂',
          codexId: 'botany-capillary',
        },
      ];

      const baseCard = scienceCards[levelIndex];
      const finalScienceCard = won
        ? baseCard
        : {
            ...baseCard,
            gameAction: `本次培育未能完成收获（最终进度 ${Math.round(growth * 100)}%）：${(failReason ?? '株体活力耗尽').replace(/。+$/, '')}。下次请注意少量多次毛细滴灌、维持 45–75% 绿区湿度并及时开启循环风机。`,
          };

      const result: GameResult = {
        levelIndex,
        won,
        stars,
        score,
        summary: won
          ? levelIndex === 0
            ? '拟南芥沿光学通道定向绽放白花，成功验证微重力向光引导与毛细供水！'
            : levelIndex === 1
              ? '矮秆小麦顺利完成萌发→拔节→抽穗→结籽全周期，金色麦穗丰收在轨！'
              : `密闭生物生态柜以 ${Math.round(vitality)}% 高活力收获成熟太空种子，累计制氧 ${o2Produced.toFixed(1)} L！`
          : failReason ?? '株体活力耗尽，生态培育中止，请调整湿度与气流后重新培育。',
        metrics: [
          {
            label: '最终培育进度',
            value: `${Math.round(growth * 100)}%`,
            status: won ? 'nominal' : 'critical',
          },
          {
            label: '收获株体活力',
            value: `${Math.round(vitality)}%`,
            status: vitality >= 75 ? 'nominal' : vitality >= 50 ? 'caution' : 'critical',
          },
          levelIndex === 0
            ? {
                label: '光学通道对准率',
                value: `${corridorPct}%`,
                status: corridorPct >= 70 ? 'nominal' : 'caution',
              }
            : {
                label: '光谱阶段匹配率',
                value: `${specPct}%`,
                status: specPct >= 68 ? 'nominal' : 'caution',
              },
          {
            label: '悬浮水球管控',
            value:
              globulesSpawned === 0
                ? '零溢水 (完美)'
                : `回收 ${globulesCaptured}/${globulesSpawned}`,
            status: globules.length === 0 ? 'nominal' : 'caution',
          },
        ],
        scienceCard: finalScienceCard,
      };

      host.completeLevel(result);
    }

    function updateSimulation(dt: number): void {
      if (paused || finished) return;
      elapsed += dt;
      runSeconds += dt;
      dripPulseAnim = Math.max(0, dripPulseAnim - dt * 2.2);
      warnBeepCooldown = Math.max(0, warnBeepCooldown - dt);

      // Keyboard smooth control for lamp & spectrum (no forbidden global keys!)
      const lampSpeed = 0.48;
      if (keysHeld.has('a') || keysHeld.has('arrowleft')) {
        lampXNorm = clamp(lampXNorm - lampSpeed * dt, 0.14, 0.86);
        syncDeckInputs();
      }
      if (keysHeld.has('d') || keysHeld.has('arrowright')) {
        lampXNorm = clamp(lampXNorm + lampSpeed * dt, 0.14, 0.86);
        syncDeckInputs();
      }
      if (keysHeld.has('q')) {
        redRatio = clamp(redRatio - 0.55 * dt, 0, 1);
        syncDeckInputs();
      }
      if (keysHeld.has('c')) {
        redRatio = clamp(redRatio + 0.55 * dt, 0, 1);
        syncDeckInputs();
      }

      // Fan kinematics
      const targetFanSpeed = fanOn ? 14 : 0;
      fanSpeed = lerp(fanSpeed, targetFanSpeed, clamp(dt * 4.5, 0, 1));
      fanAngle += fanSpeed * dt;

      // Chamber temperature shift in L3
      if (levelIndex === 2) {
        chamberTemp = 24.2 + Math.sin(runSeconds * 0.24) * 4.8 + Math.cos(runSeconds * 0.11) * 1.4;
      } else {
        chamberTemp = 23.0 + Math.sin(runSeconds * 0.15) * 0.6;
      }

      // Moisture evaporation (increases with fan, plant leaf size, and L3 thermal highs)
      const tempFactor = levelIndex === 2 ? 1 + Math.max(0, chamberTemp - 24) * 0.12 : 1;
      const baseEvap = (levelIndex === 0 ? 1.55 : levelIndex === 1 ? 1.85 : 2.35) * tempFactor;
      const fanEvap = fanOn ? 1.45 : 0;
      const foliageEvap = growth * 0.9;
      moisture = clamp(moisture - (baseEvap + fanEvap + foliageEvap) * dt, 0, 100);

      // Stagnant CO2 boundary layer in microgravity (prominent in L2 & L3)
      const blBuildRate =
        levelIndex === 0 ? 0.014 : levelIndex === 1 ? 0.072 + growth * 0.045 : 0.085 + growth * 0.055;
      if (fanOn) {
        boundaryLayer = clamp(boundaryLayer - 0.34 * dt, 0, 1);
      } else {
        boundaryLayer = clamp(boundaryLayer + blBuildRate * dt, 0, 1);
      }

      if (levelIndex >= 1 && boundaryLayer > 0.52 && !fanOn) {
        pushDebouncedToast(
          'bl-warn',
          '叶片周围已积聚灰白 CO₂ 静止边界层！失重没有自然对流，请按 E 或点击按钮开启循环风机！',
          'caution',
          '无对流气膜告警',
          9
        );
      }

      // Occasional stray condensation/capillary water globules in L3
      if (levelIndex === 2) {
        straySpawnTimer -= dt;
        if (straySpawnTimer <= 0 && globules.length < 3) {
          straySpawnTimer = 8.5 + Math.random() * 4.0;
          spawnWaterGlobule(0.24 + Math.random() * 0.52, 0.14 + Math.random() * 0.12, 0.06);
          host.audio.playWarning();
          pushDebouncedToast(
            'l3-stray-water',
            '高蒸腾凝露形成了失重游离水球！点击画布上的水球（或点击下方吸回按钮）迅速回收！',
            'caution',
            '游离水珠预警',
            8
          );
          syncDeckInputs();
        }
      }

      // Update floating water globules in zero-G
      let rootGlobules = 0;
      let railGlobules = 0;
      for (const g of globules) {
        g.age += dt;
        g.phase += dt * 3.8;
        // Fan pushes globules gently rightward!
        if (fanOn) {
          g.vx += 0.08 * dt;
        }
        // Subtle micro-drift damping
        g.vx = clamp(g.vx, -0.14, 0.14);
        g.vy = clamp(g.vy, -0.12, 0.12);
        g.xNorm += g.vx * dt;
        g.yNorm += g.vy * dt;

        if (g.xNorm < 0.09) {
          g.xNorm = 0.09;
          g.vx = Math.abs(g.vx) * 0.85;
        } else if (g.xNorm > 0.91) {
          g.xNorm = 0.91;
          g.vx = -Math.abs(g.vx) * 0.85;
        }
        if (g.yNorm < 0.06) {
          g.yNorm = 0.06;
          g.vy = Math.abs(g.vy) * 0.85;
        } else if (g.yNorm > 0.88) {
          g.yNorm = 0.88;
          g.vy = -Math.abs(g.vy) * 0.85;
        }

        if (g.yNorm < 0.24) rootGlobules += 1;
        if (g.yNorm > 0.78) railGlobules += 1;
      }

      // Stage & Spectrum evaluation
      const stages = getStages();
      const stage = getCurrentStage();
      const newStageIdx = stages.indexOf(stage);
      if (newStageIdx !== stageIndex) {
        stageIndex = newStageIdx;
        host.audio.playLock();
        pushDebouncedToast(
          `stage-${stageIndex}`,
          `进入【${stage.name}期】！建议光谱：${stage.spectrumHint}。`,
          'info',
          '生长阶段跃迁',
          4
        );
      }

      const tip = nodes[nodes.length - 1];
      const lampDistX = Math.abs(lampXNorm - tip.xNorm);
      const lightAlign = clamp(1 - lampDistX / 0.36, 0.15, 1);

      const inIdealSpectrum = redRatio >= stage.idealRedMin && redRatio <= stage.idealRedMax;
      const specCenter = (stage.idealRedMin + stage.idealRedMax) * 0.5;
      const specHalf = (stage.idealRedMax - stage.idealRedMin) * 0.5;
      const specErr = Math.max(0, Math.abs(redRatio - specCenter) - specHalf);
      const spectrumScore = clamp(1 - specErr * 2.2, 0.25, 1);

      spectrumTimeTotal += dt;
      if (inIdealSpectrum) spectrumTimeGood += dt;

      // Moisture factor (ideal 45..75%)
      const inMoistureGreen = moisture >= 45 && moisture <= 75;
      let moistureScore = 1;
      if (moisture < 45) moistureScore = clamp(moisture / 45, 0.12, 1);
      else if (moisture > 75) moistureScore = clamp(1 - (moisture - 75) / 30, 0.2, 1);

      // Boundary layer penalty
      const gasExchangeScore = clamp(1 - Math.max(0, boundaryLayer - 0.22) * 1.15, 0.15, 1);

      // Corridor alignment (crucial in L1!)
      const corridorTargetX = getCorridorCenterX(levelIndex, growth);
      const corridorErr = Math.abs(tip.xNorm - corridorTargetX);
      const inCorridor = levelIndex === 0 ? corridorErr <= 0.135 : true;
      corridorTimeTotal += dt;
      if (inCorridor) corridorTimeGood += dt;

      // Effective Photosynthesis Rate (0..1)
      photosynRate = clamp(
        lightAlign * 0.32 +
          spectrumScore * 0.32 +
          moistureScore * 0.2 +
          gasExchangeScore * 0.16,
        0.08,
        1
      );

      // Growth rate (tuned so each level takes ~36-48s of engaged play)
      const baseGrowthSpeed = levelIndex === 0 ? 0.0255 : levelIndex === 1 ? 0.0235 : 0.0265;
      const corridorBoost = levelIndex === 0 ? (inCorridor ? 1.15 : 0.55) : 1.0;
      const dGrowth = baseGrowthSpeed * (0.28 + photosynRate * 1.02) * corridorBoost * dt;
      growth = clamp(growth + dGrowth, 0, 1);
      o2Produced += photosynRate * growth * dt * 1.45;

      // Extend procedural stem nodes upward, bending dynamically toward lampXNorm (phototropism!)
      const targetTipY = clamp(growth * 0.84, 0.035, 0.85);
      const lastNode = nodes[nodes.length - 1];
      const stepY = 0.036;
      if (targetTipY - lastNode.yNorm >= stepY) {
        const pull = clamp(lampXNorm - lastNode.xNorm, -0.35, 0.35);
        const bendFactor = levelIndex === 0 ? 0.28 : 0.16;
        const nextX = clamp(lastNode.xNorm + pull * bendFactor, 0.14, 0.86);
        nodes.push({
          xNorm: nextX,
          yNorm: lastNode.yNorm + stepY,
          growthAt: growth,
          leafSeed: nodes.length * 1.73 + levelIndex * 0.9,
        });
      } else {
        // Gentle live phototropic lean on the newest apical tip
        const prev = nodes[nodes.length - 2];
        const desiredX = clamp(prev.xNorm + clamp(lampXNorm - prev.xNorm, -0.22, 0.22) * 0.22, 0.14, 0.86);
        lastNode.xNorm = lerp(lastNode.xNorm, desiredX, dt * 1.6);
        lastNode.yNorm = Math.max(lastNode.yNorm, targetTipY);
      }

      // Vitality update: stress drains vitality; healthy conditions slowly recover it!
      let vitDelta = 0;
      if (moisture < 28) {
        vitDelta -= 6.5;
        pushDebouncedToast(
          'dry-crit',
          '多孔陶粒严重缺水！请轻按 Space 毛细微量滴灌补充水分。',
          'critical',
          '基质干旱告警',
          7
        );
      } else if (moisture < 42) {
        vitDelta -= 1.8;
      } else if (moisture > 84) {
        vitDelta -= 5.8;
        pushDebouncedToast(
          'wet-crit',
          '根系过饱和缺氧！微重力下水膜会包裹根毛阻碍呼吸，停止浇水并开启风机加速蒸发！',
          'critical',
          '根系窒息告警',
          7
        );
      }

      if (levelIndex >= 1 && boundaryLayer > 0.72) {
        vitDelta -= 4.2;
      }
      if (levelIndex === 0 && !inCorridor && growth > 0.15) {
        vitDelta -= 2.1;
        pushDebouncedToast(
          'corridor-drift',
          '幼苗偏离光学引导通道！把顶部 LED 灯架移到通道前方，利用向光性把茎尖拉回来！',
          'caution',
          '向光定向提示',
          8
        );
      }
      if (levelIndex >= 1 && !inIdealSpectrum && growth > 0.2) {
        vitDelta -= 1.4;
      }
      if (globules.length > 0) {
        vitDelta -= rootGlobules * 2.4 + railGlobules * 3.0 + (globules.length - rootGlobules - railGlobules) * 0.6;
      }

      // Gentle recovery when everything is thriving
      if (inMoistureGreen && boundaryLayer < 0.45 && globules.length === 0 && photosynRate > 0.68) {
        vitDelta += levelIndex === 2 ? 2.6 : 2.1;
      }

      vitality = clamp(vitality + vitDelta * dt, 0, 100);

      if (vitDelta < -4 && warnBeepCooldown <= 0) {
        host.audio.playWarning();
        warnBeepCooldown = 3.2;
      }

      // Emit O2 photosynthesis sparkle motes from healthy canopy
      if (photosynRate > 0.62 && Math.random() < dt * (3 + growth * 7)) {
        const { width, height } = hi.getSize();
        const cab = getCabinetRect(width, height);
        const pick = nodes[Math.max(1, Math.floor(Math.random() * nodes.length))];
        const sp = plantPosToScreen(cab, pick.xNorm, pick.yNorm);
        particles.spawn({
          x: sp.x + (Math.random() - 0.5) * 28,
          y: sp.y + (Math.random() - 0.5) * 18,
          vx: (fanOn ? 36 : 0) + (Math.random() - 0.5) * 14,
          vy: -14 - Math.random() * 14,
          life: 1.1,
          size: 2.3,
          color: levelIndex === 2 ? '#86efac' : '#4ade80',
        });
      }

      particles.update(dt);

      // Update HUD Telemetry cleanly
      const moistStatus: MetricStatus =
        moisture < 30 || moisture > 85
          ? 'critical'
          : moisture < 45 || moisture > 75
            ? 'caution'
            : 'nominal';
      const vitStatus: MetricStatus =
        vitality < 40 ? 'critical' : vitality < 70 ? 'caution' : 'nominal';
      const photoVal =
        levelIndex === 0
          ? inCorridor
            ? `已对准 · ${Math.round(photosynRate * 100)}%`
            : `偏离通道`
          : boundaryLayer > 0.55
            ? `气膜阻塞 · ${Math.round(photosynRate * 100)}%`
            : `${Math.round(photosynRate * 100)}%`;
      const photoStatus: MetricStatus =
        levelIndex === 0
          ? inCorridor
            ? 'nominal'
            : 'caution'
          : boundaryLayer > 0.65
            ? 'critical'
            : boundaryLayer > 0.42 || !inIdealSpectrum
              ? 'caution'
              : 'nominal';

      host.hud.updateMetric('growth', {
        value: `${Math.round(growth * 100)}% · ${stage.name}`,
        ratio: growth,
        status: growth >= 0.85 ? 'nominal' : 'info',
      });
      host.hud.updateMetric('vitality', {
        value: `${Math.round(vitality)}%`,
        ratio: vitality / 100,
        status: vitStatus,
      });
      host.hud.updateMetric('moisture', {
        value: `${Math.round(moisture)}%`,
        ratio: moisture / 100,
        status: moistStatus,
      });
      host.hud.updateMetric('photosyn', {
        value: photoVal,
        ratio: photosynRate,
        status: photoStatus,
      });
      if (vacuumBtn) syncDeckInputs();

      // Win / Fail checks
      if (vitality <= 0.1) {
        finishAttempt(false, '株体活力归零（缺水/过涝或气膜长期窒息），培育失败。');
        return;
      }
      if (growth >= 1) {
        if (levelIndex === 2 && vitality < 70) {
          finishAttempt(
            false,
            `种子虽已成熟，但最终活力仅 ${Math.round(vitality)}%（未达到密闭生态 >70% 考核标准）。`
          );
        } else {
          finishAttempt(true);
        }
      }
    }

    function drawScene(): void {
      const { width: w, height: h } = hi.getSize();
      if (!drawBakedBackdrop(ctx, 'lab-interior', w, h, 0.22, 0.34)) {
        starfield.draw(ctx, w, h, elapsed, elapsed * 2, elapsed * 0.8);
      }

      const cab = getCabinetRect(w, h);

      ctx.save();

      // ---- 1. Wentian Cabinet Outer Chassis (flat dark-slate fill, zero clip/gradients) ----
      ctx.fillStyle = '#1b283c';
      ctx.beginPath();
      ctx.roundRect(cab.x, cab.y, cab.w, cab.h, 14);
      ctx.fill();
      ctx.strokeStyle = 'rgba(186, 218, 255, 0.45)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Machined stainless mounting bolts (flat circles)
      const boltOff = 12;
      const bolts = [
        [cab.x + boltOff, cab.y + boltOff],
        [cab.x + cab.w - boltOff, cab.y + boltOff],
        [cab.x + boltOff, cab.y + cab.h - boltOff],
        [cab.x + cab.w - boltOff, cab.y + cab.h - boltOff],
      ];
      for (const [bx, by] of bolts) {
        ctx.fillStyle = '#64748b';
        ctx.beginPath();
        ctx.arc(bx, by, 3.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 0.9;
        ctx.stroke();
      }

      // Top nameplate bar
      const stage = getCurrentStage();
      ctx.font = '700 11px "JetBrains Mono", monospace';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText('WENTIAN BIO-CABINET // 问天生命生态实验柜', cab.innerX, cab.y + 21);

      const specHintColor =
        redRatio >= stage.idealRedMin && redRatio <= stage.idealRedMax ? '#4ade80' : '#fbbf24';
      ctx.textAlign = 'right';
      ctx.fillStyle = specHintColor;
      ctx.font = '600 11px "Noto Sans SC", sans-serif';
      ctx.fillText(
        `【${stage.name}期】${stage.spectrumHint}`,
        cab.innerX + cab.innerW,
        cab.y + 21
      );
      ctx.textAlign = 'left';

      // ---- 2. Cabinet Interior Chamber Background (flat deep slate, zero gradient/clip) ----
      ctx.fillStyle = '#0c1626';
      ctx.beginPath();
      ctx.roundRect(cab.innerX, cab.innerY, cab.innerW, cab.innerH, 8);
      ctx.fill();
      ctx.save();

      // Subtle metallic interior grid lines
      ctx.strokeStyle = 'rgba(148, 185, 235, 0.06)';
      ctx.lineWidth = 1;
      for (let gx = cab.innerX + 40; gx < cab.innerX + cab.innerW; gx += 48) {
        ctx.beginPath();
        ctx.moveTo(gx, cab.innerY);
        ctx.lineTo(gx, cab.trayY);
        ctx.stroke();
      }
      for (let gy = cab.innerY + 40; gy < cab.trayY; gy += 44) {
        ctx.beginPath();
        ctx.moveTo(cab.innerX, gy);
        ctx.lineTo(cab.innerX + cab.innerW, gy);
        ctx.stroke();
      }

      // ---- 3. Target Optical Growth Corridor (L1 prominent curved guide) ----
      if (levelIndex === 0) {
        const halfCorridorPx = cab.innerW * 0.13;
        ctx.save();
        ctx.beginPath();
        const steps = 28;
        for (let i = 0; i <= steps; i++) {
          const g = i / steps;
          const pt = plantPosToScreen(cab, getCorridorCenterX(0, g), g * 0.85);
          if (i === 0) ctx.moveTo(pt.x - halfCorridorPx, pt.y);
          else ctx.lineTo(pt.x - halfCorridorPx, pt.y);
        }
        for (let i = steps; i >= 0; i--) {
          const g = i / steps;
          const pt = plantPosToScreen(cab, getCorridorCenterX(0, g), g * 0.85);
          ctx.lineTo(pt.x + halfCorridorPx, pt.y);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(74, 222, 128, 0.08)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(74, 222, 128, 0.35)';
        ctx.setLineDash([6, 5]);
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);

        // Target beacon ring at current growth + lead height
        const leadG = clamp(growth + 0.08, 0.08, 0.96);
        const beacon = plantPosToScreen(cab, getCorridorCenterX(0, leadG), leadG * 0.85);
        const pulse = 1 + Math.sin(elapsed * 4.5) * 0.12;
        ctx.strokeStyle = 'rgba(74, 222, 128, 0.78)';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(beacon.x, beacon.y, 13 * pulse, 0, Math.PI * 2);
        ctx.stroke();
        ctx.font = '600 10px "Noto Sans SC", sans-serif';
        ctx.fillStyle = 'rgba(134, 239, 172, 0.85)';
        ctx.fillText('向光靶区', beacon.x + 17, beacon.y + 3);
        ctx.restore();
      }

      // ---- 4. Flat Translucent LED Light Cone (450nm Blue <-> 660nm Red, zero gradients/lighter) ----
      const lampX = cab.innerX + lampXNorm * cab.innerW;
      const lampW = Math.min(136, cab.innerW * 0.24);
      const rCol = Math.round(lerp(56, 244, redRatio));
      const gCol = Math.round(lerp(130, 63, redRatio));
      const bCol = Math.round(lerp(246, 118, redRatio));
      const specRgb = `${rCol}, ${gCol}, ${bCol}`;

      ctx.fillStyle = `rgba(${specRgb}, 0.14)`;
      ctx.beginPath();
      ctx.moveTo(Math.max(cab.innerX + 2, lampX - lampW * 0.44), cab.railY + 18);
      ctx.lineTo(Math.min(cab.innerX + cab.innerW - 2, lampX + lampW * 0.44), cab.railY + 18);
      ctx.lineTo(Math.min(cab.innerX + cab.innerW - 2, lampX + lampW * 1.48), cab.trayY);
      ctx.lineTo(Math.max(cab.innerX + 2, lampX - lampW * 1.48), cab.trayY);
      ctx.closePath();
      ctx.fill();

      // Inner photon core trapezoid
      ctx.fillStyle = `rgba(${specRgb}, 0.11)`;
      ctx.beginPath();
      ctx.moveTo(Math.max(cab.innerX + 2, lampX - lampW * 0.28), cab.railY + 18);
      ctx.lineTo(Math.min(cab.innerX + cab.innerW - 2, lampX + lampW * 0.28), cab.railY + 18);
      ctx.lineTo(Math.min(cab.innerX + cab.innerW - 2, lampX + lampW * 0.78), cab.trayY);
      ctx.lineTo(Math.max(cab.innerX + 2, lampX - lampW * 0.78), cab.trayY);
      ctx.closePath();
      ctx.fill();

      // ---- 5. Left Wall Micro-Circulation Fan & Right Exhaust + Airflow Streamlines ----
      const fanCx = cab.innerX + 26;
      const fanCy = lerp(cab.railY + 46, cab.trayY - 26, 0.52);
      const fanR = 21;

      // Animated forced airflow streamlines when fan is spinning
      if (fanSpeed > 0.6) {
        const alpha = clamp(fanSpeed / 14, 0, 1) * 0.48;
        ctx.save();
        ctx.strokeStyle = `rgba(125, 211, 252, ${alpha})`;
        ctx.lineWidth = 1.6;
        for (let row = 0; row < 5; row++) {
          const sy = cab.railY + 48 + row * ((cab.trayY - cab.railY - 76) / 4);
          const flowOffset = (elapsed * 195 + row * 47) % (cab.innerW - 70);
          const xStart = cab.innerX + 46 + flowOffset;
          const segLen = 58;
          ctx.beginPath();
          ctx.moveTo(xStart, sy + Math.sin(elapsed * 5 + row) * 3);
          ctx.quadraticCurveTo(
            xStart + segLen * 0.5,
            sy - 5 + Math.cos(elapsed * 4 + row) * 3,
            Math.min(cab.innerX + cab.innerW - 22, xStart + segLen),
            sy + Math.sin(elapsed * 5 + row + 1) * 3
          );
          ctx.stroke();
        }
        ctx.restore();
      }

      // Fan housing
      ctx.save();
      ctx.fillStyle = '#16253d';
      ctx.strokeStyle = fanOn ? '#38bdf8' : '#475569';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(fanCx, fanCy, fanR, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Fan blades
      ctx.translate(fanCx, fanCy);
      ctx.rotate(fanAngle);
      for (let b = 0; b < 5; b++) {
        ctx.rotate((Math.PI * 2) / 5);
        ctx.fillStyle = fanOn ? '#7dd3fc' : '#64748b';
        ctx.beginPath();
        ctx.ellipse(7, 0, 7.5, 3.2, 0.25, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(0, 0, 4.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.font = '600 9.5px "JetBrains Mono", monospace';
      ctx.fillStyle = fanOn ? '#7dd3fc' : '#64748b';
      ctx.fillText(fanOn ? 'FAN ON' : 'FAN OFF', cab.innerX + 8, fanCy + fanR + 13);

      // Right wall sensor strip (Temp / O2 telemetry)
      const sensorX = cab.innerX + cab.innerW - 18;
      ctx.fillStyle = '#16253d';
      ctx.fillRect(sensorX, fanCy - 36, 12, 72);
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1;
      ctx.strokeRect(sensorX, fanCy - 36, 12, 72);
      for (let s = 0; s < 5; s++) {
        ctx.fillStyle = s === 0 ? '#22c55e' : s === 1 && chamberTemp > 26.5 ? '#f59e0b' : '#38bdf8';
        ctx.fillRect(sensorX + 3, fanCy - 28 + s * 13, 6, 4);
      }
      if (levelIndex === 2) {
        ctx.save();
        ctx.textAlign = 'right';
        ctx.font = '700 10px "JetBrains Mono", monospace';
        ctx.fillStyle = chamberTemp > 27 ? '#fbbf24' : '#7dd3fc';
        ctx.fillText(`${chamberTemp.toFixed(1)}°C`, sensorX - 4, fanCy - 18);
        ctx.fillStyle = '#86efac';
        ctx.fillText(`O₂ ${o2Produced.toFixed(1)}L`, sensorX - 4, fanCy + 2);
        ctx.restore();
      }

      // ---- 6. Stagnant Boundary-Layer CO2 Halo (behind & around plant leaves) ----
      if (boundaryLayer > 0.16 && nodes.length > 1) {
        ctx.save();
        const blAlpha = clamp((boundaryLayer - 0.14) * 0.42, 0, 0.34);
        ctx.fillStyle = `rgba(148, 163, 184, ${blAlpha.toFixed(3)})`;
        ctx.beginPath();
        for (let i = 1; i < nodes.length; i += 2) {
          const sp = plantPosToScreen(cab, nodes[i].xNorm, nodes[i].yNorm);
          const rHalo = 18 + boundaryLayer * 24 + Math.sin(elapsed * 2 + i) * 2.5;
          ctx.moveTo(sp.x + rHalo, sp.y);
          ctx.arc(sp.x, sp.y, rHalo, 0, Math.PI * 2);
        }
        ctx.fill();
        if (boundaryLayer > 0.45) {
          const mid = nodes[Math.floor(nodes.length * 0.65)];
          const mp = plantPosToScreen(cab, mid.xNorm, mid.yNorm);
          ctx.font = '700 11px "Noto Sans SC", sans-serif';
          ctx.fillStyle = 'rgba(226, 232, 240, 0.9)';
          ctx.fillText('静止 CO₂ 边界层', mp.x + 24, mp.y - 4);
        }
        ctx.restore();
      }

      // ---- 7. Procedurally Animated Growing Plant ----
      drawGrowingPlant(cab);

      // ---- 8. Porous Ceramic Capillary Root Tray & Root Filaments ----
      drawCapillaryRootTray(cab);

      // ---- 9. Top Movable LED Rail & Lamp Gantry ----
      ctx.fillStyle = '#334155';
      ctx.fillRect(cab.innerX + 12, cab.railY - 3, cab.innerW - 24, 6);
      ctx.fillStyle = '#64748b';
      ctx.fillRect(cab.innerX + 12, cab.railY - 1, cab.innerW - 24, 2);

      // Lamp carriage body with anodized titanium & gold MLI accent trim
      ctx.save();
      ctx.fillStyle = draggingLamp || hoverLamp ? '#334155' : '#1e293b';
      ctx.strokeStyle = draggingLamp || hoverLamp ? '#7dd3fc' : '#64748b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(lampX - lampW * 0.5, cab.railY - 6, lampW, 24, 6);
      ctx.fill();
      ctx.stroke();

      const lampMli = getMLIPattern(ctx);
      if (lampMli) {
        ctx.fillStyle = lampMli;
        ctx.fillRect(lampX - lampW * 0.46, cab.railY - 4, 14, 5);
        ctx.fillRect(lampX + lampW * 0.46 - 14, cab.railY - 4, 14, 5);
      }

      // Individual Blue (450nm) & Red (660nm) LED emitter beads (crisp dots, zero additive halos)
      const diodeCount = 9;
      for (let d = 0; d < diodeCount; d++) {
        const t = d / (diodeCount - 1);
        const dx = lampX - lampW * 0.38 + t * lampW * 0.76;
        const isRed = (d % 2 === 0 && redRatio >= 0.2) || redRatio > 0.72;
        const isBlue = !isRed || redRatio < 0.25;
        const lum = isRed ? clamp(0.25 + redRatio * 0.9, 0.2, 1) : clamp(0.25 + (1 - redRatio) * 0.9, 0.2, 1);
        const diodeRgb =
          isBlue && !isRed ? '59, 130, 246' : isRed && !isBlue ? '244, 63, 94' : specRgb;
        ctx.fillStyle = `rgba(${diodeRgb}, ${lum})`;
        ctx.beginPath();
        ctx.arc(dx, cab.railY + 13, 3.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.beginPath();
        ctx.arc(dx, cab.railY + 13, 1.4, 0, Math.PI * 2);
        ctx.fill();
      }

      // Grip handle marker on lamp
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(lampX - 10, cab.railY - 2, 20, 3);
      ctx.restore();

      // ---- 10. Floating Surface-Tension Water Globules (flat aqua body + crisp specular highlight, zero gradients) ----
      for (const g of globules) {
        const p = plantPosToScreen(cab, g.xNorm, g.yNorm);
        const isHov = g.id === hoverGlobuleId;
        ctx.save();
        ctx.translate(p.x, p.y);

        // Organic surface-tension wobble contour
        ctx.beginPath();
        const pts = 18;
        for (let i = 0; i <= pts; i++) {
          const ang = (i / pts) * Math.PI * 2;
          const wob =
            1 +
            0.09 * Math.sin(ang * 2 + g.phase) +
            0.05 * Math.cos(ang * 3 - g.phase * 1.4);
          const rr = g.radius * wob;
          const px = Math.cos(ang) * rr;
          const py = Math.sin(ang) * rr;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();

        ctx.fillStyle = 'rgba(56, 189, 248, 0.56)';
        ctx.fill();

        ctx.strokeStyle = isHov ? '#fde047' : 'rgba(224, 242, 254, 0.92)';
        ctx.lineWidth = isHov ? 2.4 : 1.5;
        ctx.stroke();

        // Crisp 3D specular highlight crescent
        ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
        ctx.beginPath();
        ctx.ellipse(-g.radius * 0.34, -g.radius * 0.32, g.radius * 0.28, g.radius * 0.14, -0.62, 0, Math.PI * 2);
        ctx.fill();

        // Secondary rim bounce dot
        ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
        ctx.beginPath();
        ctx.arc(-g.radius * 0.1, -g.radius * 0.52, Math.max(1.2, g.radius * 0.08), 0, Math.PI * 2);
        ctx.fill();

        // Prompt badge for clicking
        ctx.font = '700 10px "Noto Sans SC", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = isHov ? '#fde047' : '#bae6fd';
        ctx.fillText('点吸回收', 0, g.radius + 13);
        ctx.restore();
      }

      // Particles inside chamber
      particles.draw(ctx);

      // ---- 11. Physics Overlay (V) ----
      if (physicsOverlay) {
        drawPhysicsOverlay(cab, lampX, fanCx, fanCy);
      }

      ctx.restore();

      // Crisp growth chamber viewport frame (no linear glass gradient/glassViewport helper)
      ctx.strokeStyle = 'rgba(125, 211, 252, 0.35)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.roundRect(cab.innerX, cab.innerY, cab.innerW, cab.innerH, 8);
      ctx.stroke();

      ctx.restore();
    }

    function drawGrowingPlant(cab: CabinetRect): void {
      if (nodes.length < 2) return;
      const healthT = clamp(vitality / 100, 0, 1);
      const stemR = Math.round(lerp(180, 52, healthT));
      const stemG = Math.round(lerp(155, 211, healthT));
      const stemB = Math.round(lerp(48, 102, healthT));
      const leafColor = `rgb(${stemR}, ${stemG}, ${stemB})`;
      const leafDark = `rgb(${Math.round(stemR * 0.68)}, ${Math.round(stemG * 0.72)}, ${Math.round(stemB * 0.72)})`;

      const pts = nodes.map((n, idx) => {
        const p = plantPosToScreen(cab, n.xNorm, n.yNorm);
        const sway = Math.sin(elapsed * (fanOn ? 5.2 : 1.7) + idx * 0.45) * (fanOn ? 4.2 : 1.5) * (idx / nodes.length);
        return { x: p.x + sway, y: p.y, node: n };
      });

      ctx.save();
      // Main flexible stem
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 1; i < pts.length; i++) {
        const p0 = pts[i - 1];
        const p1 = pts[i];
        const thickness = lerp(5.5, 2.2, i / pts.length);
        ctx.strokeStyle = leafDark;
        ctx.lineWidth = thickness + 1.5;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();

        ctx.strokeStyle = leafColor;
        ctx.lineWidth = thickness;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
      }

      // Rosette / basal leaves at root crown
      const base = pts[0];
      const rosetteCount = levelIndex === 0 ? 4 : 6;
      for (let r = 0; r < rosetteCount; r++) {
        const side = r % 2 === 0 ? -1 : 1;
        const spread = 14 + Math.min(20, growth * 28) + (r >> 1) * 5;
        const ang = side * (0.45 + (r >> 1) * 0.32);
        ctx.save();
        ctx.translate(base.x, base.y - 3);
        ctx.rotate(ang + Math.sin(elapsed * 2 + r) * 0.04);
        ctx.fillStyle = leafColor;
        ctx.beginPath();
        ctx.ellipse(side * spread * 0.55, -2, spread * 0.55, levelIndex === 0 ? 6.5 : 3.8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Side leaves along stem nodes with glowing subsurface scattering highlights
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i];
        const side = i % 2 === 0 ? 1 : -1;
        const maturity = clamp((growth - p.node.growthAt) * 3.5 + 0.35, 0.2, 1);
        const leafLen = (levelIndex === 0 ? 18 : 30) * maturity;
        const leafWid = (levelIndex === 0 ? 7.5 : 4.6) * maturity;
        const droop = (1 - healthT) * 0.35;
        const windTilt = fanOn ? 0.22 : 0;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(side * (-0.42 + droop) + windTilt);

        // Flat sunlit leaf blade fill (no per-leaf gradient)
        ctx.fillStyle = leafColor;
        ctx.strokeStyle = leafDark;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(side * leafLen * 0.55, -leafWid, side * leafLen, 0);
        ctx.quadraticCurveTo(side * leafLen * 0.55, leafWid * 0.9, 0, 0);
        ctx.fill();
        ctx.stroke();

        // Leaf veins
        ctx.strokeStyle = `rgba(187, 247, 208, ${(0.38 + photosynRate * 0.42).toFixed(2)})`;
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(side * 2, 0);
        ctx.quadraticCurveTo(side * leafLen * 0.5, -leafWid * 0.18, side * leafLen * 0.88, 0);
        ctx.moveTo(side * leafLen * 0.32, 0);
        ctx.lineTo(side * leafLen * 0.5, -leafWid * 0.48);
        ctx.moveTo(side * leafLen * 0.56, 0);
        ctx.lineTo(side * leafLen * 0.72, leafWid * 0.44);
        ctx.stroke();
        ctx.restore();
      }

      const tip = pts[pts.length - 1];
      if (levelIndex === 0) {
        // Arabidopsis: tiny emerald bud -> 4-petal crisp white blossoms
        if (growth > 0.62) {
          const bloomT = clamp((growth - 0.62) / 0.3, 0, 1);
          const flowerOffsets = [
            [0, -4],
            [-11, 5],
            [11, 6],
          ];
          for (let f = 0; f < flowerOffsets.length; f++) {
            if (f > 0 && growth < 0.76) continue;
            const fx = tip.x + flowerOffsets[f][0];
            const fy = tip.y + flowerOffsets[f][1];
            const petalR = (4 + 3.5 * bloomT) * (f === 0 ? 1.15 : 0.85);
            ctx.save();
            ctx.translate(fx, fy);
            ctx.fillStyle = '#f8fafc';
            for (let pe = 0; pe < 4; pe++) {
              ctx.rotate(Math.PI * 0.5);
              ctx.beginPath();
              ctx.ellipse(petalR * 0.72, 0, petalR * 0.65, petalR * 0.42, 0, 0, Math.PI * 2);
              ctx.fill();
            }
            ctx.fillStyle = '#fde047';
            ctx.beginPath();
            ctx.arc(0, 0, petalR * 0.36, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        } else {
          ctx.fillStyle = '#86efac';
          ctx.beginPath();
          ctx.arc(tip.x, tip.y - 2, 4.5, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        // Wheat / Rice: lush golden ripening spike ears once stage >= 3 (growth > 0.52)
        if (growth > 0.52) {
          const earT = clamp((growth - 0.52) / 0.46, 0, 1);
          const ripeR = Math.round(lerp(134, 250, earT));
          const ripeG = Math.round(lerp(239, 204, earT));
          const ripeB = Math.round(lerp(128, 36, earT));
          const grainCol = `rgb(${ripeR}, ${ripeG}, ${ripeB})`;
          const grainCount = Math.floor(4 + earT * 7);
          const earAngles = levelIndex === 2 ? [-0.24, 0, 0.24] : [-0.14, 0.14];

          for (const ea of earAngles) {
            ctx.save();
            ctx.translate(tip.x, tip.y + 4);
            ctx.rotate(ea + (fanOn ? 0.14 : 0));
            for (let g = 0; g < grainCount; g++) {
              const gy = -g * 5.2;
              const side = g % 2 === 0 ? -1 : 1;
              ctx.fillStyle = grainCol;
              ctx.strokeStyle = 'rgba(120, 72, 14, 0.55)';
              ctx.lineWidth = 0.8;
              ctx.beginPath();
              ctx.ellipse(side * 3.4, gy, 3.8, 2.3, side * 0.45, 0, Math.PI * 2);
              ctx.fill();
              ctx.stroke();

              // Delicate wheat awns
              ctx.strokeStyle = `rgba(${ripeR}, ${ripeG}, ${ripeB}, 0.55)`;
              ctx.beginPath();
              ctx.moveTo(side * 5, gy - 1);
              ctx.lineTo(side * 8.5, gy - 10);
              ctx.stroke();
            }
            ctx.restore();
          }
        } else {
          ctx.fillStyle = '#86efac';
          ctx.beginPath();
          ctx.ellipse(tip.x, tip.y - 4, 3.5, 6.5, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.restore();
    }

    function drawCapillaryRootTray(cab: CabinetRect): void {
      const mNorm = clamp(moisture / 100, 0, 1);
      // Ceramic porous substrate color shifts from dry sandy terracotta -> rich moist umber -> cyan oversaturated
      const rSub = Math.round(lerp(138, 56, mNorm));
      const gSub = Math.round(lerp(98, 48, mNorm));
      const bSub = Math.round(lerp(66, 54, mNorm));

      ctx.save();
      ctx.fillStyle = `rgb(${rSub}, ${gSub}, ${bSub})`;
      ctx.fillRect(cab.innerX, cab.trayY, cab.innerW, cab.trayH);

      // Oversaturation cyan capillary sheen
      if (moisture > 65) {
        const wetAlpha = clamp((moisture - 65) / 40, 0, 0.45);
        ctx.fillStyle = `rgba(56, 189, 248, ${wetAlpha})`;
        ctx.fillRect(cab.innerX, cab.trayY, cab.innerW, cab.trayH);
      }

      // Porous ceramic granules texture
      ctx.fillStyle = 'rgba(255, 245, 230, 0.12)';
      for (let i = 0; i < 42; i++) {
        const px = cab.innerX + ((i * 53 + 17) % Math.max(10, Math.floor(cab.innerW - 12)));
        const py = cab.trayY + 8 + ((i * 29) % Math.max(8, Math.floor(cab.trayH - 14)));
        ctx.beginPath();
        ctx.arc(px, py, 2.1 + (i % 3) * 0.7, 0, Math.PI * 2);
        ctx.fill();
      }

      // Branching microgravity root filaments glowing softly inside cutaway
      const rootCx = cab.innerX + cab.innerW * 0.5;
      const rootReach = 24 + growth * Math.min(130, cab.innerW * 0.24);
      ctx.strokeStyle =
        moisture > 82
          ? 'rgba(248, 113, 113, 0.75)'
          : moisture < 30
            ? 'rgba(251, 191, 36, 0.75)'
            : 'rgba(226, 248, 226, 0.78)';
      ctx.lineWidth = 1.6;
      for (let b = -3; b <= 3; b++) {
        const spread = (b / 3) * rootReach;
        const depth = cab.trayH * (0.45 + (1 - Math.abs(b) / 4) * 0.36);
        ctx.beginPath();
        ctx.moveTo(rootCx, cab.trayY + 3);
        ctx.quadraticCurveTo(
          rootCx + spread * 0.45,
          cab.trayY + depth * 0.55,
          rootCx + spread,
          cab.trayY + depth
        );
        ctx.stroke();
      }

      // Capillary drip emitter nozzle highlight on pulse
      if (dripPulseAnim > 0) {
        ctx.fillStyle = `rgba(56, 189, 248, ${(0.34 * dripPulseAnim).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(rootCx, cab.trayY + 12, 22 * dripPulseAnim, 0, Math.PI * 2);
        ctx.fill();
      }

      // Top rim divider of tray
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cab.innerX, cab.trayY);
      ctx.lineTo(cab.innerX + cab.innerW, cab.trayY);
      ctx.stroke();

      ctx.font = '600 10px "JetBrains Mono", monospace';
      ctx.fillStyle = 'rgba(226, 232, 240, 0.8)';
      ctx.fillText('多孔陶粒毛细基质 CAPILLARY MATRIX', cab.innerX + 10, cab.trayY + cab.trayH - 8);
      ctx.restore();
    }

    function drawPhysicsOverlay(
      cab: CabinetRect,
      lampX: number,
      fanCx: number,
      fanCy: number
    ): void {
      ctx.save();

      // 1. Wavelength Spectrum Mix Readout beside LED lamp
      const bluePct = Math.round((1 - redRatio) * 100);
      const redPct = Math.round(redRatio * 100);
      const boxW = 148;
      const boxX = clamp(lampX + 74, cab.innerX + 10, cab.innerX + cab.innerW - boxW - 10);
      const boxY = cab.railY + 24;
      ctx.fillStyle = 'rgba(6, 15, 32, 0.86)';
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxW, 38, 6);
      ctx.fill();
      ctx.stroke();

      ctx.font = '700 10px "JetBrains Mono", monospace';
      ctx.fillStyle = '#93c5fd';
      ctx.fillText(`450nm ${bluePct}%`, boxX + 8, boxY + 14);
      ctx.fillStyle = '#fca5a5';
      ctx.textAlign = 'right';
      ctx.fillText(`660nm ${redPct}%`, boxX + boxW - 8, boxY + 14);
      ctx.textAlign = 'left';

      // Mini dual wavelength spectrum bar
      const barX = boxX + 8;
      const barY = boxY + 22;
      const barW = boxW - 16;
      ctx.fillStyle = '#3b82f6';
      ctx.fillRect(barX, barY, barW * (1 - redRatio), 7);
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(barX + barW * (1 - redRatio), barY, barW * redRatio, 7);

      // 2. Phototropic Growth Vector Arrow from stem apex toward LED Lamp
      if (nodes.length > 0) {
        const tip = nodes[nodes.length - 1];
        const tp = plantPosToScreen(cab, tip.xNorm, tip.yNorm);
        const dx = lampX - tp.x;
        const dy = cab.railY + 18 - tp.y;
        const d = Math.hypot(dx, dy) || 1;
        const vecLen = Math.min(72, d * 0.55);
        drawVectorArrow(
          ctx,
          tp.x,
          tp.y,
          tp.x + (dx / d) * vecLen,
          tp.y + (dy / d) * vecLen,
          '#fde047',
          '向光生长矢量 F_photo',
          2.2
        );
      }

      // 3. Airflow / Boundary-Layer Convection Arrows
      if (fanOn) {
        drawVectorArrow(
          ctx,
          fanCx + 28,
          fanCy - 18,
          fanCx + 115,
          fanCy - 24,
          '#38bdf8',
          '强制对流破除气膜',
          2
        );
        drawVectorArrow(
          ctx,
          fanCx + 28,
          fanCy + 16,
          fanCx + 105,
          fanCy + 20,
          '#38bdf8',
          undefined,
          2
        );
      } else if (boundaryLayer > 0.25) {
        ctx.font = '700 10.5px "JetBrains Mono", monospace';
        ctx.fillStyle = '#fbbf24';
        ctx.fillText(
          `无浮力对流 δ_CO2 = ${Math.round(boundaryLayer * 100)}%`,
          fanCx + 28,
          fanCy + 4
        );
      }

      // 4. Capillary Saturation Gauge overlaid on Root Zone
      const gaugeW = Math.min(200, cab.innerW * 0.36);
      const gaugeX = cab.innerX + cab.innerW - gaugeW - 12;
      const gaugeY = cab.trayY + 10;
      ctx.fillStyle = 'rgba(6, 15, 32, 0.85)';
      ctx.fillRect(gaugeX, gaugeY, gaugeW, 14);
      // Optimal green window 45..75%
      ctx.fillStyle = 'rgba(34, 197, 94, 0.32)';
      ctx.fillRect(gaugeX + gaugeW * 0.45, gaugeY, gaugeW * 0.3, 14);
      // Current fill marker
      const markerX = gaugeX + gaugeW * clamp(moisture / 100, 0, 1);
      ctx.fillStyle = moisture >= 45 && moisture <= 75 ? '#4ade80' : '#f59e0b';
      ctx.fillRect(markerX - 2, gaugeY - 2, 4, 18);
      ctx.strokeStyle = 'rgba(148, 197, 255, 0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(gaugeX, gaugeY, gaugeW, 14);
      ctx.font = '700 9.5px "JetBrains Mono", monospace';
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText(`毛细饱和度 ${Math.round(moisture)}% [绿区45-75%]`, gaugeX, gaugeY + 26);

      // 5. Surface tension vector annotation on first floating globule
      if (globules.length > 0) {
        const g = globules[0];
        const gp = plantPosToScreen(cab, g.xNorm, g.yNorm);
        drawVectorArrow(ctx, gp.x + g.radius + 18, gp.y - 16, gp.x + g.radius * 0.4, gp.y - 4, '#7dd3fc', '表面张力 γ', 1.6);
      }

      ctx.restore();
    }

    // ---- Pointer & Keyboard Input ----
    function getCanvasPoint(ev: PointerEvent): { x: number; y: number } {
      const rect = canvas.getBoundingClientRect();
      return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
    }

    const onPointerDown = (ev: PointerEvent) => {
      if (paused || finished) return;
      const pt = getCanvasPoint(ev);
      const { width, height } = hi.getSize();
      const cab = getCabinetRect(width, height);

      // 1. Check click on any floating water globule first!
      for (const g of globules) {
        const gp = plantPosToScreen(cab, g.xNorm, g.yNorm);
        if (dist(pt.x, pt.y, gp.x, gp.y) <= g.radius + 20) {
          captureGlobule(g, cab);
          syncDeckInputs();
          return;
        }
      }

      // 2. Check click on fan to toggle directly on canvas
      const fanCx = cab.innerX + 26;
      const fanCy = lerp(cab.railY + 46, cab.trayY - 26, 0.52);
      if (dist(pt.x, pt.y, fanCx, fanCy) <= 28) {
        toggleFan();
        return;
      }

      // 3. Check drag on lamp or top rail area
      if (
        pt.x >= cab.innerX &&
        pt.x <= cab.innerX + cab.innerW &&
        pt.y >= cab.railY - 26 &&
        pt.y <= cab.railY + 48
      ) {
        draggingLamp = true;
        lampXNorm = clamp((pt.x - cab.innerX) / cab.innerW, 0.14, 0.86);
        syncDeckInputs();
        canvas.setPointerCapture?.(ev.pointerId);
      }
    };

    const onPointerMove = (ev: PointerEvent) => {
      const pt = getCanvasPoint(ev);
      const { width, height } = hi.getSize();
      const cab = getCabinetRect(width, height);

      if (draggingLamp && !paused && !finished) {
        lampXNorm = clamp((pt.x - cab.innerX) / cab.innerW, 0.14, 0.86);
        syncDeckInputs();
        canvas.style.cursor = 'grabbing';
        return;
      }

      hoverGlobuleId = null;
      for (const g of globules) {
        const gp = plantPosToScreen(cab, g.xNorm, g.yNorm);
        if (dist(pt.x, pt.y, gp.x, gp.y) <= g.radius + 18) {
          hoverGlobuleId = g.id;
          break;
        }
      }

      const lampX = cab.innerX + lampXNorm * cab.innerW;
      hoverLamp =
        Math.abs(pt.x - lampX) <= 78 && pt.y >= cab.railY - 20 && pt.y <= cab.railY + 36;

      const fanCx = cab.innerX + 26;
      const fanCy = lerp(cab.railY + 46, cab.trayY - 26, 0.52);
      const hoverFan = dist(pt.x, pt.y, fanCx, fanCy) <= 26;

      canvas.style.cursor = hoverGlobuleId !== null || hoverFan ? 'pointer' : hoverLamp ? 'grab' : 'default';
    };

    const onPointerUp = (ev: PointerEvent) => {
      if (draggingLamp) {
        draggingLamp = false;
        canvas.releasePointerCapture?.(ev.pointerId);
        canvas.style.cursor = 'default';
      }
    };

    const onKeyDown = (ev: KeyboardEvent) => {
      if (paused || finished) return;
      const k = ev.key.toLowerCase();
      // Never intercept global shell keys
      if (/^[1-8]$/.test(ev.key) || ['tab', 'escape', 'v', 'r', 'm', 'f', '?'].includes(k)) {
        return;
      }
      const isInputFocused = (ev.target as HTMLElement | null)?.tagName === 'INPUT';
      if (ev.code === 'Space') {
        ev.preventDefault();
        if (!ev.repeat) triggerCapillaryDrip();
        return;
      }
      if (k === 'e' && !ev.repeat) {
        ev.preventDefault();
        toggleFan();
        return;
      }
      if (isInputFocused && k.startsWith('arrow')) return;
      if (['a', 'd', 'q', 'c', 'arrowleft', 'arrowright'].includes(k)) {
        keysHeld.add(k);
      }
    };

    const onKeyUp = (ev: KeyboardEvent) => {
      keysHeld.delete(ev.key.toLowerCase());
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    function frame(now: number): void {
      if (destroyed) return;
      const dt = clamp((now - lastTs) / 1000, 0, 0.05);
      lastTs = now;
      updateSimulation(dt);
      drawScene();
      rafId = requestAnimationFrame(frame);
    }

    initLevel(levelIndex);
    lastTs = performance.now();
    rafId = requestAnimationFrame(frame);

    return {
      destroy(): void {
        destroyed = true;
        cancelAnimationFrame(rafId);
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        host.hud.clearTactileDeck();
        hi.destroy();
      },
      setLevel(idx: number): void {
        initLevel(idx);
      },
      restart(): void {
        initLevel(levelIndex);
      },
      setPaused(p: boolean): void {
        paused = p;
        if (p) {
          keysHeld.clear();
          draggingLamp = false;
        }
      },
      setPhysicsOverlay(enabled: boolean): void {
        physicsOverlay = enabled;
      },
    };
  },
};
