import {
  angleDiff,
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
  drawAdditiveGlow,
  drawBackdropImage,
  drawCinematicVignette,
  drawGlassViewport,
  drawSunLensFlare,
  drawTitaniumModule,
  getMLIPattern,
} from '../../core/materials';
import type {
  GameHostAPI,
  GameInstance,
  GameModule,
  GameResult,
  MetricStatus,
} from '../../core/game-interface';

interface FlareEvent {
  warnStart: number;
  start: number;
  end: number;
  warned: boolean;
  activeToast: boolean;
  safeToast: boolean;
  endedToast: boolean;
}

interface SolarLevelConfig {
  name: string;
  subtitle: string;
  objective: string;
  targetOrbits: number;
  orbitDuration: number; // seconds per simulated 90-min orbit
  sunlitFraction: number; // 0..1 of orbit in sunlight
  pMaxKw: number;
  batteryCapKws: number;
  startBatteryPct: number;
  p1Kw: number;
  p2Kw: number;
  p3Kw: number;
  p2ScoreRate: number;
  p3ScoreRate: number;
  hasHullShadow: boolean;
  flares: { warnStart: number; start: number; end: number }[];
  scienceTarget3Star: number;
  effTarget3Star: number;
  minBatt3Star: number;
  codexId: string;
}

const LEVELS: SolarLevelConfig[] = [
  {
    name: '常规昼夜循环',
    subtitle: '2个轨道周期 · 阳照余弦蓄能与地影保电',
    objective: '完成 2 圈轨道昼夜轮转，旋转双翼追踪太阳为锂电池蓄能，地影期合理卸载保 P1 生保',
    targetOrbits: 2,
    orbitDuration: 25,
    sunlitFraction: 0.55,
    pMaxKw: 108,
    batteryCapKws: 720,
    startBatteryPct: 62,
    p1Kw: 28,
    p2Kw: 18,
    p3Kw: 32,
    p2ScoreRate: 4.5,
    p3ScoreRate: 11.5,
    hasHullShadow: false,
    flares: [],
    scienceTarget3Star: 195,
    effTarget3Star: 0.78,
    minBatt3Star: 20,
    codexId: 'solar-eclipse',
  },
  {
    name: '重载科研窗口',
    subtitle: '高功耗科研柜 · 舱体阴影遮挡优化',
    objective: '避开舱体动态阴影遮挡，阳照期全力运行 P3 科学实验柜冲击 ≥ 220 科研分，地影期护航生保',
    targetOrbits: 2,
    orbitDuration: 27,
    sunlitFraction: 0.56,
    pMaxKw: 116,
    batteryCapKws: 720,
    startBatteryPct: 60,
    p1Kw: 28,
    p2Kw: 18,
    p3Kw: 36,
    p2ScoreRate: 4.5,
    p3ScoreRate: 14.5,
    hasHullShadow: true,
    flares: [],
    scienceTarget3Star: 225,
    effTarget3Star: 0.75,
    minBatt3Star: 16,
    codexId: 'solar-cosine',
  },
  {
    name: '太阳耀斑防护',
    subtitle: '剧烈昼夜交替 · 2波 CME 耀斑顺桨避险',
    objective: '在 2 波太阳耀斑抵达前将双翼顺桨（|cos θ| < 0.22）规避过载损毁，随后迅速恢复追日供电',
    targetOrbits: 2,
    orbitDuration: 29,
    sunlitFraction: 0.57,
    pMaxKw: 122,
    batteryCapKws: 760,
    startBatteryPct: 68,
    p1Kw: 28,
    p2Kw: 18,
    p3Kw: 32,
    p2ScoreRate: 4.5,
    p3ScoreRate: 12.5,
    hasHullShadow: false,
    flares: [
      { warnStart: 4.5, start: 8.5, end: 13.8 },
      { warnStart: 33.5, start: 37.5, end: 43.0 },
    ],
    scienceTarget3Star: 175,
    effTarget3Star: 0.72,
    minBatt3Star: 14,
    codexId: 'solar-flare',
  },
];

const WING_MIN_DEG = -135;
const WING_MAX_DEG = 135;
const WING_SLEW_DEG_PER_SEC = 148;
const KEY_ROT_DEG_PER_SEC = 105;
const FEATHER_COS_THRESHOLD = 0.22;

interface BusRect {
  id: 'p1' | 'p2' | 'p3';
  x: number;
  y: number;
  w: number;
  h: number;
}

export const solarGame: GameModule = {
  meta: {
    id: 'solar',
    number: '02',
    shortTitle: '太阳翼能源',
    title: '太阳翼追日调度',
    enTitle: 'SOLAR WING & ECLIPSE',
    moduleName: '双太阳翼/能源总线',
    genre: '实时能源策略',
    tagline: '驾驭90分钟昼夜地影期与余弦追日定律保障全站供电',
    accent: '#f59e0b',
    hubAnchor: { x: 0.17, y: 0.22 },
    briefingSteps: [
      {
        title: '余弦追日最大化发电',
        desc: '拖拽画面、拖动滑块或按 A/D 旋转双太阳翼，使帆板法线正对入射阳光（P = Pmax·cos θ），阳照期尽快蓄满电池。',
      },
      {
        title: '地影期分级卸载配电',
        desc: '观察左侧轨道图进入地球本影的倒计时。地影期光伏发电归零，及时关闭 P3 科研/P2 测控，誓保 P1 环控生保不断电！',
      },
      {
        title: '耀斑预警一键顺桨',
        desc: '遭遇 CME 太阳耀斑预警时，4 秒内将太阳翼侧对阳光（|cos θ| < 0.22）或按 Space 一键顺桨，风暴过后立即恢复追日。',
      },
    ],
    controlsHint: '画面拖拽 或 A/D / ←→ 旋翼 · Q/E 切换 P2/P3 负载 · Space 一键顺桨 · C 自动微调',
    levels: LEVELS.map((l, index) => ({
      index,
      name: l.name,
      subtitle: l.subtitle,
      objective: l.objective,
    })),
    codexIds: ['solar-eclipse', 'solar-cosine', 'solar-flare'],
  },

  mount(canvasHost: HTMLElement, host: GameHostAPI): GameInstance {
    const stars = new StarfieldRenderer(190, 202);
    const particles = new ParticleSystem();

    let levelIndex = clamp(host.getLevel(), 0, LEVELS.length - 1);
    let paused = host.isPaused();
    let physicsOverlay = host.hud.isPhysicsOverlayEnabled();
    let destroyed = false;

    let width = 960;
    let height = 600;
    const handle = setupHiDPICanvas(canvasHost, (w, h) => {
      width = w;
      height = h;
    });
    const sz = handle.getSize();
    width = sz.width;
    height = sz.height;

    // Simulation state
    let simTime = 0;
    let wingDeg = -55; // current wing normal angle relative to zenith (0 = straight UP, -90 = left, +90 = right)
    let targetWingDeg = -55;
    let batteryKws = 440;
    let wingIntegrity = 100;
    let sciencePoints = 0;
    let p2On = true;
    let p3On = true;
    let minBatteryPct = 100;
    let sunlitEffSum = 0;
    let sunlitEffTime = 0;
    let shadowOccluded = false;
    let shadowCenterDeg = 22;

    // Auto-trim assist & feather states
    let autoTrimRemain = 0;
    let autoTrimCooldown = 0;
    let featherActive = false;

    // Live derived telemetry
    let isSunlit = true;
    let wasSunlit = true;
    let eclipseBlend = 0; // 0 = sunlit leo-earth, 1 = eclipse earth-night (aurora & city lights)
    let sunDeg = -60; // angle relative to zenith (-72°..+72° during sunlit)
    let currentGenKw = 0;
    let currentLoadKw = 78;
    let currentCos = 1;
    let currentIncidenceDeg = 0;
    let currentOrbitProgress = 0; // 0..targetOrbits
    let phaseTimeRemain = 0;

    // CME Flare state
    let flares: FlareEvent[] = [];
    let activeFlareState: 'none' | 'warning' | 'active' = 'none';
    let flareCountdown = 0;
    let flareRemaining = 0;
    let flareSafeFeathered = false;
    let flareAlarmCooldown = 0;
    let flareDamageFlash = 0;

    // Outcome & toasts
    let phase: 'playing' | 'finished' = 'playing';
    let resultSent = false;
    let toastLowBattShown = false;
    let toastShadowShown = false;
    let toastEclipseCount = 0;
    let toastSunriseShown = false;
    let packetPhase = 0;

    // Input & drag state
    let keyLeft = false;
    let keyRight = false;
    let isDragging = false;
    let canvasBusRects: BusRect[] = [];

    // Tactile deck references
    let sliderEl: HTMLInputElement | null = null;
    let sliderValEl: HTMLElement | null = null;
    let autoTrimBtn: HTMLButtonElement | null = null;
    let featherBtn: HTMLButtonElement | null = null;
    let p1Btn: HTMLButtonElement | null = null;
    let p2Btn: HTMLButtonElement | null = null;
    let p3Btn: HTMLButtonElement | null = null;

    const computeFeatherAngle = (curSunDeg: number): number => {
      const optA = curSunDeg + 90;
      const optB = curSunDeg - 90;
      const validA = optA >= WING_MIN_DEG && optA <= WING_MAX_DEG;
      const validB = optB >= WING_MIN_DEG && optB <= WING_MAX_DEG;
      if (validA && validB) {
        return Math.abs(optA - wingDeg) <= Math.abs(optB - wingDeg) ? optA : optB;
      }
      if (validA) return optA;
      if (validB) return optB;
      return clamp(optA, WING_MIN_DEG, WING_MAX_DEG);
    };

    const triggerFeather = (): void => {
      if (paused || phase !== 'playing') return;
      autoTrimRemain = 0;
      featherActive = true;
      targetWingDeg = computeFeatherAngle(sunDeg);
      host.audio.playSwitch();
      syncDeckUI();
      if (activeFlareState === 'none') {
        host.hud.pushToast('已下达顺桨指令：双太阳翼正转向侧对阳光（低迎风面/低辐照态）。', 'info', '顺桨模式');
      }
    };

    const triggerAutoTrim = (): void => {
      if (paused || phase !== 'playing') return;
      if (activeFlareState === 'active') {
        host.audio.playWarning();
        host.hud.pushToast('耀斑冲击期间禁止对日追踪！请保持顺桨状态。', 'critical', '防护联锁');
        return;
      }
      if (autoTrimCooldown > 0) return;
      featherActive = false;
      autoTrimRemain = 2.6;
      autoTrimCooldown = 6.5;
      host.audio.playSwitch();
      syncDeckUI();
    };

    const toggleP2 = (): void => {
      if (paused || phase !== 'playing') return;
      p2On = !p2On;
      host.audio.playSwitch();
      syncDeckUI();
    };

    const toggleP3 = (): void => {
      if (paused || phase !== 'playing') return;
      p3On = !p3On;
      host.audio.playSwitch();
      syncDeckUI();
    };

    const syncDeckUI = (): void => {
      const cfg = LEVELS[levelIndex];
      if (sliderEl && !isDragging) {
        const rounded = Math.round(targetWingDeg);
        if (sliderEl.value !== String(rounded)) sliderEl.value = String(rounded);
      }
      if (sliderValEl) {
        const sign = targetWingDeg >= 0 ? '+' : '';
        sliderValEl.textContent = `${sign}${Math.round(targetWingDeg)}°`;
      }
      if (autoTrimBtn) {
        if (autoTrimRemain > 0) {
          autoTrimBtn.textContent = `◎ 追日 ${autoTrimRemain.toFixed(1)}s`;
          autoTrimBtn.classList.add('is-active');
        } else if (autoTrimCooldown > 0) {
          autoTrimBtn.textContent = `◎ 微调 (${Math.ceil(autoTrimCooldown)}s)`;
          autoTrimBtn.classList.remove('is-active');
        } else {
          autoTrimBtn.textContent = '◎ 微调 C';
          autoTrimBtn.classList.remove('is-active');
        }
      }
      if (featherBtn) {
        featherBtn.classList.toggle('is-active', featherActive);
        featherBtn.classList.toggle('is-danger', activeFlareState !== 'none' && !flareSafeFeathered);
        featherBtn.textContent =
          activeFlareState !== 'none' ? '◈ 顺桨 Space!' : '◈ 顺桨 Space';
      }
      if (p1Btn) {
        p1Btn.textContent = `P1 ${cfg.p1Kw}kW`;
      }
      if (p2Btn) {
        p2Btn.textContent = `P2 ${cfg.p2Kw}kW ${p2On ? '●' : '○'}`;
        p2Btn.classList.toggle('is-active', p2On);
      }
      if (p3Btn) {
        p3Btn.textContent = `P3 ${cfg.p3Kw}kW ${p3On ? '●' : '○'}`;
        p3Btn.classList.toggle('is-active', p3On);
        p3Btn.classList.toggle('is-gold', p3On);
      }
    };

    const buildTactileDeck = (): void => {
      host.hud.clearTactileDeck();
      const deck = host.hud.getTactileDeck();

      // Slider group for wing normal angle
      const sliderGroup = document.createElement('div');
      sliderGroup.className = 'deck-slider-group';
      const lbl = document.createElement('span');
      lbl.textContent = '翼角';
      sliderEl = document.createElement('input');
      sliderEl.type = 'range';
      sliderEl.min = String(WING_MIN_DEG);
      sliderEl.max = String(WING_MAX_DEG);
      sliderEl.step = '1';
      sliderEl.value = String(Math.round(targetWingDeg));
      sliderEl.style.width = '84px';
      sliderEl.setAttribute('aria-label', '太阳翼法线角度');
      sliderEl.addEventListener('input', () => {
        if (paused || phase !== 'playing') return;
        featherActive = false;
        autoTrimRemain = 0;
        targetWingDeg = Number(sliderEl!.value);
        syncDeckUI();
      });
      sliderValEl = document.createElement('span');
      sliderValEl.className = 'mono-num';
      sliderValEl.style.minWidth = '38px';
      sliderValEl.style.textAlign = 'right';
      sliderGroup.append(lbl, sliderEl, sliderValEl);

      // Auto-trim button
      autoTrimBtn = document.createElement('button');
      autoTrimBtn.type = 'button';
      autoTrimBtn.className = 'deck-ctrl-btn';
      autoTrimBtn.title = '触发 2.6 秒自动对日微调 (C)';
      autoTrimBtn.addEventListener('click', triggerAutoTrim);

      // Feather shield button
      featherBtn = document.createElement('button');
      featherBtn.type = 'button';
      featherBtn.className = 'deck-ctrl-btn is-gold';
      featherBtn.title = '一键将双太阳翼转至侧对阳光顺桨避险 (Space)';
      featherBtn.addEventListener('click', triggerFeather);

      // P1 locked breaker
      p1Btn = document.createElement('button');
      p1Btn.type = 'button';
      p1Btn.className = 'deck-ctrl-btn is-active';
      p1Btn.title = '核心生命保障母线（硬件联锁不可断开）';
      p1Btn.addEventListener('click', () => {
        host.audio.playWarning();
        host.hud.pushToast('P1 环控生保母线涉及乘组生命安全，硬件联锁禁止断开！', 'caution', '配电联锁');
      });

      // P2 breaker
      p2Btn = document.createElement('button');
      p2Btn.type = 'button';
      p2Btn.className = 'deck-ctrl-btn is-active';
      p2Btn.title = '切换测控通信母线供电 (Q)';
      p2Btn.addEventListener('click', toggleP2);

      // P3 breaker
      p3Btn = document.createElement('button');
      p3Btn.type = 'button';
      p3Btn.className = 'deck-ctrl-btn is-active is-gold';
      p3Btn.title = '切换科学实验柜母线供电，产出高额科研分 (E)';
      p3Btn.addEventListener('click', toggleP3);

      deck.append(sliderGroup, autoTrimBtn, featherBtn, p1Btn, p2Btn, p3Btn);
      syncDeckUI();
    };

    const resetLevel = (idx: number): void => {
      levelIndex = clamp(idx, 0, LEVELS.length - 1);
      const cfg = LEVELS[levelIndex];

      simTime = 0;
      sunDeg = -68;
      wingDeg = -62;
      targetWingDeg = -62;
      batteryKws = (cfg.startBatteryPct / 100) * cfg.batteryCapKws;
      wingIntegrity = 100;
      sciencePoints = 0;
      p2On = true;
      p3On = true;
      minBatteryPct = cfg.startBatteryPct;
      sunlitEffSum = 0;
      sunlitEffTime = 0;
      shadowOccluded = false;
      shadowCenterDeg = 18;

      autoTrimRemain = 0;
      autoTrimCooldown = 0;
      featherActive = false;

      isSunlit = true;
      wasSunlit = true;
      eclipseBlend = 0;
      currentGenKw = cfg.pMaxKw;
      currentLoadKw = cfg.p1Kw + cfg.p2Kw + cfg.p3Kw;
      currentCos = 1;
      currentIncidenceDeg = 0;
      currentOrbitProgress = 0;
      phaseTimeRemain = cfg.orbitDuration * cfg.sunlitFraction;

      flares = cfg.flares.map((f) => ({
        ...f,
        warned: false,
        activeToast: false,
        safeToast: false,
        endedToast: false,
      }));
      activeFlareState = 'none';
      flareCountdown = 0;
      flareRemaining = 0;
      flareSafeFeathered = false;
      flareAlarmCooldown = 0;
      flareDamageFlash = 0;

      phase = 'playing';
      resultSent = false;
      toastLowBattShown = false;
      toastShadowShown = false;
      toastEclipseCount = 0;
      toastSunriseShown = false;
      keyLeft = false;
      keyRight = false;
      isDragging = false;

      particles.clear();
      syncDeckUI();

      host.hud.setObjective(cfg.objective);
      host.hud.setMetrics([
        { id: 'power', label: '光伏发电 / 负载', value: `${Math.round(currentGenKw)} / ${currentLoadKw} kW`, status: 'nominal' },
        {
          id: 'battery',
          label: '锂电池储量',
          value: `${Math.round(cfg.startBatteryPct)}%`,
          ratio: cfg.startBatteryPct / 100,
          status: 'nominal',
        },
        {
          id: 'cos',
          label: levelIndex === 2 ? '余弦效率 / 翼完好' : '余弦追日效率',
          value: levelIndex === 2 ? '99% · 100%' : '99% (θ=6°)',
          ratio: 0.99,
          status: 'nominal',
        },
        {
          id: 'orbit',
          label: '轨道 / 科研分',
          value: `0.0/${cfg.targetOrbits}圈 · 0分`,
          ratio: 0,
          status: 'info',
        },
      ]);

      if (levelIndex === 0) {
        host.hud.pushToast('拖动画面或按 A/D 让双太阳翼紧跟金色光束，地影到来前把电池充饱！', 'info', '阳照追日');
      } else if (levelIndex === 1) {
        host.hud.pushToast('注意暗色舱体阴影扇区：避开阴影遮挡，阳照期开启 P3 科研柜赚取高分！', 'caution', '阴影规避');
      } else {
        host.hud.pushToast('空间天气监测：本周期预计有 2 波 CME 太阳耀斑，听到警报请立即按 Space 顺桨！', 'caution', '空间天气预警');
      }
    };

    const finishMission = (won: boolean, failReason?: string): void => {
      if (resultSent) return;
      resultSent = true;
      phase = 'finished';
      keyLeft = false;
      keyRight = false;
      isDragging = false;

      const cfg = LEVELS[levelIndex];
      const avgEff = sunlitEffTime > 0.5 ? sunlitEffSum / sunlitEffTime : 0.7;
      const finalBattPct = (batteryKws / cfg.batteryCapKws) * 100;
      const sciRounded = Math.round(sciencePoints);

      if (won) {
        const score = Math.round(
          sciRounded * 1.65 + avgEff * 340 + minBatteryPct * 2.4 + wingIntegrity * 1.8
        );

        let stars: 1 | 2 | 3 = 1;
        const meets3Star =
          sciRounded >= cfg.scienceTarget3Star &&
          avgEff >= cfg.effTarget3Star &&
          minBatteryPct >= cfg.minBatt3Star &&
          wingIntegrity >= (levelIndex === 2 ? 84 : 95);

        if (meets3Star) {
          stars = 3;
        } else if (
          (sciRounded >= cfg.scienceTarget3Star * 0.62 && wingIntegrity >= 60) ||
          score >= 620
        ) {
          stars = 2;
        }

        const scienceCards = [
          {
            title: '90分钟轨道昼夜轮转与锂电储能',
            gameAction: `你完成了 2 圈完整轨道，平均追日余弦效率 ${Math.round(avgEff * 100)}%，并在两次地影黑夜中稳住了 P1 生命保障供电（最低电量 ${Math.round(minBatteryPct)}%）。`,
            realStationFact: '中国空间站约 92 分钟绕地球一圈，每天经历 16 次日出日落。在长达 ~37 分钟的地影区里太阳翼发电为零，全靠阳照期蓄满的高比能锂离子蓄电池组撑过黑夜。',
            realData: '轨道周期 ~92 min | 阳照 ~55 min / 地影 ~37 min',
            codexId: 'solar-eclipse',
          },
          {
            title: '双自由度对日定向与余弦发电定律',
            gameAction: `你在避开舱体阴影遮挡的同时，保持了 ${Math.round(avgEff * 100)}% 的余弦跟踪效率并高效产出 ${sciRounded} 点科学实验成果！`,
            realStationFact: '光伏电池接收到的太阳辐射功率遵循余弦定律 P = Pmax·cos θ。问天/梦天实验舱 55 米柔性三结砷化镓太阳翼配备对日定向机构，并通过姿轨联合优化避开相邻舱段阴影。',
            realData: '柔性三结砷化镓太阳翼 | 转换效率 > 30% | 全站发电 > 100 kW',
            codexId: 'solar-cosine',
          },
          {
            title: '空间天气 CME 太阳耀斑与顺桨分级保护',
            gameAction: `你在 2 波日冕物质抛射冲击中保住了 ${Math.round(wingIntegrity)}% 太阳翼完好度与全站能源母线，实现零断电安全通关！`,
            realStationFact: '强烈太阳耀斑伴随高能带电粒子流与电磁脉冲，可能击穿光伏阵列并诱发高压直流母线过载。真实空间站会结合空间天气预报执行负载卸载与翼面姿态防护。',
            realData: '100V 高压直流母线 | P1/P2/P3 三级优先级配电保护',
            codexId: 'solar-flare',
          },
        ];

        const result: GameResult = {
          levelIndex,
          won: true,
          stars,
          score,
          summary:
            stars === 3
              ? '卓越的空间站能源调度官！追日效率、地影保电与科研产出全部拉满 3★！'
              : stars === 2
              ? '稳定保障全站供电完成 2 圈轨道！多在阳照期运行 P3 科学柜并紧跟太阳可冲击 3★。'
              : '安全度过所有地影周期！下次提升余弦追日效率并在安全余量下开启科研载荷拿更高星级。',
          metrics: [
            { label: '科研总产出', value: `${sciRounded} pts`, status: sciRounded >= cfg.scienceTarget3Star ? 'nominal' : 'info' },
            { label: '阳照平均余弦效率', value: `${Math.round(avgEff * 100)}%`, status: avgEff >= cfg.effTarget3Star ? 'nominal' : 'caution' },
            { label: '最低 / 剩余电量', value: `${Math.round(minBatteryPct)}% / ${Math.round(finalBattPct)}%`, status: minBatteryPct >= cfg.minBatt3Star ? 'nominal' : 'caution' },
            { label: '太阳翼结构完好度', value: `${Math.round(wingIntegrity)}%`, status: wingIntegrity >= 85 ? 'nominal' : 'caution' },
          ],
          scienceCard: scienceCards[levelIndex],
        };
        host.completeLevel(result);
      } else {
        const isWingFail = wingIntegrity <= 0.1;
        const result: GameResult = {
          levelIndex,
          won: false,
          stars: 0,
          score: Math.round(sciRounded + currentOrbitProgress * 80),
          summary:
            failReason ??
            (isWingFail
              ? '太阳耀斑高能粒子流烧毁了迎面暴露的光伏电池阵！收到 4 秒预警后请立刻按 Space 顺桨。'
              : '锂离子蓄电池耗尽，P1 环控生保母线失电！进入地影前务必蓄满电量并关闭 P3/P2 负载。'),
          metrics: [
            { label: '已完成轨道', value: `${currentOrbitProgress.toFixed(2)} / ${cfg.targetOrbits} 圈`, status: 'info' },
            { label: '失败原因', value: isWingFail ? '太阳翼耀斑过载' : 'P1 生保母线失电', status: 'critical' },
            { label: '科研产出', value: `${sciRounded} pts`, status: 'info' },
            { label: '阳照平均效率', value: `${Math.round(avgEff * 100)}%`, status: 'caution' },
          ],
          scienceCard: {
            title: isWingFail ? '太阳耀斑顺桨防护原理' : '地影期负载分级卸载策略',
            gameAction: isWingFail
              ? '太阳翼在 CME 耀斑窗内仍大角度正对太阳（|cos θ| ≥ 0.22），导致光伏阵过载损伤。'
              : '进入地球本影后光伏发电骤降为 0 kW，同时保持高功耗载荷迅速抽干了蓄电池。',
            realStationFact: isWingFail
              ? '当帆板法线与入射流垂直（顺桨，|cos θ| → 0）时，截面积降至最小，大幅削减高能粒子与过载电流冲击。'
              : '真实空间站配电遵循严格优先级：当储能紧张时自动或手动卸载 P3 科学实验柜，优先确保 P1 制氧与热控不断电。',
            realData: isWingFail
              ? '顺桨安全判据 |cos θ| < 0.22 | 提前 4 秒预报窗口'
              : 'P1 环控生保 28kW（必保） | P2 测控 18kW | P3 实验柜 32–36kW',
            codexId: isWingFail ? 'solar-flare' : 'solar-eclipse',
          },
        };
        host.completeLevel(result);
      }
    };

    // Layout helper keeping all visual zones cleanly inside safe play area (120 .. height-130)
    const getLayout = () => {
      const safeTop = 128;
      const safeBottom = Math.max(safeTop + 210, height - 134);
      const centerY = safeTop + (safeBottom - safeTop) * 0.48;
      const stationX = width * 0.49;
      const stationY = centerY + 6;
      const wingHalfSpan = clamp(Math.min(width * 0.145, (safeBottom - safeTop) * 0.34), 84, 134);

      // Left Orbital Mini-Diagram (safely below top-left HUD ~162px and above bottom-left HUD)
      const miniR = clamp(width * 0.046, 38, 52);
      const miniX = clamp(miniR + 48, 86, 138);
      const miniY = clamp(centerY - 12, 224, safeBottom - 95);

      // Right Power Bus Panel (safely below top-right telemetry ~158px and above bottom-right toasts)
      const busW = clamp(width * 0.165, 148, 196);
      const busX = width - busW - 18;
      const busTopY = clamp(centerY - 118, 174, Math.max(174, safeBottom - 265));

      return { safeTop, safeBottom, centerY, stationX, stationY, wingHalfSpan, miniX, miniY, miniR, busX, busTopY, busW };
    };

    // Pointer drag to aim solar wing normal directly + click canvas load bus cards
    const aimWingFromPointer = (clientX: number, clientY: number): void => {
      const rect = handle.canvas.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      const layout = getLayout();
      const dx = px - layout.stationX;
      const dy = py - layout.stationY;
      if (Math.hypot(dx, dy) < 16) return;
      // Angle relative to zenith (straight UP = 0°, right = +90°, left = -90°)
      const degFromZenith = (Math.atan2(dx, -dy) * 180) / Math.PI;
      featherActive = false;
      autoTrimRemain = 0;
      targetWingDeg = clamp(degFromZenith, WING_MIN_DEG, WING_MAX_DEG);
      syncDeckUI();
    };

    const onPointerDown = (e: PointerEvent): void => {
      if (paused || host.isPaused() || phase !== 'playing') return;
      const rect = handle.canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;

      // Check if clicking one of the interactive Canvas Load Bus cards
      for (const b of canvasBusRects) {
        if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) {
          if (b.id === 'p1') {
            host.audio.playWarning();
            host.hud.pushToast('P1 环控生保母线不可断开！请通过卸载 P2/P3 保存电量。', 'caution', '配电联锁');
          } else if (b.id === 'p2') {
            toggleP2();
          } else {
            toggleP3();
          }
          return;
        }
      }

      isDragging = true;
      handle.canvas.setPointerCapture(e.pointerId);
      aimWingFromPointer(e.clientX, e.clientY);
    };

    const onPointerMove = (e: PointerEvent): void => {
      if (paused || phase !== 'playing') return;
      if (isDragging) {
        handle.canvas.style.cursor = 'grabbing';
        aimWingFromPointer(e.clientX, e.clientY);
        return;
      }
      const rect = handle.canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const onCard = canvasBusRects.some(
        (b) => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h
      );
      handle.canvas.style.cursor = onCard ? 'pointer' : 'grab';
    };

    const onPointerUp = (e: PointerEvent): void => {
      if (!isDragging) return;
      isDragging = false;
      handle.canvas.style.cursor = 'grab';
      if (handle.canvas.hasPointerCapture(e.pointerId)) {
        handle.canvas.releasePointerCapture(e.pointerId);
      }
    };

    // Keyboard controls (zero conflict with main.ts 1-8, M, F, V, R, ?, Tab, Esc)
    const onKeyDown = (e: KeyboardEvent): void => {
      if (paused || host.isPaused() || phase !== 'playing') return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const k = e.key.toLowerCase();
      if (k === 'a' || e.key === 'ArrowLeft') {
        e.preventDefault();
        keyLeft = true;
        featherActive = false;
        autoTrimRemain = 0;
      } else if (k === 'd' || e.key === 'ArrowRight') {
        e.preventDefault();
        keyRight = true;
        featherActive = false;
        autoTrimRemain = 0;
      } else if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        triggerFeather();
      } else if (k === 'c') {
        e.preventDefault();
        triggerAutoTrim();
      } else if (k === 'q') {
        e.preventDefault();
        toggleP2();
      } else if (k === 'e') {
        e.preventDefault();
        toggleP3();
      }
    };

    const onKeyUp = (e: KeyboardEvent): void => {
      const k = e.key.toLowerCase();
      if (k === 'a' || e.key === 'ArrowLeft') keyLeft = false;
      if (k === 'd' || e.key === 'ArrowRight') keyRight = false;
    };

    const onWindowBlur = (): void => {
      keyLeft = false;
      keyRight = false;
      isDragging = false;
    };

    handle.canvas.addEventListener('pointerdown', onPointerDown);
    handle.canvas.addEventListener('pointermove', onPointerMove);
    handle.canvas.addEventListener('pointerup', onPointerUp);
    handle.canvas.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWindowBlur);

    // Simulation step
    const update = (dt: number): void => {
      if (phase !== 'playing') {
        particles.update(dt);
        return;
      }

      const cfg = LEVELS[levelIndex];
      const layout = getLayout();

      simTime += dt;
      packetPhase += dt;
      particles.update(dt);
      if (flareAlarmCooldown > 0) flareAlarmCooldown -= dt;
      if (flareDamageFlash > 0) flareDamageFlash = Math.max(0, flareDamageFlash - dt * 2.5);
      if (autoTrimCooldown > 0) autoTrimCooldown = Math.max(0, autoTrimCooldown - dt);

      // Orbital cycle progress
      const totalDuration = cfg.targetOrbits * cfg.orbitDuration;
      currentOrbitProgress = clamp(simTime / cfg.orbitDuration, 0, cfg.targetOrbits);
      const orbitFrac = (simTime % cfg.orbitDuration) / cfg.orbitDuration;
      isSunlit = orbitFrac < cfg.sunlitFraction;
      eclipseBlend = lerp(eclipseBlend, isSunlit ? 0 : 1, clamp(dt * 1.9, 0, 1));

      if (isSunlit) {
        const sunU = orbitFrac / cfg.sunlitFraction; // 0..1 across sunlit arc
        sunDeg = -72 + sunU * 144; // sweeps from -72° (sunrise left) -> 0° (noon) -> +72° (sunset right)
        phaseTimeRemain = (cfg.sunlitFraction - orbitFrac) * cfg.orbitDuration;
      } else {
        const eclU = (orbitFrac - cfg.sunlitFraction) / (1 - cfg.sunlitFraction);
        sunDeg = 72 - eclU * 144; // behind Earth returning toward sunrise
        phaseTimeRemain = (1 - orbitFrac) * cfg.orbitDuration;
      }

      // Transition toasts: Eclipse Entry & Orbital Sunrise
      if (wasSunlit && !isSunlit) {
        toastEclipseCount++;
        host.audio.playBeep(360, 0.14);
        host.hud.pushToast(
          `进入地球本影区！光伏发电归零（持续 ${Math.round((1 - cfg.sunlitFraction) * cfg.orbitDuration)}s），建议立即断开 P3 科学柜保护电池。`,
          'caution',
          '地影黑夜'
        );
      } else if (!wasSunlit && isSunlit && simTime > 2) {
        host.audio.playBeep(660, 0.12);
        if (!toastSunriseShown) {
          toastSunriseShown = true;
          host.hud.pushToast(
            '轨道日出！太阳已升至左侧 -72° 方位，迅速转回太阳翼对日蓄能并重启科研载荷！',
            'nominal',
            '轨道日出'
          );
        }
      }
      wasSunlit = isSunlit;

      // Evaluate CME Solar Flare events (Level 3)
      activeFlareState = 'none';
      flareCountdown = 0;
      flareRemaining = 0;
      for (const f of flares) {
        if (simTime >= f.warnStart && simTime < f.start) {
          activeFlareState = 'warning';
          flareCountdown = f.start - simTime;
          if (!f.warned) {
            f.warned = true;
            host.audio.playWarning();
            host.hud.pushToast(
              '⚠ CME 太阳耀斑 4 秒后抵达！立刻按 Space 一键顺桨或手动转至侧对阳光（|cos θ| < 0.22）！',
              'critical',
              '太阳耀斑预警'
            );
          }
        } else if (simTime >= f.start && simTime <= f.end) {
          activeFlareState = 'active';
          flareRemaining = f.end - simTime;
          if (!f.activeToast) {
            f.activeToast = true;
            autoTrimRemain = 0;
            host.audio.playWarning();
          }
        } else if (simTime > f.end && !f.endedToast) {
          f.endedToast = true;
          featherActive = false;
          host.audio.playBeep(720, 0.12);
          host.hud.pushToast(
            '✓ CME 太阳耀斑已过境！立刻拖动太阳翼或按 C 恢复追日蓄能，准备迎接下一段地影！',
            'nominal',
            '警报解除'
          );
        }
      }

      // Keyboard manual wing rotation
      if (keyLeft) {
        targetWingDeg = clamp(targetWingDeg - KEY_ROT_DEG_PER_SEC * dt, WING_MIN_DEG, WING_MAX_DEG);
      }
      if (keyRight) {
        targetWingDeg = clamp(targetWingDeg + KEY_ROT_DEG_PER_SEC * dt, WING_MIN_DEG, WING_MAX_DEG);
      }

      // Auto-trim assist (brief pulse)
      if (autoTrimRemain > 0) {
        autoTrimRemain = Math.max(0, autoTrimRemain - dt);
        if (isSunlit && activeFlareState !== 'active') {
          let desired = sunDeg;
          // On Level 2, auto-trim gently biases slightly off shadow core too
          if (cfg.hasHullShadow && Math.abs(desired - shadowCenterDeg) < 15) {
            desired += desired >= shadowCenterDeg ? 17 : -17;
          }
          targetWingDeg = clamp(desired, WING_MIN_DEG, WING_MAX_DEG);
        }
      } else if (featherActive) {
        // Keep wings cleanly feathered edge-on to moving sun
        targetWingDeg = computeFeatherAngle(sunDeg);
      }

      // Smooth mechanical alpha-gimbal slew
      const deltaDeg = targetWingDeg - wingDeg;
      const maxStep = WING_SLEW_DEG_PER_SEC * dt;
      if (Math.abs(deltaDeg) <= maxStep) {
        wingDeg = targetWingDeg;
      } else {
        wingDeg += Math.sign(deltaDeg) * maxStep;
      }

      // Compute shortest incidence angle θ and Cosine Law efficiency
      const incRad = Math.abs(angleDiff((sunDeg * Math.PI) / 180, (wingDeg * Math.PI) / 180));
      currentIncidenceDeg = (incRad * 180) / Math.PI;
      const rawCos = Math.cos(incRad);
      const posCos = Math.max(0, rawCos);
      currentCos = posCos;

      // Level 2 dynamic hull shadow band
      shadowOccluded = false;
      let shadowMultiplier = 1;
      if (cfg.hasHullShadow && isSunlit) {
        shadowCenterDeg = sunDeg + Math.sin(simTime * 0.42 + 0.6) * 26;
        if (Math.abs(wingDeg - shadowCenterDeg) < 17) {
          shadowOccluded = true;
          shadowMultiplier = 0.68; // partial single-wing occlusion -> 32% drop
          if (!toastShadowShown) {
            toastShadowShown = true;
            host.hud.pushToast(
              '左侧太阳翼落入舱体动态阴影扇区（发电骤降 32%）！稍微偏转翼角避开阴影带即可回升功率。',
              'caution',
              '舱体阴影遮挡'
            );
          }
        }
      }

      // Solar Flare physics & damage
      flareSafeFeathered = Math.abs(rawCos) < FEATHER_COS_THRESHOLD;
      if (activeFlareState === 'active') {
        // Spawn dramatic CME plasma streaks across viewport
        if (Math.random() < 0.72) {
          const sunRad = ((sunDeg - 90) * Math.PI) / 180;
          const rayX = -Math.cos(sunRad);
          const rayY = -Math.sin(sunRad);
          const perpX = -rayY;
          const perpY = rayX;
          const offset = (Math.random() - 0.5) * width * 0.9;
          particles.spawn({
            x: layout.stationX - rayX * 360 + perpX * offset,
            y: layout.stationY - rayY * 360 + perpY * offset,
            vx: rayX * (420 + Math.random() * 180),
            vy: rayY * (420 + Math.random() * 180),
            life: 0.65,
            size: 2.8 + Math.random() * 2.2,
            color: Math.random() < 0.5 ? '#fb7185' : '#fbbf24',
          });
        }

        if (flareSafeFeathered) {
          // Feathered safely! Bonus engineering score
          sciencePoints += 7.5 * dt;
          for (const f of flares) {
            if (simTime >= f.start && simTime <= f.end && !f.safeToast) {
              f.safeToast = true;
              host.audio.playLock();
              host.hud.pushToast(
                '✓ 顺桨防护生效（|cos θ| < 0.22）！CME 高能粒子流正安全掠过太阳翼边缘。',
                'nominal',
                '顺桨成功'
              );
            }
          }
        } else {
          // Exposed to CME -> wing overload damage!
          const exposure = Math.abs(rawCos) - 0.16;
          wingIntegrity = Math.max(0, wingIntegrity - exposure * 28 * dt);
          flareDamageFlash = 0.85;
          if (flareAlarmCooldown <= 0) {
            host.audio.playCritical();
            flareAlarmCooldown = 0.55;
            particles.burst(layout.stationX, layout.stationY, 12, '#ef4444', 110, 3.0, 0.5);
          }
          if (wingIntegrity <= 0) {
            finishMission(false, '太阳耀斑击穿了未顺桨的太阳翼光伏阵列，主供电母线瘫痪！');
            return;
          }
        }
      }

      // Compute generation & load power (kW)
      if (!isSunlit) {
        currentGenKw = 0;
      } else if (activeFlareState === 'active') {
        // During CME, feathered wings produce negligible safe trickle; unfeathered surges are shunted to protect bus
        currentGenKw = flareSafeFeathered ? 4 : cfg.pMaxKw * 0.18;
      } else {
        currentGenKw = cfg.pMaxKw * posCos * shadowMultiplier;
        sunlitEffSum += posCos * shadowMultiplier * dt;
        sunlitEffTime += dt;
      }

      currentLoadKw = cfg.p1Kw + (p2On ? cfg.p2Kw : 0) + (p3On ? cfg.p3Kw : 0);
      const netKw = currentGenKw - currentLoadKw;
      batteryKws = clamp(batteryKws + netKw * dt, 0, cfg.batteryCapKws);
      const battPct = (batteryKws / cfg.batteryCapKws) * 100;
      minBatteryPct = Math.min(minBatteryPct, battPct);

      // Science & comms score accrual
      if (p2On) sciencePoints += cfg.p2ScoreRate * dt;
      if (p3On) sciencePoints += cfg.p3ScoreRate * dt;

      // Low battery contextual alert
      if (!toastLowBattShown && battPct <= 22 && netKw < 0) {
        toastLowBattShown = true;
        host.audio.playWarning();
        host.hud.pushToast(
          '蓄电池电量低于 22%！请立刻断开 P3 科研柜与 P2 测控，全力保住 P1 环控生保！',
          'critical',
          '低电量告急'
        );
      }

      // Blackout failure
      if (batteryKws <= 0.01) {
        finishMission(false, '锂离子蓄电池完全耗尽，P1 环控生保系统断电，任务紧急中止！');
        return;
      }

      // Victory check: completed required orbits!
      if (simTime >= totalDuration) {
        finishMission(true);
        return;
      }

      // Update event-driven HUD metrics
      const powerStatus: MetricStatus =
        netKw >= 0 ? 'nominal' : netKw > -35 ? 'caution' : 'critical';
      const battStatus: MetricStatus =
        battPct > 42 ? 'nominal' : battPct > 20 ? 'caution' : 'critical';

      host.hud.updateMetric('power', {
        value: `${Math.round(currentGenKw)} / ${currentLoadKw} kW`,
        status: powerStatus,
      });
      host.hud.updateMetric('battery', {
        value: `${Math.round(battPct)}%`,
        ratio: battPct / 100,
        status: battStatus,
      });

      if (levelIndex === 2) {
        const cosStatus: MetricStatus =
          activeFlareState === 'active'
            ? flareSafeFeathered
              ? 'nominal'
              : 'critical'
            : wingIntegrity < 65
            ? 'caution'
            : posCos > 0.78 || !isSunlit
            ? 'nominal'
            : 'caution';
        const valText =
          activeFlareState === 'active'
            ? `${flareSafeFeathered ? '已顺桨' : '暴露!'} · 翼${Math.round(wingIntegrity)}%`
            : `${isSunlit ? Math.round(posCos * 100) + '%' : '地影'} · 翼${Math.round(wingIntegrity)}%`;
        host.hud.updateMetric('cos', {
          value: valText,
          ratio: wingIntegrity / 100,
          status: cosStatus,
        });
      } else {
        const effPct = isSunlit ? Math.round(posCos * shadowMultiplier * 100) : 0;
        const cosStatus: MetricStatus = !isSunlit
          ? 'info'
          : shadowOccluded
          ? 'caution'
          : effPct >= 82
          ? 'nominal'
          : effPct >= 50
          ? 'caution'
          : 'critical';
        host.hud.updateMetric('cos', {
          value: isSunlit
            ? `${effPct}% (θ=${Math.round(currentIncidenceDeg)}°)`
            : '地影期 (0 kW)',
          ratio: effPct / 100,
          status: cosStatus,
        });
      }

      host.hud.updateMetric('orbit', {
        value: `${currentOrbitProgress.toFixed(1)}/${cfg.targetOrbits}圈 · ${Math.round(sciencePoints)}分`,
        ratio: currentOrbitProgress / cfg.targetOrbits,
        status: sciencePoints >= cfg.scienceTarget3Star ? 'nominal' : 'info',
      });

      syncDeckUI();
    };

    // ---------------- Canvas 2D Rendering ----------------

    const drawSunlightOrFlareBackdrop = (
      ctx: CanvasRenderingContext2D,
      sx: number,
      sy: number
    ): void => {
      if (!isSunlit) {
        // Subtle deep night tint so glowing aurora & city lights on earth-night remain dramatic
        ctx.fillStyle = `rgba(2, 6, 18, ${(0.14 * eclipseBlend).toFixed(3)})`;
        ctx.fillRect(0, 0, width, height);
        return;
      }

      // Direction FROM station TOWARD sun (0° = straight UP -> canvas angle -PI/2)
      const toSunRad = ((sunDeg - 90) * Math.PI) / 180;
      const sunDist = Math.max(width, height) * 0.56;
      const sunX = sx + Math.cos(toSunRad) * sunDist;
      const sunY = sy + Math.sin(toSunRad) * sunDist;

      ctx.save();
      // Parallel sunbeam shafts sweeping from sun across space station
      const rayDirX = -Math.cos(toSunRad);
      const rayDirY = -Math.sin(toSunRad);
      const perpX = -rayDirY;
      const perpY = rayDirX;

      const isFlare = activeFlareState === 'active';
      const isWarn = activeFlareState === 'warning';
      const pulse = 0.8 + 0.2 * Math.sin(simTime * (isFlare ? 14 : 3.2));
      const sunVis = clamp(1 - eclipseBlend * 0.85, 0.15, 1);

      // Wide ambient golden / crimson-gold solar wash
      ctx.globalCompositeOperation = 'lighter';
      const wash = ctx.createRadialGradient(sunX, sunY, 20, sx, sy, Math.max(width, height) * 0.74);
      if (isFlare) {
        wash.addColorStop(0, `rgba(251, 113, 133, ${(0.42 * pulse).toFixed(3)})`);
        wash.addColorStop(0.45, `rgba(245, 158, 11, ${(0.22 * pulse).toFixed(3)})`);
        wash.addColorStop(1, 'rgba(15, 5, 10, 0)');
      } else if (isWarn) {
        wash.addColorStop(0, `rgba(251, 191, 36, ${(0.32 * pulse).toFixed(3)})`);
        wash.addColorStop(0.5, 'rgba(249, 115, 22, 0.13)');
        wash.addColorStop(1, 'rgba(10, 15, 30, 0)');
      } else {
        wash.addColorStop(0, `rgba(253, 224, 71, ${(0.24 * sunVis).toFixed(3)})`);
        wash.addColorStop(0.5, `rgba(245, 158, 11, ${(0.08 * sunVis).toFixed(3)})`);
        wash.addColorStop(1, 'rgba(10, 15, 30, 0)');
      }
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, width, height);

      // Parallel animated light beams
      const beamCount = isFlare ? 9 : 6;
      for (let i = 0; i < beamCount; i++) {
        const u = ((i / (beamCount - 1)) - 0.5) * 320;
        const bx1 = sx - rayDirX * 360 + perpX * u;
        const by1 = sy - rayDirY * 360 + perpY * u;
        const bx2 = sx + rayDirX * 340 + perpX * u;
        const by2 = sy + rayDirY * 340 + perpY * u;

        const g = ctx.createLinearGradient(bx1, by1, bx2, by2);
        if (isFlare) {
          g.addColorStop(0, 'rgba(251, 113, 133, 0)');
          g.addColorStop(0.35, `rgba(244, 63, 94, ${(0.32 * pulse).toFixed(3)})`);
          g.addColorStop(0.65, `rgba(251, 191, 36, ${(0.26 * pulse).toFixed(3)})`);
          g.addColorStop(1, 'rgba(251, 113, 133, 0)');
        } else {
          g.addColorStop(0, 'rgba(254, 240, 138, 0)');
          g.addColorStop(0.4, `rgba(253, 224, 71, ${(0.14 * sunVis).toFixed(3)})`);
          g.addColorStop(1, 'rgba(245, 158, 11, 0)');
        }
        ctx.strokeStyle = g;
        ctx.lineWidth = isFlare ? 11 : 16;
        ctx.beginPath();
        ctx.moveTo(bx1, by1);
        ctx.lineTo(bx2, by2);
        ctx.stroke();
      }

      // Cinematic Orbital Sun with Anamorphic Lens Flare & Intense Crimson-Gold CME Bloom
      const orbR = Math.min(width * 0.31, (height - 230) * 0.54);
      const orbX = sx + Math.cos(toSunRad) * orbR;
      const orbY = clamp(sy + Math.sin(toSunRad) * orbR, 68, height - 160);

      if (isFlare) {
        drawAdditiveGlow(ctx, orbX, orbY, 148 * pulse, '244, 63, 94', 0.62 * pulse);
        drawAdditiveGlow(ctx, orbX, orbY, 82 * pulse, '251, 146, 60', 0.75 * pulse);
        drawSunLensFlare(ctx, orbX, orbY, 30, 1.38 * pulse);
        // Expanding CME coronal shockwave ring
        const shockR = 36 + ((simTime * 125) % 105);
        const shockA = clamp(1 - (shockR - 36) / 105, 0, 1) * 0.55;
        ctx.strokeStyle = `rgba(251, 113, 133, ${shockA.toFixed(3)})`;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.arc(orbX, orbY, shockR, 0, Math.PI * 2);
        ctx.stroke();
      } else if (isWarn) {
        drawAdditiveGlow(ctx, orbX, orbY, 92 * pulse, '245, 158, 11', 0.48 * pulse);
        drawSunLensFlare(ctx, orbX, orbY, 24, 1.12 * pulse);
      } else {
        drawSunLensFlare(ctx, orbX, orbY, 21, 0.96 * sunVis);
      }

      ctx.restore();
    };

    const drawOrbitalMiniDiagram = (
      ctx: CanvasRenderingContext2D,
      cx: number,
      cy: number,
      r: number
    ): void => {
      const cfg = LEVELS[levelIndex];
      const orbitFrac = (simTime % cfg.orbitDuration) / cfg.orbitDuration;
      // Map orbit angle: 0..sunlitFrac sweeps sunlit half (left/top/bottom facing left Sun), sunlitFrac..1 passes right Umbra cone
      // Let Sun be on the LEFT (-x). Umbra shadow extends to the RIGHT (+x), spanning ±alpha around angle 0.
      const eclipseHalfAng = (1 - cfg.sunlitFraction) * Math.PI;
      let thetaOrb: number;
      if (orbitFrac < cfg.sunlitFraction) {
        const u = orbitFrac / cfg.sunlitFraction;
        // Start just exiting eclipse at +eclipseHalfAng, sweep CCW (around top -> left -> bottom) to 2*PI - eclipseHalfAng
        thetaOrb = eclipseHalfAng + u * (Math.PI * 2 - 2 * eclipseHalfAng);
      } else {
        const u = (orbitFrac - cfg.sunlitFraction) / (1 - cfg.sunlitFraction);
        thetaOrb = -eclipseHalfAng + u * (2 * eclipseHalfAng);
      }

      ctx.save();
      // Glass card backdrop
      const boxW = r * 2 + 34;
      const boxH = r * 2 + 56;
      ctx.fillStyle = 'rgba(8, 18, 35, 0.84)';
      ctx.beginPath();
      ctx.roundRect(cx - boxW / 2, cy - r - 24, boxW, boxH, 10);
      ctx.fill();
      ctx.strokeStyle = isSunlit ? 'rgba(245, 158, 11, 0.42)' : 'rgba(56, 189, 248, 0.55)';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // Header text
      ctx.font = '700 10px "JetBrains Mono", "Noto Sans SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText('90MIN 轨道昼夜相位', cx, cy - r - 10);

      // Incoming sunlight arrows on left edge
      ctx.strokeStyle = 'rgba(253, 224, 71, 0.65)';
      ctx.lineWidth = 1.2;
      for (const dy of [-14, 0, 14]) {
        ctx.beginPath();
        ctx.moveTo(cx - r - 12, cy + dy);
        ctx.lineTo(cx - r + 2, cy + dy);
        ctx.stroke();
      }

      // Earth Umbra Shadow Cone extending right (+x)
      const earthR = r * 0.42;
      ctx.fillStyle = 'rgba(2, 6, 20, 0.78)';
      ctx.beginPath();
      ctx.moveTo(cx, cy - earthR);
      ctx.lineTo(cx + r + 14, cy - earthR * 1.15);
      ctx.lineTo(cx + r + 14, cy + earthR * 1.15);
      ctx.lineTo(cx, cy + earthR);
      ctx.closePath();
      ctx.fill();

      // Orbit ring (sunlit arc gold, eclipse arc slate-blue)
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.65)';
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.84, eclipseHalfAng, Math.PI * 2 - eclipseHalfAng);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(99, 102, 241, 0.65)';
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.84, -eclipseHalfAng, eclipseHalfAng);
      ctx.stroke();
      ctx.setLineDash([]);

      // Earth disc (daylit left, night right)
      const eg = ctx.createLinearGradient(cx - earthR, cy, cx + earthR, cy);
      eg.addColorStop(0, '#38bdf8');
      eg.addColorStop(0.5, '#0369a1');
      eg.addColorStop(0.65, '#082f49');
      eg.addColorStop(1, '#020617');
      ctx.fillStyle = eg;
      ctx.beginPath();
      ctx.arc(cx, cy, earthR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(125, 211, 252, 0.6)';
      ctx.lineWidth = 1.1;
      ctx.stroke();

      // Station dot on orbit (canvas Y is down so invert sin for CCW top sweep)
      const stX = cx + Math.cos(thetaOrb) * r * 0.84;
      const stY = cy - Math.sin(thetaOrb) * r * 0.84;
      const dotColor = activeFlareState === 'active' ? '#ef4444' : isSunlit ? '#fde047' : '#38bdf8';
      ctx.fillStyle = dotColor;
      ctx.beginPath();
      ctx.arc(stX, stY, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // Live countdown label
      ctx.font = '700 11px "JetBrains Mono", "Noto Sans SC", sans-serif';
      ctx.fillStyle = isSunlit ? '#fde68a' : '#7dd3fc';
      ctx.fillText(
        isSunlit ? `阳照 · 距地影 ${phaseTimeRemain.toFixed(1)}s` : `地影 · 距日出 ${phaseTimeRemain.toFixed(1)}s`,
        cx,
        cy + r + 18
      );
      ctx.restore();
    };

    const drawStationAndSolarWings = (
      ctx: CanvasRenderingContext2D,
      cx: number,
      cy: number,
      wingHalfSpan: number
    ): void => {
      const cfg = LEVELS[levelIndex];
      const wingRad = (wingDeg * Math.PI) / 180; // 0 = normal pointing UP (-y), wings horizontal along X!
      const litVisual = !isSunlit
        ? 0.16
        : activeFlareState === 'active'
        ? flareSafeFeathered
          ? 0.28
          : 1.0
        : clamp(0.2 + currentCos * (shadowOccluded ? 0.65 : 0.85), 0.16, 1);

      ctx.save();
      ctx.translate(cx, cy);

      // Subtle azimuth tracking compass ring around station
      const dialR = wingHalfSpan + 16;
      ctx.strokeStyle = 'rgba(125, 185, 255, 0.16)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.arc(0, 0, dialR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // Level 2: Dynamic Hull Shadow Occlusion Sector on compass ring
      if (cfg.hasHullShadow && isSunlit) {
        const shCenterRad = ((shadowCenterDeg - 90) * Math.PI) / 180;
        const shHalf = (17 * Math.PI) / 180;
        ctx.fillStyle = shadowOccluded ? 'rgba(239, 68, 68, 0.20)' : 'rgba(15, 23, 42, 0.45)';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, dialR + 6, shCenterRad - shHalf, shCenterRad + shHalf);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = shadowOccluded ? 'rgba(248, 113, 113, 0.72)' : 'rgba(148, 163, 184, 0.45)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(0, 0, dialR + 6, shCenterRad - shHalf, shCenterRad + shHalf);
        ctx.stroke();

        // Shadow badge
        const lx = Math.cos(shCenterRad) * (dialR + 18);
        const ly = Math.sin(shCenterRad) * (dialR + 18);
        ctx.font = '700 10px "Noto Sans SC", monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = shadowOccluded ? '#fca5a5' : '#94a3b8';
        ctx.fillText('舱体阴影区', lx, ly);
      }

      // ---- Rotating Twin Giant Articulating Solar Wings ----
      ctx.save();
      ctx.rotate(wingRad);

      // Central structural brushed titanium gimbal mast boom
      drawTitaniumModule(ctx, -wingHalfSpan - 4, -4, (wingHalfSpan + 4) * 2, 8, {
        radius: 3,
        rivets: false,
        rimGlow: isSunlit ? 'rgba(226, 240, 255, 0.72)' : 'rgba(100, 140, 190, 0.45)',
      });

      const panelLen = wingHalfSpan - 34;
      const panelThick = 28;
      const gap = 30;

      // Left Wing & Right Wing (using shared drawSolarPanelRect!)
      const leftLit = shadowOccluded ? litVisual * 0.35 : litVisual;
      drawSolarPanelRect(ctx, -gap - panelLen, -panelThick / 2, panelLen, panelThick, leftLit);
      drawSolarPanelRect(ctx, gap, -panelThick / 2, panelLen, panelThick, litVisual);

      // Active photovoltaic face highlight bar along TOP edge (-y = normal side!)
      const pvGlow = isSunlit ? clamp(currentCos, 0.15, 1) : 0.12;
      ctx.fillStyle =
        activeFlareState === 'active' && !flareSafeFeathered
          ? 'rgba(239, 68, 68, 0.92)'
          : `rgba(253, 224, 71, ${0.28 + 0.68 * pvGlow})`;
      ctx.fillRect(-gap - panelLen, -panelThick / 2 - 3, panelLen, 3.2);
      ctx.fillRect(gap, -panelThick / 2 - 3, panelLen, 3.2);

      // Volumetric photovoltaic shimmer glow along wing roots when actively generating power
      if (isSunlit && currentGenKw > 25 && !(activeFlareState === 'active' && !flareSafeFeathered)) {
        const gAlpha = clamp(currentGenKw / cfg.pMaxKw, 0.2, 1) * 0.34;
        drawAdditiveGlow(ctx, -gap - panelLen * 0.5, -panelThick * 0.45, panelLen * 0.42, '253, 224, 71', shadowOccluded ? gAlpha * 0.3 : gAlpha);
        drawAdditiveGlow(ctx, gap + panelLen * 0.5, -panelThick * 0.45, panelLen * 0.42, '253, 224, 71', gAlpha);
      }

      // Dark slate backing edge on underside (+y) so sun-facing side is unmistakable
      ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
      ctx.fillRect(-gap - panelLen, panelThick / 2, panelLen, 3);
      ctx.fillRect(gap, panelThick / 2, panelLen, 3);

      // Shadow overlay hatch on left wing when Level 2 hull shadow occludes it
      if (shadowOccluded) {
        ctx.fillStyle = 'rgba(2, 6, 20, 0.52)';
        ctx.fillRect(-gap - panelLen, -panelThick / 2, panelLen, panelThick);
        ctx.strokeStyle = '#f87171';
        ctx.lineWidth = 1.4;
        ctx.strokeRect(-gap - panelLen, -panelThick / 2, panelLen, panelThick);
      }

      // Protective cyan aerodynamic/plasma slipstream shield when safely feathered during flare!
      if (activeFlareState === 'active' && flareSafeFeathered) {
        drawAdditiveGlow(ctx, 0, 0, wingHalfSpan * 0.72, '56, 189, 248', 0.24);
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.88)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(-wingHalfSpan - 6, -panelThick / 2 - 7, (wingHalfSpan + 6) * 2, panelThick + 14, 10);
        ctx.stroke();
      }

      // Small normal indicator chevron at wing center
      drawAdditiveGlow(ctx, 0, -panelThick / 2 - 9, 12, '56, 189, 248', 0.42);
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.moveTo(0, -panelThick / 2 - 14);
      ctx.lineTo(-6, -panelThick / 2 - 5);
      ctx.lineTo(6, -panelThick / 2 - 5);
      ctx.closePath();
      ctx.fill();

      ctx.restore();

      // ---- Stationary Central Space Station Core (Tianhe / Wentian / Mengtian hub) ----
      // Vertical pressurized titanium core hull with crinkled gold MLI thermal bands
      drawTitaniumModule(ctx, -18, -38, 36, 76, {
        vertical: true,
        radius: 9,
        mliBands: [0.1, 0.78],
        rivets: true,
        rimGlow: isSunlit ? 'rgba(241, 248, 255, 0.86)' : 'rgba(100, 150, 210, 0.52)',
      });
      if (eclipseBlend > 0.04) {
        ctx.save();
        ctx.fillStyle = `rgba(4, 10, 26, ${(eclipseBlend * 0.48).toFixed(3)})`;
        ctx.beginPath();
        ctx.roundRect(-18, -38, 36, 76, 9);
        ctx.fill();
        ctx.restore();
      }

      // Volumetric hub energy aura (gold sunlit generation / cyan eclipse standby / crimson CME danger)
      const hubRgb =
        activeFlareState === 'active' && !flareSafeFeathered
          ? '239, 68, 68'
          : currentGenKw > 5
          ? '251, 191, 36'
          : '56, 189, 248';
      const hubGlowAlpha =
        activeFlareState === 'active' && !flareSafeFeathered
          ? 0.65
          : currentGenKw > 5
          ? 0.25 + clamp(currentGenKw / cfg.pMaxKw, 0, 1) * 0.35
          : 0.22;
      drawAdditiveGlow(ctx, 0, 0, 42, hubRgb, hubGlowAlpha);

      // Central alpha-gimbal rotary ring hub with crinkled gold MLI actuator ring
      const mli = getMLIPattern(ctx);
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, 23, 0, Math.PI * 2);
      ctx.fillStyle = mli ?? '#d97706';
      ctx.fill();
      // Cylindrical bevel over gold MLI collar
      const ringBevel = ctx.createLinearGradient(-23, -23, 23, 23);
      ringBevel.addColorStop(0, 'rgba(255, 252, 225, 0.35)');
      ringBevel.addColorStop(0.5, 'rgba(255, 255, 255, 0.05)');
      ringBevel.addColorStop(1, 'rgba(12, 8, 2, 0.62)');
      ctx.fillStyle = ringBevel;
      ctx.fill();
      ctx.strokeStyle = isSunlit ? '#fde68a' : '#7dd3fc';
      ctx.lineWidth = 1.6;
      ctx.stroke();

      // Inner obsidian telemetry housing
      const coreHub = ctx.createRadialGradient(-5, -5, 2, 0, 0, 18);
      coreHub.addColorStop(0, '#1e324d');
      coreHub.addColorStop(1, '#081122');
      ctx.fillStyle = coreHub;
      ctx.beginPath();
      ctx.arc(0, 0, 18.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = activeFlareState === 'active' && !flareSafeFeathered ? '#ef4444' : '#f59e0b';
      ctx.lineWidth = 1.8;
      ctx.stroke();
      ctx.restore();

      // Recessed optical cabin glass viewports with additive glow (dim/red if battery critical)
      const battPct = (batteryKws / cfg.batteryCapKws) * 100;
      const winCrit = battPct <= 20;
      const winPulse = Math.sin(simTime * 10) > 0;
      const winRgb = winCrit ? '239, 68, 68' : '56, 189, 248';
      const winTint = winCrit
        ? winPulse
          ? 'rgba(239, 68, 68, 0.72)'
          : 'rgba(127, 29, 29, 0.45)'
        : 'rgba(56, 189, 248, 0.56)';
      for (const wy of [-29, 29]) {
        drawAdditiveGlow(ctx, 0, wy, 10, winRgb, winCrit ? (winPulse ? 0.65 : 0.2) : 0.42);
        drawGlassViewport(ctx, -4.5, wy - 4, 9, 8, 4, winTint);
      }

      // Central generator power badge
      ctx.font = '700 9.5px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fef3c7';
      ctx.fillText(`${Math.round(currentGenKw)}kW`, 0, 3.2);

      ctx.restore();

      // ---- Physics Overlay (V): Sun Incidence Vector, Normal Vector, Angle Arc θ & Live Formula ----
      if (physicsOverlay) {
        ctx.save();
        const vecLen = wingHalfSpan * 0.72;
        const nRad = ((wingDeg - 90) * Math.PI) / 180;
        const nx = cx + Math.cos(nRad) * vecLen;
        const ny = cy + Math.sin(nRad) * vecLen;
        drawVectorArrow(ctx, cx, cy, nx, ny, '#38bdf8', '法线 n̂', 2.2);

        if (isSunlit) {
          const sRad = ((sunDeg - 90) * Math.PI) / 180;
          const sxEnd = cx + Math.cos(sRad) * (vecLen + 14);
          const syEnd = cy + Math.sin(sRad) * (vecLen + 14);
          drawVectorArrow(ctx, sxEnd, syEnd, cx + Math.cos(sRad) * 20, cy + Math.sin(sRad) * 20, '#fbbf24', '阳光 S', 2.2);

          // Shortest angle θ arc between wing normal and sun direction
          const arcR = 44;
          const diff = angleDiff(sRad, nRad);
          if (Math.abs(diff) > 0.04) {
            ctx.strokeStyle = activeFlareState === 'active' ? '#fb7185' : '#fde047';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(cx, cy, arcR, nRad, nRad + diff, diff < 0);
            ctx.stroke();
            const midA = nRad + diff * 0.5;
            ctx.font = '700 11px "JetBrains Mono", monospace';
            ctx.fillStyle = '#fef08a';
            ctx.textAlign = 'center';
            ctx.fillText(`θ=${Math.round(currentIncidenceDeg)}°`, cx + Math.cos(midA) * (arcR + 18), cy + Math.sin(midA) * (arcR + 18));
          }
        }

        // Live Formula Pill cleanly above station (inside safe play area)
        const formulaY = Math.max(134, cy - wingHalfSpan - 32);
        const formulaText = !isSunlit
          ? '地影本影区 · P = 0.0 kW（纯锂电池组放电供电）'
          : activeFlareState === 'active'
          ? `CME 顺桨判据: |cos(${Math.round(currentIncidenceDeg)}°)| = ${Math.abs(Math.cos((currentIncidenceDeg * Math.PI) / 180)).toFixed(2)} ${flareSafeFeathered ? '< 0.22 ✓ 安全' : '≥ 0.22 ✕ 受损!'}`
          : `P = ${cfg.pMaxKw} · cos(${Math.round(currentIncidenceDeg)}°)${shadowOccluded ? ' × 0.68(阴影)' : ''} = ${currentGenKw.toFixed(1)} kW`;

        ctx.font = '700 11.5px "JetBrains Mono", "Noto Sans SC", monospace';
        const tw = ctx.measureText(formulaText).width + 22;
        ctx.fillStyle = 'rgba(7, 16, 32, 0.86)';
        ctx.beginPath();
        ctx.roundRect(cx - tw / 2, formulaY - 14, tw, 24, 6);
        ctx.fill();
        ctx.strokeStyle = activeFlareState === 'active'
          ? flareSafeFeathered
            ? '#22c55e'
            : '#ef4444'
          : 'rgba(245, 158, 11, 0.55)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.fillStyle = activeFlareState === 'active' && !flareSafeFeathered ? '#fca5a5' : '#fef3c7';
        ctx.textAlign = 'center';
        ctx.fillText(formulaText, cx, formulaY + 2);
        ctx.restore();
      }
    };

    const drawPowerBusAndFlow = (
      ctx: CanvasRenderingContext2D,
      stationX: number,
      stationY: number,
      busX: number,
      busTopY: number,
      busW: number
    ): void => {
      const cfg = LEVELS[levelIndex];
      const battPct = (batteryKws / cfg.batteryCapKws) * 100;
      const netKw = currentGenKw - currentLoadKw;

      const battH = 62;
      const battY = busTopY;
      const cardH = 44;
      const gap = 8;

      const p1Y = battY + battH + 14;
      const p2Y = p1Y + cardH + gap;
      const p3Y = p2Y + cardH + gap;

      canvasBusRects = [
        { id: 'p1', x: busX, y: p1Y, w: busW, h: cardH },
        { id: 'p2', x: busX, y: p2Y, w: busW, h: cardH },
        { id: 'p3', x: busX, y: p3Y, w: busW, h: cardH },
      ];

      ctx.save();

      // ---- Animated Glowing Power Bus Cable from Solar Station -> Lithium Battery Bank ----
      const cableStartX = stationX + 20;
      const cableStartY = stationY;
      const cableEndX = busX;
      const cableEndY = battY + battH / 2;
      const midX = (cableStartX + cableEndX) * 0.52;

      const drawFlowPath = (
        x1: number,
        y1: number,
        mx: number,
        x2: number,
        y2: number,
        active: boolean,
        color: string,
        glowRgb: string,
        speed: number
      ) => {
        if (active) {
          ctx.save();
          ctx.strokeStyle = `rgba(${glowRgb}, 0.24)`;
          ctx.lineWidth = 6.5;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.bezierCurveTo(mx, y1, mx, y2, x2, y2);
          ctx.stroke();
          ctx.restore();
        }
        ctx.strokeStyle = active ? color : 'rgba(100, 116, 139, 0.25)';
        ctx.lineWidth = active ? 2.4 : 1.3;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.bezierCurveTo(mx, y1, mx, y2, x2, y2);
        ctx.stroke();

        if (!active || speed === 0) return;
        // Flowing luminous energy packets along cubic bezier with additive bloom
        const count = 4;
        for (let i = 0; i < count; i++) {
          let t = ((packetPhase * Math.abs(speed) + i / count) % 1);
          if (speed < 0) t = 1 - t;
          const u = 1 - t;
          const px = u * u * u * x1 + 3 * u * u * t * mx + 3 * u * t * t * mx + t * t * t * x2;
          const py = u * u * u * y1 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y2;
          drawAdditiveGlow(ctx, px, py, 14, glowRgb, 0.72);
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(px, py, 2.6, 0, Math.PI * 2);
          ctx.fill();
        }
      };

      const genFlowSpeed = currentGenKw > 2 ? clamp(currentGenKw / 95, 0.35, 1.35) : 0;
      drawFlowPath(
        cableStartX,
        cableStartY,
        midX,
        cableEndX,
        cableEndY,
        currentGenKw > 2,
        '#fbbf24',
        '251, 191, 36',
        genFlowSpeed
      );

      // ---- Lithium Battery Bank Card ----
      const battCol = battPct > 42 ? '#22c55e' : battPct > 20 ? '#f59e0b' : '#ef4444';
      ctx.fillStyle = 'rgba(9, 20, 39, 0.88)';
      ctx.beginPath();
      ctx.roundRect(busX, battY, busW, battH, 8);
      ctx.fill();
      ctx.strokeStyle = battCol;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.font = '700 10.5px "Noto Sans SC", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText('100V 锂离子电池组', busX + 10, battY + 17);

      ctx.font = '700 11px "JetBrains Mono", monospace';
      ctx.textAlign = 'right';
      ctx.fillStyle = netKw >= 0 ? '#4ade80' : '#fbbf24';
      ctx.fillText(`${netKw >= 0 ? '+' : ''}${Math.round(netKw)}kW`, busX + busW - 10, battY + 17);

      // Battery segmented bar
      const barX = busX + 10;
      const barY = battY + 27;
      const barW = busW - 20;
      const barH = 14;
      ctx.fillStyle = 'rgba(30, 41, 59, 0.9)';
      ctx.beginPath();
      ctx.roundRect(barX, barY, barW, barH, 4);
      ctx.fill();
      ctx.fillStyle = battCol;
      ctx.beginPath();
      ctx.roundRect(barX, barY, Math.max(0, barW * (battPct / 100)), barH, 4);
      ctx.fill();

      ctx.font = '700 10px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`${Math.round(battPct)}%`, barX + barW / 2, barY + 10.5);

      ctx.font = '600 9.5px "Noto Sans SC", monospace';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(netKw >= 0 ? '▲ 充电蓄能中' : '▼ 电池放电供总线', busX + busW / 2, battY + 54);

      // ---- Vertical Feeder Trunk from Battery -> P1 / P2 / P3 ----
      const trunkX = busX - 10;
      const trunkTopY = battY + battH - 12;
      const trunkBotY = p3Y + cardH / 2;
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.52)';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(busX, trunkTopY);
      ctx.lineTo(trunkX, trunkTopY);
      ctx.lineTo(trunkX, trunkBotY);
      ctx.stroke();

      // Animated additive power packets pulsing down the 100V feeder trunk
      for (let i = 0; i < 3; i++) {
        const ft = (packetPhase * 0.85 + i / 3) % 1;
        const py = lerp(trunkTopY, trunkBotY, ft);
        drawAdditiveGlow(ctx, trunkX, py, 9, '56, 189, 248', 0.6);
        ctx.fillStyle = '#e0f2fe';
        ctx.beginPath();
        ctx.arc(trunkX, py, 1.9, 0, Math.PI * 2);
        ctx.fill();
      }

      // Draw each Load Bus Card
      const buses: {
        id: 'p1' | 'p2' | 'p3';
        y: number;
        title: string;
        sub: string;
        kw: number;
        on: boolean;
        color: string;
        rgb: string;
      }[] = [
        { id: 'p1', y: p1Y, title: 'P1 环控生保', sub: '必保 · 制氧热控', kw: cfg.p1Kw, on: true, color: '#22c55e', rgb: '34, 197, 94' },
        { id: 'p2', y: p2Y, title: 'P2 测控通信', sub: p2On ? '在线 · +遥测分' : '已卸载 · 点击恢复', kw: cfg.p2Kw, on: p2On, color: '#38bdf8', rgb: '56, 189, 248' },
        { id: 'p3', y: p3Y, title: 'P3 科学实验柜', sub: p3On ? '运行 · 高科研分' : '已卸载 · 点击恢复', kw: cfg.p3Kw, on: p3On, color: '#f59e0b', rgb: '245, 158, 11' },
      ];

      for (const b of buses) {
        // Horizontal feeder tap + animated pulse dot when ON
        ctx.strokeStyle = b.on ? b.color : 'rgba(100,116,139,0.28)';
        ctx.lineWidth = b.on ? 2 : 1.2;
        ctx.beginPath();
        ctx.moveTo(trunkX, b.y + cardH / 2);
        ctx.lineTo(busX, b.y + cardH / 2);
        ctx.stroke();

        ctx.fillStyle = b.on ? 'rgba(11, 24, 46, 0.92)' : 'rgba(10, 16, 28, 0.65)';
        ctx.beginPath();
        ctx.roundRect(busX, b.y, busW, cardH, 7);
        ctx.fill();
        ctx.strokeStyle = b.on ? b.color : 'rgba(100, 116, 139, 0.35)';
        ctx.lineWidth = b.on ? 1.5 : 1;
        ctx.stroke();

        // Status indicator LED with additive optical glow when bus is active
        if (b.on) {
          drawAdditiveGlow(ctx, busX + 12, b.y + 15, 13, b.rgb, 0.65);
        }
        ctx.fillStyle = b.on ? '#ffffff' : '#475569';
        ctx.beginPath();
        ctx.arc(busX + 12, b.y + 15, b.on ? 3.4 : 3.2, 0, Math.PI * 2);
        ctx.fill();
        if (b.on) {
          ctx.strokeStyle = b.color;
          ctx.lineWidth = 1.4;
          ctx.stroke();
        }

        ctx.font = '700 11.5px "Noto Sans SC", sans-serif';
        ctx.textAlign = 'left';
        ctx.fillStyle = b.on ? '#f1f5f9' : '#64748b';
        ctx.fillText(b.title, busX + 21, b.y + 18);

        ctx.font = '700 11px "JetBrains Mono", monospace';
        ctx.textAlign = 'right';
        ctx.fillStyle = b.on ? b.color : '#64748b';
        ctx.fillText(b.on ? `${b.kw}kW` : 'OFF', busX + busW - 9, b.y + 18);

        ctx.font = '500 10px "Noto Sans SC", sans-serif';
        ctx.textAlign = 'left';
        ctx.fillStyle = b.on ? '#94a3b8' : '#64748b';
        ctx.fillText(b.sub, busX + 10, b.y + 34);
      }

      ctx.restore();
    };

    const drawFlareBanner = (ctx: CanvasRenderingContext2D): void => {
      if (activeFlareState === 'none') return;
      ctx.save();
      const bx = width * 0.5;
      const by = 72;
      const isWarn = activeFlareState === 'warning';
      const pulse = 0.72 + 0.28 * Math.sin(simTime * 11);

      const text = isWarn
        ? `⚠ CME 太阳耀斑预警 · ${flareCountdown.toFixed(1)}s 后抵达 · 请立即按 Space 顺桨！`
        : flareSafeFeathered
        ? `✓ 太阳耀斑冲击中 (${flareRemaining.toFixed(1)}s) · 顺桨防护生效！`
        : `✕ 太阳耀斑直击帆板 (${flareRemaining.toFixed(1)}s) · 立即顺桨止损！`;

      ctx.font = '800 13px "JetBrains Mono", "Noto Sans SC", sans-serif';
      const bw = Math.min(width - 420, Math.max(300, ctx.measureText(text).width + 34));
      ctx.fillStyle = isWarn
        ? `rgba(120, 53, 15, ${0.88 * pulse})`
        : flareSafeFeathered
        ? 'rgba(6, 78, 59, 0.9)'
        : `rgba(127, 29, 29, ${0.92 * pulse})`;
      ctx.beginPath();
      ctx.roundRect(bx - bw / 2, by - 18, bw, 36, 8);
      ctx.fill();
      ctx.strokeStyle = isWarn ? '#f59e0b' : flareSafeFeathered ? '#22c55e' : '#ef4444';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(text, bx, by + 5);
      ctx.restore();
    };

    const render = (): void => {
      const ctx = handle.ctx;
      const cfg = LEVELS[levelIndex];
      const layout = getLayout();

      // 1. Deep space starfield + smooth orbital crossfade between sunlit LEO Earth & night aurora/city-lights Earth
      stars.draw(ctx, width, height, simTime, -simTime * 4.5, 0);
      const orbitFrac = (simTime % cfg.orbitDuration) / cfg.orbitDuration;
      const horizonSunPhase = isSunlit
        ? lerp(-0.35, 1.35, orbitFrac / cfg.sunlitFraction)
        : lerp(1.75, 3.05, (orbitFrac - cfg.sunlitFraction) / (1 - cfg.sunlitFraction));

      const driftX = Math.sin(simTime * 0.06) * 8;
      const driftY = Math.cos(simTime * 0.05) * 3;
      const dayAlpha = clamp(1 - eclipseBlend, 0, 1);
      const nightAlpha = clamp(eclipseBlend, 0, 1);

      const dayPainted =
        dayAlpha > 0.01
          ? drawBackdropImage(ctx, 'leo-earth', width, height, {
              alpha: dayAlpha * 0.94,
              offsetX: driftX,
              offsetY: driftY,
              darken: 0.22,
            })
          : false;
      const nightPainted =
        nightAlpha > 0.01
          ? drawBackdropImage(ctx, 'earth-night', width, height, {
              alpha: nightAlpha * 0.96,
              offsetX: driftX,
              offsetY: driftY,
              darken: 0.14,
            })
          : false;

      if (dayPainted || nightPainted) {
        // Subtle sunlit limb warmth -> terminator sunset glow -> night emerald aurora & citylight glow
        if (dayAlpha > 0.05) {
          drawAdditiveGlow(ctx, width * 0.18 + driftX, height * 0.78, Math.min(width, height) * 0.34, '255, 195, 110', 0.12 * dayAlpha);
        }
        if (nightAlpha > 0.05) {
          drawAdditiveGlow(ctx, width * 0.64 + driftX, height * 0.72, Math.min(width, height) * 0.36, '52, 211, 153', 0.14 * nightAlpha);
          drawAdditiveGlow(ctx, width * 0.28 + driftX, height * 0.84, Math.min(width, height) * 0.28, '251, 191, 36', 0.11 * nightAlpha);
        }
        if (eclipseBlend > 0.04 && eclipseBlend < 0.96) {
          const termPeak = Math.sin(eclipseBlend * Math.PI);
          drawAdditiveGlow(ctx, width * 0.5, height * 0.76, Math.min(width, height) * 0.45, '249, 115, 22', termPeak * 0.22);
        }
        drawCinematicVignette(ctx, width, height, 0.36);
      } else {
        drawEarthHorizon(ctx, width, height, simTime, {
          yRatio: 1.76,
          radiusScale: 1.15,
          sunPhase: horizonSunPhase,
          nightMode: !isSunlit,
          darken: 0.2,
        });
      }

      // 2. Sunlight shafts / eclipse night / CME aurora backdrop
      drawSunlightOrFlareBackdrop(ctx, layout.stationX, layout.stationY);

      // 3. Particles (CME plasma streams / overload sparks)
      particles.draw(ctx);

      // 4. Right-column Power Bus & glowing energy flow packets (drawn behind station center hub cleanly)
      drawPowerBusAndFlow(
        ctx,
        layout.stationX,
        layout.stationY,
        layout.busX,
        layout.busTopY,
        layout.busW
      );

      // 5. Center Space Station Core + Articulating Twin Golden Solar Wings + Physics Vectors
      drawStationAndSolarWings(ctx, layout.stationX, layout.stationY, layout.wingHalfSpan);

      // 6. Left-column Orbital Phase & Eclipse Countdown Mini-Diagram
      drawOrbitalMiniDiagram(ctx, layout.miniX, layout.miniY, layout.miniR);

      // 7. Top-center CME Flare Warning / Status Banner (Level 3)
      drawFlareBanner(ctx);

      // 8. Red peripheral damage vignette if wing taking CME hits
      if (flareDamageFlash > 0.02) {
        ctx.save();
        ctx.strokeStyle = `rgba(239, 68, 68, ${flareDamageFlash * 0.7})`;
        ctx.lineWidth = 10;
        ctx.strokeRect(5, 5, width - 10, height - 10);
        ctx.restore();
      }
    };

    // Mount deck & initialize level
    buildTactileDeck();
    resetLevel(levelIndex);

    // Main animation loop
    let rafId = 0;
    let lastTs = performance.now();

    const tick = (now: number) => {
      if (destroyed) return;
      const rawDt = Math.min(0.05, Math.max(0, (now - lastTs) / 1000));
      lastTs = now;

      if (!paused) {
        update(rawDt);
      }
      render();
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);

    return {
      destroy() {
        destroyed = true;
        cancelAnimationFrame(rafId);
        handle.canvas.removeEventListener('pointerdown', onPointerDown);
        handle.canvas.removeEventListener('pointermove', onPointerMove);
        handle.canvas.removeEventListener('pointerup', onPointerUp);
        handle.canvas.removeEventListener('pointercancel', onPointerUp);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onWindowBlur);
        host.hud.clearTactileDeck();
        handle.destroy();
      },
      setLevel(nextIdx: number) {
        resetLevel(nextIdx);
      },
      restart() {
        resetLevel(levelIndex);
      },
      setPaused(p: boolean) {
        paused = p;
        if (p) {
          keyLeft = false;
          keyRight = false;
          isDragging = false;
        }
      },
      setPhysicsOverlay(enabled: boolean) {
        physicsOverlay = enabled;
      },
    };
  },
};
