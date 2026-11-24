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
  drawBakedBackdrop,
  drawTitaniumModule,
  getMLIPattern,
} from '../../core/materials';
import { drawModelSprite, isModelSpriteLoaded } from '../../core/model-sprites';
import type {
  GameHostAPI,
  GameInstance,
  GameModule,
  GameResult,
  MetricStatus,
} from '../../core/game-interface';

interface DockingLevelConfig {
  name: string;
  subtitle: string;
  objective: string;
  initialFuel: number;
  startRelX: number; // negative px from docking collar
  startRelY: number;
  startVx: number;
  startVy: number;
  startTheta: number; // rad
  startOmega: number; // rad/s
  eclipse: boolean;
  targetDriftAmpY: number;
  targetDriftFreqY: number;
  targetRollAmpRad: number;
  targetRollFreq: number;
  crossCoupling: number; // subtle disturbance torque when firing main thrust
  fuelTarget3Star: number;
  codexId: string;
}

const LEVELS: DockingLevelConfig[] = [
  {
    name: '标准终近对接',
    subtitle: '静止目标 · 充足燃料 · 惯性制动教学',
    objective: '沿绿色安全走廊缓慢逼近前向对接口，相对速度 ≤ 0.25 m/s、偏角 ≤ 7° 完成软捕获',
    initialFuel: 100,
    startRelX: -390,
    startRelY: -18,
    startVx: 0,
    startVy: 0,
    startTheta: 0,
    startOmega: 0,
    eclipse: false,
    targetDriftAmpY: 0,
    targetDriftFreqY: 0,
    targetRollAmpRad: 0,
    targetRollFreq: 0,
    crossCoupling: 0,
    fuelTarget3Star: 52,
    codexId: 'docking-inertia',
  },
  {
    name: '燃料受限漂移',
    subtitle: '65% 推进剂 · 初始横向漂移与偏航角',
    objective: '在 65% 燃料上限内消除初始偏航与横向漂移，采用“小脉冲+滑行”完成节能对接',
    initialFuel: 65,
    startRelX: -385,
    startRelY: 64,
    startVx: 7,
    startVy: -15,
    startTheta: -0.21,
    startOmega: 0.055,
    eclipse: false,
    targetDriftAmpY: 0,
    targetDriftFreqY: 0,
    targetRollAmpRad: 0,
    targetRollFreq: 0,
    crossCoupling: 0,
    fuelTarget3Star: 22,
    codexId: 'docking-rcs',
  },
  {
    name: '地影区应急对接',
    subtitle: '地影暗光 · 探照灯照明 · 微幅滚摆与推力微扰',
    objective: '借助探照灯光锥在地影黑夜中锁定微幅摆动的对接口，克服喷口耦合微扰完成应急对接',
    initialFuel: 78,
    startRelX: -395,
    startRelY: -52,
    startVx: 4,
    startVy: 11,
    startTheta: 0.16,
    startOmega: -0.05,
    eclipse: true,
    targetDriftAmpY: 14,
    targetDriftFreqY: 0.36,
    targetRollAmpRad: 0.068,
    targetRollFreq: 0.42,
    crossCoupling: 0.12,
    fuelTarget3Star: 20,
    codexId: 'docking-coas',
  },
];

// Scale & capture thresholds
const NOSE_LEN = 46; // px from ship CoM to docking probe tip
const MAX_CAPTURE_SPEED_PX = 18; // 18 px/s == 0.25 m/s
const IMPACT_ABORT_SPEED_PX = 55; // > 55 px/s damages collar
const MAX_CAPTURE_OFFSET_Y = 14; // px
const MAX_CAPTURE_ANGLE_DEG = 7; // degrees
const PX_TO_MS = 0.25 / MAX_CAPTURE_SPEED_PX;
const PX_TO_METERS = 0.04; // 390px ≈ 15.6m terminal approach

const THRUST_FWD = 58; // px/s²
const THRUST_LAT = 46; // px/s²
const THRUST_ROT = 1.48; // rad/s²
const SAS_DAMP_LIN = 48; // px/s²
const SAS_DAMP_ANG = 2.1; // rad/s²

const FUEL_BURN_LIN = 5.6; // %/s
const FUEL_BURN_ROT = 3.2; // %/s
const FUEL_BURN_SAS = 4.4; // %/s max

type ControlKey = 'fwd' | 'retro' | 'port' | 'stbd' | 'ccw' | 'cw' | 'sas';

export const dockingGame: GameModule = {
  meta: {
    id: 'docking',
    number: '01',
    shortTitle: '交会对接',
    title: '轨道交会对接',
    enTitle: 'ORBITAL DOCKING',
    moduleName: '前向对接口',
    genre: '惯性物理微操',
    tagline: '微重力无阻力下用RCS冷气推进完成毫米级对准',
    accent: '#38bdf8',
    hubAnchor: { x: 0.5, y: 0.22 },
    briefingSteps: [
      {
        title: '掌握微重力惯性滑行',
        desc: '低地球轨道几乎没有空气阻力，点喷加速后飞船会保持匀速漂移，接近目标前务必按 S 提前反向制动。',
      },
      {
        title: '校准 COAS 光学靶心',
        desc: '观察顶部 COAS 十字瞄准靶与绿色走廊，用 A/D 修正上下偏移、Q/E 调平姿态，将误差收拢到绿区。',
      },
      {
        title: '毫米级低速软捕获',
        desc: '以 ≤ 0.25 m/s、偏移 ≤ 14px、偏角 ≤ 7° 轻触对接环触发 12 组锁钩锁紧；超速猛撞会损坏对接口。',
      },
    ],
    controlsHint: 'W/S 前进反推 · A/D 上下平移 · Q/E 旋转 · Space 阻尼(SAS) · 方向键/底部按钮均可操作',
    levels: LEVELS.map((l, index) => ({
      index,
      name: l.name,
      subtitle: l.subtitle,
      objective: l.objective,
    })),
    codexIds: ['docking-inertia', 'docking-coas', 'docking-rcs'],
  },

  mount(canvasHost: HTMLElement, host: GameHostAPI): GameInstance {
    const stars = new StarfieldRenderer(185, 101);
    const particles = new ParticleSystem();

    let levelIndex = clamp(host.getLevel(), 0, LEVELS.length - 1);
    let paused = host.isPaused();
    let physicsOverlay = host.hud.isPhysicsOverlayEnabled();
    let destroyed = false;

    // Simulation state (ship coordinates are relative to nominal docking collar (0, 0))
    let shipX = -380;
    let shipY = 0;
    let vx = 0;
    let vy = 0;
    let theta = 0;
    let omega = 0;
    let fuel = 100;
    let collarIntegrity = 100;
    let collarBumps = 0;
    let simTime = 0;
    let elapsed = 0;
    let shakeTime = 0;
    let shakeIntensity = 0;
    let thrustSoundCooldown = 0;
    let zeroFuelDriftTimer = 0;

    // Outcome & capture animation state
    let phase: 'playing' | 'capturing' | 'aborting' | 'finished' = 'playing';
    let animTimer = 0;
    let captureStartX = 0;
    let captureStartY = 0;
    let captureStartTheta = 0;
    let capturedRelSpeedMs = 0;
    let capturedOffsetPx = 0;
    let capturedAngDeg = 0;
    let abortReason = '';
    let abortDetail = '';
    let resultSent = false;

    // Contextual science toast flags (debounced per attempt)
    let toastInertiaShown = false;
    let toastFinalZoneShown = false;
    let toastLowFuelShown = false;
    let toastSasShown = false;
    let toastEclipseBeamShown = false;
    let lastBumpToastTime = -10;
    let hasEverThrustedFwd = false;

    // Input state (separate keyboard and pointer sources so neither cancels the other)
    const keyInput: Record<ControlKey, boolean> = {
      fwd: false,
      retro: false,
      port: false,
      stbd: false,
      ccw: false,
      cw: false,
      sas: false,
    };
    const btnInput: Record<ControlKey, boolean> = {
      fwd: false,
      retro: false,
      port: false,
      stbd: false,
      ccw: false,
      cw: false,
      sas: false,
    };
    const deckButtons = new Map<ControlKey, HTMLButtonElement>();

    let width = 960;
    let height = 600;

    const handle = setupHiDPICanvas(canvasHost, (w, h) => {
      width = w;
      height = h;
    });
    const initialSize = handle.getSize();
    width = initialSize.width;
    height = initialSize.height;

    const isControlActive = (k: ControlKey): boolean => keyInput[k] || btnInput[k];

    const syncDeckVisuals = (): void => {
      for (const [k, btn] of deckButtons) {
        btn.classList.toggle('is-active', isControlActive(k));
      }
    };

    // Build tactile thruster deck
    const buildTactileDeck = (): void => {
      host.hud.clearTactileDeck();
      deckButtons.clear();
      const deck = host.hud.getTactileDeck();

      const specs: { key: ControlKey; label: string; title: string; extraClass?: string }[] = [
        { key: 'ccw', label: '⟲ 左旋 Q', title: '逆时针调整姿态 (Q)' },
        { key: 'port', label: '▲ 上移 A', title: '向左舷/上方平移推进 (A / ↑)' },
        { key: 'retro', label: '◀ 反推 S', title: '反向制动减速 (S / ←)' },
        { key: 'fwd', label: '▶ 前推 W', title: '沿轴向推进靠近 (W / →)' },
        { key: 'stbd', label: '▼ 下移 D', title: '向右舷/下方平移推进 (D / ↓)' },
        { key: 'cw', label: '⟳ 右旋 E', title: '顺时针调整姿态 (E)' },
        { key: 'sas', label: '◎ 阻尼 Space', title: '按住启用 RCS 姿态/速度阻尼 (Space)', extraClass: 'is-gold' },
      ];

      for (const sp of specs) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `deck-ctrl-btn${sp.extraClass ? ' ' + sp.extraClass : ''}`;
        btn.textContent = sp.label;
        btn.title = sp.title;

        const press = (e: PointerEvent) => {
          e.preventDefault();
          if (paused || phase !== 'playing') return;
          btnInput[sp.key] = true;
          syncDeckVisuals();
        };
        const release = () => {
          if (!btnInput[sp.key]) return;
          btnInput[sp.key] = false;
          syncDeckVisuals();
        };

        btn.addEventListener('pointerdown', press);
        btn.addEventListener('pointerup', release);
        btn.addEventListener('pointerleave', release);
        btn.addEventListener('pointercancel', release);

        deck.appendChild(btn);
        deckButtons.set(sp.key, btn);
      }
    };

    const clearInputs = (): void => {
      (Object.keys(keyInput) as ControlKey[]).forEach((k) => {
        keyInput[k] = false;
        btnInput[k] = false;
      });
      syncDeckVisuals();
    };

    const getTargetPose = (t: number) => {
      const cfg = LEVELS[levelIndex];
      const y = cfg.targetDriftAmpY * Math.sin(t * cfg.targetDriftFreqY);
      const vyTarget = cfg.targetDriftAmpY * cfg.targetDriftFreqY * Math.cos(t * cfg.targetDriftFreqY);
      const ang = cfg.targetRollAmpRad * Math.sin(t * cfg.targetRollFreq + 0.7);
      return { y, vy: vyTarget, ang };
    };

    const getLayout = () => {
      const compact = height <= 720;
      const safeTop = compact ? 102 : 124;
      const safeBottom = Math.max(safeTop + 190, height - (compact ? 94 : 134));
      const centerY = (safeTop + safeBottom) * 0.52;
      const portX = clamp(width * 0.75, Math.min(width - 175, 520), width - 210);
      return { safeTop, safeBottom, centerY, portX };
    };

    const resetLevel = (idx: number): void => {
      levelIndex = clamp(idx, 0, LEVELS.length - 1);
      const cfg = LEVELS[levelIndex];
      const layout = getLayout();

      // Scale start distance slightly on narrower viewports so ship always spawns well inside screen
      const maxRunway = Math.max(240, layout.portX - 120);
      shipX = -Math.min(Math.abs(cfg.startRelX), maxRunway);
      shipY = cfg.startRelY;
      vx = cfg.startVx;
      vy = cfg.startVy;
      theta = cfg.startTheta;
      omega = cfg.startOmega;
      fuel = cfg.initialFuel;
      collarIntegrity = 100;
      collarBumps = 0;
      simTime = 0;
      elapsed = 0;
      shakeTime = 0;
      shakeIntensity = 0;
      zeroFuelDriftTimer = 0;

      phase = 'playing';
      animTimer = 0;
      resultSent = false;
      abortReason = '';
      abortDetail = '';

      toastInertiaShown = false;
      toastFinalZoneShown = false;
      toastLowFuelShown = false;
      toastSasShown = false;
      toastEclipseBeamShown = false;
      lastBumpToastTime = -10;
      hasEverThrustedFwd = false;

      particles.clear();
      clearInputs();

      host.hud.setObjective(cfg.objective);
      host.hud.setMetrics([
        { id: 'dist', label: '对接距离', value: `${(Math.abs(shipX + NOSE_LEN) * PX_TO_METERS).toFixed(1)} m`, status: 'info' },
        { id: 'vel', label: '相对速度', value: `${(Math.hypot(vx, vy) * PX_TO_MS).toFixed(2)} m/s`, status: 'nominal' },
        { id: 'align', label: '偏角 / 偏移', value: `0.0° / 0px`, status: 'info' },
        {
          id: 'fuel',
          label: 'RCS 推进剂',
          value: `${Math.round(fuel)}%`,
          ratio: fuel / 100,
          status: fuel > 35 ? 'nominal' : 'caution',
        },
      ]);

      if (levelIndex === 0) {
        host.hud.pushToast('轻按 W 获得初速后即可松手滑行，靠拢前务必按 S 反向脉冲制动！', 'info', '微重力教学');
      } else if (levelIndex === 1) {
        host.hud.pushToast('推进剂仅剩 65%！先用 Q/E 调平偏航，再用极短脉冲修正横向漂移。', 'caution', 'RCS 节能模式');
      } else {
        host.hud.pushToast('已进入地球本影区！借助飞船探照灯光锥瞄准微幅摆动的空间站对接环。', 'caution', '地影应急对接');
      }
    };

    const spawnPlume = (
      localX: number,
      localY: number,
      localDirX: number,
      localDirY: number,
      intensity = 1,
      tint = '#bae6fd'
    ): void => {
      const layout = getLayout();
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      const wx = layout.portX + shipX + localX * cos - localY * sin;
      const wy = layout.centerY + shipY + localX * sin + localY * cos;
      const dx = localDirX * cos - localDirY * sin;
      const dy = localDirX * sin + localDirY * cos;

      const count = intensity > 0.7 ? 2 : 1;
      for (let i = 0; i < count; i++) {
        const spread = (Math.random() - 0.5) * 0.34;
        const cs = Math.cos(spread);
        const sn = Math.sin(spread);
        const spd = (95 + Math.random() * 65) * intensity;
        particles.spawn({
          x: wx,
          y: wy,
          vx: vx * 0.3 + (dx * cs - dy * sn) * spd,
          vy: vy * 0.3 + (dx * sn + dy * cs) * spd,
          life: 0.22 + Math.random() * 0.16,
          size: 2.0 + Math.random() * 2.2 * intensity,
          color: tint,
          kind: i === 0 ? 'glow' : 'dot',
        });
      }
    };

    const finishMission = (won: boolean): void => {
      if (resultSent) return;
      resultSent = true;
      phase = 'finished';
      clearInputs();

      const cfg = LEVELS[levelIndex];

      if (won) {
        const speedScore = clamp(Math.round((1 - capturedRelSpeedMs / 0.28) * 320), 80, 320);
        const alignScore = clamp(Math.round((1 - capturedOffsetPx / 16) * 180 + (1 - capturedAngDeg / 8) * 140), 70, 320);
        const fuelScore = clamp(Math.round((fuel / cfg.initialFuel) * 260), 20, 260);
        const integrityScore = Math.max(0, 120 - collarBumps * 45);
        const score = speedScore + alignScore + fuelScore + integrityScore;

        let stars: 1 | 2 | 3 = 1;
        if (
          collarBumps === 0 &&
          fuel >= cfg.fuelTarget3Star &&
          (capturedRelSpeedMs <= 0.20 || score >= 780)
        ) {
          stars = 3;
        } else if (collarBumps <= 1 && score >= 560) {
          stars = 2;
        }

        const scienceCards = [
          {
            title: '微重力惯性与反向脉冲制动',
            gameAction: `你以 ${capturedRelSpeedMs.toFixed(2)} m/s 的极低相对速度完成了软捕获，并在接近前通过反向喷气抵消了滑行惯性。`,
            realStationFact: '在 400 公里近地轨道，空气阻力几乎为零。神舟飞船终近对接时严格执行“脉冲加速—无动力滑行—反向减速”策略，确保碰撞能量低于对接缓冲机构吸收极限。',
            realData: '神舟终近对接相对速度 ≤ 0.2 m/s | 轴向偏角容差 ±5°',
            codexId: 'docking-inertia',
          },
          {
            title: 'RCS 姿控冷气推进与 Δv 燃料预算',
            gameAction: `你在受限推进剂条件下保住了 ${Math.round(fuel)}% 余量，通过短脉冲微调同时消除了横向漂移与姿态偏航。`,
            realStationFact: '飞船周身对称布置多组 25N/150N 姿控发动机，成对点火产生纯力偶调姿，同向点火实现精准平移；太空推进剂极其珍贵，每克燃料都直接关乎在轨安全余度。',
            realData: '神舟 RCS 毫秒级脉宽调制 | 燃料余度决定应急复飞能力',
            codexId: 'docking-rcs',
          },
          {
            title: 'COAS 光学瞄准靶与地影应急手控对接',
            gameAction: `你在地球阴影区借助探照灯追踪目标滚摆，最终将偏角控制在 ${capturedAngDeg.toFixed(1)}°、横向偏差 ${Math.round(capturedOffsetPx)}px 完成捕获！`,
            realStationFact: '真实空间站对接口装有光学十字靶标与激光角反射器；即便在 35 分钟的地影黑夜或自动交会失效时，航天员也能借助照明灯与 COAS 光学靶实现毫米级手控对接。',
            realData: '异体同构周边式对接机构 | 12 组捕获锁钩同步拉紧',
            codexId: 'docking-coas',
          },
        ];

        const result: GameResult = {
          levelIndex,
          won: true,
          stars,
          score,
          summary:
            stars === 3
              ? '教科书级微重力精准对接！速度、姿态与推进剂控制全部达到航天员金牌标准。'
              : stars === 2
              ? '成功完成刚性锁紧！继续降低触环速度或减少推进剂消耗即可斩获 3★。'
              : '安全完成交会对接！试试“短点喷+耐心滑行”减少碰擦并节省推进剂。',
          metrics: [
            { label: '捕获相对速度', value: `${capturedRelSpeedMs.toFixed(2)} m/s`, status: capturedRelSpeedMs <= 0.16 ? 'nominal' : 'info' },
            { label: '对准偏角 / 偏移', value: `${capturedAngDeg.toFixed(1)}° / ${Math.round(capturedOffsetPx)}px`, status: 'nominal' },
            { label: '剩余推进剂', value: `${Math.round(fuel)}%`, status: fuel >= cfg.fuelTarget3Star ? 'nominal' : 'caution' },
            { label: '对接环碰擦 / 耗时', value: `${collarBumps} 次 · ${elapsed.toFixed(1)}s`, status: collarBumps === 0 ? 'nominal' : 'caution' },
          ],
          scienceCard: scienceCards[levelIndex],
        };
        host.completeLevel(result);
      } else {
        const result: GameResult = {
          levelIndex,
          won: false,
          stars: 0,
          score: Math.max(0, Math.round(fuel * 2)),
          summary: `${abortReason}：${abortDetail}`,
          metrics: [
            { label: '中止原因', value: abortReason, status: 'critical' },
            { label: '剩余推进剂', value: `${Math.round(fuel)}%`, status: fuel <= 1 ? 'critical' : 'caution' },
            { label: '对接环完好度', value: `${Math.max(0, Math.round(collarIntegrity))}%`, status: collarIntegrity <= 0 ? 'critical' : 'caution' },
            { label: '飞行耗时', value: `${elapsed.toFixed(1)}s`, status: 'info' },
          ],
          scienceCard: {
            title: '为什么太空对接最忌“猛加油门”？',
            gameAction: abortDetail,
            realStationFact: '失重环境不等于无惯性：8 吨重的飞船即使只有 0.8 m/s 的相对速度，撞击动能也足以损伤对接捕获机构。真实手控对接中，航天员宁可多滑行 30 秒，也绝不超速冲撞。',
            realData: '安全软捕获窗：v ≤ 0.25 m/s | 提前反向点喷制动',
            codexId: cfg.codexId,
          },
        };
        host.completeLevel(result);
      }
    };

    // Keyboard listeners
    const mapKey = (e: KeyboardEvent): ControlKey | null => {
      const k = e.key.toLowerCase();
      if (k === 'w' || e.key === 'ArrowRight') return 'fwd';
      if (k === 's' || e.key === 'ArrowLeft') return 'retro';
      if (k === 'a' || e.key === 'ArrowUp') return 'port';
      if (k === 'd' || e.key === 'ArrowDown') return 'stbd';
      if (k === 'q') return 'ccw';
      if (k === 'e') return 'cw';
      if (e.code === 'Space' || e.key === ' ') return 'sas';
      return null;
    };

    const onKeyDown = (e: KeyboardEvent): void => {
      if (paused || host.isPaused() || phase !== 'playing') return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const ctrl = mapKey(e);
      if (!ctrl) return;
      e.preventDefault();
      if (!keyInput[ctrl]) {
        keyInput[ctrl] = true;
        syncDeckVisuals();
      }
    };

    const onKeyUp = (e: KeyboardEvent): void => {
      const ctrl = mapKey(e);
      if (!ctrl) return;
      if (keyInput[ctrl]) {
        keyInput[ctrl] = false;
        syncDeckVisuals();
      }
    };

    const onWindowBlur = (): void => clearInputs();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWindowBlur);

    // Physics update step
    const update = (dt: number): void => {
      const cfg = LEVELS[levelIndex];
      const layout = getLayout();

      particles.update(dt);
      if (shakeTime > 0) shakeTime = Math.max(0, shakeTime - dt);
      if (thrustSoundCooldown > 0) thrustSoundCooldown -= dt;

      if (phase === 'capturing') {
        animTimer += dt;
        simTime += dt * 0.25;
        const target = getTargetPose(simTime);
        const t = clamp(animTimer / 1.35, 0, 1);
        const ease = 1 - Math.pow(1 - t, 3);
        shipX = lerp(captureStartX, -NOSE_LEN + 2, ease);
        shipY = lerp(captureStartY, target.y, ease);
        theta = lerp(captureStartTheta, target.ang, ease);

        if (animTimer >= 1.38) {
          finishMission(true);
        }
        return;
      }

      if (phase === 'aborting') {
        animTimer += dt;
        shipX += vx * dt;
        shipY += vy * dt;
        theta += omega * dt;
        if (animTimer >= 0.85) {
          finishMission(false);
        }
        return;
      }

      if (phase !== 'playing') return;

      simTime += dt;
      elapsed += dt;

      const target = getTargetPose(simTime);

      // Apply RCS controls if fuel > 0
      const fwd = isControlActive('fwd');
      const retro = isControlActive('retro');
      const port = isControlActive('port');
      const stbd = isControlActive('stbd');
      const ccw = isControlActive('ccw');
      const cw = isControlActive('cw');
      const sas = isControlActive('sas');

      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      let anyThrust = false;
      let thrustPower = 0;

      if (fuel > 0) {
        if (fwd) {
          hasEverThrustedFwd = true;
          vx += cos * THRUST_FWD * dt;
          vy += sin * THRUST_FWD * dt;
          fuel = Math.max(0, fuel - FUEL_BURN_LIN * dt);
          anyThrust = true;
          thrustPower = Math.max(thrustPower, 0.85);
          spawnPlume(-44, -8, -1, 0, 0.95);
          spawnPlume(-44, 8, -1, 0, 0.95);
          // L3 subtle cross-coupling disturbance
          if (cfg.crossCoupling > 0) {
            omega += Math.sin(simTime * 2.1) * cfg.crossCoupling * dt;
          }
        }
        if (retro) {
          vx -= cos * THRUST_FWD * dt;
          vy -= sin * THRUST_FWD * dt;
          fuel = Math.max(0, fuel - FUEL_BURN_LIN * dt);
          anyThrust = true;
          thrustPower = Math.max(thrustPower, 0.8);
          spawnPlume(28, -12, 1, -0.15, 0.85);
          spawnPlume(28, 12, 1, 0.15, 0.85);
          if (cfg.crossCoupling > 0) {
            omega -= Math.cos(simTime * 1.9) * cfg.crossCoupling * 0.8 * dt;
          }
        }
        if (port) {
          // Translate upward relative to ship heading (left/port side)
          vx += sin * THRUST_LAT * dt;
          vy += -cos * THRUST_LAT * dt;
          fuel = Math.max(0, fuel - FUEL_BURN_LIN * 0.85 * dt);
          anyThrust = true;
          thrustPower = Math.max(thrustPower, 0.65);
          spawnPlume(18, 14, 0, 1, 0.72);
          spawnPlume(-24, 14, 0, 1, 0.72);
        }
        if (stbd) {
          // Translate downward relative to ship heading (right/starboard side)
          vx += -sin * THRUST_LAT * dt;
          vy += cos * THRUST_LAT * dt;
          fuel = Math.max(0, fuel - FUEL_BURN_LIN * 0.85 * dt);
          anyThrust = true;
          thrustPower = Math.max(thrustPower, 0.65);
          spawnPlume(18, -14, 0, -1, 0.72);
          spawnPlume(-24, -14, 0, -1, 0.72);
        }
        if (ccw) {
          omega -= THRUST_ROT * dt;
          fuel = Math.max(0, fuel - FUEL_BURN_ROT * dt);
          anyThrust = true;
          thrustPower = Math.max(thrustPower, 0.5);
          spawnPlume(26, 12, 0, 1, 0.65, '#7dd3fc');
          spawnPlume(-30, -12, 0, -1, 0.65, '#7dd3fc');
        }
        if (cw) {
          omega += THRUST_ROT * dt;
          fuel = Math.max(0, fuel - FUEL_BURN_ROT * dt);
          anyThrust = true;
          thrustPower = Math.max(thrustPower, 0.5);
          spawnPlume(26, -12, 0, -1, 0.65, '#7dd3fc');
          spawnPlume(-30, 12, 0, 1, 0.65, '#7dd3fc');
        }
        if (sas && !fwd && !retro && !port && !stbd && !ccw && !cw) {
          const speed = Math.hypot(vx, vy - target.vy);
          const angRate = Math.abs(omega);
          if (speed > 0.4 || angRate > 0.008) {
            let sasBurn = 0;
            if (speed > 0.4) {
              const dvx = -vx;
              const dvy = target.vy - vy;
              const step = Math.min(speed, SAS_DAMP_LIN * dt);
              vx += (dvx / speed) * step;
              vy += (dvy / speed) * step;
              sasBurn += FUEL_BURN_SAS * 0.7;
              // Emit tiny opposing puff
              if (Math.random() < 0.45) {
                spawnPlume(-10, 0, -dvx / speed, -dvy / speed, 0.45, '#fde68a');
              }
            }
            if (angRate > 0.008) {
              const step = Math.min(angRate, SAS_DAMP_ANG * dt);
              omega -= Math.sign(omega) * step;
              sasBurn += FUEL_BURN_SAS * 0.35;
            }
            fuel = Math.max(0, fuel - sasBurn * dt);
            anyThrust = true;
            thrustPower = Math.max(thrustPower, 0.35);

            if (!toastSasShown) {
              toastSasShown = true;
              host.hud.pushToast(
                'SAS 阻尼系统正在自动触发反向微脉冲抵消滑行速度与旋转，注意它会消耗额外燃料。',
                'info',
                'RCS 姿控阻尼'
              );
            }
          }
        }
      }

      if (anyThrust && thrustSoundCooldown <= 0) {
        host.audio.playThruster(thrustPower);
        thrustSoundCooldown = 0.095;
      }

      // Integrate pure frictionless microgravity rigid-body motion!
      omega = clamp(omega, -2.4, 2.4);
      shipX += vx * dt;
      shipY += vy * dt;
      theta += omega * dt;
      // Keep theta wrapped cleanly in (-PI, PI]
      theta = angleDiff(theta, 0);

      // Compute docking interface geometry
      const probeX = shipX + Math.cos(theta) * NOSE_LEN;
      const probeY = shipY + Math.sin(theta) * NOSE_LEN;
      const dx = probeX; // target collar x is 0
      const dy = probeY - target.y;
      const relVx = vx;
      const relVy = vy - target.vy;
      const relSpeed = Math.hypot(relVx, relVy);
      const relSpeedMs = relSpeed * PX_TO_MS;
      const angErrRad = angleDiff(theta, target.ang);
      const angErrDeg = Math.abs(angErrRad) * (180 / Math.PI);
      const distMeters = Math.max(0, Math.hypot(Math.min(0, dx), dy) * PX_TO_METERS);

      // Contextual debounced science toasts
      if (
        !toastInertiaShown &&
        hasEverThrustedFwd &&
        !fwd &&
        !retro &&
        vx > 22 &&
        probeX > -290 &&
        probeX < -100
      ) {
        toastInertiaShown = true;
        host.hud.pushToast(
          '你已松开推进键，飞船正按牛顿第一定律匀速滑行！请提前轻按 S 反向脉冲减速。',
          'info',
          '微重力惯性'
        );
      }

      if (!toastFinalZoneShown && probeX > -95 && probeX < -15 && relSpeed > MAX_CAPTURE_SPEED_PX + 4) {
        toastFinalZoneShown = true;
        host.hud.pushToast(
          `进入最后 3 米终近区！当前速度 ${relSpeedMs.toFixed(2)} m/s 偏高，请立即反推至 ≤ 0.25 m/s。`,
          'caution',
          'COAS 终近告警'
        );
      }

      if (!toastLowFuelShown && fuel <= 20 && fuel > 0) {
        toastLowFuelShown = true;
        host.hud.pushToast(
          'RCS 推进剂低于 20%！停止持续点火，利用微重力惯性滑行对准接口。',
          'caution',
          '推进剂预警'
        );
      }

      if (cfg.eclipse && !toastEclipseBeamShown && probeX > -240 && Math.abs(dy) < 55 && angErrDeg < 14) {
        toastEclipseBeamShown = true;
        host.hud.pushToast(
          '探照灯已照亮对接口角反射器！地影区依靠光学十字靶与导航信标完成精准贴靠。',
          'nominal',
          '光学靶标锁定'
        );
      }

      // Check docking collar capture or collision
      if (probeX >= -8 && probeX <= 18 && Math.abs(dy) <= 42) {
        const withinOffset = Math.abs(dy) <= MAX_CAPTURE_OFFSET_Y;
        const withinAngle = angErrDeg <= MAX_CAPTURE_ANGLE_DEG;
        const withinSpeed = relSpeed <= MAX_CAPTURE_SPEED_PX;

        if (withinOffset && withinAngle && withinSpeed) {
          // SUCCESSFUL SOFT CAPTURE!
          phase = 'capturing';
          animTimer = 0;
          captureStartX = shipX;
          captureStartY = shipY;
          captureStartTheta = theta;
          capturedRelSpeedMs = relSpeedMs;
          capturedOffsetPx = Math.abs(dy);
          capturedAngDeg = angErrDeg;
          vx = 0;
          vy = 0;
          omega = 0;
          host.audio.playLock();
          particles.burst(layout.portX, layout.centerY + target.y, 26, '#4ade80', 95, 3.2, 0.7);
          particles.spawn({
            x: layout.portX,
            y: layout.centerY + target.y,
            vx: 0,
            vy: 0,
            life: 0.65,
            size: 28,
            color: '#38bdf8',
            kind: 'ring',
          });
          host.hud.pushToast(
            '12组异体同构捕获锁钩刚性锁紧！对接通道检漏正常。',
            'nominal',
            '捕获锁紧'
          );
          return;
        }

        // High-speed destructive impact
        if (relSpeed > IMPACT_ABORT_SPEED_PX) {
          collarIntegrity = 0;
          phase = 'aborting';
          animTimer = 0;
          shakeTime = 0.45;
          shakeIntensity = 9;
          vx = -Math.max(24, Math.abs(vx) * 0.5);
          vy = (dy >= 0 ? 1 : -1) * 18;
          omega = (dy >= 0 ? 1 : -1) * 0.9;
          host.audio.playCritical();
          particles.burst(layout.portX, layout.centerY + probeY, 36, '#f97316', 140, 3.8, 0.85);
          abortReason = '超速撞击对接机构';
          abortDetail = `触环相对速度达到 ${relSpeedMs.toFixed(2)} m/s（安全上限 0.25 m/s），缓冲锁钩受损。下次请提前按 S 反向脉冲降速后再贴靠。`;
          return;
        }

        // Moderate bump: bounce off collar buffer & give constructive telemetry feedback
        collarBumps++;
        collarIntegrity = Math.max(0, collarIntegrity - 34);
        shipX = -NOSE_LEN - 9;
        vx = -Math.max(12, Math.abs(vx) * 0.55);
        vy = vy * 0.5 + (dy >= 0 ? 6 : -6);
        omega += (dy >= 0 ? 0.14 : -0.14);
        shakeTime = 0.24;
        shakeIntensity = 5;
        host.audio.playWarning();
        particles.burst(layout.portX, layout.centerY + probeY, 16, '#fbbf24', 85, 2.8, 0.48);

        if (collarIntegrity <= 0) {
          phase = 'aborting';
          animTimer = 0;
          abortReason = '对接环多次碰擦受损';
          abortDetail = '连续多次偏心/超速碰擦耗尽了缓冲结构余度。请先在距离 2m 处悬停调平，再轻推贴靠。';
          return;
        }

        if (simTime - lastBumpToastTime > 1.4) {
          lastBumpToastTime = simTime;
          if (!withinSpeed) {
            host.hud.pushToast(
              `触环速度 ${relSpeedMs.toFixed(2)} m/s 超标（需 ≤ 0.25 m/s），已触发弹性回弹，请提前反推！`,
              'caution',
              '缓冲碰擦'
            );
          } else if (!withinOffset) {
            host.hud.pushToast(
              `纵向偏移 ${Math.round(Math.abs(dy))}px 超出 ±14px 捕获窗，请用 A/D 精准对中！`,
              'caution',
              '偏差超限'
            );
          } else {
            host.hud.pushToast(
              `姿态偏角 ${angErrDeg.toFixed(1)}° 超出 ±7° 容差，请用 Q/E 归零后再贴靠！`,
              'caution',
              '姿态超限'
            );
          }
        }
      } else if (probeX >= 8 && Math.abs(dy) > 42 && Math.abs(dy) < 128) {
        // Collided with station main forward bulkhead outside docking ring
        if (relSpeed > 44) {
          collarIntegrity = 0;
          phase = 'aborting';
          animTimer = 0;
          shakeTime = 0.4;
          shakeIntensity = 8;
          vx = -22;
          omega = (dy > 0 ? 0.8 : -0.8);
          host.audio.playCritical();
          particles.burst(layout.portX + 12, layout.centerY + probeY, 30, '#ef4444', 120, 3.5, 0.75);
          abortReason = '舱体前壁碰撞';
          abortDetail = '飞船偏离对接走廊并高速擦碰核心舱前段壳体。请先沿中轴绿带对准后再推进。';
          return;
        } else {
          collarBumps++;
          collarIntegrity = Math.max(0, collarIntegrity - 25);
          shipX = -NOSE_LEN + 4;
          vx = -Math.max(10, Math.abs(vx) * 0.5);
          host.audio.playWarning();
          particles.burst(layout.portX + 8, layout.centerY + probeY, 12, '#f59e0b', 70, 2.4, 0.45);
          if (simTime - lastBumpToastTime > 1.5) {
            lastBumpToastTime = simTime;
            host.hud.pushToast('擦碰核心舱外壁！请先退回安全距离并对准绿色走廊。', 'critical', '防碰撞告警');
          }
          if (collarIntegrity <= 0) {
            phase = 'aborting';
            animTimer = 0;
            abortReason = '多次擦碰空间站舱壁';
            abortDetail = '多次碰撞触发交会应急撤离指令。建议先通过 A/D 将飞船移回中心对准线。';
            return;
          }
        }
      } else if (shipX >= -18 && Math.abs(shipY - target.y) < 92) {
        // Prevent reversed/tilted spacecraft body from clipping into station node sphere
        collarBumps++;
        collarIntegrity = Math.max(0, collarIntegrity - 25);
        shipX = -26;
        vx = -Math.max(12, Math.abs(vx) * 0.5);
        shakeTime = 0.22;
        shakeIntensity = 4;
        host.audio.playWarning();
        particles.burst(layout.portX - 10, layout.centerY + shipY, 12, '#f59e0b', 65, 2.4, 0.42);
        if (simTime - lastBumpToastTime > 1.5) {
          lastBumpToastTime = simTime;
          host.hud.pushToast('飞船姿态反偏碰撞节点舱！请用 Q/E 将对接探头朝向右侧接口。', 'caution', '姿态防撞');
        }
        if (collarIntegrity <= 0) {
          phase = 'aborting';
          animTimer = 0;
          abortReason = '船体姿态异常碰撞';
          abortDetail = '飞船未正对接口发生多次船体碰撞。请先用 Q/E 调正机头指向天和前向接口。';
          return;
        }
      }

      // Check drifting out of safe radar envelope
      const maxLeft = -(layout.portX + 85);
      const maxVert = Math.max(250, (layout.safeBottom - layout.safeTop) * 0.72);
      if (shipX < maxLeft || shipX > 120 || Math.abs(shipY) > maxVert) {
        phase = 'aborting';
        animTimer = 0;
        host.audio.playCritical();
        abortReason = '偏离终近交会走廊';
        abortDetail = '飞船已漂出激光雷达有效跟踪范围，自动撤离程序已接管。请用轻柔短脉冲保持在屏幕视野内。';
        return;
      }

      // Check stranded out-of-fuel state
      if (fuel <= 0.01) {
        const headingAway = vx < 1.5 || Math.abs(dy) > 36;
        if (headingAway) {
          zeroFuelDriftTimer += dt;
          if (zeroFuelDriftTimer >= 2.2) {
            phase = 'aborting';
            animTimer = 0;
            host.audio.playCritical();
            abortReason = 'RCS 推进剂耗尽';
            abortDetail = '推进剂归零且飞船无法靠惯性进入捕获窗。微重力下应以“极短脉冲 + 耐心滑行”大幅节省 Δv。';
            return;
          }
        } else {
          zeroFuelDriftTimer = 0;
        }
      }

      // Update event-driven HUD metrics
      const velStatus: MetricStatus =
        relSpeed <= MAX_CAPTURE_SPEED_PX
          ? 'nominal'
          : relSpeed <= 36
          ? 'caution'
          : 'critical';
      const alignOk = Math.abs(dy) <= MAX_CAPTURE_OFFSET_Y && angErrDeg <= MAX_CAPTURE_ANGLE_DEG;
      const alignStatus: MetricStatus = alignOk
        ? 'nominal'
        : Math.abs(dy) <= 32 && angErrDeg <= 14
        ? 'caution'
        : 'critical';
      const fuelStatus: MetricStatus =
        fuel > 35 ? 'nominal' : fuel > 15 ? 'caution' : 'critical';

      host.hud.updateMetric('dist', {
        value: `${distMeters.toFixed(1)} m`,
        status: distMeters < 3.0 ? 'nominal' : 'info',
      });
      host.hud.updateMetric('vel', {
        value: `${relSpeedMs.toFixed(2)} m/s`,
        status: velStatus,
      });
      host.hud.updateMetric('align', {
        value: `${angErrDeg.toFixed(1)}° / ${Math.round(Math.abs(dy))}px`,
        status: alignStatus,
      });
      host.hud.updateMetric('fuel', {
        value: `${Math.round(fuel)}%`,
        ratio: fuel / 100,
        status: fuelStatus,
      });
    };

    // ---------------- Canvas 2D Rendering ----------------

    const drawCorridorGuides = (
      ctx: CanvasRenderingContext2D,
      portX: number,
      portY: number,
      targetAng: number,
      inCorridor: boolean,
      eclipse: boolean
    ): void => {
      ctx.save();
      ctx.translate(portX, portY);
      ctx.rotate(targetAng);

      const corridorLen = Math.max(360, portX - 70);

      // Crisp flat capture channel fill
      const baseAlpha = eclipse ? 0.08 : 0.12;
      ctx.fillStyle = inCorridor
        ? `rgba(34, 197, 94, ${baseAlpha})`
        : `rgba(56, 189, 248, ${(baseAlpha * 0.7).toFixed(3)})`;
      ctx.fillRect(-corridorLen, -MAX_CAPTURE_OFFSET_Y, corridorLen, MAX_CAPTURE_OFFSET_Y * 2);

      // Upper & lower ±14px corridor rails
      ctx.strokeStyle = inCorridor ? 'rgba(74, 222, 128, 0.55)' : 'rgba(125, 211, 252, 0.34)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      ctx.moveTo(-corridorLen, -MAX_CAPTURE_OFFSET_Y);
      ctx.lineTo(0, -MAX_CAPTURE_OFFSET_Y);
      ctx.moveTo(-corridorLen, MAX_CAPTURE_OFFSET_Y);
      ctx.lineTo(0, MAX_CAPTURE_OFFSET_Y);
      ctx.stroke();

      // Center optical laser axis
      ctx.strokeStyle = inCorridor ? 'rgba(74, 222, 128, 0.42)' : 'rgba(56, 189, 248, 0.22)';
      ctx.setLineDash([3, 6]);
      ctx.beginPath();
      ctx.moveTo(-corridorLen, 0);
      ctx.lineTo(0, 0);
      ctx.stroke();
      ctx.setLineDash([]);

      // Distance range markers (every 5 meters = 125px)
      ctx.font = '600 10px "JetBrains Mono", monospace';
      ctx.fillStyle = eclipse ? 'rgba(148, 163, 184, 0.45)' : 'rgba(148, 185, 235, 0.55)';
      ctx.textAlign = 'center';
      for (let m = 2; m <= 14; m += 3) {
        const rx = -(m / PX_TO_METERS);
        if (rx < -corridorLen + 20) break;
        ctx.strokeStyle = 'rgba(148, 185, 235, 0.25)';
        ctx.beginPath();
        ctx.moveTo(rx, -MAX_CAPTURE_OFFSET_Y - 5);
        ctx.lineTo(rx, -MAX_CAPTURE_OFFSET_Y + 3);
        ctx.moveTo(rx, MAX_CAPTURE_OFFSET_Y - 3);
        ctx.lineTo(rx, MAX_CAPTURE_OFFSET_Y + 5);
        ctx.stroke();
        ctx.fillText(`${m}m`, rx, MAX_CAPTURE_OFFSET_Y + 16);
      }

      // Physics overlay: ±7° approach acceptance cone
      if (physicsOverlay) {
        const coneAng = (MAX_CAPTURE_ANGLE_DEG * Math.PI) / 180;
        const coneLen = 270;
        ctx.strokeStyle = 'rgba(250, 204, 21, 0.45)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-Math.cos(coneAng) * coneLen, -Math.sin(coneAng) * coneLen);
        ctx.moveTo(0, 0);
        ctx.lineTo(-Math.cos(coneAng) * coneLen, Math.sin(coneAng) * coneLen);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(253, 224, 71, 0.75)';
        ctx.fillText('±7° 捕获锥', -coneLen + 10, -Math.sin(coneAng) * coneLen - 6);
      }

      ctx.restore();
    };

    const drawStationModule = (
      ctx: CanvasRenderingContext2D,
      portX: number,
      portY: number,
      targetAng: number,
      readyToLock: boolean,
      captureProgress: number,
      eclipse: boolean
    ): void => {
      ctx.save();
      ctx.translate(portX, portY);
      ctx.rotate(targetAng);

      const lit = eclipse ? 0.34 : 0.94;

      // Station dorsal & ventral solar wing roots on right
      drawSolarPanelRect(ctx, 185, -168, 43, 122, lit);
      drawSolarPanelRect(ctx, 185, 46, 43, 122, lit);

      const usedStationSprite = drawModelSprite(ctx, 'tianhe-dock-side', -4, -44, 290, 88, {
        brightness: eclipse ? 0.45 : 1.0,
      });

      if (!usedStationSprite) {
        // Fallback procedural hull while sprite finishes preloading
        drawTitaniumModule(ctx, 134, -56, 10, 112, {
          vertical: true,
          radius: 3,
          rivets: false,
          rimGlow: eclipse ? 'rgba(100, 140, 190, 0.4)' : 'rgba(226, 240, 255, 0.72)',
        });
        drawTitaniumModule(ctx, 62, -52, 170, 104, {
          radius: 14,
          mliBands: [0.17, 0.74],
          rivets: true,
          rimGlow: eclipse ? 'rgba(100, 145, 200, 0.45)' : 'rgba(241, 248, 255, 0.85)',
        });
        for (const wx of [136, 176]) {
          ctx.fillStyle = eclipse ? '#38bdf8' : 'rgba(56, 189, 248, 0.55)';
          ctx.beginPath();
          ctx.arc(wx, -16, 6.5, 0, Math.PI * 2);
          ctx.fill();
        }
        drawTitaniumModule(ctx, 2, -26, 20, 52, { radius: 3, rivets: false });
      }

      // Androgynous Peripheral Docking Collar Ring at x = 0
      const collarColor =
        captureProgress > 0
          ? '#22c55e'
          : readyToLock
          ? '#4ade80'
          : '#38bdf8';

      drawTitaniumModule(ctx, -6, -34, 11, 68, {
        radius: 3,
        rivets: false,
        rimGlow: collarColor,
      });
      if (eclipse) {
        ctx.fillStyle = 'rgba(6, 14, 32, 0.45)';
        ctx.beginPath();
        ctx.roundRect(-6, -34, 11, 68, 3);
        ctx.fill();
      }
      ctx.strokeStyle = collarColor;
      ctx.lineWidth = readyToLock || captureProgress > 0 ? 2.4 : 1.6;
      ctx.beginPath();
      ctx.roundRect(-6, -34, 11, 68, 3);
      ctx.stroke();

      // 12 Capture Latches arranged along the peripheral collar face
      const latchClamp = captureProgress * 4.5;
      for (let i = 0; i < 12; i++) {
        const u = (i / 11) * 2 - 1; // -1..+1
        const ly = u * 29;
        const clampedX = -7 + latchClamp;
        const latchCol =
          captureProgress > 0.35
            ? '#4ade80'
            : readyToLock
            ? '#7dd3fc'
            : '#f59e0b';
        ctx.fillStyle = latchCol;
        ctx.fillRect(clampedX, ly - 1.6, 5, 3.2);
      }

      // Guide petals angled outward with metallic rim
      ctx.strokeStyle = eclipse ? '#7d93b0' : '#e2ecf8';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(-4, -30);
      ctx.lineTo(-13, -38);
      ctx.moveTo(-4, 30);
      ctx.lineTo(-13, 38);
      ctx.stroke();

      // Optical retro-reflector COAS target cross on collar center
      ctx.strokeStyle = readyToLock ? '#4ade80' : '#fbbf24';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-1, -10);
      ctx.lineTo(-1, 10);
      ctx.moveTo(-8, 0);
      ctx.lineTo(4, 0);
      ctx.stroke();

      // Blinking aerospace navigation strobes (red port / green starboard)
      const blink = Math.sin(simTime * 5.2) > 0.15;
      const drawStrobe = (sx: number, sy: number, col: string) => {
        ctx.fillStyle = blink ? '#ffffff' : col;
        ctx.beginPath();
        ctx.arc(sx, sy, blink ? 3.2 : 2, 0, Math.PI * 2);
        ctx.fill();
      };
      drawStrobe(66, -54, '#ef4444');
      drawStrobe(66, 54, '#22c55e');

      // Notice: keep unused import silent when sprite active
      void isModelSpriteLoaded;
      // Label
      ctx.font = '700 10.5px "JetBrains Mono", monospace';
      ctx.fillStyle = eclipse ? 'rgba(186, 210, 238, 0.72)' : 'rgba(226, 240, 255, 0.88)';
      ctx.textAlign = 'left';
      ctx.fillText('TIANHE-01', 124, 56);

      ctx.restore();
    };

    const drawShenzhouCraft = (
      ctx: CanvasRenderingContext2D,
      sx: number,
      sy: number,
      ang: number,
      eclipse: boolean
    ): void => {
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(ang);

      const lit = eclipse ? 0.35 : 0.96;
      const mli = getMLIPattern(ctx);

      // Studio-rendered 3D Shenzhou Crew Spacecraft aligned so nose probe tip sits at x = +NOSE_LEN (+46)
      const usedShenzhouSprite = drawModelSprite(ctx, 'shenzhou-side', -58, -42, 104, 84, {
        brightness: eclipse ? 0.5 : 1.0,
      });

      if (!usedShenzhouSprite) {
        drawSolarPanelRect(ctx, -36, -68, 20, 48, lit);
        drawSolarPanelRect(ctx, -36, 20, 20, 48, lit);
        ctx.fillStyle = '#9fb6d1';
        ctx.fillRect(-28, -22, 4, 44);
        drawTitaniumModule(ctx, -44, -16, 28, 32, { radius: 4, rivets: false });
        drawTitaniumModule(ctx, 6, -13, 24, 26, { radius: 7, mliBands: [0.06], rivets: false });
        if (mli) {
          ctx.fillStyle = mli;
          ctx.fillRect(-43, -15, 9, 30);
        }
      }

      // Probe head optical capture beacon at x = +NOSE_LEN (+46)
      ctx.fillStyle = '#e0f2fe';
      ctx.beginPath();
      ctx.arc(NOSE_LEN, 0, 2.8, 0, Math.PI * 2);
      ctx.fill();

      // Lightweight RCS Cold-Gas Plumes (flat translucent cone + inner jet line, no gradients/lighter)
      const drawFlame = (nx: number, ny: number, dx: number, dy: number, len: number, rgb: string) => {
        const mag = Math.hypot(dx, dy) || 1;
        const ux = dx / mag;
        const uy = dy / mag;
        const px = -uy;
        const py = ux;
        const ex = nx + ux * len;
        const ey = ny + uy * len;
        const spread = Math.max(3.2, len * 0.25);

        ctx.fillStyle = `rgba(${rgb}, 0.42)`;
        ctx.beginPath();
        ctx.moveTo(nx + px * 1.4, ny + py * 1.4);
        ctx.lineTo(ex + px * spread, ey + py * spread);
        ctx.lineTo(ex - px * spread, ey - py * spread);
        ctx.lineTo(nx - px * 1.4, ny - py * 1.4);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(nx, ny);
        ctx.lineTo(nx + ux * len * 0.55, ny + uy * len * 0.55);
        ctx.stroke();
      };

      if (fuel > 0 && phase === 'playing') {
        const flicker = 0.82 + Math.random() * 0.42;
        if (isControlActive('fwd')) {
          drawFlame(-54, -7, -1, 0, 22 * flicker, '56, 189, 248');
          drawFlame(-54, 7, -1, 0, 22 * flicker, '56, 189, 248');
        }
        if (isControlActive('retro')) {
          drawFlame(27, -12, 1, -0.2, 17 * flicker, '125, 211, 252');
          drawFlame(27, 12, 1, 0.2, 17 * flicker, '125, 211, 252');
        }
        if (isControlActive('port')) {
          drawFlame(18, 12, 0, 1, 15 * flicker, '125, 211, 252');
          drawFlame(-34, 13, 0, 1, 15 * flicker, '125, 211, 252');
        }
        if (isControlActive('stbd')) {
          drawFlame(18, -12, 0, -1, 15 * flicker, '125, 211, 252');
          drawFlame(-34, -13, 0, -1, 15 * flicker, '125, 211, 252');
        }
        if (isControlActive('ccw')) {
          drawFlame(24, 12, 0, 1, 14 * flicker, '186, 230, 253');
          drawFlame(-38, -13, 0, -1, 14 * flicker, '186, 230, 253');
        }
        if (isControlActive('cw')) {
          drawFlame(24, -12, 0, -1, 14 * flicker, '186, 230, 253');
          drawFlame(-38, 13, 0, 1, 14 * flicker, '186, 230, 253');
        }
        if (
          isControlActive('sas') &&
          !isControlActive('fwd') &&
          !isControlActive('retro') &&
          !isControlActive('port') &&
          !isControlActive('stbd') &&
          !isControlActive('ccw') &&
          !isControlActive('cw') &&
          (Math.hypot(vx, vy) > 1.2 || Math.abs(omega) > 0.015)
        ) {
          ctx.strokeStyle = 'rgba(253, 224, 71, 0.48)';
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(-10, 0, 14, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      ctx.restore();
    };

    const drawEclipseHeadlamp = (
      ctx: CanvasRenderingContext2D,
      sx: number,
      sy: number,
      ang: number,
      portX: number,
      portY: number
    ): void => {
      // Moody dark orbital umbra veil
      ctx.save();
      ctx.fillStyle = 'rgba(2, 6, 16, 0.62)';
      ctx.fillRect(0, 0, width, height);

      // Flat translucent spotlight cone illuminating station collar (no gradient / no lighter)
      const lampX = sx + Math.cos(ang) * 32;
      const lampY = sy + Math.sin(ang) * 32;
      const beamLen = Math.max(420, Math.hypot(portX - lampX, portY - lampY) + 120);
      const spread = 0.24;

      ctx.fillStyle = 'rgba(186, 230, 253, 0.13)';
      ctx.beginPath();
      ctx.moveTo(lampX, lampY);
      ctx.arc(lampX, lampY, beamLen, ang - spread, ang + spread);
      ctx.closePath();
      ctx.fill();

      // Glint ring on station retro-reflector when inside spotlight cone
      const toPortAng = Math.atan2(portY - lampY, portX - lampX);
      const beamDiff = Math.abs(angleDiff(toPortAng, ang));
      if (beamDiff < spread * 0.92 && portX > lampX - 20) {
        ctx.strokeStyle = 'rgba(186, 230, 253, 0.65)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(portX - 2, portY, 16, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    };

    const drawCOASReticle = (
      ctx: CanvasRenderingContext2D,
      dy: number,
      angErrDeg: number,
      angErrSignedDeg: number,
      relSpeedMs: number,
      readyToLock: boolean
    ): void => {
      // Positioned cleanly in top-center gap between Top-Left and Top-Right HUD panels
      const r = width >= 1200 ? 40 : 31;
      const cx = width * 0.5;
      const cy = width >= 1200 ? 58 : 54;

      ctx.save();
      ctx.translate(cx, cy);

      // Backing glass instrument housing
      ctx.fillStyle = 'rgba(7, 16, 32, 0.88)';
      ctx.beginPath();
      ctx.arc(0, 0, r + 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = readyToLock ? '#22c55e' : 'rgba(56, 189, 248, 0.55)';
      ctx.lineWidth = readyToLock ? 2.2 : 1.5;
      ctx.stroke();

      // Inner green capture window ring
      const safeR = r * 0.36;
      ctx.fillStyle = readyToLock ? 'rgba(34, 197, 94, 0.22)' : 'rgba(34, 197, 94, 0.08)';
      ctx.beginPath();
      ctx.arc(0, 0, safeR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(74, 222, 128, 0.7)';
      ctx.lineWidth = 1.1;
      ctx.stroke();

      // Caution dashed ring
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.35)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.72, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // Fixed optical crosshairs
      ctx.strokeStyle = 'rgba(125, 211, 252, 0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-r + 4, 0);
      ctx.lineTo(r - 4, 0);
      ctx.moveTo(0, -r + 4);
      ctx.lineTo(0, r - 4);
      ctx.stroke();

      // Live alignment pip: X axis = angle error, Y axis = lateral offset dy
      const px = clamp((angErrSignedDeg / 20) * (r - 6), -(r - 6), r - 6);
      const py = clamp((dy / 40) * (r - 6), -(r - 6), r - 6);

      // Draw error vector line from center to pip
      ctx.strokeStyle = readyToLock ? '#4ade80' : '#f59e0b';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(px, py);
      ctx.stroke();

      // Moving alignment diamond pip
      ctx.fillStyle = readyToLock ? '#4ade80' : angErrDeg <= 7 && Math.abs(dy) <= 14 ? '#38bdf8' : '#fbbf24';
      ctx.beginPath();
      ctx.moveTo(px, py - 5);
      ctx.lineTo(px + 5, py);
      ctx.lineTo(px, py + 5);
      ctx.lineTo(px - 5, py);
      ctx.closePath();
      ctx.fill();

      // Compact title pill & readiness badge
      ctx.font = '700 10px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = readyToLock ? '#4ade80' : '#7dd3fc';
      ctx.fillText(
        readyToLock ? 'COAS · LOCK READY ✓' : `COAS 瞄准靶 · ${relSpeedMs.toFixed(2)}m/s`,
        0,
        r + 18
      );

      ctx.restore();
    };

    const drawPhysicsVectors = (
      ctx: CanvasRenderingContext2D,
      sx: number,
      sy: number,
      relVx: number,
      relVy: number,
      relSpeedMs: number
    ): void => {
      const speed = Math.hypot(relVx, relVy);
      const scale = 1.85;

      // Velocity vector v (cyan)
      if (speed > 2) {
        const vxEnd = sx + clamp(relVx * scale, -110, 110);
        const vyEnd = sy + clamp(relVy * scale, -110, 110);
        drawVectorArrow(ctx, sx, sy, vxEnd, vyEnd, '#38bdf8', `v = ${relSpeedMs.toFixed(2)} m/s`, 2.2);

        // Required braking counter-thrust vector -v (emerald)
        const bxEnd = sx - clamp(relVx * scale * 0.72, -80, 80);
        const byEnd = sy - clamp(relVy * scale * 0.72, -80, 80);
        drawVectorArrow(ctx, sx, sy, bxEnd, byEnd, '#4ade80', '制动 -v', 1.8);
      }

      // Angular velocity arc ω around spacecraft
      if (Math.abs(omega) > 0.03) {
        const arcR = 54;
        const span = clamp(omega * 1.1, -1.1, 1.1);
        ctx.save();
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sx, sy, arcR, theta, theta + span, span < 0);
        ctx.stroke();
        const endAng = theta + span;
        const ax = sx + Math.cos(endAng) * arcR;
        const ay = sy + Math.sin(endAng) * arcR;
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.arc(ax, ay, 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = '600 10.5px "JetBrains Mono", monospace';
        ctx.fillText(`ω=${(omega * 57.3).toFixed(1)}°/s`, ax + 7, ay + 3);
        ctx.restore();
      }
    };

    const render = (): void => {
      const ctx = handle.ctx;
      const cfg = LEVELS[levelIndex];
      const layout = getLayout();
      const target = getTargetPose(simTime);

      ctx.save();
      if (shakeTime > 0) {
        const mag = shakeIntensity * (shakeTime / 0.45);
        ctx.translate((Math.random() - 0.5) * mag * 2, (Math.random() - 0.5) * mag * 2);
      }

      // 1. Baked Opaque LEO Backdrop (1 integer drawImage when cached; fallback to starfield + horizon)
      if (
        !drawBakedBackdrop(
          ctx,
          levelIndex === 2 ? 'earth-night' : 'leo-earth',
          width,
          height,
          levelIndex === 2 ? 0.34 : 0.2,
          0.32
        )
      ) {
        stars.draw(ctx, width, height, simTime, -simTime * 3.5, 0);
        drawEarthHorizon(ctx, width, height, elapsed, {
          yRatio: 1.78,
          radiusScale: 1.16,
          sunPhase: cfg.eclipse ? 2.55 : 0.32,
          nightMode: levelIndex === 2,
          darken: levelIndex === 2 ? 0.34 : 0.2,
        });
      }

      const portX = layout.portX;
      const portY = layout.centerY + target.y;
      const sx = layout.portX + shipX;
      const sy = layout.centerY + shipY;

      // Compute live docking telemetry for visuals
      const probeX = shipX + Math.cos(theta) * NOSE_LEN;
      const probeY = shipY + Math.sin(theta) * NOSE_LEN;
      const dy = probeY - target.y;
      const relVx = vx;
      const relVy = vy - target.vy;
      const relSpeed = Math.hypot(relVx, relVy);
      const relSpeedMs = relSpeed * PX_TO_MS;
      const angErrSignedRad = angleDiff(theta, target.ang);
      const angErrSignedDeg = angErrSignedRad * (180 / Math.PI);
      const angErrDeg = Math.abs(angErrSignedDeg);

      const inCorridor = Math.abs(dy) <= MAX_CAPTURE_OFFSET_Y && angErrDeg <= MAX_CAPTURE_ANGLE_DEG;
      const readyToLock = inCorridor && relSpeed <= MAX_CAPTURE_SPEED_PX;
      const captureProgress = phase === 'capturing' ? clamp(animTimer / 1.35, 0, 1) : 0;

      // 2. Corridor guide rails
      drawCorridorGuides(ctx, portX, portY, target.ang, inCorridor, cfg.eclipse);

      // 3. Space station docking module
      drawStationModule(ctx, portX, portY, target.ang, readyToLock, captureProgress, cfg.eclipse);

      // 4. Cold-gas thruster & spark particles
      particles.draw(ctx);

      // 5. Shenzhou spacecraft
      drawShenzhouCraft(ctx, sx, sy, theta, cfg.eclipse);

      // 6. Level 3 Eclipse atmospheric darkness + volumetric docking headlamp beam
      if (cfg.eclipse) {
        drawEclipseHeadlamp(ctx, sx, sy, theta, portX, portY);
      }

      // 7. Physics Vector Overlay (V) + optical laser rangefinder beam
      if (physicsOverlay && phase === 'playing') {
        const probeScreenX = layout.portX + probeX;
        const probeScreenY = layout.centerY + probeY;
        ctx.save();
        ctx.strokeStyle = readyToLock ? 'rgba(74, 222, 128, 0.58)' : 'rgba(56, 189, 248, 0.35)';
        ctx.lineWidth = 1.1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(probeScreenX, probeScreenY);
        ctx.lineTo(portX, portY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
        drawPhysicsVectors(ctx, sx, sy, relVx, relVy, relSpeedMs);
      }

      // 8. Soft-capture rigid latch banner on Canvas during animation
      if (phase === 'capturing') {
        ctx.save();
        ctx.font = '800 16px "JetBrains Mono", "Noto Sans SC", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#4ade80';
        ctx.fillText('✓ 捕获锁钩正在刚性拉紧 · HARD DOCK LOCKING...', width * 0.5, layout.safeTop + 26);
        ctx.restore();
      }

      // 9. Live Inset COAS Optical Alignment Reticle (always crisp above eclipse layer)
      drawCOASReticle(ctx, dy, angErrDeg, angErrSignedDeg, relSpeedMs, readyToLock);

      ctx.restore();
    };

    // Initialize deck & level
    buildTactileDeck();
    resetLevel(levelIndex);

    // Main rAF loop
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
        if (p) clearInputs();
      },
      setPhysicsOverlay(enabled: boolean) {
        physicsOverlay = enabled;
      },
    };
  },
};
