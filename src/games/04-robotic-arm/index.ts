import {
  ParticleSystem,
  StarfieldRenderer,
  angleDiff,
  clamp,
  dist,
  drawEarthHorizon,
  drawSolarPanelRect,
  drawVectorArrow,
  lerp,
  setupHiDPICanvas,
} from '../../core/canvas-utils';
import {
  drawAdditiveGlow,
  drawGlassViewport,
  drawSunLensFlare,
  drawTitaniumModule,
  getMLIPattern,
  getTitaniumPattern,
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

// ============================================================================
// Virtual World Dimensions & Arm Mechanical Parameters
// Safe Play Area: y in [120, h - 135]
// ============================================================================
const WORLD_W = 960;
const WORLD_H = 380;
const HULL_TOP_Y = 114;

const L1 = 168; // Upper boom length (virtual px; L1 + L2 = 336 ≈ 10.2 m)
const L2 = 168; // Lower boom length
const R_MAX = L1 + L2 - 2; // 334
const R_MIN = 44;
const PX_PER_METER = (L1 + L2) / 10.2;

interface AdapterNode {
  id: string;
  label: string;
  x: number;
  y: number;
}

interface ObstacleSpec {
  id: string;
  label: string;
  kind: 'dish' | 'radiator' | 'mast';
  x: number;
  baseY: number;
  topY: number;
  radius: number;
}

interface ArmLevelConfig {
  adapters: AdapterNode[];
  initialBaseId: string;
  initialTarget: { x: number; y: number };
  payloadStart: { x: number; y: number };
  targetSlot: { x: number; y: number; label: string };
  obstacles: ObstacleSpec[];
  requireInchworm: boolean;
}

const ARM_LEVELS: ArmLevelConfig[] = [
  // L1: Precision Payload Transfer
  {
    adapters: [
      { id: 'A1', label: '适配器 A1', x: -255, y: HULL_TOP_Y },
      { id: 'A2', label: '核心基座 A2', x: 0, y: HULL_TOP_Y },
      { id: 'A3', label: '适配器 A3', x: 255, y: HULL_TOP_Y },
    ],
    initialBaseId: 'A2',
    initialTarget: { x: -115, y: -30 },
    payloadStart: { x: -222, y: 78 },
    targetSlot: { x: 222, y: 78, label: '暴露实验槽位 B' },
    obstacles: [],
    requireInchworm: false,
  },
  // L2: Obstacle Corridor Transfer
  {
    adapters: [
      { id: 'A1', label: '适配器 A1', x: -265, y: HULL_TOP_Y },
      { id: 'A2', label: '核心基座 A2', x: 0, y: HULL_TOP_Y },
      { id: 'A3', label: '适配器 A3', x: 265, y: HULL_TOP_Y },
    ],
    initialBaseId: 'A2',
    initialTarget: { x: -135, y: -48 },
    payloadStart: { x: -242, y: 78 },
    targetSlot: { x: 242, y: 78, label: '实验载荷工位 B' },
    obstacles: [
      {
        id: 'dish',
        label: 'S波段中继天线',
        kind: 'dish',
        x: -114,
        baseY: HULL_TOP_Y,
        topY: 50,
        radius: 21,
      },
      {
        id: 'radiator',
        label: '热控辐射散热翼',
        kind: 'radiator',
        x: 114,
        baseY: HULL_TOP_Y,
        topY: 44,
        radius: 20,
      },
    ],
    requireInchworm: false,
  },
  // L3: Inchworm Crawling across Station Modules
  {
    adapters: [
      { id: 'A1', label: '后端基座 A1', x: -330, y: HULL_TOP_Y },
      { id: 'A2', label: '中转适配器 A2', x: -45, y: HULL_TOP_Y },
      { id: 'A3', label: '前端适配器 A3', x: 240, y: HULL_TOP_Y },
    ],
    initialBaseId: 'A1',
    initialTarget: { x: -175, y: -26 },
    payloadStart: { x: 64, y: 78 },
    targetSlot: { x: 274, y: 76, label: '远端实验舱接口 B' },
    obstacles: [
      {
        id: 'mast',
        label: '星敏感器支架',
        kind: 'mast',
        x: 174,
        baseY: HULL_TOP_Y,
        topY: 58,
        radius: 17,
      },
    ],
    requireInchworm: true,
  },
];

function buildScienceCard(
  levelIndex: number,
  stats: { peakStress: number; crawlCount: number; collisions: number }
): ScienceComparison {
  if (levelIndex === 0) {
    return {
      title: '七自由度空间机械臂逆运动学',
      gameAction: `你通过目标靶标驱动逆运动学解算，平滑完成了暴露实验载荷转位，峰值关节应力仅 ${Math.round(stats.peakStress)}%。`,
      realStationFact:
        '天和核心舱大机械臂展开全长 10.2 米，拥有肩、肘、腕共 7 个自由度回转关节，最大承载能力达 25 吨。飞控计算机实时解算逆运动学，将末端执行器精准引导至毫米级目标位姿。',
      realData: '真实天宫参数：核心舱大机械臂长 10.2 m ｜ 7 自由度 ｜ 最大承载 25 吨',
      codexId: 'arm-kinematics',
    };
  }
  if (levelIndex === 1) {
    return {
      title: '微重力大质量载荷柔性振动抑制',
      gameAction: `你在双障碍走廊中以 ${stats.collisions} 次碰擦、峰值应力 ${Math.round(stats.peakStress)}% 成功抑制惯性振摆并精准就位。`,
      realStationFact:
        '太空中失重不代表无惯性！数十吨级的实验舱或载荷一旦急加速或急停，巨大的惯性会激发轻质碳纤维机械臂的低频柔性晃动，因此真实在轨转位速度严格控制在 0.15 m/s 以内并辅以主动柔顺控制。',
      realData: '真实天宫参数：重载平移限速 ≤ 0.15 m/s ｜ 关节力矩实时闭环限幅',
      codexId: 'arm-flex-inertia',
    };
  }
  return {
    title: '“尺蠖式”首尾交替爬行转位',
    gameAction: `你执行了 ${stats.crawlCount} 次首尾基座切换，让空间机械臂像尺蠖一样跨舱爬行，突破单臂展限制完成远端安装！`,
    realStationFact:
      '中国空间站机械臂两端装有完全对称的末端执行器，既可抓取载荷也可锚定舱壁的目标适配器（PDGF）。通过释放旧底座、锁定新适配器并切换电气与控制主从关系，它能够像尺蠖一样爬遍天宫三舱外表面。',
    realData: '真实天宫参数：双端对称三瓣捕获机构 ｜ 舱壁多点目标适配器（PDGF）供电供数',
    codexId: 'arm-inchworm',
  };
}

function pointToSegmentDist(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) return dist(px, py, x1, y1);
  const t = clamp(((px - x1) * dx + (py - y1) * dy) / lenSq, 0, 1);
  return dist(px, py, x1 + t * dx, y1 + t * dy);
}

export const roboticArmMeta: GameMeta = {
  id: 'robotic-arm',
  number: '04',
  shortTitle: '空间机械臂',
  title: '空间机械臂载荷转位',
  enTitle: 'ROBOTIC ARM TRANSFER',
  moduleName: '舱外大机械臂',
  genre: '逆运动学精准操控',
  tagline: '控制多关节空间臂平滑抑制惯性振摆，实现“尺蠖”跨舱爬行',
  accent: '#a78bfa',
  hubAnchor: { x: 0.65, y: 0.30 },
  briefingSteps: [
    {
      title: '逆运动学末端牵引',
      desc: '用鼠标拖动发光目标十字（或使用 WASD/方向键）牵引机械臂末端移动；按 Q 可切换肘部拱起姿态，灵活绕开舱外天线与散热翼。',
    },
    {
      title: '平滑抑振控制应力',
      desc: '微重力下重型实验载荷仍具有显著惯性！急拉猛甩会引发机械臂弹性弯曲与关节应力飙升（绿→琥珀→红），匀速缓慢牵引即可保持低应力拿满 3★。',
    },
    {
      title: '载荷捕获与尺蠖爬行',
      desc: '靠近金色实验载荷按 Space 抓取/对接；第 3 关需先将空载末端对准中转适配器 A2 按 E（或 Shift）切换锚定基座，跨舱触达远端工位！',
    },
  ],
  controlsHint:
    '鼠标拖拽目标十字 / WASD 移控末端 ｜ Space 抓取/释放载荷 ｜ E/Shift 尺蠖切换基座 ｜ Q 切换肘部姿态',
  levels: [
    {
      index: 0,
      name: '暴露载荷精准转位',
      subtitle: '逆运动学牵引与微重力柔性抑振入门',
      objective: '抓取工位 A 的科学实验载荷箱，低速平稳转位对接至目标槽位 B',
    },
    {
      index: 1,
      name: '绕障精细搬运',
      subtitle: 'S 波段天线与热控辐射翼安全走廊作业',
      objective: '平滑绕过中继天线与辐射散热翼，避免碰撞并低应力送达槽位 B',
    },
    {
      index: 2,
      name: '尺蠖式跨舱爬行',
      subtitle: '双端对称机构交替锚定实现跨舱作业',
      objective: '先将自由端对准中转适配器 A2 按 E 切换基座，再跨舱抓取载荷送入接口 B',
    },
  ],
  codexIds: ['arm-kinematics', 'arm-inchworm', 'arm-flex-inertia'],
};

export const roboticArmGame: GameModule = {
  meta: roboticArmMeta,

  mount(canvasHost: HTMLElement, host: GameHostAPI): GameInstance {
    let viewW = 1280;
    let viewH = 720;
    let scale = 1;
    let originX = 640;
    let originY = 360;

    const recomputeViewport = (w: number, h: number) => {
      viewW = w;
      viewH = h;
      const safeTop = 122;
      const safeBottom = Math.max(safeTop + 180, h - 138);
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

    const starfield = new StarfieldRenderer(160, 404);
    const particles = new ParticleSystem();

    const screenToWorld = (sx: number, sy: number) => ({
      x: (sx - originX) / scale,
      y: (sy - originY) / scale,
    });

    // ---- Simulation State ----
    let levelIndex = host.getLevel();
    let cfg: ArmLevelConfig = ARM_LEVELS[levelIndex] ?? ARM_LEVELS[0];
    let paused = host.isPaused();
    let physicsOverlay = host.hud.isPhysicsOverlayEnabled();
    let finished = false;
    let destroyed = false;

    let simTime = 0;
    let levelTime = 0;

    // Active base & IK state
    let activeBaseId = 'A2';
    let elbowSign: 1 | -1 = -1;
    let theta1 = -Math.PI * 0.65;
    let theta2 = -1.2;
    let omega1 = 0;
    let omega2 = 0;

    // Target reticle (clamped to playfield)
    let targetX = -115;
    let targetY = -30;
    let prevTargetX = -115;
    let prevTargetY = -30;

    // Kinematics derived positions
    let elbowX = 0;
    let elbowY = 0;
    let tipX = 0;
    let tipY = 0;
    let prevTipX = 0;
    let prevTipY = 0;
    let tipVx = 0;
    let tipVy = 0;
    let prevTipVx = 0;
    let prevTipVy = 0;
    let tipAx = 0;
    let tipAy = 0;

    // Flexible boom harmonic oscillation state
    let flexX = 0;
    let flexY = 0;
    let flexVx = 0;
    let flexVy = 0;
    let stress = 0; // 0..100
    let peakStress = 0;
    let collisions = 0;
    let hitCooldown = 0;
    let crawlCount = 0;

    // Payload state
    let carrying = false;
    let payloadX = -220;
    let payloadY = 78;
    let payloadVx = 0;
    let payloadVy = 0;
    let payloadDocked = false;

    // Audio throttles
    let warnTimer = 0;
    let motorHumTimer = 0;

    // Input state
    const keys = new Set<string>();
    let dragging = false;

    const toastCooldowns = new Map<string, number>();
    const pushDebouncedToast = (
      key: string,
      text: string,
      tone: MetricStatus = 'info',
      tag = '机械臂遥测',
      cooldownSec = 6
    ) => {
      const prev = toastCooldowns.get(key) ?? -999;
      if (simTime - prev < cooldownSec) return;
      toastCooldowns.set(key, simTime);
      host.hud.pushToast(text, tone, tag);
    };

    // ---- Tactile Deck Buttons ----
    let btnGrab!: HTMLButtonElement;
    let btnCrawl!: HTMLButtonElement;
    let btnElbow!: HTMLButtonElement;

    const getActiveBase = (): AdapterNode =>
      cfg.adapters.find((a) => a.id === activeBaseId) ?? cfg.adapters[0];

    const findLockableAdapter = (): AdapterNode | null => {
      if (carrying) return null;
      let best: AdapterNode | null = null;
      let bestD = 40;
      for (const a of cfg.adapters) {
        if (a.id === activeBaseId) continue;
        const d = dist(tipX, tipY, a.x, a.y);
        if (d < bestD) {
          bestD = d;
          best = a;
        }
      }
      return best;
    };

    const syncDeckButtons = () => {
      if (!btnGrab) return;

      const dPayload = dist(tipX, tipY, payloadX, payloadY - 12);
      const dSlot = dist(payloadX, payloadY, cfg.targetSlot.x, cfg.targetSlot.y);

      if (carrying) {
        btnGrab.classList.toggle('is-gold', dSlot < 38);
        btnGrab.classList.toggle('is-active', true);
        btnGrab.textContent = dSlot < 38 ? '✓ 对接锁紧槽位 B (Space)' : '◈ 释放载荷 (Space)';
      } else {
        btnGrab.classList.toggle('is-gold', dPayload < 42);
        btnGrab.classList.remove('is-active');
        btnGrab.textContent = dPayload < 42 ? '◆ 抓取载荷箱 (Space)' : '◇ 抓取 / 释放 (Space)';
      }

      const lockAd = findLockableAdapter();
      btnCrawl.classList.toggle('is-gold', lockAd !== null);
      btnCrawl.textContent = lockAd
        ? `⇄ 锚定 ${lockAd.id} 切换基座 (E)`
        : '⇄ 尺蠖切换基座 (E)';

      btnElbow.textContent =
        elbowSign === -1 ? '⟳ 肘部姿态：右/上拱 (Q)' : '⟳ 肘部姿态：左/上拱 (Q)';
    };

    // ---- IK Solver ----
    const solveIK = (
      bx: number,
      by: number,
      tx: number,
      ty: number,
      preferredSign: 1 | -1
    ): { th1: number; th2: number; usedSign: 1 | -1 } => {
      const dx = tx - bx;
      const dy = ty - by;
      const rawD = Math.hypot(dx, dy);
      const d = clamp(rawD, R_MIN, R_MAX);
      const baseAng = Math.atan2(dy, dx);
      const cosBeta = clamp((d * d - L1 * L1 - L2 * L2) / (2 * L1 * L2), -1, 1);
      const beta = Math.acos(cosBeta);

      const calcCandidate = (sign: 1 | -1) => {
        const th2 = sign * beta;
        const th1 = baseAng - th2 * 0.5;
        const ex = bx + L1 * Math.cos(th1);
        const ey = by + L1 * Math.sin(th1);
        return { th1, th2, ex, ey, sign };
      };

      const pref = calcCandidate(preferredSign);
      const alt = calcCandidate(preferredSign === 1 ? -1 : 1);

      const hullLimit = HULL_TOP_Y - 12;
      if (pref.ey <= hullLimit) {
        return { th1: pref.th1, th2: pref.th2, usedSign: pref.sign };
      }
      if (alt.ey <= hullLimit) {
        return { th1: alt.th1, th2: alt.th2, usedSign: alt.sign };
      }
      // If both somehow low, choose higher elbow
      const higher = pref.ey < alt.ey ? pref : alt;
      return { th1: higher.th1, th2: higher.th2, usedSign: higher.sign };
    };

    const updateForwardKinematics = () => {
      const base = getActiveBase();
      elbowX = base.x + L1 * Math.cos(theta1);
      elbowY = base.y + L1 * Math.sin(theta1);
      tipX = elbowX + L2 * Math.cos(theta1 + theta2);
      tipY = elbowY + L2 * Math.sin(theta1 + theta2);
    };

    // ---- Actions ----
    const toggleElbowPose = () => {
      if (finished || paused) return;
      elbowSign = elbowSign === 1 ? -1 : 1;
      host.audio.playSwitch();
      pushDebouncedToast(
        'elbow-flip',
        '已切换机械臂肘部逆运动学构型，请观察多关节平滑重组姿态以规避障碍。',
        'info',
        '逆运动学构型',
        4
      );
      syncDeckButtons();
    };

    const attemptInchwormCrawl = () => {
      if (finished || paused) return;
      if (carrying) {
        host.audio.playBeep(260, 0.08);
        pushDebouncedToast(
          'crawl-carrying',
          '当前末端正抓取实验载荷，请先松开载荷再锚定目标适配器！',
          'caution',
          '尺蠖爬行限制',
          4
        );
        return;
      }

      const targetAd = findLockableAdapter();
      if (!targetAd) {
        host.audio.playBeep(260, 0.08);
        pushDebouncedToast(
          'crawl-far',
          '请先将自由末端执行器移至发光的目标适配器（如 A2）正上方再按 E 切换基座！',
          'caution',
          '对齐适配器',
          4
        );
        return;
      }

      // Seamless exact geometric flip: old tip at targetAd becomes new base, old base becomes new tip!
      const oldBase = getActiveBase();
      const curElbowX = elbowX;
      const curElbowY = elbowY;

      activeBaseId = targetAd.id;
      const newTh1 = Math.atan2(curElbowY - targetAd.y, curElbowX - targetAd.x);
      const oldBaseFromElbow = Math.atan2(oldBase.y - curElbowY, oldBase.x - curElbowX);
      const newTh2 = angleDiff(oldBaseFromElbow, newTh1);

      theta1 = newTh1;
      theta2 = newTh2;
      omega1 = 0;
      omega2 = 0;
      elbowSign = newTh2 >= 0 ? 1 : -1;
      flexX *= 0.3;
      flexY *= 0.3;
      flexVx = 0;
      flexVy = 0;

      updateForwardKinematics();
      prevTipX = tipX;
      prevTipY = tipY;
      tipVx = 0;
      tipVy = 0;

      // Gently lift newly freed end off old adapter so player immediately sees the flip!
      targetX = clamp(oldBase.x + (targetAd.x > oldBase.x ? 48 : -48), -420, 420);
      targetY = HULL_TOP_Y - 68;
      prevTargetX = targetX;
      prevTargetY = targetY;

      crawlCount++;
      host.audio.playLock();
      particles.burst(targetAd.x, targetAd.y, 24, '#a78bfa', 105, 3.2, 0.65);
      particles.spawn({
        x: targetAd.x,
        y: targetAd.y,
        vx: 0,
        vy: 0,
        life: 0.55,
        size: 30,
        color: '#22c55e',
        kind: 'ring',
      });

      if (levelIndex === 2 && targetAd.id === 'A2') {
        host.hud.setObjective('尺蠖爬行成功！基座已切换至 A2，请抓取载荷并平稳送入远端接口 B');
      }
      pushDebouncedToast(
        'crawl-ok',
        `尺蠖式跨舱爬行完成！锚定基座已切换至 ${targetAd.label}，原底座已解锁转为自由作业端。`,
        'nominal',
        '双端对称切换',
        3
      );
      syncDeckButtons();
    };

    const attemptGrabOrRelease = () => {
      if (finished || paused) return;

      if (!carrying) {
        const dPayload = dist(tipX, tipY, payloadX, payloadY - 12);
        if (dPayload <= 44) {
          carrying = true;
          payloadVx = 0;
          payloadVy = 0;
          host.audio.playLock();
          particles.burst(payloadX, payloadY - 10, 18, '#38bdf8', 85, 2.8, 0.5);
          pushDebouncedToast(
            'grab-ok',
            '已捕获 4.2 吨科学实验载荷！微重力下质量惯性依然显著，请缓慢平滑牵引抑制柔性振摆。',
            'nominal',
            '载荷捕获锁定',
            4
          );
          syncDeckButtons();
          return;
        }

        const lockAd = findLockableAdapter();
        if (lockAd) {
          pushDebouncedToast(
            'hint-crawl',
            `末端当前对准的是舱壁适配器 ${lockAd.id}，请按 E（或点击“尺蠖切换基座”）切换锚定基座！`,
            'info',
            '适配器提示',
            4
          );
          host.audio.playBeep(320, 0.06);
          return;
        }

        host.audio.playBeep(240, 0.07);
        pushDebouncedToast(
          'grab-far',
          '请将末端捕获器移至金色实验载荷箱顶部抓手附近再按 Space 抓取。',
          'caution',
          '捕获距离提示',
          4
        );
      } else {
        // Check if within Target Slot B docking envelope
        const dSlot = dist(payloadX, payloadY, cfg.targetSlot.x, cfg.targetSlot.y);
        const tipSpeed = Math.hypot(tipVx, tipVy);
        if (dSlot <= 38) {
          if (tipSpeed > 135 || stress > 82) {
            host.audio.playWarning();
            pushDebouncedToast(
              'dock-fast',
              '末端晃动或相对速度偏大！请稍作停顿待柔性振摆平息后再按 Space 精准锁紧。',
              'caution',
              '柔顺对接保护',
              3
            );
            return;
          }

          // Successful precision docking!
          carrying = false;
          payloadDocked = true;
          payloadX = cfg.targetSlot.x;
          payloadY = cfg.targetSlot.y;
          host.audio.playLock();
          particles.burst(payloadX, payloadY, 34, '#22c55e', 125, 3.6, 0.85);
          particles.spawn({
            x: payloadX,
            y: payloadY,
            vx: 0,
            vy: 0,
            life: 0.6,
            size: 36,
            color: '#4ade80',
            kind: 'ring',
          });
          finishMission(true);
          return;
        }

        // Release in place (softly settles if near start carrier, else floats gently damped)
        carrying = false;
        payloadVx = tipVx * 0.2;
        payloadVy = tipVy * 0.2;
        host.audio.playSwitch();
        pushDebouncedToast(
          'release-mid',
          '载荷已释放。如需继续搬运，将末端移回抓手处按 Space 重新锁定。',
          'info',
          '载荷松开',
          4
        );
        syncDeckButtons();
      }
    };

    const mountTactileDeck = () => {
      host.hud.clearTactileDeck();
      const deck = host.hud.getTactileDeck();

      btnGrab = document.createElement('button');
      btnGrab.type = 'button';
      btnGrab.className = 'deck-ctrl-btn';
      btnGrab.textContent = '◇ 抓取 / 释放载荷 (Space)';
      btnGrab.title = '抓取实验载荷箱或将其对接锁紧至目标槽位 B (快捷键 Space)';
      btnGrab.addEventListener('click', () => attemptGrabOrRelease());

      btnCrawl = document.createElement('button');
      btnCrawl.type = 'button';
      btnCrawl.className = 'deck-ctrl-btn';
      btnCrawl.textContent = '⇄ 尺蠖切换基座 (E)';
      btnCrawl.title = '空载对准另一舱壁适配器时切换锚定基座，实现尺蠖式跨舱爬行 (快捷键 E / Shift)';
      btnCrawl.addEventListener('click', () => attemptInchwormCrawl());

      btnElbow = document.createElement('button');
      btnElbow.type = 'button';
      btnElbow.className = 'deck-ctrl-btn';
      btnElbow.textContent = '⟳ 切换肘部姿态 (Q)';
      btnElbow.title = '切换逆运动学肘部弯折姿态以绕开舱外障碍物 (快捷键 Q)';
      btnElbow.addEventListener('click', () => toggleElbowPose());

      deck.append(btnGrab, btnCrawl, btnElbow);
      syncDeckButtons();
    };

    const loadLevel = (idx: number) => {
      levelIndex = clamp(idx, 0, ARM_LEVELS.length - 1);
      cfg = ARM_LEVELS[levelIndex];
      finished = false;
      levelTime = 0;

      activeBaseId = cfg.initialBaseId;
      elbowSign = -1;
      targetX = cfg.initialTarget.x;
      targetY = cfg.initialTarget.y;
      prevTargetX = targetX;
      prevTargetY = targetY;

      const base = getActiveBase();
      const sol = solveIK(base.x, base.y, targetX, targetY, elbowSign);
      theta1 = sol.th1;
      theta2 = sol.th2;
      elbowSign = sol.usedSign;
      omega1 = 0;
      omega2 = 0;
      updateForwardKinematics();
      prevTipX = tipX;
      prevTipY = tipY;
      tipVx = 0;
      tipVy = 0;
      prevTipVx = 0;
      prevTipVy = 0;
      tipAx = 0;
      tipAy = 0;

      flexX = 0;
      flexY = 0;
      flexVx = 0;
      flexVy = 0;
      stress = 0;
      peakStress = 0;
      collisions = 0;
      hitCooldown = 0;
      crawlCount = 0;

      carrying = false;
      payloadDocked = false;
      payloadX = cfg.payloadStart.x;
      payloadY = cfg.payloadStart.y;
      payloadVx = 0;
      payloadVy = 0;

      keys.clear();
      dragging = false;
      particles.clear();
      toastCooldowns.clear();

      const lm = roboticArmMeta.levels[levelIndex];
      if (lm) host.hud.setObjective(lm.objective);

      host.hud.setMetrics([
        {
          id: 'stress',
          label: '关节柔性应力',
          value: '0%',
          ratio: 0,
          status: 'nominal',
        },
        {
          id: 'speed',
          label: '末端平移速率',
          value: '0.00 m/s',
          ratio: 0,
          status: 'nominal',
        },
        {
          id: 'base',
          label: '当前锚定基座',
          value: `${activeBaseId} · 正常 (0/3碰擦)`,
          status: 'info',
        },
        {
          id: 'payload',
          label: '载荷转位状态',
          value: cfg.requireInchworm ? '待尺蠖爬行' : '待抓取载荷',
          ratio: 0,
          status: 'info',
        },
      ]);

      mountTactileDeck();

      if (levelIndex === 0) {
        pushDebouncedToast(
          'arm-l1',
          '拖动紫色目标十字（或用 WASD）引导机械臂末端靠近左侧实验载荷箱，按 Space 抓取并匀速送至右侧槽位 B。',
          'info',
          '机械臂自检完成',
          2
        );
      } else if (levelIndex === 1) {
        pushDebouncedToast(
          'arm-l2',
          '注意舱壁凸出的 S 波段中继天线与热控散热翼！抬高弧线绕障，必要时按 Q 切换肘部构型。',
          'caution',
          '防碰撞走廊警告',
          2
        );
      } else {
        pushDebouncedToast(
          'arm-l3',
          '远端载荷与目标槽位 B 超出基座 A1 单次臂展！请先将自由末端移至中转适配器 A2，按 E 启动“尺蠖式”基座切换！',
          'caution',
          '跨舱爬行指令',
          2
        );
      }
    };

    const finishMission = (won: boolean, failReason?: string) => {
      if (finished) return;
      finished = true;
      dragging = false;
      keys.clear();

      let stars: 0 | 1 | 2 | 3 = 0;
      if (won) {
        if (collisions === 0 && peakStress < 60) {
          stars = 3;
        } else if (collisions <= 1 && peakStress < 86) {
          stars = 2;
        } else {
          stars = 1;
        }
      }

      const score = won
        ? Math.round(
            520 +
              Math.max(0, 300 - peakStress * 3.1) +
              Math.max(0, 180 - collisions * 90)
          )
        : Math.round(crawlCount * 100 + (carrying ? 120 : 40));

      const summary = won
        ? stars === 3
          ? '毫米级柔顺对接！全程零碰撞且柔性振动抑制优异，达到航天级操控标准。'
          : '成功完成载荷转位对接，放缓加减速节奏以降低峰值应力即可斩获 3★。'
        : failReason ?? '机械臂触发结构过载与碰撞保护停机，请放慢牵引速度并绕开舱外设施。';

      const result: GameResult = {
        levelIndex,
        won,
        stars,
        score,
        summary,
        metrics: [
          {
            label: '峰值柔性应力',
            value: `${Math.round(peakStress)}%`,
            status: peakStress < 60 ? 'nominal' : peakStress < 85 ? 'caution' : 'critical',
          },
          {
            label: '碰擦 / 过载告警',
            value: `${collisions} 次`,
            status: collisions === 0 ? 'nominal' : collisions === 1 ? 'caution' : 'critical',
          },
          {
            label: '尺蠖基座切换',
            value: `${crawlCount} 次`,
            status: cfg.requireInchworm && crawlCount > 0 ? 'nominal' : 'info',
          },
          {
            label: '作业耗时',
            value: `${levelTime.toFixed(1)} s`,
            status: 'info',
          },
        ],
        scienceCard: buildScienceCard(levelIndex, {
          peakStress,
          crawlCount,
          collisions,
        }),
      };

      host.completeLevel(result);
    };

    const registerStrike = (reason: string, fx: number, fy: number) => {
      if (hitCooldown > 0 || finished) return;
      hitCooldown = 1.45;
      collisions++;
      host.audio.playWarning();
      particles.burst(fx, fy, 20, '#ef4444', 110, 3.2, 0.6);

      // Emergency active damping recoil
      omega1 *= 0.2;
      omega2 *= 0.2;
      flexVx *= -0.35;
      flexVy *= -0.35;

      pushDebouncedToast(
        `strike-${collisions}`,
        `${reason}（结构安全余度 ${Math.max(0, 3 - collisions)}/3）`,
        'critical',
        '力矩保护触发',
        1.5
      );

      if (collisions >= 3) {
        finishMission(
          false,
          '机械臂累计触发 3 次碰撞或超限过载，飞控系统已自动锁定关节以保护舱外设备。'
        );
      }
    };

    // ---- Input Handlers ----
    const clampTargetToWorkspace = (wx: number, wy: number) => {
      const base = getActiveBase();
      const clampedX = clamp(wx, -438, 438);
      const clampedY = clamp(wy, -165, HULL_TOP_Y - 5);
      // Softly pull inside reachable outer ring (still allow pulling slightly outside so player feels reach boundary)
      const dx = clampedX - base.x;
      const dy = clampedY - base.y;
      const d = Math.hypot(dx, dy);
      if (d > R_MAX + 22) {
        const s = (R_MAX + 22) / d;
        targetX = base.x + dx * s;
        targetY = clamp(base.y + dy * s, -165, HULL_TOP_Y - 5);
      } else {
        targetX = clampedX;
        targetY = clampedY;
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (destroyed || paused || finished) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const k = e.key.toLowerCase();
      // Strictly never intercept global shell keys
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
        e.key === 'ArrowRight'
      ) {
        e.preventDefault();
        keys.add(k);
      } else if (e.key === ' ') {
        e.preventDefault();
        if (!e.repeat) attemptGrabOrRelease();
      } else if (k === 'e' || e.key === 'Shift') {
        if (!e.repeat) {
          e.preventDefault();
          attemptInchwormCrawl();
        }
      } else if (k === 'q') {
        e.preventDefault();
        if (!e.repeat) toggleElbowPose();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      keys.delete(e.key.toLowerCase());
    };

    const onBlur = () => {
      keys.clear();
      dragging = false;
    };

    const onPointerDown = (e: PointerEvent) => {
      if (destroyed || paused || finished || e.button !== 0) return;
      const rect = canvas.getBoundingClientRect();
      const wp = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      dragging = true;
      canvas.setPointerCapture?.(e.pointerId);
      clampTargetToWorkspace(wp.x, wp.y);
      host.audio.playHover();
    };

    const onPointerMove = (e: PointerEvent) => {
      if (destroyed || paused || finished || !dragging) return;
      const rect = canvas.getBoundingClientRect();
      const wp = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      clampTargetToWorkspace(wp.x, wp.y);
    };

    const onPointerUp = () => {
      dragging = false;
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
      if (hitCooldown > 0) hitCooldown = Math.max(0, hitCooldown - dt);

      // 1. Keyboard steering of target reticle
      let inX = 0;
      let inY = 0;
      if (keys.has('a') || keys.has('arrowleft')) inX -= 1;
      if (keys.has('d') || keys.has('arrowright')) inX += 1;
      if (keys.has('w') || keys.has('arrowup')) inY -= 1;
      if (keys.has('s') || keys.has('arrowdown')) inY += 1;
      const mag = Math.hypot(inX, inY);
      if (mag > 0) {
        const steerSpeed = carrying ? 165 : 215;
        clampTargetToWorkspace(
          targetX + (inX / mag) * steerSpeed * dt,
          targetY + (inY / mag) * steerSpeed * dt
        );
      }

      const targetVel = dist(targetX, targetY, prevTargetX, prevTargetY) / Math.max(dt, 0.004);
      prevTargetX = targetX;
      prevTargetY = targetY;

      // 2. Solve Analytical 2-Link IK
      const base = getActiveBase();
      const sol = solveIK(base.x, base.y, targetX, targetY, elbowSign);

      // Smooth angular tracking with motor velocity & acceleration bounds
      const maxOmega1 = carrying ? 1.18 : 1.72;
      const maxOmega2 = carrying ? 1.52 : 2.25;
      const kp = carrying ? 4.4 : 6.0;

      const err1 = angleDiff(sol.th1, theta1);
      const err2 = angleDiff(sol.th2, theta2);
      const desOm1 = clamp(err1 * kp, -maxOmega1, maxOmega1);
      const desOm2 = clamp(err2 * kp, -maxOmega2, maxOmega2);

      // Joint angular acceleration reflects control aggression
      const blend = clamp(dt * (carrying ? 7.2 : 10.5), 0, 1);
      const alpha1 = (desOm1 - omega1) / Math.max(dt, 0.008);
      const alpha2 = (desOm2 - omega2) / Math.max(dt, 0.008);
      omega1 = lerp(omega1, desOm1, blend);
      omega2 = lerp(omega2, desOm2, blend);

      theta1 += omega1 * dt;
      theta2 += omega2 * dt;

      updateForwardKinematics();

      // Keep elbow & tip strictly above pressurized hull exterior
      if (tipY > HULL_TOP_Y - 4) {
        tipY = HULL_TOP_Y - 4;
      }

      // 3. Linear Tip Velocity & Acceleration
      tipVx = (tipX - prevTipX) / Math.max(dt, 0.005);
      tipVy = (tipY - prevTipY) / Math.max(dt, 0.005);
      prevTipX = tipX;
      prevTipY = tipY;

      tipAx = (tipVx - prevTipVx) / Math.max(dt, 0.005);
      tipAy = (tipVy - prevTipVy) / Math.max(dt, 0.005);
      prevTipVx = tipVx;
      prevTipVy = tipVy;

      const tipSpeed = Math.hypot(tipVx, tipVy);
      const tipAccMag = Math.hypot(tipAx, tipAy);

      // Subtle motorized servo sound when moving cleanly
      if (tipSpeed > 25) {
        motorHumTimer -= dt;
        if (motorHumTimer <= 0) {
          motorHumTimer = 0.28;
          host.audio.playBeep(175 + clamp(tipSpeed * 0.4, 0, 90), 0.025);
        }
      }

      // 4. Flexible Inertia Harmonic Oscillator (Real Structural Boom Flex!)
      const wn = carrying ? 5.2 : 7.8; // heavier payload = lower resonant freq & deeper swing
      const zeta = carrying ? 0.23 : 0.36;
      const driveGain = carrying ? 0.145 : 0.042;

      // Also inject realistic jerk impulse if user whips target aggressively while carrying
      const whipPenalty = carrying && targetVel > 240 ? (targetVel - 240) * 0.32 : 0;
      const clampedAx = clamp(tipAx, -950, 950);
      const clampedAy = clamp(tipAy, -950, 950);

      const fAx = -wn * wn * flexX - 2 * zeta * wn * flexVx - clampedAx * driveGain;
      const fAy = -wn * wn * flexY - 2 * zeta * wn * flexVy - clampedAy * driveGain;
      flexVx += fAx * dt;
      flexVy += fAy * dt;
      flexX = clamp(flexX + flexVx * dt, -34, 34);
      flexY = clamp(flexY + flexVy * dt, -34, 34);

      const flexMag = Math.hypot(flexX, flexY);
      const torqueLoad = (Math.abs(alpha1) + Math.abs(alpha2)) * (carrying ? 2.8 : 0.9);
      const instantStress = clamp(
        flexMag * (carrying ? 4.2 : 2.0) +
          Math.max(0, tipAccMag - 210) * (carrying ? 0.065 : 0.022) +
          whipPenalty +
          torqueLoad * 0.45,
        0,
        100
      );

      stress = lerp(stress, instantStress, clamp(dt * (instantStress > stress ? 7.5 : 3.4), 0, 1));
      peakStress = Math.max(peakStress, stress);

      if (stress > 55) {
        pushDebouncedToast(
          'flex-warn',
          '检测到机械臂柔性振摆与力矩升高！微重力下重型载荷仍具显著惯性，请放缓拖拉节奏。',
          'caution',
          '惯性抑振提示',
          6
        );
      }
      if (stress > 82) {
        warnTimer -= dt;
        if (warnTimer <= 0) {
          warnTimer = 0.95;
          host.audio.playWarning();
        }
      }
      if (stress >= 97) {
        registerStrike('关节柔性力矩过载（≥97%）！急甩载荷导致连杆剧烈振摆。', elbowX, elbowY);
        stress = 62;
        if (finished) return;
      }

      // 5. Payload Position Update
      const visTipX = tipX + flexX;
      const visTipY = tipY + flexY;

      if (carrying) {
        payloadX = visTipX;
        payloadY = clamp(visTipY + 14, -155, HULL_TOP_Y - 14);
      } else if (!payloadDocked) {
        // Gentle damped zero-G drift if released mid-space; softly settle onto start carrier if very close
        payloadX = clamp(payloadX + payloadVx * dt, -430, 430);
        payloadY = clamp(payloadY + payloadVy * dt, -155, HULL_TOP_Y - 14);
        payloadVx *= Math.exp(-2.4 * dt);
        payloadVy *= Math.exp(-2.4 * dt);
        if (dist(payloadX, payloadY, cfg.payloadStart.x, cfg.payloadStart.y) < 24) {
          payloadX = lerp(payloadX, cfg.payloadStart.x, clamp(dt * 4, 0, 1));
          payloadY = lerp(payloadY, cfg.payloadStart.y, clamp(dt * 4, 0, 1));
        }
      }

      // 6. Obstacle Collision Checks (Payload, Tip, and Forearm Boom L2)
      for (const obs of cfg.obstacles) {
        const tipD = pointToSegmentDist(visTipX, visTipY, obs.x, obs.baseY, obs.x, obs.topY);
        if (tipD < obs.radius + 7) {
          registerStrike(`机械臂末端碰擦「${obs.label}」！`, visTipX, visTipY);
          break;
        }
        if (carrying) {
          const payD = pointToSegmentDist(payloadX, payloadY, obs.x, obs.baseY, obs.x, obs.topY);
          if (payD < obs.radius + 15) {
            registerStrike(`实验载荷箱撞击「${obs.label}」！请抬高转位弧线绕行。`, payloadX, payloadY);
            break;
          }
        }
        // Sample forearm boom L2 (midpoint & 70%)
        let forearmHit = false;
        for (const f of [0.38, 0.68]) {
          const sx = lerp(elbowX, visTipX, f);
          const sy = lerp(elbowY, visTipY, f);
          if (pointToSegmentDist(sx, sy, obs.x, obs.baseY, obs.x, obs.topY) < obs.radius + 5) {
            registerStrike(`机械臂下臂杆触碰「${obs.label}」！可按 Q 切换肘部姿态绕障。`, sx, sy);
            forearmHit = true;
            break;
          }
        }
        if (forearmHit) break;
      }
      if (finished) return;

      particles.update(dt);

      // 7. HUD Telemetry Updates (Event-Driven)
      const stressStatus: MetricStatus =
        stress < 45 ? 'nominal' : stress < 78 ? 'caution' : 'critical';
      host.hud.updateMetric('stress', {
        value: `${Math.round(stress)}% (峰 ${Math.round(peakStress)}%)`,
        ratio: clamp(stress / 100, 0, 1),
        status: stressStatus,
      });

      const speedMps = tipSpeed / PX_PER_METER * 0.04; // Scaled to real 0.00..0.25 m/s range
      const speedStatus: MetricStatus =
        speedMps <= 0.15 ? 'nominal' : speedMps <= 0.22 ? 'caution' : 'critical';
      host.hud.updateMetric('speed', {
        value: `${speedMps.toFixed(2)} m/s`,
        ratio: clamp(speedMps / 0.26, 0, 1),
        status: speedStatus,
      });

      host.hud.updateMetric('base', {
        value: `${activeBaseId} · 余度 ${Math.max(0, 3 - collisions)}/3`,
        status: collisions === 0 ? 'nominal' : collisions === 1 ? 'caution' : 'critical',
      });

      const dToSlot = dist(payloadX, payloadY, cfg.targetSlot.x, cfg.targetSlot.y);
      const totalSpan = Math.max(1, dist(cfg.payloadStart.x, cfg.payloadStart.y, cfg.targetSlot.x, cfg.targetSlot.y));
      const transferRatio = carrying ? clamp(1 - dToSlot / totalSpan, 0.15, 0.96) : 0;
      host.hud.updateMetric('payload', {
        value: carrying
          ? dToSlot < 38
            ? '进入槽位 B · 按Space锁紧'
            : '载荷稳态转运中'
          : cfg.requireInchworm && activeBaseId === 'A1'
            ? '需先爬行至 A2'
            : '空载就绪',
        ratio: cfg.requireInchworm && activeBaseId !== 'A1' && !carrying ? 0.35 : transferRatio,
        status: carrying && dToSlot < 38 ? 'nominal' : 'info',
      });

      syncDeckButtons();
    };

    // ---- Rendering ----
    const getStressColor = (s: number): string => {
      if (s < 45) return '#22c55e';
      if (s < 78) return '#f59e0b';
      return '#ef4444';
    };

    const drawStationBackbone = () => {
      ctx.save();
      const mli = getMLIPattern(ctx);

      // Background recessed Solar Wings behind the station hull
      ctx.globalAlpha = 0.44;
      drawSolarPanelRect(ctx, -395, -148, 66, 210, 0.88);
      drawSolarPanelRect(ctx, 338, -148, 66, 210, 0.8);
      ctx.globalAlpha = 1;

      // Exterior Hull Backbone Cylinder along y = [HULL_TOP_Y, 176] using PBR brushed titanium module
      drawTitaniumModule(ctx, -448, HULL_TOP_Y, 896, 62, {
        radius: 10,
        mliBands: [0.06, 0.31, 0.64, 0.87],
        rivets: true,
        rimGlow: 'rgba(226, 242, 255, 0.82)',
      });

      // Top metallic bevel specular highlight rail along exterior dorsal spine
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.52)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-436, HULL_TOP_Y + 2);
      ctx.lineTo(436, HULL_TOP_Y + 2);
      ctx.stroke();

      // Crinkled gold Kapton MLI equipment bay wraps along exterior skin
      const drawFoil = (x: number, w: number) => {
        ctx.save();
        ctx.fillStyle = mli ?? '#d97706';
        ctx.beginPath();
        ctx.roundRect(x, HULL_TOP_Y + 11, w, 25, 2.5);
        ctx.fill();

        const wrap = ctx.createLinearGradient(x, HULL_TOP_Y + 11, x, HULL_TOP_Y + 36);
        wrap.addColorStop(0, 'rgba(255, 252, 220, 0.34)');
        wrap.addColorStop(0.28, 'rgba(255, 255, 255, 0.24)');
        wrap.addColorStop(0.78, 'rgba(12, 8, 2, 0.42)');
        wrap.addColorStop(1, 'rgba(30, 58, 100, 0.32)');
        ctx.fillStyle = wrap;
        ctx.fill();

        ctx.strokeStyle = 'rgba(254, 243, 199, 0.72)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      };
      drawFoil(-385, 42);
      drawFoil(-165, 56);
      drawFoil(125, 52);
      drawFoil(340, 56);

      // Module Ring Bulkheads with recessed shadow groove & specular lip
      for (const rx of [-195, 195]) {
        ctx.strokeStyle = 'rgba(15, 23, 42, 0.65)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(rx, HULL_TOP_Y);
        ctx.lineTo(rx, HULL_TOP_Y + 62);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(rx + 2, HULL_TOP_Y);
        ctx.lineTo(rx + 2, HULL_TOP_Y + 62);
        ctx.stroke();
      }

      // Aerospace identity stripe
      ctx.fillStyle = '#0284c7';
      ctx.fillRect(-438, HULL_TOP_Y + 42, 876, 4);
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(-438, HULL_TOP_Y + 47, 876, 2);

      // Module Names
      ctx.font = '700 10px "JetBrains Mono", monospace';
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.textAlign = 'center';
      ctx.fillText('天和核心舱 aft', -315, HULL_TOP_Y + 28);
      ctx.fillText('CSS · 节点舱 / 机械臂爬行轨道', 0, HULL_TOP_Y + 42);
      ctx.fillText('梦天实验舱暴露平台', 318, HULL_TOP_Y + 28);

      // PDGF Target Adapters (A1, A2, A3) with active grapple pin additive radiance
      const lockCand = findLockableAdapter();
      for (const ad of cfg.adapters) {
        const isBase = ad.id === activeBaseId;
        const isCand = lockCand?.id === ad.id;
        const isStep1Hint = cfg.requireInchworm && activeBaseId === 'A1' && ad.id === 'A2';
        const pulse = 0.5 + 0.5 * Math.sin(simTime * 6.5);

        if (isBase) {
          drawAdditiveGlow(ctx, ad.x, ad.y - 2, 26, '34, 197, 94', 0.48);
        } else if (isCand) {
          drawAdditiveGlow(ctx, ad.x, ad.y - 2, 30 + pulse * 8, '74, 222, 128', 0.55);
        } else if (isStep1Hint) {
          drawAdditiveGlow(ctx, ad.x, ad.y - 2, 28 + pulse * 7, '167, 139, 250', 0.48);
        } else {
          drawAdditiveGlow(ctx, ad.x, ad.y - 2, 14, '167, 139, 250', 0.22);
        }

        if (isCand || isStep1Hint) {
          ctx.strokeStyle = isCand ? '#22c55e' : '#a78bfa';
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.arc(ad.x, ad.y, 17 + pulse * 7, Math.PI, Math.PI * 2);
          ctx.stroke();
        }

        // Machined Metallic Adapter Socket Pedestal
        drawTitaniumModule(ctx, ad.x - 19, ad.y - 9, 38, 15, {
          radius: 4,
          rivets: false,
          rimGlow: isBase ? '#22c55e' : isCand ? '#4ade80' : '#a78bfa',
        });
        ctx.fillStyle = '#0f172a';
        ctx.beginPath();
        ctx.roundRect(ad.x - 13, ad.y - 6, 26, 9, 2.5);
        ctx.fill();

        // Center PDGF grapple pin with additive beacon core
        const pinRgb = isBase ? '74, 222, 128' : isCand ? '74, 222, 128' : '196, 181, 253';
        drawAdditiveGlow(ctx, ad.x, ad.y - 2, 10, pinRgb, isBase || isCand ? 0.72 : 0.42);
        ctx.fillStyle = isBase ? '#bbf7d0' : '#f8fafc';
        ctx.beginPath();
        ctx.arc(ad.x, ad.y - 2, 3.8, 0, Math.PI * 2);
        ctx.fill();

        ctx.font = '700 10px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        const sub = isBase
          ? `${ad.id} [锚定基座]`
          : isCand
            ? `[按E] 切换至 ${ad.id}`
            : isStep1Hint
              ? `① 爬行目标 ${ad.id}`
              : ad.id;
        const tw = ctx.measureText(sub).width + 12;
        ctx.fillStyle = 'rgba(7, 15, 29, 0.86)';
        ctx.beginPath();
        ctx.roundRect(ad.x - tw * 0.5, ad.y + 11, tw, 16, 4);
        ctx.fill();
        ctx.fillStyle = isBase ? '#86efac' : isCand ? '#4ade80' : '#ddd6fe';
        ctx.fillText(sub, ad.x, ad.y + 22.5);
      }

      // Payload Pickup Carrier Cradle A (machined titanium stanchion)
      drawTitaniumModule(ctx, cfg.payloadStart.x - 24, HULL_TOP_Y - 12, 48, 12, {
        radius: 3,
        rivets: false,
        rimGlow: 'rgba(148, 185, 225, 0.65)',
      });

      // Target Slot B Illuminated Receiving Cradle with volumetric holographic glow
      const sx = cfg.targetSlot.x;
      const sy = cfg.targetSlot.y;
      const slotNear = carrying && dist(payloadX, payloadY, sx, sy) <= 38;
      const sp = 0.5 + 0.5 * Math.sin(simTime * 5.2);
      const slotRgb = slotNear ? '34, 197, 94' : '56, 189, 248';

      // Volumetric cradle radiance & vertical holographic docking guide curtain
      drawAdditiveGlow(ctx, sx, sy, slotNear ? 52 : 38 + sp * 8, slotRgb, slotNear ? 0.52 : 0.28 + sp * 0.1);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const holoGrad = ctx.createLinearGradient(sx, HULL_TOP_Y, sx, sy - 26);
      holoGrad.addColorStop(0, `rgba(${slotRgb}, ${slotNear ? 0.34 : 0.18})`);
      holoGrad.addColorStop(1, `rgba(${slotRgb}, 0)`);
      ctx.fillStyle = holoGrad;
      ctx.fillRect(sx - 22, sy - 26, 44, HULL_TOP_Y - (sy - 26));
      ctx.restore();

      // Machined cradle pedestal & glowing supports
      drawTitaniumModule(ctx, sx - 26, HULL_TOP_Y - 8, 52, 8, {
        radius: 2,
        rivets: false,
        rimGlow: slotNear ? '#4ade80' : '#38bdf8',
      });
      ctx.strokeStyle = slotNear ? '#4ade80' : '#38bdf8';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(sx - 24, HULL_TOP_Y - 4);
      ctx.lineTo(sx - 24, sy - 6);
      ctx.moveTo(sx + 24, HULL_TOP_Y - 4);
      ctx.lineTo(sx + 24, sy - 6);
      ctx.stroke();

      // Glowing corner alignment beacons on cradle stanchions
      drawAdditiveGlow(ctx, sx - 24, sy - 6, 10, slotRgb, 0.58);
      drawAdditiveGlow(ctx, sx + 24, sy - 6, 10, slotRgb, 0.58);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(sx - 24, sy - 6, 2.2, 0, Math.PI * 2);
      ctx.arc(sx + 24, sy - 6, 2.2, 0, Math.PI * 2);
      ctx.fill();

      // Glowing Holographic Target Box Outline
      ctx.fillStyle = slotNear
        ? 'rgba(34, 197, 94, 0.26)'
        : `rgba(56, 189, 248, ${0.09 + sp * 0.08})`;
      ctx.strokeStyle = slotNear ? '#4ade80' : '#38bdf8';
      ctx.lineWidth = slotNear ? 2.4 : 1.6;
      ctx.setLineDash(slotNear ? [] : [5, 4]);
      ctx.beginPath();
      ctx.roundRect(sx - 20, sy - 16, 40, 32, 4);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.font = '700 10.5px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = slotNear ? '#86efac' : '#7dd3fc';
      ctx.fillText(slotNear ? '✓ 按 Space 锁紧对接' : cfg.targetSlot.label, sx, sy - 24);

      ctx.restore();
    };

    const drawObstacles = () => {
      ctx.save();
      const mli = getMLIPattern(ctx);
      for (const obs of cfg.obstacles) {
        if (obs.kind === 'dish') {
          // Machined titanium mast pylon
          drawTitaniumModule(ctx, obs.x - 3, obs.topY + 8, 6, obs.baseY - (obs.topY + 8), {
            vertical: true,
            radius: 2,
            rivets: false,
          });

          // Parabolic S-band communication dish with cylindrical metallic sheen
          const dishGrad = ctx.createLinearGradient(obs.x - 18, obs.topY - 12, obs.x + 18, obs.topY + 8);
          dishGrad.addColorStop(0, '#ffffff');
          dishGrad.addColorStop(0.45, '#cbd5e1');
          dishGrad.addColorStop(1, '#475569');
          ctx.fillStyle = dishGrad;
          ctx.strokeStyle = '#64748b';
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.arc(obs.x, obs.topY + 6, 18, Math.PI * 0.95, Math.PI * 2.05);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          // Gold feed horn + active RF telemetry glint
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.moveTo(obs.x, obs.topY + 6);
          ctx.lineTo(obs.x, obs.topY - 12);
          ctx.stroke();
          drawAdditiveGlow(ctx, obs.x, obs.topY - 12, 12, '251, 191, 36', 0.55);
          ctx.fillStyle = '#fef08a';
          ctx.beginPath();
          ctx.arc(obs.x, obs.topY - 12, 3.2, 0, Math.PI * 2);
          ctx.fill();
        } else if (obs.kind === 'radiator') {
          // Protruding metallic white thermal radiator louvered panel
          drawTitaniumModule(ctx, obs.x - 13, obs.topY - 8, 26, obs.baseY - obs.topY + 8, {
            vertical: true,
            radius: 3,
            rivets: false,
            rimGlow: 'rgba(186, 230, 253, 0.72)',
          });

          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 1.25;
          for (let ry = obs.topY; ry < obs.baseY - 4; ry += 10) {
            ctx.beginPath();
            ctx.moveTo(obs.x - 10, ry);
            ctx.lineTo(obs.x + 10, ry);
            ctx.stroke();
          }
        } else {
          // Star tracker mast with gold MLI shroud & optical baffle lens
          drawTitaniumModule(ctx, obs.x - 2.5, obs.topY, 5, obs.baseY - obs.topY, {
            vertical: true,
            radius: 2,
            rivets: false,
          });
          ctx.fillStyle = mli ?? '#d97706';
          ctx.strokeStyle = '#fde68a';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.roundRect(obs.x - 11, obs.topY - 10, 22, 16, 3);
          ctx.fill();
          ctx.stroke();
          drawGlassViewport(ctx, obs.x - 6, obs.topY - 7, 12, 10, 2.5, 'rgba(56, 189, 248, 0.48)');
          drawAdditiveGlow(ctx, obs.x, obs.topY - 2, 11, '56, 189, 248', 0.38);
        }

        ctx.font = '700 9.5px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fca5a5';
        ctx.fillText(obs.label, obs.x, obs.topY - 22);
      }
      ctx.restore();
    };

    const drawPayload = () => {
      const mli = getMLIPattern(ctx);
      const dTip = dist(tipX, tipY, payloadX, payloadY - 12);

      ctx.save();
      ctx.translate(payloadX, payloadY);
      // Slight inertial swing tilt proportional to flexX when carrying
      const tilt = carrying ? clamp(flexX * 0.014, -0.28, 0.28) : 0;
      ctx.rotate(tilt);

      // Titanium chassis + Crinkled Gold MLI Science Experiment Module Box
      drawTitaniumModule(ctx, -20, -15, 40, 30, {
        radius: 5,
        rivets: false,
        rimGlow: payloadDocked ? '#4ade80' : carrying ? '#c4b5fd' : '#f8fafc',
      });

      // Crinkled gold MLI thermal wrap inset across experiment hull
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(-18.5, -13.5, 37, 27, 4);
      ctx.clip();
      ctx.fillStyle = mli ?? '#d97706';
      ctx.fillRect(-19, -14, 38, 28);
      const foilShade = ctx.createLinearGradient(-19, -14, 19, 14);
      foilShade.addColorStop(0, 'rgba(255, 252, 225, 0.34)');
      foilShade.addColorStop(0.32, 'rgba(255, 255, 255, 0.22)');
      foilShade.addColorStop(0.8, 'rgba(15, 10, 2, 0.42)');
      foilShade.addColorStop(1, 'rgba(30, 58, 100, 0.34)');
      ctx.fillStyle = foilShade;
      ctx.fillRect(-19, -14, 38, 28);
      ctx.restore();

      // Metallic bevel corner guards
      ctx.strokeStyle = payloadDocked ? '#4ade80' : carrying ? '#c4b5fd' : 'rgba(241, 248, 255, 0.85)';
      ctx.lineWidth = 1.9;
      ctx.beginPath();
      ctx.roundRect(-19.5, -14.5, 39, 29, 4.5);
      ctx.stroke();

      // Recessed Instrument Radiator & Telemetry Glass Viewport
      drawGlassViewport(ctx, -13, -7, 26, 14, 3, 'rgba(9, 18, 34, 0.86)');
      const led1Rgb = payloadDocked ? '74, 222, 128' : '56, 189, 248';
      drawAdditiveGlow(ctx, -6, -1, 8, led1Rgb, 0.55);
      ctx.fillStyle = payloadDocked ? '#4ade80' : '#38bdf8';
      ctx.fillRect(-9, -3, 6, 4);
      drawAdditiveGlow(ctx, 5.5, -1, 8, '251, 191, 36', 0.45);
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(2, -3, 7, 4);

      // Machined Grapple Fixture Pin on Top with luminous capture beacon
      ctx.strokeStyle = '#e2ecf8';
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(0, -14.5);
      ctx.lineTo(0, -22.5);
      ctx.stroke();
      const pinReady = !carrying && !payloadDocked && dTip <= 44;
      drawAdditiveGlow(
        ctx,
        0,
        -22.5,
        pinReady ? 17 : 12,
        pinReady || payloadDocked ? '74, 222, 128' : '56, 189, 248',
        pinReady ? 0.72 : 0.48
      );
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, -22.5, 3.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = pinReady ? '#4ade80' : '#38bdf8';
      ctx.lineWidth = 1.4;
      ctx.stroke();

      ctx.restore();

      if (!carrying && !payloadDocked) {
        ctx.save();
        ctx.font = '700 10px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = dTip <= 44 ? '#4ade80' : '#fde68a';
        ctx.fillText(
          dTip <= 44 ? '[按 Space] 抓取载荷' : '科学实验载荷 (4.2t)',
          payloadX,
          payloadY - 30
        );
        ctx.restore();
      }
    };

    const drawRoboticArm = () => {
      const base = getActiveBase();
      const visTipX = tipX + flexX;
      const visTipY = tipY + flexY;
      const midElbowX = elbowX + flexX * 0.42;
      const midElbowY = elbowY + flexY * 0.42;
      const sColor = getStressColor(stress);
      const sRgb = stress < 45 ? '34, 197, 94' : stress < 78 ? '245, 158, 11' : '239, 68, 68';
      const mli = getMLIPattern(ctx);
      const grain = getTitaniumPattern(ctx);

      ctx.save();

      // Helper to render a high-detail brushed titanium aerospace boom with cylindrical gradient & specular ridge
      const drawBoom = (
        x1: number,
        y1: number,
        x2: number,
        y2: number,
        bendX: number,
        bendY: number,
        label: string
      ) => {
        const cx = (x1 + x2) * 0.5 + bendX;
        const cy = (y1 + y2) * 0.5 + bendY;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.hypot(dx, dy) || 1;
        // Unit normal perpendicular to boom axis (oriented upward toward sunlight)
        let nx = -dy / len;
        let ny = dx / len;
        if (ny > 0) {
          nx = -nx;
          ny = -ny;
        }

        // Ambient cast shadow beneath curved boom
        ctx.save();
        ctx.strokeStyle = 'rgba(2, 6, 18, 0.52)';
        ctx.lineWidth = 17;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x1, y1 + 3);
        ctx.quadraticCurveTo(cx, cy + 3, x2, y2 + 3);
        ctx.stroke();

        // Transverse cylindrical titanium gradient across boom diameter
        const boomGrad = ctx.createLinearGradient(
          cx + nx * 8,
          cy + ny * 8,
          cx - nx * 8,
          cy - ny * 8
        );
        boomGrad.addColorStop(0, '#9fb6d1');
        boomGrad.addColorStop(0.22, '#ffffff');
        boomGrad.addColorStop(0.46, '#d8e6f5');
        boomGrad.addColorStop(0.76, '#506886');
        boomGrad.addColorStop(0.94, '#1f3048');
        boomGrad.addColorStop(1, '#365880'); // Earth blue albedo bounce

        // Dark machined outer casing rim
        ctx.strokeStyle = '#24364e';
        ctx.lineWidth = 15.2;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo(cx, cy, x2, y2);
        ctx.stroke();

        // Cylindrical metallic boom shell
        ctx.strokeStyle = boomGrad;
        ctx.lineWidth = 12.2;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo(cx, cy, x2, y2);
        ctx.stroke();

        // Subtle brushed titanium surface grain along boom
        if (grain) {
          ctx.strokeStyle = grain;
          ctx.lineWidth = 11.2;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.quadraticCurveTo(cx, cy, x2, y2);
          ctx.stroke();
        }

        // Crisp sunlit specular highlight ridge along top edge of cylindrical boom
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.moveTo(x1 + nx * 3.1, y1 + ny * 3.1);
        ctx.quadraticCurveTo(cx + nx * 3.1, cy + ny * 3.1, x2 + nx * 3.1, y2 + ny * 3.1);
        ctx.stroke();

        // Center structural telemetry conduit stripe (glows under high flexible stress)
        if (stress > 55) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = `rgba(${sRgb}, 0.45)`;
          ctx.lineWidth = 5.4;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.quadraticCurveTo(cx, cy, x2, y2);
          ctx.stroke();
          ctx.restore();
        }
        ctx.strokeStyle = stress > 55 ? sColor : '#475569';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo(cx, cy, x2, y2);
        ctx.stroke();

        // Gold Kapton MLI thermal cuff bands near both boom ends
        const ang = Math.atan2(dy, dx);
        for (const t of [0.14, 0.86]) {
          const u = 1 - t;
          const bx = u * u * x1 + 2 * u * t * cx + t * t * x2;
          const by = u * u * y1 + 2 * u * t * cy + t * t * y2;
          ctx.save();
          ctx.translate(bx, by);
          ctx.rotate(ang);
          ctx.fillStyle = mli ?? '#d97706';
          ctx.fillRect(-5, -6.4, 10, 12.8);
          const cuffShade = ctx.createLinearGradient(0, -6.4, 0, 6.4);
          cuffShade.addColorStop(0, 'rgba(255, 252, 220, 0.35)');
          cuffShade.addColorStop(0.28, 'rgba(255, 255, 255, 0.3)');
          cuffShade.addColorStop(0.82, 'rgba(12, 8, 2, 0.55)');
          cuffShade.addColorStop(1, 'rgba(30, 58, 100, 0.35)');
          ctx.fillStyle = cuffShade;
          ctx.fillRect(-5, -6.4, 10, 12.8);
          ctx.strokeStyle = 'rgba(254, 243, 199, 0.65)';
          ctx.lineWidth = 0.8;
          ctx.strokeRect(-5, -6.4, 10, 12.8);
          ctx.restore();
        }

        // Tiny Aerospace Label along boom midpoint
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(ang > Math.PI / 2 || ang < -Math.PI / 2 ? ang + Math.PI : ang);
        ctx.font = '700 8.5px "JetBrains Mono", monospace';
        ctx.fillStyle = '#0f172a';
        ctx.textAlign = 'center';
        ctx.fillText(label, 0, 3);
        ctx.restore();
        ctx.restore();
      };

      // Boom 1 (Shoulder -> Elbow) and Boom 2 (Elbow -> Wrist/Tip)
      drawBoom(base.x, base.y, midElbowX, midElbowY, flexX * 0.18, flexY * 0.18, 'CSS-ARM-01');
      drawBoom(midElbowX, midElbowY, visTipX, visTipY, flexX * 0.32, flexY * 0.32, 'CSS-ARM-02');

      // Motorized Rotary Joint Drums (Shoulder & Elbow) with Gold Kapton Actuator Wraps & Stress Bloom
      const drawJointDrum = (jx: number, jy: number, r: number) => {
        // Subtle stress-reactive actuator glow
        drawAdditiveGlow(ctx, jx, jy, r * 2.1, sRgb, stress > 50 ? 0.55 : 0.24);

        // Outer gold Kapton thermal actuator wrap
        ctx.save();
        ctx.beginPath();
        ctx.arc(jx, jy, r + 1.5, 0, Math.PI * 2);
        ctx.fillStyle = mli ?? '#d97706';
        ctx.fill();
        const wrapBevel = ctx.createRadialGradient(jx - r * 0.35, jy - r * 0.35, 1, jx, jy, r + 1.5);
        wrapBevel.addColorStop(0, 'rgba(255, 255, 230, 0.42)');
        wrapBevel.addColorStop(0.55, 'rgba(255, 255, 255, 0.05)');
        wrapBevel.addColorStop(1, 'rgba(12, 8, 2, 0.62)');
        ctx.fillStyle = wrapBevel;
        ctx.fill();
        ctx.strokeStyle = sColor;
        ctx.lineWidth = 2.2;
        ctx.stroke();

        // Inner brushed titanium stator housing
        const statorGrad = ctx.createRadialGradient(jx - r * 0.25, jy - r * 0.25, 1, jx, jy, r * 0.72);
        statorGrad.addColorStop(0, '#e2ecf8');
        statorGrad.addColorStop(0.55, '#64748b');
        statorGrad.addColorStop(1, '#1e293b');
        ctx.fillStyle = statorGrad;
        ctx.beginPath();
        ctx.arc(jx, jy, r * 0.68, 0, Math.PI * 2);
        ctx.fill();

        // Precision bolt circle rivets around rotary actuator
        ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
        for (let i = 0; i < 6; i++) {
          const ba = (i * Math.PI) / 3;
          ctx.beginPath();
          ctx.arc(jx + Math.cos(ba) * r * 0.52, jy + Math.sin(ba) * r * 0.52, 1.1, 0, Math.PI * 2);
          ctx.fill();
        }

        // Center optical encoder axle core
        ctx.fillStyle = '#091120';
        ctx.beginPath();
        ctx.arc(jx, jy, r * 0.26, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = sColor;
        ctx.beginPath();
        ctx.arc(jx, jy, r * 0.12, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      };

      drawJointDrum(base.x, base.y, 13);
      drawJointDrum(midElbowX, midElbowY, 11.5);

      // Symmetrical End-Effector Snare Head on Free Tip with Volumetric Laser Alignment Cone
      const tipAng = Math.atan2(visTipY - midElbowY, visTipX - midElbowX);
      const laserRgb = carrying ? '34, 197, 94' : '167, 139, 250';
      ctx.save();
      ctx.translate(visTipX, visTipY);
      ctx.rotate(tipAng);

      // Volumetric additive laser alignment cone projecting forward from snare head
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const coneLen = 62;
      const coneHalfW = 15;
      const coneGrad = ctx.createLinearGradient(11, 0, 11 + coneLen, 0);
      coneGrad.addColorStop(0, `rgba(${laserRgb}, 0.52)`);
      coneGrad.addColorStop(0.45, `rgba(${laserRgb}, 0.20)`);
      coneGrad.addColorStop(1, `rgba(${laserRgb}, 0)`);
      ctx.fillStyle = coneGrad;
      ctx.beginPath();
      ctx.moveTo(11, -2.2);
      ctx.lineTo(11 + coneLen, -coneHalfW);
      ctx.lineTo(11 + coneLen, coneHalfW);
      ctx.lineTo(11, 2.2);
      ctx.closePath();
      ctx.fill();

      // Sharp optical centerline rangefinder beam
      const beamGrad = ctx.createLinearGradient(11, 0, 11 + coneLen * 0.92, 0);
      beamGrad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
      beamGrad.addColorStop(0.5, `rgba(${laserRgb}, 0.65)`);
      beamGrad.addColorStop(1, `rgba(${laserRgb}, 0)`);
      ctx.strokeStyle = beamGrad;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(11, 0);
      ctx.lineTo(11 + coneLen * 0.92, 0);
      ctx.stroke();
      ctx.restore();

      // Optical laser emitter diode additive bloom
      drawAdditiveGlow(ctx, 11, 0, 14, laserRgb, 0.65);

      // Brushed titanium wrist housing + gold Kapton collar
      drawTitaniumModule(ctx, -9, -8.5, 18, 17, {
        radius: 4,
        rivets: false,
        rimGlow: carrying ? '#4ade80' : '#c4b5fd',
      });
      if (mli) {
        ctx.fillStyle = mli;
        ctx.fillRect(-7.5, -7.5, 5, 15);
      }

      // Symmetrical 3-jaw snare claws with bright metallic specular edge
      ctx.strokeStyle = '#e8f1fa';
      ctx.lineWidth = 2.6;
      ctx.lineCap = 'round';
      const open = carrying ? 4 : 7;
      ctx.beginPath();
      ctx.moveTo(7, -open);
      ctx.lineTo(14, -open + 2);
      ctx.moveTo(7, open);
      ctx.lineTo(14, open - 2);
      ctx.stroke();

      ctx.restore();

      // Target Reticle Crosshair controlled by user with subtle optical glow
      const pulse = 0.5 + 0.5 * Math.sin(simTime * 5);
      const outOfReach = dist(base.x, base.y, targetX, targetY) > R_MAX + 2;
      const retColor = outOfReach ? '#f59e0b' : '#a78bfa';
      const retRgb = outOfReach ? '245, 158, 11' : '167, 139, 250';

      drawAdditiveGlow(ctx, targetX, targetY, 22 + pulse * 4, retRgb, 0.34);

      ctx.strokeStyle = retColor;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(targetX, targetY, 13 + pulse * 2.5, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(targetX - 19, targetY);
      ctx.lineTo(targetX - 8, targetY);
      ctx.moveTo(targetX + 8, targetY);
      ctx.lineTo(targetX + 19, targetY);
      ctx.moveTo(targetX, targetY - 19);
      ctx.lineTo(targetX, targetY - 8);
      ctx.moveTo(targetX, targetY + 8);
      ctx.lineTo(targetX, targetY + 19);
      ctx.stroke();

      // Guide tether line from tip to target reticle when tracking
      if (dist(visTipX, visTipY, targetX, targetY) > 16) {
        ctx.strokeStyle = 'rgba(167, 139, 250, 0.38)';
        ctx.lineWidth = 1.3;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(visTipX, visTipY);
        ctx.lineTo(targetX, targetY);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.restore();
    };

    const drawPhysicsOverlay = () => {
      if (!physicsOverlay) return;
      const base = getActiveBase();
      const visTipX = tipX + flexX;
      const visTipY = tipY + flexY;

      ctx.save();

      // 1. Workspace Reachability Circle (Outer R_MAX & Inner R_MIN)
      ctx.strokeStyle = 'rgba(167, 139, 250, 0.42)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([7, 6]);
      ctx.beginPath();
      ctx.arc(base.x, base.y, R_MAX, Math.PI * 0.96, Math.PI * 2.04);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(167, 139, 250, 0.25)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(base.x, base.y, R_MIN, Math.PI, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.font = '600 10.5px "JetBrains Mono", monospace';
      ctx.fillStyle = '#c4b5fd';
      ctx.textAlign = 'center';
      ctx.fillText(
        `工作包络 R = 10.2m (基座 ${activeBaseId})`,
        clamp(base.x, -260, 260),
        Math.max(-156, base.y - R_MAX + 16)
      );

      // 2. Joint Angle Arcs & Live Readouts (θ1, θ2)
      const deg1 = Math.round((-theta1 * 180) / Math.PI);
      const deg2 = Math.round((theta2 * 180) / Math.PI);

      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(base.x, base.y, 28, Math.min(0, theta1), Math.max(0, theta1));
      ctx.stroke();
      ctx.fillStyle = '#7dd3fc';
      ctx.textAlign = 'left';
      ctx.fillText(`θ₁=${deg1}°`, base.x + 28, base.y - 16);

      ctx.strokeStyle = '#fbbf24';
      ctx.beginPath();
      ctx.arc(
        elbowX,
        elbowY,
        24,
        Math.min(theta1, theta1 + theta2),
        Math.max(theta1, theta1 + theta2)
      );
      ctx.stroke();
      ctx.fillStyle = '#fde68a';
      ctx.fillText(`θ₂=${deg2}°`, elbowX + 18, elbowY - 12);

      // 3. Real-Time Inertia Swing / Flex Force Vector at Payload COM
      const flexMag = Math.hypot(flexX, flexY);
      if (flexMag > 1.8) {
        const originXVec = carrying ? payloadX : visTipX;
        const originYVec = carrying ? payloadY : visTipY;
        const fColor = getStressColor(stress);
        drawVectorArrow(
          ctx,
          originXVec,
          originYVec,
          originXVec + flexX * 3.2,
          originYVec + flexY * 3.2,
          fColor,
          `F_inertia ${Math.round(stress)}%`,
          2.4
        );
      }

      // 4. Obstacle Safety Envelopes
      for (const obs of cfg.obstacles) {
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.65)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.roundRect(
          obs.x - obs.radius - 8,
          obs.topY - obs.radius - 4,
          (obs.radius + 8) * 2,
          obs.baseY - obs.topY + obs.radius + 8,
          obs.radius + 6
        );
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.restore();
    };

    const render = () => {
      starfield.draw(ctx, viewW, viewH, simTime, -simTime * 2.5, 0);
      drawEarthHorizon(ctx, viewW, viewH, simTime, {
        yRatio: 1.8,
        radiusScale: 1.2,
        sunPhase: 0.35,
        darken: 0.22,
      });
      drawSunLensFlare(ctx, viewW * 0.13, viewH * 0.16, 26, 0.72);

      ctx.save();
      ctx.translate(originX, originY);
      ctx.scale(scale, scale);

      drawStationBackbone();
      drawObstacles();
      drawPayload();
      drawRoboticArm();
      particles.draw(ctx);
      drawPhysicsOverlay();

      ctx.restore();
    };

    // ---- Main Loop ----
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
          dragging = false;
        }
      },
      setPhysicsOverlay(enabled: boolean) {
        physicsOverlay = enabled;
      },
    };
  },
};
