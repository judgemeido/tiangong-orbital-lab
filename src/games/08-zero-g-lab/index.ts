import { drawControlGyroscope3D, drawFeitianAstronaut3D } from '../../core/aerospace-models';
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

const META: GameMeta = {
  id: 'zero-g-lab',
  number: '08',
  shortTitle: '天宫实验',
  title: '天宫微重力物理实验室',
  enTitle: 'ZERO-G LAB PUZZLES',
  moduleName: '梦天流体与燃烧柜',
  genre: '天宫课堂物理闯关',
  tagline: '亲手复现水球光学双成像、微重力球形蓝焰与太空控制力矩陀螺',
  accent: '#c084fc',
  hubAnchor: { x: 0.72, y: 0.52 },
  briefingSteps: [
    {
      title: 'L1 水球光学“一正一反”双成像',
      desc: '先向微重力金属环注水成球，获得凸透镜倒立实像；再向球心注入空气泡并调节焦距屏，让外倒像与内正像同时清晰锁入绿环！',
    },
    {
      title: 'L2 微重力球形冷焰平衡',
      desc: '太空中没有浮力，火焰呈淡蓝球体。按 Space 点火后平衡 O₂ 浓度与微气流，既要吹走 CO₂ 废气壳防窒息，又不能气流过猛吹熄火焰。',
    },
    {
      title: 'L3 太空控制力矩陀螺 (CMG)',
      desc: '按住 W 加速中心飞轮提升角动量 L=Iω 增强定轴刚度，再用 A/D 施加进动反力矩抵消扰动，不耗一滴燃料稳住激光锁定 12 秒！',
    },
  ],
  controlsHint:
    '滑块 / 按钮 / 画布拖动直接交互 ｜ L2：Space 点火、G 切换1g对照 ｜ L3：W 提速飞轮、A/D 进动调姿',
  levels: [
    {
      index: 0,
      name: '水球光学双成像',
      subtitle: '天宫课堂凸/凹透镜一正一反实验',
      objective:
        '① 注水成球 → ② 向球心注入气泡 → ③ 调节气泡尺寸与屏距，让外倒像与内正像同时清晰锁入绿环 2.5s',
    },
    {
      index: 1,
      name: '微重力球形冷焰',
      subtitle: '梦天燃烧柜无浮力扩散蓝焰实验',
      objective:
        '按 Space 点火并协调 O₂ 浓度与微气流，维持稳定球形蓝焰将四周 3 组环形温度传感器全部加热至 100%',
    },
    {
      index: 2,
      name: '控制力矩陀螺 CMG',
      subtitle: '角动量定轴性与无推进剂姿控',
      objective:
        '提升飞轮 RPM 增强定轴刚度并施加进动反力矩，抵御 3 波微重力扰动、累计锁定激光 12 秒',
    },
  ],
  codexIds: ['zerog-water-lens', 'zerog-spherical-flame', 'zerog-gyroscope'],
};

interface SafePlayRect {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
}

export const zeroGLabGame: GameModule = {
  meta: META,

  mount(canvasHost: HTMLElement, host: GameHostAPI): GameInstance {
    const hi = setupHiDPICanvas(canvasHost);
    const { canvas, ctx } = hi;
    const starfield = new StarfieldRenderer(140, 808);
    const particles = new ParticleSystem();

    let rafId = 0;
    let lastTs = performance.now();
    let elapsed = 0;
    let runSeconds = 0;
    let levelIndex = host.getLevel();
    let paused = host.isPaused();
    let physicsOverlay = host.hud.isPhysicsOverlayEnabled();
    let finished = false;
    let destroyed = false;

    const keysHeld = new Set<string>();
    const toastCooldowns = new Map<string, number>();

    // =========================================================================
    // LEVEL 1 STATE: Water Sphere Dual-Imaging Optics
    // =========================================================================
    let waterVol = 16; // 0..100
    let bubblePct = 0; // 0..65 (percentage of sphere radius)
    let screenDist = 26; // 0..100 along right optical rail
    let wobbleAmp = 0;
    let wobblePhase = 0;
    let syringeAnim = 0;
    let l1LockTime = 0;
    let l1LastTick = 0;
    let l1Step1Done = false;
    let l1Step2Done = false;
    let l1OuterSharp = 0;
    let l1InnerSharp = 0;
    let l1DraggingScreen = false;
    let l1HoverScreen = false;

    // L1 deck refs
    let l1WaterSlider: HTMLInputElement | null = null;
    let l1WaterVal: HTMLElement | null = null;
    let l1BubbleSlider: HTMLInputElement | null = null;
    let l1BubbleVal: HTMLElement | null = null;
    let l1FocusSlider: HTMLInputElement | null = null;
    let l1FocusVal: HTMLElement | null = null;

    // =========================================================================
    // LEVEL 2 STATE: Zero-G Spherical Blue Flame
    // =========================================================================
    let ignited = false;
    let igniterCharges = 5;
    let o2Conc = 24; // 18..32 %
    let airflow = 36; // 0..100 %
    let exhaustShell = 0.08; // 0..1 CO2 suffocation shell
    let blowoutStress = 0; // 0..1 aerodynamic shear
    let flameRadius = 0; // smooth animated radius
    let sensorTemps = [0, 0, 0]; // 0..100 for Top, Bottom-Right, Bottom-Left
    let earthGravityMode = false;
    let flameouts = 0;
    let surgeTimer = 0;
    let surgeTriggered = false;
    let sparkAnim = 0;
    let l2WarnCooldown = 0;

    // L2 deck refs
    let l2IgniteBtn: HTMLButtonElement | null = null;
    let l2O2Slider: HTMLInputElement | null = null;
    let l2O2Val: HTMLElement | null = null;
    let l2AirSlider: HTMLInputElement | null = null;
    let l2AirVal: HTMLElement | null = null;
    let l2GravBtn: HTMLButtonElement | null = null;

    // =========================================================================
    // LEVEL 3 STATE: Control Moment Gyroscope (CMG)
    // =========================================================================
    let rpm = 1100; // 0..6000
    let rotorSpinAngle = 0;
    let tiltAngle = 8.5; // degrees (-38..+38)
    let angularVel = 0; // deg/s
    let gimbalAngle = 0; // visual gimbal tilt (-55..+55 deg)
    let cmgHoldLeft = false;
    let cmgHoldRight = false;
    let cmgHoldSpin = false;
    let cmgDragging = false;
    let cmgDragStartX = 0;
    let cmgDragInput = 0;
    let lockAccum = 0; // 0..12 seconds
    let cmgIntegrity = 100; // 0..100
    let cmgWave = 1; // 1..3
    let distTimer = 2.0;
    let distTelegraph = 0; // >0 counts down warning before torque hits
    let distActiveTimer = 0;
    let distTorque = 0; // signed external disturbance torque (deg/s^2 before stiffness)
    let distPendingTorque = 0;
    let cmgAppliedTorque = 0;
    let cmgPeakTilt = 0;
    let cmgMaxRpm = 1100;
    let cmgHitCooldown = 0;

    // L3 deck refs
    let l3LeftBtn: HTMLButtonElement | null = null;
    let l3SpinBtn: HTMLButtonElement | null = null;
    let l3RightBtn: HTMLButtonElement | null = null;

    function pushDebouncedToast(
      key: string,
      text: string,
      tone: MetricStatus = 'info',
      tag = '梦天实验遥测',
      cooldownSec = 8
    ): void {
      const last = toastCooldowns.get(key) ?? -999;
      if (elapsed - last < cooldownSec) return;
      toastCooldowns.set(key, elapsed);
      host.hud.pushToast(text, tone, tag);
    }

    function getPlayRect(w: number, h: number): SafePlayRect {
      const compact = h <= 720;
      const topSafe = compact ? Math.max(104, h * 0.16) : Math.max(142, h * 0.2);
      const bottomSafe = Math.min(h - (compact ? 76 : 92), h * 0.885);
      const availH = Math.max(240, bottomSafe - topSafe);
      const rectW = clamp(w * 0.72, 460, 880);
      const rectH = clamp(availH, 240, 480);
      const x = (w - rectW) * 0.5;
      const y = topSafe + (availH - rectH) * 0.5;
      return { x, y, w: rectW, h: rectH, cx: x + rectW * 0.5, cy: y + rectH * 0.5 };
    }

    function clearDeckRefs(): void {
      l1WaterSlider = null;
      l1WaterVal = null;
      l1BubbleSlider = null;
      l1BubbleVal = null;
      l1FocusSlider = null;
      l1FocusVal = null;
      l2IgniteBtn = null;
      l2O2Slider = null;
      l2O2Val = null;
      l2AirSlider = null;
      l2AirVal = null;
      l2GravBtn = null;
      l3LeftBtn = null;
      l3SpinBtn = null;
      l3RightBtn = null;
    }

    // =========================================================================
    // LEVEL INITIALIZATION & BESPOKE TACTILE DECKS
    // =========================================================================
    function syncL1Deck(): void {
      if (l1WaterSlider) l1WaterSlider.value = String(Math.round(waterVol));
      if (l1WaterVal) l1WaterVal.textContent = `${Math.round(waterVol)}%`;
      if (l1BubbleSlider) l1BubbleSlider.value = String(Math.round(bubblePct));
      if (l1BubbleVal) l1BubbleVal.textContent = `${Math.round(bubblePct)}%`;
      if (l1FocusSlider) l1FocusSlider.value = String(Math.round(screenDist));
      if (l1FocusVal) l1FocusVal.textContent = `${Math.round(120 + screenDist * 1.8)}mm`;
    }

    function syncL2Deck(): void {
      if (l2IgniteBtn) {
        l2IgniteBtn.textContent = ignited
          ? `燃烧中 (余火源 ${igniterCharges})`
          : `电弧点火 [Space] (${igniterCharges})`;
        l2IgniteBtn.classList.toggle('is-active', ignited);
        l2IgniteBtn.classList.toggle('is-gold', !ignited);
      }
      if (l2O2Slider) l2O2Slider.value = o2Conc.toFixed(1);
      if (l2O2Val) l2O2Val.textContent = `${o2Conc.toFixed(1)}%`;
      if (l2AirSlider) l2AirSlider.value = String(Math.round(airflow));
      if (l2AirVal) l2AirVal.textContent = `${Math.round(airflow)}%`;
      if (l2GravBtn) {
        l2GravBtn.classList.toggle('is-active', earthGravityMode);
        l2GravBtn.textContent = earthGravityMode
          ? '对照中: 地面1g [G]'
          : '地面1g对照 [G]';
      }
    }

    function triggerIgnite(): void {
      if (paused || finished || levelIndex !== 1) return;
      if (ignited) {
        host.audio.playClick();
        return;
      }
      if (igniterCharges <= 0) {
        host.audio.playCritical();
        return;
      }
      igniterCharges -= 1;
      sparkAnim = 1;
      const { width, height } = hi.getSize();
      const pr = getPlayRect(width, height);
      particles.burst(pr.cx, pr.cy, 18, '#7dd3fc', 95, 2.8, 0.42);
      host.audio.playThruster(0.8);

      if (exhaustShell > 0.85) {
        host.audio.playWarning();
        pushDebouncedToast(
          'ignite-choked',
          '燃烧室 CO₂ 废气尚未散尽，点火失败！先调高微气流吹散废气再试。',
          'caution',
          '点火条件不足',
          4
        );
      } else if (airflow > 84 && !earthGravityMode) {
        host.audio.playWarning();
        pushDebouncedToast(
          'ignite-windy',
          '微气流太强吹散了燃料雾，点火失败！把微气流调回 30–55% 再点火。',
          'caution',
          '气流过强',
          4
        );
      } else {
        ignited = true;
        blowoutStress = 0;
        flameRadius = 18;
        host.audio.playLock();
        pushDebouncedToast(
          'ignite-ok',
          '微重力球形蓝焰点燃成功！保持适度微气流扫除 CO₂ 废气壳，均匀加热 3 组环形热传感器！',
          'nominal',
          '梦天燃烧柜点火',
          10
        );
      }
      syncL2Deck();
    }

    function toggleEarthGravity(): void {
      if (paused || finished || levelIndex !== 1) return;
      earthGravityMode = !earthGravityMode;
      host.audio.playSwitch();
      syncL2Deck();
      if (earthGravityMode) {
        pushDebouncedToast(
          'grav-1g',
          '已切入【地面 1g 重力对照】：热空气变轻上升形成黄色泪滴焰，导致只有顶部传感器受热！',
          'info',
          '1g vs 0g 物理对照',
          5
        );
      } else {
        pushDebouncedToast(
          'grav-0g',
          '恢复【0g 微重力环境】：浮力消失，火焰收缩为各向同性淡蓝色球形冷焰，均匀辐射四周！',
          'nominal',
          '微重力球形冷焰',
          5
        );
      }
    }

    function bindHoldButton(
      btn: HTMLButtonElement,
      onChange: (held: boolean) => void,
      onPressImpulse?: () => void
    ): void {
      const start = (e: Event) => {
        e.preventDefault();
        btn.classList.add('is-active');
        onChange(true);
        onPressImpulse?.();
      };
      const end = () => {
        btn.classList.remove('is-active');
        onChange(false);
      };
      btn.addEventListener('pointerdown', start);
      btn.addEventListener('pointerup', end);
      btn.addEventListener('pointerleave', end);
      btn.addEventListener('pointercancel', end);
    }

    function buildLevelDeck(): void {
      const deck = host.hud.getTactileDeck();
      host.hud.clearTactileDeck();
      clearDeckRefs();

      if (levelIndex === 0) {
        // L1: Water injection, Air Bubble injection, Optical Screen focus distance
        const wGrp = document.createElement('label');
        wGrp.className = 'deck-slider-group';
        wGrp.innerHTML = `<span>注水</span>`;
        l1WaterSlider = document.createElement('input');
        l1WaterSlider.type = 'range';
        l1WaterSlider.min = '0';
        l1WaterSlider.max = '100';
        l1WaterSlider.value = String(Math.round(waterVol));
        l1WaterSlider.addEventListener('input', () => {
          const next = Number(l1WaterSlider!.value);
          if (Math.abs(next - waterVol) > 1) {
            wobbleAmp = clamp(wobbleAmp + 0.14, 0, 0.35);
          }
          waterVol = next;
          if (waterVol < 50 && bubblePct > 0) bubblePct = Math.min(bubblePct, waterVol * 0.5);
          syncL1Deck();
        });
        l1WaterVal = document.createElement('span');
        l1WaterVal.className = 'mono-num';
        l1WaterVal.style.minWidth = '34px';
        wGrp.append(l1WaterSlider, l1WaterVal);

        const injectBtn = document.createElement('button');
        injectBtn.type = 'button';
        injectBtn.className = 'deck-ctrl-btn';
        injectBtn.textContent = '+ 注水';
        injectBtn.addEventListener('click', () => {
          injectBtn.blur();
          if (paused || finished) return;
          waterVol = clamp(waterVol + 22, 0, 100);
          wobbleAmp = 0.28;
          host.audio.playBeep(440 + waterVol * 3, 0.06);
          syncL1Deck();
        });

        const bGrp = document.createElement('label');
        bGrp.className = 'deck-slider-group';
        bGrp.innerHTML = `<span>注气泡</span>`;
        l1BubbleSlider = document.createElement('input');
        l1BubbleSlider.type = 'range';
        l1BubbleSlider.min = '0';
        l1BubbleSlider.max = '65';
        l1BubbleSlider.value = String(Math.round(bubblePct));
        l1BubbleSlider.addEventListener('input', () => {
          const want = Number(l1BubbleSlider!.value);
          if (waterVol < 58 && want > 5) {
            l1BubbleSlider!.value = '0';
            bubblePct = 0;
            host.audio.playWarning();
            pushDebouncedToast(
              'need-water-first',
              '请先将水球注满至 70% 以上，再向球心注入空气泡！',
              'caution',
              '流体注入顺序',
              4
            );
            syncL1Deck();
            return;
          }
          if (Math.abs(want - bubblePct) > 1) {
            wobbleAmp = clamp(wobbleAmp + 0.12, 0, 0.32);
            syringeAnim = 1;
          }
          bubblePct = want;
          syncL1Deck();
        });
        l1BubbleVal = document.createElement('span');
        l1BubbleVal.className = 'mono-num';
        l1BubbleVal.style.minWidth = '34px';
        bGrp.append(l1BubbleSlider, l1BubbleVal);

        const fGrp = document.createElement('label');
        fGrp.className = 'deck-slider-group';
        fGrp.innerHTML = `<span>屏距</span>`;
        l1FocusSlider = document.createElement('input');
        l1FocusSlider.type = 'range';
        l1FocusSlider.min = '0';
        l1FocusSlider.max = '100';
        l1FocusSlider.value = String(Math.round(screenDist));
        l1FocusSlider.addEventListener('input', () => {
          screenDist = Number(l1FocusSlider!.value);
          syncL1Deck();
        });
        l1FocusVal = document.createElement('span');
        l1FocusVal.className = 'mono-num';
        l1FocusVal.style.minWidth = '42px';
        fGrp.append(l1FocusSlider, l1FocusVal);

        deck.append(wGrp, injectBtn, bGrp, fGrp);
        syncL1Deck();
      } else if (levelIndex === 1) {
        // L2: Igniter, O2 concentration, Micro-Airflow, 1g gravity comparison toggle
        l2IgniteBtn = document.createElement('button');
        l2IgniteBtn.type = 'button';
        l2IgniteBtn.className = 'deck-ctrl-btn is-gold';
        l2IgniteBtn.addEventListener('click', () => {
          l2IgniteBtn?.blur();
          triggerIgnite();
        });

        const o2Grp = document.createElement('label');
        o2Grp.className = 'deck-slider-group';
        o2Grp.innerHTML = `<span>O₂浓度</span>`;
        l2O2Slider = document.createElement('input');
        l2O2Slider.type = 'range';
        l2O2Slider.min = '18';
        l2O2Slider.max = '32';
        l2O2Slider.step = '0.5';
        l2O2Slider.value = String(o2Conc);
        l2O2Slider.addEventListener('input', () => {
          o2Conc = Number(l2O2Slider!.value);
          syncL2Deck();
        });
        l2O2Val = document.createElement('span');
        l2O2Val.className = 'mono-num';
        l2O2Val.style.minWidth = '40px';
        o2Grp.append(l2O2Slider, l2O2Val);

        const airGrp = document.createElement('label');
        airGrp.className = 'deck-slider-group';
        airGrp.innerHTML = `<span>微气流</span>`;
        l2AirSlider = document.createElement('input');
        l2AirSlider.type = 'range';
        l2AirSlider.min = '0';
        l2AirSlider.max = '100';
        l2AirSlider.value = String(airflow);
        l2AirSlider.addEventListener('input', () => {
          airflow = Number(l2AirSlider!.value);
          syncL2Deck();
        });
        l2AirVal = document.createElement('span');
        l2AirVal.className = 'mono-num';
        l2AirVal.style.minWidth = '34px';
        airGrp.append(l2AirSlider, l2AirVal);

        l2GravBtn = document.createElement('button');
        l2GravBtn.type = 'button';
        l2GravBtn.className = 'deck-ctrl-btn';
        l2GravBtn.addEventListener('click', () => {
          l2GravBtn?.blur();
          toggleEarthGravity();
        });

        deck.append(l2IgniteBtn, o2Grp, airGrp, l2GravBtn);
        syncL2Deck();
      } else {
        // L3: Left Precession, Spin-Up Flywheel, Right Precession
        l3LeftBtn = document.createElement('button');
        l3LeftBtn.type = 'button';
        l3LeftBtn.className = 'deck-ctrl-btn';
        l3LeftBtn.textContent = '↺ 逆时针进动 [A]';
        bindHoldButton(l3LeftBtn, (held) => {
          cmgHoldLeft = held;
        });

        l3SpinBtn = document.createElement('button');
        l3SpinBtn.type = 'button';
        l3SpinBtn.className = 'deck-ctrl-btn is-gold';
        l3SpinBtn.textContent = '飞轮提速 L=Iω [W]';
        bindHoldButton(
          l3SpinBtn,
          (held) => {
            cmgHoldSpin = held;
          },
          () => {
            if (!paused && !finished) {
              rpm = clamp(rpm + 750, 0, 6000);
              host.audio.playBeep(360 + (rpm / 6000) * 520, 0.06);
            }
          }
        );

        l3RightBtn = document.createElement('button');
        l3RightBtn.type = 'button';
        l3RightBtn.className = 'deck-ctrl-btn';
        l3RightBtn.textContent = '↻ 顺时针进动 [D]';
        bindHoldButton(l3RightBtn, (held) => {
          cmgHoldRight = held;
        });

        deck.append(l3LeftBtn, l3SpinBtn, l3RightBtn);
      }
    }

    function initLevel(idx: number): void {
      levelIndex = clamp(idx, 0, META.levels.length - 1);
      finished = false;
      runSeconds = 0;
      particles.clear();
      toastCooldowns.clear();
      keysHeld.clear();

      host.hud.setObjective(META.levels[levelIndex].objective);

      if (levelIndex === 0) {
        waterVol = 16;
        bubblePct = 0;
        screenDist = 26;
        wobbleAmp = 0.06;
        wobblePhase = 0;
        syringeAnim = 0;
        l1LockTime = 0;
        l1LastTick = 0;
        l1Step1Done = false;
        l1Step2Done = false;
        l1OuterSharp = 0;
        l1InnerSharp = 0;
        l1DraggingScreen = false;

        host.hud.setControlsHint(
          '滑块/按钮：注水成球、注入气泡、调节屏距 ｜ 可直接在画布上左右拖动右侧成像屏'
        );
        host.hud.setMetrics([
          { id: 'm1', label: '水球充盈度', value: '16%', ratio: 0.16, status: 'info' },
          { id: 'm2', label: '外倒像清晰度', value: '0%', ratio: 0, status: 'info' },
          { id: 'm3', label: '内正像清晰度', value: '未注气泡', ratio: 0, status: 'info' },
          { id: 'm4', label: '双像锁紧计时', value: '0.0 / 2.5s', ratio: 0, status: 'info' },
        ]);
        pushDebouncedToast(
          'l1-start',
          '天宫水球光学实验启动！第一步：先向右拉动“注水球”滑块（或点 +注水），观察水膜缩成完美球面凸透镜！',
          'info',
          '天宫课堂 L1',
          20
        );
      } else if (levelIndex === 1) {
        ignited = false;
        igniterCharges = 5;
        o2Conc = 24;
        airflow = 36;
        exhaustShell = 0.08;
        blowoutStress = 0;
        flameRadius = 0;
        sensorTemps = [0, 0, 0];
        earthGravityMode = false;
        flameouts = 0;
        surgeTimer = 0;
        surgeTriggered = false;
        sparkAnim = 0;
        l2WarnCooldown = 0;

        host.hud.setControlsHint(
          'Space / 按钮：电弧点火 ｜ A/D 调微气流 ｜ W/S 调 O₂ 浓度 ｜ G 切换地面1g重力对照'
        );
        host.hud.setMetrics([
          { id: 'm1', label: '三环均温进度', value: '0%', ratio: 0, status: 'info' },
          { id: 'm2', label: 'CO₂ 废气壳', value: '8%', ratio: 0.08, status: 'nominal' },
          { id: 'm3', label: '吹熄气流应力', value: '0%', ratio: 0, status: 'nominal' },
          { id: 'm4', label: '火焰工况', value: '待点火', ratio: 0, status: 'caution' },
        ]);
        pushDebouncedToast(
          'l2-start',
          '按 Space 或点击“电弧点火”引燃微重力蓝焰！也可按 G 随时对比地面 1g 浮力泪滴焰的差异。',
          'info',
          '梦天燃烧柜 L2',
          20
        );
      } else {
        rpm = 1100;
        rotorSpinAngle = 0;
        tiltAngle = 8.5;
        angularVel = 0;
        gimbalAngle = 0;
        cmgHoldLeft = false;
        cmgHoldRight = false;
        cmgHoldSpin = false;
        cmgDragging = false;
        cmgDragInput = 0;
        lockAccum = 0;
        cmgIntegrity = 100;
        cmgWave = 1;
        distTimer = 1.8;
        distTelegraph = 0;
        distActiveTimer = 0;
        distTorque = 0;
        distPendingTorque = 0;
        cmgAppliedTorque = 0;
        cmgPeakTilt = 0;
        cmgMaxRpm = 1100;
        cmgHitCooldown = 0;

        host.hud.setControlsHint(
          '按住 W / 飞轮提速提升角动量 L=Iω ｜ A / D 或按钮/画布拖动施加进动反力矩 ｜ 推进剂耗量 0 kg'
        );
        host.hud.setMetrics([
          { id: 'm1', label: '激光锁定计时', value: '0.0 / 12.0s', ratio: 0, status: 'info' },
          { id: 'm2', label: '飞轮转速 RPM', value: '1100 RPM', ratio: 1100 / 6000, status: 'caution' },
          { id: 'm3', label: '平台偏角', value: '+8.5°', ratio: 0.25, status: 'caution' },
          { id: 'm4', label: '当前扰动波次', value: '第 1/3 波', ratio: 0.33, status: 'info' },
        ]);
        pushDebouncedToast(
          'l3-start',
          '先按住 W 加速中心飞轮提升角动量 L=Iω，定轴刚度会倍增！再用 A/D 施加进动反力矩把绿色激光稳锁靶心！',
          'info',
          '控制力矩陀螺 L3',
          20
        );
      }

      buildLevelDeck();
    }

    function finishAttempt(won: boolean, customFail?: string): void {
      if (finished) return;
      finished = true;

      if (levelIndex === 0) {
        const precision = Math.round(((l1OuterSharp + l1InnerSharp) * 0.5) * 100);
        const stars: 0 | 1 | 2 | 3 = won
          ? runSeconds <= 42 && precision >= 90
            ? 3
            : runSeconds <= 75
              ? 2
              : 1
          : 0;
        const score = won
          ? Math.round(520 + precision * 3.5 + clamp(180 - runSeconds * 2.2, 0, 180))
          : 150;
        host.completeLevel({
          levelIndex: 0,
          won,
          stars,
          score,
          summary: won
            ? '成功复现天宫课堂经典水球光学双成像！外层倒立实像与球心气泡正立缩像同时清晰锁焦！'
            : customFail ?? '水球双成像校准未完成。',
          metrics: [
            { label: '水球充盈度', value: `${Math.round(waterVol)}%`, status: 'nominal' },
            { label: '气泡占比', value: `${Math.round(bubblePct)}%`, status: 'nominal' },
            { label: '双像综合锐度', value: `${precision}%`, status: 'nominal' },
            { label: '实验校准耗时', value: `${runSeconds.toFixed(1)} s`, status: 'info' },
          ],
          scienceCard: {
            title: '天宫课堂：水球光学“一正一反”双成像',
            gameAction:
              '你先注水形成微重力悬浮水球得到倒立实像，再往球心注入空气泡，微调屏距同时聚焦出外倒内正双像。',
            realStationFact:
              '失重下表面张力使水滴缩成完美圆球（凸透镜，成倒立实像）；球心注入气泡后，中心区域等价为两枚水凹透镜串联，折射出正立缩小的像！',
            realData: '真实实验：神舟十三号“天宫课堂”第一课王亚平亲手演示 | 水折射率 n ≈ 1.333',
            codexId: 'zerog-water-lens',
          },
        });
      } else if (levelIndex === 1) {
        const avgT = Math.round((sensorTemps[0] + sensorTemps[1] + sensorTemps[2]) / 3);
        const stars: 0 | 1 | 2 | 3 = won
          ? flameouts === 0 && runSeconds <= 58
            ? 3
            : flameouts <= 1
              ? 2
              : 1
          : 0;
        const score = won
          ? Math.round(540 + (5 - flameouts) * 65 + clamp(160 - runSeconds * 1.8, 0, 160))
          : Math.round(avgT * 3);
        host.completeLevel({
          levelIndex: 1,
          won,
          stars,
          score,
          summary: won
            ? `稳定维持无浮力球形蓝焰！3 组环形热传感器全部均温达标，期间仅熄火 ${flameouts} 次！`
            : customFail ?? '点火器耗尽，未能完成球形冷焰均温实验。',
          metrics: [
            { label: '三环均温进度', value: `${avgT}%`, status: won ? 'nominal' : 'critical' },
            { label: '熄火次数', value: `${flameouts} 次`, status: flameouts === 0 ? 'nominal' : 'caution' },
            { label: '最终供氧 / 气流', value: `${o2Conc.toFixed(1)}% / ${Math.round(airflow)}%`, status: 'info' },
            { label: '实验总耗时', value: `${runSeconds.toFixed(1)} s`, status: 'info' },
          ],
          scienceCard: {
            title: '微重力球形冷焰：失去浮力后的扩散燃烧',
            gameAction:
              '你精准平衡了 O₂ 浓度与微弱扫掠气流，既防止 CO₂ 废气壳裹灭火焰，又避免强风吹熄，实现了各向同性均匀热辐射。',
            realStationFact:
              '地面火焰因热气上浮拉成黄色泪滴状；太空中浮力对流消失，火焰依靠分子扩散呈淡蓝色圆球，且必须靠微量强制气流带走燃烧废气。',
            realData: '真实实验：梦天实验舱燃烧科学实验柜首次在轨点火 | 揭示微重力冷焰与减排机理',
            codexId: 'zerog-spherical-flame',
          },
        });
      } else {
        const stars: 0 | 1 | 2 | 3 = won
          ? cmgIntegrity >= 95 && cmgMaxRpm >= 4600 && cmgPeakTilt < 18
            ? 3
            : cmgIntegrity >= 75
              ? 2
              : 1
          : 0;
        const score = won
          ? Math.round(
              500 + cmgIntegrity * 3.2 + (cmgMaxRpm / 6000) * 140 + clamp(120 - cmgPeakTilt * 3, 0, 120)
            )
          : Math.round((lockAccum / 12) * 380);
        host.completeLevel({
          levelIndex: 2,
          won,
          stars,
          score,
          summary: won
            ? '不消耗一滴推进剂！成功依靠高速飞轮角动量定轴性与进动反力矩，抵御全部 3 波微重力扰动！'
            : customFail ?? '悬浮光学平台发生剧烈撞壁失稳，请先拉高飞轮 RPM 增强定轴刚度再试！',
          metrics: [
            { label: '累计激光锁定', value: `${lockAccum.toFixed(1)} / 12.0s`, status: won ? 'nominal' : 'critical' },
            { label: '峰值飞轮转速', value: `${Math.round(cmgMaxRpm)} RPM`, status: cmgMaxRpm >= 4200 ? 'nominal' : 'caution' },
            { label: '最大偏角峰值', value: `${cmgPeakTilt.toFixed(1)}°`, status: cmgPeakTilt < 16 ? 'nominal' : 'caution' },
            { label: '化学推进剂消耗', value: '0.00 kg (纯电姿控)', status: 'nominal' },
          ],
          scienceCard: {
            title: '太空陀螺定轴性与控制力矩陀螺 (CMG)',
            gameAction:
              '你通过提高中心飞轮转速增大角动量 L=Iω 显著削弱了扰动晃动，并用框架进动产生反作用力矩将激光平台稳回零位。',
            realStationFact:
              '天和核心舱装备 6 台大型控制力矩陀螺（CMG），利用太阳能供电驱动高速飞轮并偏转万向框架输出巨大控制力矩，实现长期零推进剂消耗姿态稳定。',
            realData: '真实参数：天宫核心舱 6 台 CMG 集群 | 轨道日常姿控推进剂消耗 ≈ 0 kg',
            codexId: 'zerog-gyroscope',
          },
        });
      }
    }

    // =========================================================================
    // UPDATE LOOPS PER LEVEL
    // =========================================================================
    function updateL1(dt: number): void {
      wobblePhase += dt * 7.5;
      wobbleAmp = Math.max(0.012, wobbleAmp * Math.exp(-dt * 2.2));
      syringeAnim = Math.max(0, syringeAnim - dt * 1.4);

      // Keyboard fine tuning for L1
      if (keysHeld.has('a') || keysHeld.has('arrowleft')) {
        screenDist = clamp(screenDist - 36 * dt, 0, 100);
        syncL1Deck();
      }
      if (keysHeld.has('d') || keysHeld.has('arrowright')) {
        screenDist = clamp(screenDist + 36 * dt, 0, 100);
        syncL1Deck();
      }

      // Compute physical lens sharpness
      const waterNorm = waterVol / 100;
      const idealScreen = clamp(54 + (1 - waterNorm) * 26, 48, 82);
      const focusErr = Math.abs(screenDist - idealScreen);

      l1OuterSharp =
        waterVol < 34
          ? 0
          : clamp(1 - focusErr / 26, 0, 1) * clamp((waterVol - 32) / 46, 0, 1);

      const bubbleErr = Math.abs(bubblePct - 38);
      l1InnerSharp =
        bubblePct < 10 || waterVol < 64
          ? 0
          : clamp(1 - bubbleErr / 14, 0, 1) * clamp(1 - focusErr / 28, 0, 1);

      // Contextual milestone toasts
      if (!l1Step1Done && waterVol >= 76) {
        l1Step1Done = true;
        host.audio.playLock();
        pushDebouncedToast(
          'l1-step1',
          '水球凸透镜成形！右侧已投射出倒立宇航员实像！第二步：向右拉动“注气泡”滑块向球心注入空气泡！',
          'nominal',
          '步骤 1 完成',
          4
        );
      }
      if (!l1Step2Done && l1Step1Done && bubblePct >= 26 && bubblePct <= 48) {
        l1Step2Done = true;
        host.audio.playLock();
        pushDebouncedToast(
          'l1-step2',
          '震撼！中心气泡形成双凹透镜，在倒像正中变出了正立缩像！第三步：拖动成像屏或“屏距”滑块让双像清晰锁焦！',
          'nominal',
          '一正一反双像显现',
          4
        );
      }

      const bothLocked = waterVol >= 75 && l1OuterSharp >= 0.8 && l1InnerSharp >= 0.8;
      if (bothLocked) {
        l1LockTime = clamp(l1LockTime + dt, 0, 2.5);
        const tick = Math.floor(l1LockTime * 2);
        if (tick > l1LastTick) {
          l1LastTick = tick;
          host.audio.playBeep(520 + tick * 95, 0.06);
        }
        if (l1LockTime >= 2.5) {
          finishAttempt(true);
        }
      } else {
        l1LockTime = Math.max(0, l1LockTime - dt * 1.4);
        l1LastTick = Math.floor(l1LockTime * 2);
      }

      host.hud.updateMetric('m1', {
        value: `${Math.round(waterVol)}%`,
        ratio: waterVol / 100,
        status: waterVol >= 75 ? 'nominal' : 'info',
      });
      host.hud.updateMetric('m2', {
        value: waterVol < 34 ? '水球未成形' : `${Math.round(l1OuterSharp * 100)}%`,
        ratio: l1OuterSharp,
        status: l1OuterSharp >= 0.8 ? 'nominal' : l1OuterSharp >= 0.45 ? 'caution' : 'info',
      });
      host.hud.updateMetric('m3', {
        value: bubblePct < 10 ? '未注气泡' : `${Math.round(l1InnerSharp * 100)}%`,
        ratio: l1InnerSharp,
        status: l1InnerSharp >= 0.8 ? 'nominal' : l1InnerSharp >= 0.45 ? 'caution' : 'info',
      });
      host.hud.updateMetric('m4', {
        value: `${l1LockTime.toFixed(1)} / 2.5s`,
        ratio: l1LockTime / 2.5,
        status: bothLocked ? 'nominal' : 'info',
      });
    }

    function updateL2(dt: number): void {
      sparkAnim = Math.max(0, sparkAnim - dt * 3.5);
      l2WarnCooldown = Math.max(0, l2WarnCooldown - dt);

      // Keyboard tuning
      if (keysHeld.has('a') || keysHeld.has('arrowleft')) {
        airflow = clamp(airflow - 42 * dt, 0, 100);
        syncL2Deck();
      }
      if (keysHeld.has('d') || keysHeld.has('arrowright')) {
        airflow = clamp(airflow + 42 * dt, 0, 100);
        syncL2Deck();
      }
      if (keysHeld.has('w') || keysHeld.has('arrowup')) {
        o2Conc = clamp(o2Conc + 6.5 * dt, 18, 32);
        syncL2Deck();
      }
      if (keysHeld.has('s') || keysHeld.has('arrowdown')) {
        o2Conc = clamp(o2Conc - 6.5 * dt, 18, 32);
        syncL2Deck();
      }

      const avgTemp = (sensorTemps[0] + sensorTemps[1] + sensorTemps[2]) / 3;

      // Mid-experiment Fuel Flow Surge challenge
      if (!surgeTriggered && ignited && !earthGravityMode && avgTemp >= 46) {
        surgeTriggered = true;
        surgeTimer = 8.5;
        host.audio.playWarning();
        pushDebouncedToast(
          'l2-surge',
          '燃料脉动增强！CO₂ 废气生成速率提升 38%，请适当调高微气流维持球形蓝焰不窒息！',
          'caution',
          '梦天燃烧动态工况',
          8
        );
      }
      if (surgeTimer > 0) {
        surgeTimer = Math.max(0, surgeTimer - dt);
      }

      if (ignited) {
        if (earthGravityMode) {
          // Earth 1g buoyancy mode: natural convection clears exhaust, heats ONLY top sensor
          exhaustShell = clamp(exhaustShell - 0.45 * dt, 0, 1);
          blowoutStress = clamp(blowoutStress - 0.5 * dt, 0, 1);
          flameRadius = lerp(flameRadius, 34, dt * 4);
          sensorTemps[0] = clamp(sensorTemps[0] + 6.0 * dt, 0, 100);
          sensorTemps[1] = clamp(sensorTemps[1] - 1.8 * dt, 0, 100);
          sensorTemps[2] = clamp(sensorTemps[2] - 1.8 * dt, 0, 100);
        } else {
          // True Zero-G isotropic spherical blue flame dynamics
          const surgeMult = surgeTimer > 0 ? 1.38 : 1.0;
          const co2Gen = (0.14 + (o2Conc - 18) * 0.011) * surgeMult;
          const co2Sweep = (airflow / 100) * 0.64;
          exhaustShell = clamp(exhaustShell + (co2Gen - co2Sweep) * dt, 0, 1);

          const safeAirMax = 64 + (o2Conc - 18) * 1.5;
          if (airflow > safeAirMax) {
            blowoutStress = clamp(blowoutStress + (airflow - safeAirMax) * 0.03 * dt, 0, 1);
          } else {
            blowoutStress = clamp(blowoutStress - 0.38 * dt, 0, 1);
          }

          // Suffocation or Blowout flameout
          if (exhaustShell >= 0.99) {
            ignited = false;
            flameouts += 1;
            host.audio.playCritical();
            pushDebouncedToast(
              'l2-choke',
              '火焰自我窒息熄灭！无浮力下 CO₂ 废气壳隔绝了氧气，请调高微气流扫净废气后按 Space 重新点火！',
              'critical',
              'CO₂ 废气窒息',
              3
            );
            syncL2Deck();
          } else if (blowoutStress >= 0.99) {
            ignited = false;
            flameouts += 1;
            host.audio.playCritical();
            pushDebouncedToast(
              'l2-blowout',
              '强气流吹熄了微重力冷焰！请将微气流降至 35–58% 后按 Space 重新点火！',
              'critical',
              '强风吹熄告警',
              3
            );
            syncL2Deck();
          } else {
            const targetR =
              clamp(26 + (o2Conc - 18) * 1.6, 24, 50) *
              clamp(1 - exhaustShell * 0.52, 0.35, 1) *
              clamp(1 - blowoutStress * 0.25, 0.7, 1);
            flameRadius = lerp(flameRadius, targetR, dt * 4.5);

            const heatRate =
              clamp((o2Conc - 16.5) / 13.5, 0.14, 1.18) *
              clamp(1 - exhaustShell * 0.85, 0.08, 1) *
              clamp(1 - blowoutStress * 0.55, 0.25, 1) *
              4.6;

            for (let i = 0; i < 3; i++) {
              sensorTemps[i] = clamp(sensorTemps[i] + heatRate * dt, 0, 100);
            }

            if ((exhaustShell > 0.68 || blowoutStress > 0.62) && l2WarnCooldown <= 0) {
              host.audio.playWarning();
              l2WarnCooldown = 2.6;
              if (exhaustShell > 0.68) {
                pushDebouncedToast(
                  'l2-exh-warn',
                  'CO₂ 废气壳正在增厚！微重力无自然对流，略微提高微气流避免火焰窒息！',
                  'caution',
                  '废气壳增厚',
                  6
                );
              } else {
                pushDebouncedToast(
                  'l2-blow-warn',
                  '火焰被气流剧烈拉偏，即将吹熄！请适当降低微气流！',
                  'caution',
                  '吹熄临界预警',
                  6
                );
              }
            }
          }
        }
      } else {
        // Unlit: exhaust clears smoothly with airflow, sensors gently cool
        flameRadius = lerp(flameRadius, 0, dt * 6);
        exhaustShell = clamp(exhaustShell - (0.12 + (airflow / 100) * 0.55) * dt, 0, 1);
        blowoutStress = clamp(blowoutStress - 0.6 * dt, 0, 1);
        for (let i = 0; i < 3; i++) {
          sensorTemps[i] = clamp(sensorTemps[i] - 1.1 * dt, 0, 100);
        }
        if (igniterCharges <= 0 && sparkAnim <= 0.05) {
          finishAttempt(false, '5 次电弧点火器均已耗尽，未能保持稳定微重力球形蓝焰完成均温测试。');
          return;
        }
      }

      // Check victory (all 3 probes heated to 100% in zero-G!)
      const minSensor = Math.min(sensorTemps[0], sensorTemps[1], sensorTemps[2]);
      if (minSensor >= 99.9 && !earthGravityMode) {
        finishAttempt(true);
        return;
      }

      const avgNow = (sensorTemps[0] + sensorTemps[1] + sensorTemps[2]) / 3;
      host.hud.updateMetric('m1', {
        value: `${Math.round(avgNow)}% (低:${Math.round(minSensor)}%)`,
        ratio: avgNow / 100,
        status: avgNow >= 85 ? 'nominal' : 'info',
      });
      host.hud.updateMetric('m2', {
        value: `${Math.round(exhaustShell * 100)}%`,
        ratio: exhaustShell,
        status: exhaustShell > 0.72 ? 'critical' : exhaustShell > 0.45 ? 'caution' : 'nominal',
      });
      host.hud.updateMetric('m3', {
        value: `${Math.round(blowoutStress * 100)}%`,
        ratio: blowoutStress,
        status: blowoutStress > 0.68 ? 'critical' : blowoutStress > 0.35 ? 'caution' : 'nominal',
      });
      host.hud.updateMetric('m4', {
        value: !ignited
          ? '已熄火 · 待点'
          : earthGravityMode
            ? '1g 浮力对照'
            : surgeTimer > 0
              ? '脉冲高负荷'
              : '0g 稳定蓝焰',
        ratio: ignited ? clamp(1 - Math.max(exhaustShell, blowoutStress), 0.1, 1) : 0,
        status: !ignited
          ? 'critical'
          : earthGravityMode || surgeTimer > 0
            ? 'caution'
            : 'nominal',
      });
    }

    function updateL3(dt: number): void {
      cmgHitCooldown = Math.max(0, cmgHitCooldown - dt);

      const spinActive = cmgHoldSpin || keysHeld.has('w') || keysHeld.has('arrowup');
      const leftActive = cmgHoldLeft || keysHeld.has('a') || keysHeld.has('arrowleft');
      const rightActive = cmgHoldRight || keysHeld.has('d') || keysHeld.has('arrowright');

      // Flywheel angular momentum L = I*omega
      if (spinActive) {
        rpm = clamp(rpm + 2450 * dt, 0, 6000);
      } else {
        rpm = clamp(rpm - 58 * dt, 650, 6000);
      }
      cmgMaxRpm = Math.max(cmgMaxRpm, rpm);
      const normL = clamp(rpm / 6000, 0.1, 1);
      rotorSpinAngle += (2.5 + normL * 26) * dt;

      // Determine wave by cumulative lock time (0..4s -> W1, 4..8s -> W2, 8..12s -> W3)
      const nextWave = lockAccum >= 8 ? 3 : lockAccum >= 4 ? 2 : 1;
      if (nextWave !== cmgWave) {
        cmgWave = nextWave;
        host.audio.playLock();
        pushDebouncedToast(
          `cmg-wave-${cmgWave}`,
          cmgWave === 2
            ? '第 2 波扰动【机械臂启停反作用力矩】来袭！保持高飞轮转速并轻柔进动稳住激光！'
            : '最终第 3 波【对接微振复合扰动】来袭！稳住最后 4 秒锁定即可通关！',
          'caution',
          `扰动波次 ${cmgWave}/3`,
          4
        );
      }

      // Disturbance telegraph & execution
      if (distActiveTimer > 0) {
        distActiveTimer = Math.max(0, distActiveTimer - dt);
        if (distActiveTimer <= 0) {
          distTorque = 0;
          distTimer = cmgWave === 1 ? 2.1 : cmgWave === 2 ? 1.55 : 1.15;
        }
      } else if (distTelegraph > 0) {
        distTelegraph -= dt;
        if (distTelegraph <= 0) {
          distTorque = distPendingTorque;
          distActiveTimer = cmgWave === 1 ? 1.5 : cmgWave === 2 ? 1.75 : 2.1;
          host.audio.playThruster(0.45);
        }
      } else {
        distTimer -= dt;
        if (distTimer <= 0) {
          const dir = Math.random() < 0.5 ? -1 : 1;
          const amp = cmgWave === 1 ? 22 : cmgWave === 2 ? 32 : 42;
          distPendingTorque = dir * (amp * (0.82 + Math.random() * 0.34));
          distTelegraph = 1.05;
          host.audio.playBeep(660, 0.05);
        }
      }

      // Gimbal precession torque (scales strongly with flywheel angular momentum normL!)
      let gimbalInput = 0;
      if (leftActive) gimbalInput -= 1;
      if (rightActive) gimbalInput += 1;
      if (cmgDragging) gimbalInput = clamp(cmgDragInput, -1, 1);

      const targetGimbal = gimbalInput * 44;
      gimbalAngle = lerp(gimbalAngle, targetGimbal, clamp(dt * 8, 0, 1));

      cmgAppliedTorque = gimbalInput * (18 + 44 * normL);

      // Gyroscopic stiffness: high RPM suppresses external disturbance angular acceleration!
      const gyroStiffness = 0.28 + 2.15 * normL;
      const microJitter = Math.sin(elapsed * (2.4 + cmgWave * 0.8)) * (3.5 + cmgWave * 1.4);
      const effectiveExtAccel = (distTorque + microJitter) / gyroStiffness;

      // Nutation damping grows with flywheel momentum
      const damping = -(0.55 + 1.55 * normL) * angularVel;
      angularVel += (effectiveExtAccel + cmgAppliedTorque + damping) * dt;
      tiltAngle += angularVel * dt;

      if (Math.abs(tiltAngle) > cmgPeakTilt) cmgPeakTilt = Math.abs(tiltAngle);

      // Low RPM physics tip
      if (rpm < 2200 && Math.abs(distTorque) > 10) {
        pushDebouncedToast(
          'cmg-low-rpm',
          '飞轮转速偏低，角动量 L=Iω 不足导致抗扰动刚度差！快按住 W 给飞轮提速！',
          'caution',
          '角动量不足',
          7
        );
      }

      // Hard-stop wall bounce & integrity check
      if (Math.abs(tiltAngle) > 34) {
        tiltAngle = clamp(tiltAngle, -34, 34);
        angularVel = -angularVel * 0.4;
        cmgIntegrity = clamp(cmgIntegrity - 18 * dt, 0, 100);
        if (cmgHitCooldown <= 0) {
          host.audio.playWarning();
          cmgHitCooldown = 0.6;
        }
        if (cmgIntegrity <= 0) {
          finishAttempt(false, '悬浮光学平台剧烈偏摆碰撞机柜限位，实验中止！');
          return;
        }
      }

      // Target Laser Lock check (|tiltAngle| < 4.5°)
      const locked = Math.abs(tiltAngle) <= 4.5;
      if (locked) {
        lockAccum = clamp(lockAccum + dt, 0, 12);
        if (lockAccum >= 12) {
          finishAttempt(true);
          return;
        }
      }

      host.hud.updateMetric('m1', {
        value: `${lockAccum.toFixed(1)} / 12.0s`,
        ratio: lockAccum / 12,
        status: locked ? 'nominal' : 'info',
      });
      host.hud.updateMetric('m2', {
        value: `${Math.round(rpm)} RPM`,
        ratio: rpm / 6000,
        status: rpm >= 3800 ? 'nominal' : rpm >= 2200 ? 'caution' : 'critical',
      });
      host.hud.updateMetric('m3', {
        value: `${tiltAngle >= 0 ? '+' : ''}${tiltAngle.toFixed(1)}°`,
        ratio: clamp(1 - Math.abs(tiltAngle) / 34, 0, 1),
        status: Math.abs(tiltAngle) <= 4.5 ? 'nominal' : Math.abs(tiltAngle) <= 16 ? 'caution' : 'critical',
      });
      host.hud.updateMetric('m4', {
        value: distTelegraph > 0 ? `第${cmgWave}波 · 预警!` : `第 ${cmgWave}/3 波`,
        ratio: cmgWave / 3,
        status: distTelegraph > 0 || distActiveTimer > 0 ? 'caution' : 'nominal',
      });
    }

    function updateSimulation(dt: number): void {
      if (paused || finished) return;
      elapsed += dt;
      runSeconds += dt;
      if (levelIndex === 0) updateL1(dt);
      else if (levelIndex === 1) updateL2(dt);
      else updateL3(dt);
      particles.update(dt);
    }

    // =========================================================================
    // RENDERING HELPERS
    // =========================================================================
    function drawAstronautEmblem(
      cx: number,
      cy: number,
      scale: number,
      invertY: boolean,
      alpha: number,
      blurAmount: number,
      tint: string
    ): void {
      const passes = blurAmount > 1.2 ? 5 : 1;
      for (let p = 0; p < passes; p++) {
        const ang = (p / passes) * Math.PI * 2;
        const ox = passes === 1 ? 0 : Math.cos(ang) * blurAmount;
        const oy = passes === 1 ? 0 : Math.sin(ang) * blurAmount;

        ctx.save();
        ctx.translate(cx + ox, cy + oy);
        ctx.scale(scale, invertY ? -scale : scale);
        ctx.globalAlpha = alpha / (passes === 1 ? 1 : 2.8);

        // Crisp upward orientation arrow above helmet (makes upright vs inverted instant to read!)
        ctx.strokeStyle = tint;
        ctx.fillStyle = tint;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(0, -16);
        ctx.lineTo(0, -35);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, -41);
        ctx.lineTo(-7, -30);
        ctx.lineTo(7, -30);
        ctx.closePath();
        ctx.fill();

        // Sculpted 3D Feitian Astronaut silhouette inside refraction reticle
        drawFeitianAstronaut3D(ctx, {
          x: 0,
          y: 12,
          scale: 0.78,
          facing: 1,
          thermalMode: invertY ? 'heat' : 'cool',
          suitTemp: invertY ? 31 : 19,
        });

        // Orientation letter marker
        ctx.font = '800 10px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = tint;
        ctx.fillText('▲', 0, -43);

        ctx.restore();
      }
    }

    // =========================================================================
    // RENDER LEVEL 1: WATER SPHERE DUAL-IMAGING OPTICS
    // =========================================================================
    function getL1Geometry(pr: SafePlayRect) {
      const benchY = pr.y + pr.h * 0.82;
      const axisY = pr.y + pr.h * 0.45;
      const objX = pr.x + pr.w * 0.14;
      const lensX = pr.x + pr.w * 0.46;
      const railStartX = pr.x + pr.w * 0.62;
      const railEndX = pr.x + pr.w * 0.9;
      const screenX = lerp(railStartX, railEndX, screenDist / 100);
      const maxSphereR = clamp(pr.h * 0.22, 42, 68);
      const sphereR = lerp(18, maxSphereR, waterVol / 100);
      const bubbleR = sphereR * (bubblePct / 100);
      return { benchY, axisY, objX, lensX, railStartX, railEndX, screenX, maxSphereR, sphereR, bubbleR };
    }

    function drawL1(pr: SafePlayRect): void {
      const g = getL1Geometry(pr);

      // Lab bench chamber frame (flat fill, zero clip/gradients)
      ctx.save();
      ctx.fillStyle = 'rgba(11, 20, 40, 0.94)';
      ctx.beginPath();
      ctx.roundRect(pr.x, pr.y, pr.w, pr.h, 14);
      ctx.fill();
      ctx.strokeStyle = 'rgba(192, 132, 252, 0.42)';
      ctx.lineWidth = 1.8;
      ctx.stroke();

      // Corner mounting bolts (flat circles)
      for (const [bx, by] of [
        [pr.x + 12, pr.y + 12],
        [pr.x + pr.w - 12, pr.y + 12],
        [pr.x + 12, pr.y + pr.h - 12],
        [pr.x + pr.w - 12, pr.y + pr.h - 12],
      ]) {
        ctx.fillStyle = '#64748b';
        ctx.beginPath();
        ctx.arc(bx, by, 3.4, 0, Math.PI * 2);
        ctx.fill();
      }

      // Header progress breadcrumb
      ctx.font = '700 11px "JetBrains Mono", monospace';
      ctx.fillStyle = '#c4b5fd';
      ctx.fillText(
        pr.w > 640 ? 'TIANGONG OPTICS BENCH // 水球双成像微重力光学台' : '水球双成像微重力光学台',
        pr.x + 22,
        pr.y + 24
      );

      const stepsTxt = [
        { ok: waterVol >= 75, t: '① 注水成球' },
        { ok: bubblePct >= 26 && bubblePct <= 48 && waterVol >= 64, t: '② 注入气泡' },
        { ok: l1OuterSharp >= 0.8 && l1InnerSharp >= 0.8, t: '③ 双像对焦 2.5s' },
      ];
      let sx = pr.x + pr.w - 300;
      ctx.font = '700 11px "Noto Sans SC", sans-serif';
      for (const st of stepsTxt) {
        ctx.fillStyle = st.ok ? '#4ade80' : '#64748b';
        ctx.fillText(`${st.ok ? '✓' : '○'} ${st.t}`, sx, pr.y + 24);
        sx += 98;
      }

      // Precision Optical Bench Rail with mm ruler ticks (flat slate, no gradient/clip)
      const railX = pr.x + 28;
      const railW = pr.w - 56;
      ctx.fillStyle = '#334155';
      ctx.beginPath();
      ctx.roundRect(railX, g.benchY, railW, 16, 4);
      ctx.fill();
      ctx.strokeStyle = 'rgba(203, 213, 225, 0.55)';
      ctx.lineWidth = 1.3;
      ctx.stroke();

      ctx.strokeStyle = 'rgba(226, 240, 255, 0.48)';
      ctx.lineWidth = 1;
      for (let tx = pr.x + 42; tx < pr.x + pr.w - 42; tx += 16) {
        const tall = ((tx - pr.x) % 64) < 16;
        ctx.beginPath();
        ctx.moveTo(tx, g.benchY + 1);
        ctx.lineTo(tx, g.benchY + (tall ? 9 : 5));
        ctx.stroke();
      }

      // Principal Optical Axis dashed line
      ctx.strokeStyle = 'rgba(148, 185, 235, 0.24)';
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(g.objX, g.axisY);
      ctx.lineTo(g.railEndX + 24, g.axisY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Flat translucent optical light cones (Target -> Water Sphere -> Screen, zero gradients/lighter)
      if (waterVol >= 25) {
        const waterNorm = waterVol / 100;
        const focalX = g.lensX + lerp(pr.w * 0.14, pr.w * 0.09, waterNorm);
        const rimOff = g.sphereR * 0.68;
        const tRatio = (g.screenX - focalX) / Math.max(20, focalX - g.lensX);
        const hitSpan = rimOff * clamp(tRatio, 0.2, 1.35);

        ctx.fillStyle = 'rgba(251, 191, 36, 0.08)';
        ctx.beginPath();
        ctx.moveTo(g.objX + 24, g.axisY - 34);
        ctx.lineTo(g.lensX, g.axisY - rimOff);
        ctx.lineTo(g.lensX, g.axisY + rimOff);
        ctx.lineTo(g.objX + 24, g.axisY + 34);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = 'rgba(253, 224, 71, 0.11)';
        ctx.beginPath();
        ctx.moveTo(g.lensX, g.axisY - rimOff);
        ctx.lineTo(focalX, g.axisY);
        ctx.lineTo(g.screenX - 4, g.axisY + hitSpan);
        ctx.lineTo(g.screenX - 4, g.axisY - hitSpan);
        ctx.lineTo(focalX, g.axisY);
        ctx.lineTo(g.lensX, g.axisY + rimOff);
        ctx.closePath();
        ctx.fill();

        // Crisp focal point marker
        ctx.fillStyle = `rgba(253, 224, 71, ${(0.5 + l1OuterSharp * 0.45).toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(focalX, g.axisY, 3.2, 0, Math.PI * 2);
        ctx.fill();

        // Flat emerald concave central beam when air bubble is present
        if (g.bubbleR > 4) {
          const inOff = Math.min(g.bubbleR * 0.62, 16);
          ctx.fillStyle = 'rgba(74, 222, 128, 0.13)';
          ctx.beginPath();
          ctx.moveTo(g.lensX, g.axisY - inOff);
          ctx.lineTo(g.screenX - 4, g.axisY - inOff * 1.35);
          ctx.lineTo(g.screenX - 4, g.axisY + inOff * 1.35);
          ctx.lineTo(g.lensX, g.axisY + inOff);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }

      // ---- 1. Left Illuminated Astronaut Emblem Target ----
      ctx.fillStyle = '#334155';
      ctx.fillRect(g.objX - 5, g.axisY + 46, 10, g.benchY - (g.axisY + 46));
      ctx.fillStyle = 'rgba(15, 34, 62, 0.92)';
      ctx.beginPath();
      ctx.roundRect(g.objX - 36, g.axisY - 56, 72, 104, 8);
      ctx.fill();

      drawAstronautEmblem(g.objX, g.axisY + 2, 0.92, false, 1, 0, '#e0f2fe');
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.48)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.roundRect(g.objX - 36, g.axisY - 56, 72, 104, 8);
      ctx.stroke();
      ctx.font = '700 10.5px "Noto Sans SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#93c5fd';
      ctx.fillText('正立光源靶标 (↑)', g.objX, g.benchY + 32);
      ctx.textAlign = 'left';

      // ---- 2. Center Zero-G Wire Loop + 3D Shaded Water Sphere + Air Bubble ----
      // Stand stem
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(g.lensX, g.benchY);
      ctx.lineTo(g.lensX, g.axisY + g.maxSphereR * 0.72);
      ctx.stroke();

      // Metallic wire loop ring
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(g.lensX, g.axisY, g.maxSphereR * 0.22, g.maxSphereR * 0.74, 0, 0, Math.PI * 2);
      ctx.stroke();

      // Crisp Water Sphere with Fresnel rim highlight & specular arc (zero gradients/additive halos)
      ctx.save();
      ctx.translate(g.lensX, g.axisY);

      ctx.beginPath();
      const segs = 36;
      for (let i = 0; i <= segs; i++) {
        const ang = (i / segs) * Math.PI * 2;
        const wob =
          1 +
          wobbleAmp * Math.sin(ang * 2 + wobblePhase) +
          wobbleAmp * 0.45 * Math.cos(ang * 3 - wobblePhase * 1.3);
        const rr = g.sphereR * wob;
        const px = Math.cos(ang) * rr;
        const py = Math.sin(ang) * rr;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();

      ctx.fillStyle = 'rgba(56, 189, 248, 0.34)';
      ctx.fill();

      // Fresnel rim highlight stroke
      ctx.strokeStyle = 'rgba(224, 242, 254, 0.94)';
      ctx.lineWidth = 2.1;
      ctx.stroke();

      // Specular highlight crescent on water sphere
      ctx.fillStyle = 'rgba(255, 255, 255, 0.86)';
      ctx.beginPath();
      ctx.ellipse(
        -g.sphereR * 0.34,
        -g.sphereR * 0.34,
        g.sphereR * 0.27,
        g.sphereR * 0.13,
        -0.65,
        0,
        Math.PI * 2
      );
      ctx.fill();

      // Faint miniature internal inverted reflection inside water ball
      if (waterVol >= 45) {
        drawAstronautEmblem(0, 0, (g.sphereR / 64) * 0.65, true, 0.28, 0, '#fde68a');
      }

      // Centered Air Bubble (equivalent to dual concave lens!)
      if (g.bubbleR > 2.5) {
        ctx.fillStyle = 'rgba(8, 22, 48, 0.86)';
        ctx.beginPath();
        ctx.arc(0, 0, g.bubbleR, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = l1InnerSharp >= 0.7 ? '#86efac' : '#ffffff';
        ctx.lineWidth = 1.8;
        ctx.stroke();

        // Crisp inner total-internal-reflection sparkle
        ctx.fillStyle = 'rgba(255, 255, 255, 0.86)';
        ctx.beginPath();
        ctx.ellipse(
          g.bubbleR * 0.32,
          -g.bubbleR * 0.32,
          Math.max(1.5, g.bubbleR * 0.22),
          Math.max(1, g.bubbleR * 0.1),
          0.6,
          0,
          Math.PI * 2
        );
        ctx.fill();

        // Upright miniature reflection right inside the air bubble!
        drawAstronautEmblem(0, 0, clamp(g.bubbleR / 44, 0.22, 0.55), false, 0.82, 0, '#4ade80');
      }

      // Syringe needle animation when injecting air
      if (syringeAnim > 0.02) {
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(g.sphereR + 34, -g.sphereR - 22);
        ctx.lineTo(lerp(g.sphereR + 6, 4, syringeAnim), lerp(-g.sphereR * 0.4, 0, syringeAnim));
        ctx.stroke();
      }
      ctx.restore();

      ctx.font = '700 10.5px "Noto Sans SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#7dd3fc';
      ctx.fillText(
        bubblePct > 10 ? '水球凸透镜 + 气泡凹透镜' : '微重力悬浮水球环',
        g.lensX,
        g.benchY + 32
      );
      ctx.textAlign = 'left';

      // ---- 3. Right Draggable Optical Projection Screen ----
      // Sliding carriage on rail
      ctx.fillStyle = l1DraggingScreen || l1HoverScreen ? '#38bdf8' : '#475569';
      ctx.beginPath();
      ctx.roundRect(g.screenX - 18, g.benchY - 4, 36, 22, 5);
      ctx.fill();
      ctx.fillStyle = '#64748b';
      ctx.fillRect(g.screenX - 4, g.axisY + 62, 8, g.benchY - (g.axisY + 62));

      // Screen panel border
      const scrW = 94;
      const scrH = 128;
      ctx.fillStyle = 'rgba(7, 17, 34, 0.94)';
      ctx.beginPath();
      ctx.roundRect(g.screenX - scrW * 0.5, g.axisY - scrH * 0.5, scrW, scrH, 10);
      ctx.fill();
      ctx.strokeStyle =
        l1LockTime > 0
          ? '#4ade80'
          : l1DraggingScreen || l1HoverScreen
            ? '#7dd3fc'
            : 'rgba(148, 197, 255, 0.55)';
      ctx.lineWidth = l1LockTime > 0 ? 2.5 : 2;
      ctx.beginPath();
      ctx.roundRect(g.screenX - scrW * 0.5, g.axisY - scrH * 0.5, scrW, scrH, 10);
      ctx.stroke();

      // Target calibration rings on projection screen
      const outerOk = l1OuterSharp >= 0.8 && waterVol >= 75;
      const innerOk = l1InnerSharp >= 0.8 && waterVol >= 75;
      ctx.save();
      ctx.strokeStyle = outerOk ? '#4ade80' : 'rgba(251, 191, 36, 0.45)';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = outerOk ? 2 : 1.3;
      ctx.beginPath();
      ctx.arc(g.screenX, g.axisY, 42, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = innerOk ? '#4ade80' : 'rgba(56, 189, 248, 0.42)';
      ctx.setLineDash([]);
      ctx.lineWidth = innerOk ? 2 : 1.2;
      ctx.beginPath();
      ctx.arc(g.screenX, g.axisY, 20, 0, Math.PI * 2);
      ctx.stroke();

      // Project OUTER INVERTED IMAGE (↓ convex water sphere refraction)
      if (waterVol >= 32) {
        const outBlur = (1 - l1OuterSharp) * 7.5;
        const outScale = lerp(1.18, 0.88, l1OuterSharp) * clamp(waterVol / 88, 0.65, 1.05);
        const outAlpha = clamp(0.25 + l1OuterSharp * 0.75, 0.25, 1);
        drawAstronautEmblem(
          g.screenX,
          g.axisY,
          outScale,
          true,
          outAlpha,
          outBlur,
          outerOk ? '#fde047' : '#fbbf24'
        );
      }

      // Project INNER UPRIGHT IMAGE (↑ central air bubble concave refraction)
      if (bubblePct >= 10 && waterVol >= 62) {
        const inBlur = (1 - l1InnerSharp) * 6.0;
        const inScale = clamp((bubblePct / 38) * 0.43, 0.22, 0.62);
        const inAlpha = clamp(0.28 + l1InnerSharp * 0.72, 0.28, 1);
        // Subtle dark circular backdrop separating inner upright image cleanly!
        ctx.fillStyle = 'rgba(6, 16, 34, 0.72)';
        ctx.beginPath();
        ctx.arc(g.screenX, g.axisY, 18, 0, Math.PI * 2);
        ctx.fill();
        drawAstronautEmblem(
          g.screenX,
          g.axisY,
          inScale,
          false,
          inAlpha,
          inBlur,
          innerOk ? '#4ade80' : '#7dd3fc'
        );
      }

      // Lock progress circular arc around screen
      if (l1LockTime > 0) {
        const frac = clamp(l1LockTime / 2.5, 0, 1);
        ctx.strokeStyle = '#4ade80';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(g.screenX, g.axisY, 54, -Math.PI * 0.5, -Math.PI * 0.5 + Math.PI * 2 * frac);
        ctx.stroke();
      }
      ctx.restore();

      ctx.font = '700 10.5px "Noto Sans SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = outerOk && innerOk ? '#4ade80' : '#cbd5e1';
      ctx.fillText(
        outerOk && innerOk
          ? `双像锁焦中 ${l1LockTime.toFixed(1)}s`
          : '↔ 拖动成像屏对焦',
        g.screenX,
        g.benchY + 32
      );

      // Status caption above screen
      ctx.font = '700 10px "JetBrains Mono", monospace';
      ctx.fillStyle = outerOk ? '#fde047' : '#94a3b8';
      ctx.fillText(
        waterVol >= 34 ? `外倒像(↓) ${Math.round(l1OuterSharp * 100)}%` : '外倒像: 未成形',
        g.screenX,
        g.axisY - scrH * 0.5 - 20
      );
      ctx.fillStyle = innerOk ? '#4ade80' : '#94a3b8';
      ctx.fillText(
        bubblePct >= 10 ? `内正像(↑) ${Math.round(l1InnerSharp * 100)}%` : '内正像: 待注气泡',
        g.screenX,
        g.axisY - scrH * 0.5 - 7
      );
      ctx.textAlign = 'left';

      // ---- 4. Physics Overlay (V): Snell Geometric Optical Ray Paths with Additive Optical Glow ----
      if (physicsOverlay) {
        ctx.save();
        const waterNorm = waterVol / 100;
        const focalX = g.lensX + lerp(pr.w * 0.14, pr.w * 0.09, waterNorm);

        // Gold outer convex rays crossing at focal point F1 to invert image!
        if (waterVol >= 25) {
          const topStartY = g.axisY - 34;
          const botStartY = g.axisY + 34;
          const rimOffset = g.sphereR * 0.72;
          const tRatio = (g.screenX - focalX) / Math.max(20, focalX - g.lensX);
          const screenTopHitY = g.axisY + rimOffset * clamp(tRatio, 0.2, 1.35);
          const screenBotHitY = g.axisY - rimOffset * clamp(tRatio, 0.2, 1.35);

          const traceGoldRays = () => {
            ctx.beginPath();
            ctx.moveTo(g.objX + 22, topStartY);
            ctx.lineTo(g.lensX - g.sphereR * 0.5, g.axisY - rimOffset);
            ctx.lineTo(g.lensX + g.sphereR * 0.5, g.axisY - rimOffset * 0.82);
            ctx.lineTo(focalX, g.axisY);
            ctx.lineTo(g.screenX - 2, screenTopHitY);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(g.objX + 22, botStartY);
            ctx.lineTo(g.lensX - g.sphereR * 0.5, g.axisY + rimOffset);
            ctx.lineTo(g.lensX + g.sphereR * 0.5, g.axisY + rimOffset * 0.82);
            ctx.lineTo(focalX, g.axisY);
            ctx.lineTo(g.screenX - 2, screenBotHitY);
            ctx.stroke();
          };

          ctx.strokeStyle = 'rgba(251, 191, 36, 0.42)';
          ctx.lineWidth = 5;
          traceGoldRays();
          ctx.strokeStyle = 'rgba(254, 240, 138, 0.95)';
          ctx.lineWidth = 1.8;
          traceGoldRays();

          // Focal Point marker F1
          ctx.fillStyle = '#fef9c3';
          ctx.beginPath();
          ctx.arc(focalX, g.axisY, 4.4, 0, Math.PI * 2);
          ctx.fill();
          ctx.font = '700 10px "JetBrains Mono", monospace';
          ctx.fillStyle = '#fde047';
          ctx.fillText('F₁ 凸透镜焦点 (交叉成倒像)', focalX - 38, g.axisY + 58);
        }

        // Emerald inner concave bubble rays staying upright (do not cross axis!)
        if (g.bubbleR > 4) {
          const innerOff = Math.min(g.bubbleR * 0.65, 16);
          const traceGreenRays = () => {
            ctx.beginPath();
            ctx.moveTo(g.objX + 22, g.axisY - innerOff);
            ctx.lineTo(g.lensX - g.bubbleR * 0.8, g.axisY - innerOff);
            ctx.lineTo(g.lensX + g.bubbleR * 0.8, g.axisY - innerOff * 1.15);
            ctx.lineTo(g.screenX - 2, g.axisY - innerOff * 1.35);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(g.objX + 22, g.axisY + innerOff);
            ctx.lineTo(g.lensX - g.bubbleR * 0.8, g.axisY + innerOff);
            ctx.lineTo(g.lensX + g.bubbleR * 0.8, g.axisY + innerOff * 1.15);
            ctx.lineTo(g.screenX - 2, g.axisY + innerOff * 1.35);
            ctx.stroke();
          };

          ctx.strokeStyle = 'rgba(74, 222, 128, 0.42)';
          ctx.lineWidth = 4.8;
          traceGreenRays();
          ctx.strokeStyle = 'rgba(187, 247, 208, 0.96)';
          ctx.lineWidth = 1.8;
          traceGreenRays();

          ctx.fillStyle = '#86efac';
          ctx.font = '700 10px "JetBrains Mono", monospace';
          ctx.fillText('中心气泡等效双凹透镜 (未交叉 → 成正像)', g.lensX - 95, g.axisY - g.sphereR - 14);
        }

        ctx.fillStyle = '#bae6fd';
        ctx.font = '700 10px "JetBrains Mono", monospace';
        ctx.fillText('n_水 = 1.333 | n_气 = 1.000', g.lensX - 72, g.axisY + g.sphereR + 20);
        ctx.restore();
      }

      ctx.restore();
    }

    // =========================================================================
    // RENDER LEVEL 2: ZERO-G SPHERICAL BLUE FLAME
    // =========================================================================
    function drawL2(pr: SafePlayRect): void {
      const cx = pr.cx;
      const cy = pr.cy + 4;
      const chamberR = clamp(Math.min(pr.h * 0.44, pr.w * 0.25), 108, 174);

      ctx.save();
      // Mengtian Combustion Rack Frame (flat slate fill, zero clip/gradients)
      ctx.fillStyle = 'rgba(12, 20, 38, 0.95)';
      ctx.beginPath();
      ctx.roundRect(pr.x, pr.y, pr.w, pr.h, 14);
      ctx.fill();
      ctx.strokeStyle = surgeTimer > 0 ? 'rgba(245, 158, 11, 0.78)' : 'rgba(192, 132, 252, 0.42)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Top chamber status banner
      ctx.font = '700 11px "JetBrains Mono", monospace';
      ctx.fillStyle = '#c4b5fd';
      ctx.fillText(
        pr.w > 640 ? 'MENGTIAN COMBUSTION RACK // 梦天燃烧科学实验柜' : '梦天燃烧科学实验柜',
        pr.x + 18,
        pr.y + 24
      );

      ctx.textAlign = 'right';
      ctx.font = '700 11px "Noto Sans SC", sans-serif';
      ctx.fillStyle = earthGravityMode ? '#fbbf24' : surgeTimer > 0 ? '#f97316' : '#7dd3fc';
      ctx.fillText(
        earthGravityMode
          ? '[对照] 地面 1g 浮力对流对照模式 (按 G 返回 0g 完成实验)'
          : surgeTimer > 0
            ? `[脉冲] 燃料脉动增强 (${surgeTimer.toFixed(0)}s) · 请调高微气流!`
            : `微重力 0g 扩散燃烧模式 | O₂ ${o2Conc.toFixed(1)}% · 气流 ${Math.round(airflow)}%`,
        pr.x + pr.w - 18,
        pr.y + 24
      );
      ctx.textAlign = 'left';

      // Steel Circular Pressurized Porthole Flange (flat metallic steel, no gradient/clip)
      ctx.fillStyle = '#475569';
      ctx.beginPath();
      ctx.arc(cx, cy, chamberR + 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.55)';
      ctx.lineWidth = 1.6;
      ctx.stroke();

      // Recessed inner machined groove
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.8)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, chamberR + 2, 0, Math.PI * 2);
      ctx.stroke();

      // 12 Stainless porthole bolts (flat circles)
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const bx = cx + Math.cos(a) * (chamberR + 9);
        const by = cy + Math.sin(a) * (chamberR + 9);
        ctx.fillStyle = '#94a3b8';
        ctx.beginPath();
        ctx.arc(bx, by, 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(15, 23, 42, 0.8)';
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }

      // Interior combustion chamber black-sapphire cavity
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, chamberR, 0, Math.PI * 2);
      ctx.clip();

      ctx.fillStyle = ignited ? '#061329' : '#030812';
      ctx.fillRect(cx - chamberR, cy - chamberR, chamberR * 2, chamberR * 2);

      // Animated Micro-Airflow streamlines passing left -> right
      if (airflow > 3) {
        const speed = 35 + airflow * 2.6;
        const alpha = clamp(airflow / 100, 0.08, 0.6);
        ctx.strokeStyle = `rgba(125, 211, 252, ${alpha})`;
        ctx.lineWidth = 1.4;
        for (let r = -3; r <= 3; r++) {
          const sy = cy + r * (chamberR * 0.24);
          const ox = ((elapsed * speed + (r + 5) * 63) % (chamberR * 2.2)) - chamberR * 1.1;
          ctx.beginPath();
          ctx.moveTo(cx + ox - 28, sy);
          ctx.lineTo(cx + ox + 28, sy);
          ctx.stroke();
        }
      }

      // Ceramic central fuel nozzle rising from bottom to center
      ctx.fillStyle = '#64748b';
      ctx.fillRect(cx - 5, cy + 4, 10, chamberR);
      ctx.fillStyle = '#e2e8f0';
      ctx.beginPath();
      ctx.arc(cx, cy + 4, 6, 0, Math.PI * 2);
      ctx.fill();

      // Lightweight translucent CO2 Exhaust Shell ring wrapping the flame (no radial gradients)
      if (exhaustShell > 0.12) {
        const shellR = Math.max(36, flameRadius + 20 + exhaustShell * 38);
        const driftX = (airflow / 100) * 14;
        ctx.strokeStyle = `rgba(148, 163, 184, ${(exhaustShell * 0.42).toFixed(3)})`;
        ctx.lineWidth = 12 + exhaustShell * 16;
        ctx.beginPath();
        ctx.arc(cx + driftX * 0.45, cy, shellR * 0.72, 0, Math.PI * 2);
        ctx.stroke();
      }

      // ---- Render Flame (0g Layered Cobalt-Cyan-White Sphere vs 1g Teardrop, zero gradients/lighter) ----
      if (ignited && flameRadius > 2) {
        const shearX = earthGravityMode ? 0 : blowoutStress * 34;
        const pulse = 1 + Math.sin(elapsed * 9) * 0.035;

        if (earthGravityMode) {
          // 1g Buoyancy Yellow-Orange Teardrop Flame (flat layered silhouettes)
          ctx.save();
          ctx.translate(cx, cy + 4);
          const fH = 88 + Math.sin(elapsed * 16) * 8;
          const fW = 30 + Math.cos(elapsed * 13) * 3;
          ctx.fillStyle = 'rgba(251, 146, 60, 0.82)';
          ctx.beginPath();
          ctx.moveTo(0, -fH);
          ctx.bezierCurveTo(fW, -fH * 0.4, fW * 0.95, 6, 0, 8);
          ctx.bezierCurveTo(-fW * 0.95, 6, -fW, -fH * 0.4, 0, -fH);
          ctx.fill();

          ctx.fillStyle = 'rgba(250, 204, 21, 0.9)';
          ctx.beginPath();
          ctx.moveTo(0, -fH * 0.72);
          ctx.bezierCurveTo(fW * 0.62, -fH * 0.28, fW * 0.6, 5, 0, 7);
          ctx.bezierCurveTo(-fW * 0.6, 5, -fW * 0.62, -fH * 0.28, 0, -fH * 0.72);
          ctx.fill();

          ctx.fillStyle = 'rgba(56, 189, 248, 0.88)';
          ctx.beginPath();
          ctx.ellipse(0, 2, fW * 0.45, 7, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        } else {
          // 0g Isotropic Spherical Blue Cold Flame (3 crisp translucent concentric shells)
          const fr = flameRadius * pulse;
          const fx = cx + shearX;
          const fy = cy;

          ctx.save();
          ctx.translate(fx, fy);
          ctx.scale(1 + blowoutStress * 0.42, 1 - blowoutStress * 0.16);
          ctx.fillStyle = 'rgba(37, 99, 235, 0.36)';
          ctx.beginPath();
          ctx.arc(0, 0, fr * 1.15, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = 'rgba(56, 189, 248, 0.56)';
          ctx.beginPath();
          ctx.arc(0, 0, fr * 0.82, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = 'rgba(224, 242, 254, 0.88)';
          ctx.beginPath();
          ctx.arc(0, 0, fr * 0.42, 0, Math.PI * 2);
          ctx.fill();

          // Cerulean spherical diffusion flame front ring
          ctx.strokeStyle = 'rgba(224, 242, 254, 0.92)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, 0, fr * 0.86, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      } else {
        // Unlit prompt pulsing right over nozzle
        const pulseA = 0.55 + 0.4 * Math.sin(elapsed * 5);
        ctx.font = '700 12px "Noto Sans SC", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = `rgba(253, 224, 71, ${pulseA})`;
        ctx.fillText('点击喷嘴或按 Space 电弧点火', cx, cy - 22);
        ctx.textAlign = 'left';
      }

      // Electric igniter spark flash
      if (sparkAnim > 0) {
        ctx.strokeStyle = `rgba(240, 249, 255, ${sparkAnim})`;
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(cx - 22, cy - 10);
        ctx.lineTo(cx - 6, cy - 3);
        ctx.lineTo(cx + 3, cy + 5);
        ctx.lineTo(cx + 22, cy - 8);
        ctx.stroke();
      }

      // ---- 3 Symmetrical Ring Thermal Sensors (120° apart: Top, Bottom-Right, Bottom-Left) ----
      const sensorAngles = [-Math.PI * 0.5, Math.PI / 6, (Math.PI * 5) / 6];
      const sensorLabels = ['顶部热探头 T1', '右下热探头 T2', '左下热探头 T3'];
      const probeDist = chamberR * 0.7;

      for (let i = 0; i < 3; i++) {
        const a = sensorAngles[i];
        const px = cx + Math.cos(a) * probeDist;
        const py = cy + Math.sin(a) * probeDist;
        const t = sensorTemps[i];
        const done = t >= 99.9;

        // Probe mounting strut to chamber wall
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * chamberR, cy + Math.sin(a) * chamberR);
        ctx.lineTo(px, py);
        ctx.stroke();

        // Circular probe gauge
        ctx.fillStyle = '#0f172a';
        ctx.strokeStyle = done ? '#4ade80' : t > 50 ? '#fbbf24' : '#38bdf8';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, 19, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Progress ring fill
        ctx.strokeStyle = done ? '#4ade80' : '#f59e0b';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.arc(px, py, 14, -Math.PI * 0.5, -Math.PI * 0.5 + (t / 100) * Math.PI * 2);
        ctx.stroke();

        ctx.font = '700 10px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = done ? '#86efac' : '#f8fafc';
        ctx.fillText(`${Math.round(t)}%`, px, py + 3.5);
        ctx.font = '600 9.5px "Noto Sans SC", sans-serif';
        ctx.fillStyle = '#94a3b8';
        ctx.fillText(sensorLabels[i], px, py + (i === 0 ? -24 : 31));
      }
      ctx.textAlign = 'left';

      // ---- Physics Overlay (V) for L2 ----
      if (physicsOverlay) {
        // Radial inward O2 diffusion arrows
        for (let k = 0; k < 6; k++) {
          const ang = (k / 6) * Math.PI * 2 + 0.25;
          const rOut = Math.max(66, flameRadius + 44);
          const rIn = Math.max(36, flameRadius + 14);
          drawVectorArrow(
            ctx,
            cx + Math.cos(ang) * rOut,
            cy + Math.sin(ang) * rOut,
            cx + Math.cos(ang) * rIn,
            cy + Math.sin(ang) * rIn,
            '#4ade80',
            k === 0 ? 'O₂扩散' : undefined,
            1.6
          );
        }

        // Dashed CO2 exhaust shell boundary
        const exR = Math.max(46, flameRadius + 18 + exhaustShell * 38);
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.75)';
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(cx, cy, exR, 0, Math.PI * 2);
        ctx.stroke();

        // Ghost comparison outline of Earth 1g teardrop flame
        if (!earthGravityMode) {
          ctx.strokeStyle = 'rgba(253, 224, 71, 0.52)';
          ctx.setLineDash([4, 4]);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(cx, cy - 82);
          ctx.bezierCurveTo(cx + 28, cy - 30, cx + 26, cy + 12, cx, cy + 12);
          ctx.bezierCurveTo(cx - 26, cy + 12, cx - 28, cy - 30, cx, cy - 82);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.font = '700 10px "JetBrains Mono", monospace';
          ctx.fillStyle = '#fde68a';
          ctx.fillText('虚线对照: 1g 浮力泪滴焰', cx + 30, cy - 64);
        }
        ctx.setLineDash([]);

        // Horizontal airflow velocity arrow
        drawVectorArrow(
          ctx,
          cx - chamberR + 14,
          cy + chamberR * 0.42,
          cx - chamberR + 26 + airflow * 0.72,
          cy + chamberR * 0.42,
          '#38bdf8',
          `v_air ${Math.round(airflow)}%`,
          2
        );
      }

      ctx.restore(); // end circular viewport clip

      // Circular porthole bezel rim & curved specular arc
      ctx.strokeStyle = 'rgba(125, 211, 252, 0.38)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(cx, cy, chamberR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
      ctx.lineWidth = 3.2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cx, cy, chamberR - 7, Math.PI * 1.12, Math.PI * 1.38);
      ctx.stroke();
      ctx.restore();

      // Side intake/exhaust callout badges outside viewport
      ctx.font = '700 10.5px "JetBrains Mono", monospace';
      ctx.fillStyle = '#7dd3fc';
      ctx.fillText('微气流进风口 →', pr.x + 22, cy - 6);
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(`O₂: ${o2Conc.toFixed(1)}%`, pr.x + 22, cy + 12);

      ctx.textAlign = 'right';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText('→ CO₂ 废气抽除口', pr.x + pr.w - 22, cy - 6);
      ctx.fillStyle = exhaustShell > 0.5 ? '#fbbf24' : '#86efac';
      ctx.fillText(`废气壳 δ: ${Math.round(exhaustShell * 100)}%`, pr.x + pr.w - 22, cy + 12);
      ctx.textAlign = 'left';

      particles.draw(ctx);
      ctx.restore();
    }

    // =========================================================================
    // RENDER LEVEL 3: CONTROL MOMENT GYROSCOPE (CMG)
    // =========================================================================
    function drawL3(pr: SafePlayRect): void {
      const platCx = pr.x + pr.w * 0.36;
      const platCy = pr.cy + 4;
      const detX = pr.x + pr.w * 0.84;
      const detY = platCy;
      const tiltRad = (tiltAngle * Math.PI) / 180;
      const normL = clamp(rpm / 6000, 0.08, 1);
      const locked = Math.abs(tiltAngle) <= 4.5;

      ctx.save();
      // Mengtian Zero-G Gyroscope Bay Frame (flat slate fill, zero clip/gradients)
      ctx.fillStyle = 'rgba(11, 20, 40, 0.95)';
      ctx.beginPath();
      ctx.roundRect(pr.x, pr.y, pr.w, pr.h, 14);
      ctx.fill();
      ctx.strokeStyle = locked ? 'rgba(74, 222, 128, 0.58)' : 'rgba(192, 132, 252, 0.42)';
      ctx.lineWidth = 1.8;
      ctx.stroke();

      // Header + Zero-Propellant Badge
      ctx.font = '700 11px "JetBrains Mono", monospace';
      ctx.fillStyle = '#c4b5fd';
      ctx.fillText('TIANGONG CMG TESTBED // 控制力矩陀螺无推进剂姿控实验台', pr.x + 18, pr.y + 24);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#4ade80';
      ctx.fillText('推进剂消耗: 0.00 kg · 纯电角动量定轴', pr.x + pr.w - 18, pr.y + 24);
      ctx.textAlign = 'left';

      // Target Lock Window Cone (faint green ±4.5° wedge from platform to detector)
      const beamSpan = detX - platCx;
      const lockHalfH = Math.tan((4.5 * Math.PI) / 180) * beamSpan;
      ctx.fillStyle = locked ? 'rgba(34, 197, 94, 0.13)' : 'rgba(56, 189, 248, 0.05)';
      ctx.beginPath();
      ctx.moveTo(platCx, platCy);
      ctx.lineTo(detX, detY - lockHalfH);
      ctx.lineTo(detX, detY + lockHalfH);
      ctx.closePath();
      ctx.fill();

      // Target Photodetector Array on Right Wall with recessed glazing
      const detH = clamp(pr.h * 0.62, 140, 220);
      ctx.fillStyle = '#18263d';
      ctx.beginPath();
      ctx.roundRect(detX - 10, detY - detH * 0.5, 34, detH, 6);
      ctx.fill();

      // Green bullseye target zone (±4.5°) on detector
      ctx.fillStyle = locked ? 'rgba(34, 197, 94, 0.45)' : 'rgba(34, 197, 94, 0.2)';
      ctx.strokeStyle = '#4ade80';
      ctx.lineWidth = 1.8;
      ctx.fillRect(detX - 10, detY - lockHalfH, 16, lockHalfH * 2);
      ctx.strokeRect(detX - 10, detY - lockHalfH, 16, lockHalfH * 2);

      // Cumulative Lock Progress Vertical Gauge inside Detector
      const fillRatio = clamp(lockAccum / 12, 0, 1);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(detX + 10, detY - detH * 0.42, 8, detH * 0.84);
      ctx.fillStyle = '#4ade80';
      const fillH = detH * 0.84 * fillRatio;
      ctx.fillRect(detX + 10, detY + detH * 0.42 - fillH, 8, fillH);
      ctx.strokeStyle = 'rgba(148, 197, 255, 0.35)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.roundRect(detX - 10, detY - detH * 0.5, 34, detH, 6);
      ctx.stroke();

      ctx.font = '700 10px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = locked ? '#86efac' : '#94a3b8';
      ctx.fillText('激光靶区', detX + 7, detY - detH * 0.5 - 10);
      ctx.fillText(`${lockAccum.toFixed(1)}s`, detX + 7, detY + detH * 0.5 + 16);
      ctx.textAlign = 'left';

      // ---- Alignment Laser Beam (flat source-over 2-pass beam, zero lighter/glows) ----
      const emitterLocalX = 82;
      const laserStartX = platCx + Math.cos(tiltRad) * emitterLocalX;
      const laserStartY = platCy + Math.sin(tiltRad) * emitterLocalX;
      const laserDx = Math.cos(tiltRad);
      const laserDy = Math.sin(tiltRad);
      const rayT = (detX - 10 - laserStartX) / Math.max(0.2, laserDx);
      const laserHitX = detX - 10;
      const laserHitY = clamp(laserStartY + laserDy * rayT, pr.y + 34, pr.y + pr.h - 20);
      const laserRgb = locked
        ? '74, 222, 128'
        : Math.abs(tiltAngle) > 18
          ? '239, 68, 68'
          : '250, 204, 21';

      ctx.strokeStyle = `rgba(${laserRgb}, 0.36)`;
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(laserStartX, laserStartY);
      ctx.lineTo(laserHitX, laserHitY);
      ctx.stroke();

      ctx.strokeStyle = locked ? '#dcfce7' : Math.abs(tiltAngle) > 18 ? '#fee2e2' : '#fef9c3';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(laserStartX, laserStartY);
      ctx.lineTo(laserHitX, laserHitY);
      ctx.stroke();

      // Impact dot
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(laserHitX, laserHitY, 4.2, 0, Math.PI * 2);
      ctx.fill();

      // ---- Floating Optical Platform + Central Control Moment Gyroscope ----
      ctx.save();
      ctx.translate(platCx, platCy);
      ctx.rotate(tiltRad);

      // Platform chassis bar (flat dark titanium, zero gradient/clip)
      ctx.fillStyle = '#253348';
      ctx.beginPath();
      ctx.roundRect(-86, -24, 172, 48, 10);
      ctx.fill();
      ctx.strokeStyle = locked ? '#4ade80' : '#94a3b8';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Laser emitter turret on right end of platform
      ctx.fillStyle = '#334155';
      ctx.fillRect(68, -9, 18, 18);
      ctx.fillStyle = locked ? '#4ade80' : '#f59e0b';
      ctx.beginPath();
      ctx.arc(84, 0, 4, 0, Math.PI * 2);
      ctx.fill();

      // Counterbalance sensor pod on left end wrapped with Kapton Gold MLI foil accent
      const mliPattern = getMLIPattern(ctx);
      ctx.fillStyle = mliPattern ?? '#b45309';
      ctx.fillRect(-78, -12, 18, 24);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.25)';
      ctx.fillRect(-78, -12, 18, 24);
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 1.4;
      ctx.strokeRect(-78, -12, 18, 24);

      // High-Speed Precision 3D Control Moment Gyroscope (CMG)
      const cmgR = 54;

      drawControlGyroscope3D(ctx, {
        cx: 0,
        cy: 0,
        radius: cmgR,
        rotorAngle: rotorSpinAngle,
        gimbalTiltRad: (gimbalAngle * Math.PI) / 180,
        rpmNorm: normL,
        simTime: elapsed,
      });

      // Cyan motion-blur spin streaks at high RPM (normal source-over blend)
      const rotorR = cmgR * 0.56;
      if (rpm > 2000) {
        ctx.strokeStyle = `rgba(125, 211, 252, ${(normL * 0.72).toFixed(3)})`;
        ctx.lineWidth = 2.2;
        for (let a = 0; a < 3; a++) {
          const baseA = rotorSpinAngle * 1.3 + (a * Math.PI * 2) / 3;
          ctx.beginPath();
          ctx.arc(0, 0, rotorR + 3, baseA, baseA + 0.9 * normL);
          ctx.stroke();
        }
      }

      ctx.restore(); // end platform rotation

      // Disturbance Telegraph / Active Wave Banner right below platform
      ctx.textAlign = 'center';
      ctx.font = '700 11px "JetBrains Mono", monospace';
      ctx.fillStyle = rpm >= 3600 ? '#4ade80' : '#fbbf24';
      ctx.fillText(
        `飞轮 ${Math.round(rpm)} RPM · 定轴刚度 ×${(0.28 + 2.15 * normL).toFixed(1)}`,
        platCx,
        platCy + 82
      );

      if (distTelegraph > 0) {
        ctx.fillStyle = '#fbbf24';
        ctx.font = '700 12px "Noto Sans SC", sans-serif';
        const dirTxt = distPendingTorque > 0 ? '顺时针 ↻' : '逆时针 ↺';
        ctx.fillText(`[预警] 扰动力矩即将袭来 (${dirTxt})`, platCx, platCy - 86);
      } else if (distActiveTimer > 0) {
        ctx.fillStyle = '#f87171';
        ctx.font = '700 12px "Noto Sans SC", sans-serif';
        const dirTxt = distTorque > 0 ? '顺时针冲击 ↻' : '逆时针冲击 ↺';
        ctx.fillText(`[冲击] 微重力扰动施加中 (${dirTxt})`, platCx, platCy - 86);
      }
      ctx.textAlign = 'left';

      // ---- Physics Overlay (V) for L3: Angular Momentum L, Disturbance τ_ext, CMG τ_cmg ----
      if (physicsOverlay) {
        ctx.save();
        // 1. Cyan Angular Momentum Vector L = Iω perpendicular to platform spin plane
        const lVecLen = 30 + normL * 78;
        const lAng = tiltRad - Math.PI * 0.5;
        const lx2 = platCx + Math.cos(lAng) * lVecLen;
        const ly2 = platCy + Math.sin(lAng) * lVecLen;
        drawVectorArrow(
          ctx,
          platCx,
          platCy,
          lx2,
          ly2,
          '#7dd3fc',
          `L = Iω (${Math.round(rpm)} RPM)`,
          2.8
        );

        // 2. External Disturbance Torque Vector τ_ext
        const shownExt = distActiveTimer > 0 ? distTorque : distTelegraph > 0 ? distPendingTorque * 0.65 : 0;
        if (Math.abs(shownExt) > 2) {
          const sign = Math.sign(shownExt);
          const tx1 = platCx - 76;
          const ty1 = platCy - sign * 34;
          const ty2 = ty1 + sign * clamp(Math.abs(shownExt) * 1.4, 22, 62);
          drawVectorArrow(ctx, tx1, ty1, tx1, ty2, '#f97316', 'τ_ext 外扰力矩', 2.4);
        }

        // 3. Reactive CMG Precession Torque Vector τ_cmg = Ω × L
        if (Math.abs(cmgAppliedTorque) > 2) {
          const sign = Math.sign(cmgAppliedTorque);
          const cx1 = platCx + 76;
          const cy1 = platCy - sign * 28;
          const cy2 = cy1 + sign * clamp(Math.abs(cmgAppliedTorque) * 0.9, 24, 60);
          drawVectorArrow(ctx, cx1, cy1, cx1, cy2, '#4ade80', 'τ_cmg = Ω×L', 2.4);
        }

        // 4. Protractor tilt angle arc
        ctx.strokeStyle = 'rgba(148, 185, 235, 0.35)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(platCx, platCy, 108, -0.5, 0.5);
        ctx.stroke();
        ctx.font = '700 10px "JetBrains Mono", monospace';
        ctx.fillStyle = locked ? '#4ade80' : '#fbbf24';
        ctx.fillText(
          `θ = ${tiltAngle >= 0 ? '+' : ''}${tiltAngle.toFixed(1)}° (绿区 ±4.5°)` ,
          platCx + 114,
          platCy + Math.sin(tiltRad) * 90 + 4
        );
        ctx.restore();
      }

      ctx.restore();
    }

    function drawScene(): void {
      const { width: w, height: h } = hi.getSize();
      if (!drawBakedBackdrop(ctx, 'lab-interior', w, h, 0.25, 0.36)) {
        starfield.draw(ctx, w, h, elapsed, elapsed * 2, elapsed * 0.8);
      }
      const pr = getPlayRect(w, h);

      if (levelIndex === 0) drawL1(pr);
      else if (levelIndex === 1) drawL2(pr);
      else drawL3(pr);
    }

    // =========================================================================
    // POINTER & KEYBOARD HANDLERS
    // =========================================================================
    function getCanvasPt(ev: PointerEvent): { x: number; y: number } {
      const rect = canvas.getBoundingClientRect();
      return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
    }

    const onPointerDown = (ev: PointerEvent) => {
      if (paused || finished) return;
      const pt = getCanvasPt(ev);
      const { width, height } = hi.getSize();
      const pr = getPlayRect(width, height);

      if (levelIndex === 0) {
        const g = getL1Geometry(pr);
        // Drag projection screen along rail
        if (Math.abs(pt.x - g.screenX) <= 58 && Math.abs(pt.y - g.axisY) <= 84) {
          l1DraggingScreen = true;
          canvas.setPointerCapture?.(ev.pointerId);
          return;
        }
        // Clicking water sphere gives a helpful water pulse
        if (dist(pt.x, pt.y, g.lensX, g.axisY) <= g.maxSphereR + 12) {
          if (waterVol < 86) {
            waterVol = clamp(waterVol + 18, 0, 100);
            wobbleAmp = 0.28;
            host.audio.playBeep(460 + waterVol * 2.6, 0.06);
          } else if (bubblePct < 36) {
            bubblePct = clamp(bubblePct + 12, 0, 65);
            wobbleAmp = 0.22;
            syringeAnim = 1;
            host.audio.playBeep(640 + bubblePct * 3, 0.06);
          }
          syncL1Deck();
        }
      } else if (levelIndex === 1) {
        // Clicking central nozzle ignites!
        if (!ignited && dist(pt.x, pt.y, pr.cx, pr.cy + 4) <= 68) {
          triggerIgnite();
        }
      } else if (levelIndex === 2) {
        // Dragging on the floating CMG platform applies continuous gimbal precession
        const platCx = pr.x + pr.w * 0.36;
        const platCy = pr.cy + 4;
        if (dist(pt.x, pt.y, platCx, platCy) <= 105) {
          cmgDragging = true;
          cmgDragStartX = pt.x;
          cmgDragInput = 0;
          canvas.setPointerCapture?.(ev.pointerId);
        }
      }
    };

    const onPointerMove = (ev: PointerEvent) => {
      const pt = getCanvasPt(ev);
      const { width, height } = hi.getSize();
      const pr = getPlayRect(width, height);

      if (levelIndex === 0) {
        const g = getL1Geometry(pr);
        if (l1DraggingScreen && !paused && !finished) {
          screenDist = clamp(((pt.x - g.railStartX) / Math.max(10, g.railEndX - g.railStartX)) * 100, 0, 100);
          syncL1Deck();
          canvas.style.cursor = 'grabbing';
          return;
        }
        l1HoverScreen = Math.abs(pt.x - g.screenX) <= 56 && Math.abs(pt.y - g.axisY) <= 82;
        const hoverWater = dist(pt.x, pt.y, g.lensX, g.axisY) <= g.maxSphereR + 10;
        canvas.style.cursor = l1HoverScreen ? 'ew-resize' : hoverWater ? 'pointer' : 'default';
      } else if (levelIndex === 1) {
        const hoverNozzle = !ignited && dist(pt.x, pt.y, pr.cx, pr.cy + 4) <= 64;
        canvas.style.cursor = hoverNozzle ? 'pointer' : 'default';
      } else {
        if (cmgDragging && !paused && !finished) {
          cmgDragInput = clamp((pt.x - cmgDragStartX) / 55, -1, 1);
          canvas.style.cursor = 'grabbing';
          return;
        }
        const platCx = pr.x + pr.w * 0.36;
        const platCy = pr.cy + 4;
        canvas.style.cursor = dist(pt.x, pt.y, platCx, platCy) <= 95 ? 'grab' : 'default';
      }
    };

    const onPointerUp = (ev: PointerEvent) => {
      if (l1DraggingScreen) {
        l1DraggingScreen = false;
        canvas.releasePointerCapture?.(ev.pointerId);
        canvas.style.cursor = 'default';
      }
      if (cmgDragging) {
        cmgDragging = false;
        cmgDragInput = 0;
        canvas.releasePointerCapture?.(ev.pointerId);
        canvas.style.cursor = 'default';
      }
    };

    const onKeyDown = (ev: KeyboardEvent) => {
      if (paused || finished) return;
      const k = ev.key.toLowerCase();
      // Never bind forbidden global shell shortcuts
      if (/^[1-8]$/.test(ev.key) || ['tab', 'escape', 'v', 'r', 'm', 'f', '?'].includes(k)) {
        return;
      }
      const isInputFocused = (ev.target as HTMLElement | null)?.tagName === 'INPUT';

      if (levelIndex === 1) {
        if (ev.code === 'Space') {
          ev.preventDefault();
          if (!ev.repeat) triggerIgnite();
          return;
        }
        if (k === 'g' && !ev.repeat) {
          ev.preventDefault();
          toggleEarthGravity();
          return;
        }
      }

      if (isInputFocused && k.startsWith('arrow')) return;
      if (['a', 'd', 'w', 's', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(k)) {
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
          cmgHoldLeft = false;
          cmgHoldRight = false;
          cmgHoldSpin = false;
          l1DraggingScreen = false;
          cmgDragging = false;
        }
      },
      setPhysicsOverlay(enabled: boolean): void {
        physicsOverlay = enabled;
      },
    };
  },
};
