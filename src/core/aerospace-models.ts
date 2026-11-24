import { clamp } from './canvas-utils';
import { drawAdditiveGlow, getMLIPattern, getTitaniumPattern } from './materials';
import { getModelSprite } from './model-sprites';

export interface FeitianAstronautOptions {
  x: number;
  y: number;
  scale?: number;
  facing?: 1 | -1;
  tilt?: number;
  simTime?: number;
  thermalMode?: 'cool' | 'balance' | 'heat';
  suitTemp?: number;
  grabbing?: boolean;
  exercising?: boolean;
  posePhase?: number;
  showAura?: boolean;
}

/**
 * High-Craft 3D PBR Feitian EVA Spacesuit Astronaut Renderer:
 * Uses studio-raymarched 3D transparent RGBA sprite (`feitian-eva.png`) with true 3D shading,
 * 24K reflective gold Earth-limb visor, crinkled Kapton MLI backpack, and Feitian stripes,
 * paired with live gameplay telemetry overlays (thermal halo, PLSS cooling LED, chest DCM gauge).
 */
export function drawFeitianAstronaut3D(
  ctx: CanvasRenderingContext2D,
  opts: FeitianAstronautOptions
): void {
  const scale = opts.scale ?? 1;
  const f = opts.facing ?? 1;
  const tilt = opts.tilt ?? 0;
  const simTime = opts.simTime ?? 0;
  const thermalMode = opts.thermalMode ?? 'balance';
  const suitTemp = opts.suitTemp ?? 22;
  const grabbing = opts.grabbing ?? false;
  const exercising = opts.exercising ?? false;
  const posePhase = opts.posePhase ?? 0;

  const astroImg = getModelSprite('feitian-eva');
  if (astroImg) {
    const exBob = exercising ? Math.sin(simTime * 10 + posePhase) * 2.2 : 0;
    const exTilt = exercising ? Math.sin(simTime * 9 + posePhase) * 0.08 : 0;
    const grabPitch = grabbing ? 0.08 * f : 0;
    const breathScaleY = exercising ? 1 + Math.sin(simTime * 11 + posePhase) * 0.035 : 1;

    ctx.save();
    ctx.translate(opts.x, opts.y + exBob);
    ctx.rotate(tilt + exTilt + grabPitch);
    ctx.scale(scale * f, scale * breathScaleY);

    // Optional thermal warning ring (zero gradient/shadowBlur cost)
    if (opts.showAura && (suitTemp > 29 || suitTemp < 15)) {
      const hot = suitTemp > 29;
      ctx.strokeStyle = hot ? 'rgba(239, 68, 68, 0.65)' : 'rgba(56, 189, 248, 0.65)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, -2, 31, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Draw studio-raymarched 3D Feitian EVA sprite aligned to legacy envelope (-31..31, -33..29)
    ctx.drawImage(astroImg, -31, -33, 62, 62);

    // Live PLSS Backpack Thermal Status LED overlay
    const ledHex =
      thermalMode === 'cool' ? '#38bdf8' : thermalMode === 'heat' ? '#f97316' : '#22c55e';
    ctx.fillStyle = ledHex;
    ctx.fillRect(-12.2, -7.2, 3.6, 2.8);

    // Live Chest DCM Telemetry Bar (reflects live suitTemp status cleanly)
    const tempHex = suitTemp > 30 ? '#ef4444' : suitTemp < 14 ? '#38bdf8' : '#22c55e';
    ctx.fillStyle = tempHex;
    ctx.fillRect(5.2, -0.5, 4.4, 2.2);

    ctx.restore();
    return;
  }

  const grain = getTitaniumPattern(ctx);

  ctx.save();
  ctx.translate(opts.x, opts.y);
  ctx.rotate(tilt);
  ctx.scale(scale, scale);

  // Optional thermal warning halo
  if (opts.showAura && (suitTemp > 29 || suitTemp < 15)) {
    const hot = suitTemp > 29;
    drawAdditiveGlow(
      ctx,
      0,
      0,
      36 + Math.sin(simTime * 10) * 4,
      hot ? '239, 68, 68' : '56, 189, 248',
      0.48
    );
  }

  // ---- 1. PLSS Life-Support Backpack + UHF Whip Antenna ----
  const bx = f > 0 ? -17.5 : 6.5;
  ctx.save();
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(bx + 5, -13);
  ctx.lineTo(bx + 5 - f * 2, -25);
  ctx.stroke();
  ctx.fillStyle = '#38bdf8';
  ctx.beginPath();
  ctx.arc(bx + 5 - f * 2, -25.5, 1.5, 0, Math.PI * 2);
  ctx.fill();

  const packGrad = ctx.createLinearGradient(bx, -14, bx + 11, 10);
  packGrad.addColorStop(0, '#f8fafc');
  packGrad.addColorStop(0.35, '#cbd5e1');
  packGrad.addColorStop(0.78, '#64748b');
  packGrad.addColorStop(1, '#334155');
  ctx.fillStyle = packGrad;
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.roundRect(bx, -14, 11, 23, 3.2);
  ctx.fill();
  ctx.stroke();

  // Backpack radiator louver grooves
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.42)';
  ctx.lineWidth = 1;
  for (let ly = -3; ly <= 5; ly += 3) {
    ctx.beginPath();
    ctx.moveTo(bx + 2, ly);
    ctx.lineTo(bx + 9, ly);
    ctx.stroke();
  }

  // Backpack thermal status LED
  const ledRgb =
    thermalMode === 'cool' ? '56, 189, 248' : thermalMode === 'heat' ? '249, 115, 22' : '34, 197, 94';
  const ledHex =
    thermalMode === 'cool' ? '#38bdf8' : thermalMode === 'heat' ? '#f97316' : '#22c55e';
  const ledX = f > 0 ? bx + 2.5 : bx + 3;
  drawAdditiveGlow(ctx, ledX + 2.8, -8, 8, ledRgb, 0.55);
  ctx.fillStyle = ledHex;
  ctx.fillRect(ledX, -10, 5.5, 3.6);
  ctx.restore();

  // ---- 2. Articulated Legs + Knee Bellows + Sculpted Boots ----
  const legSwing = exercising ? Math.sin(simTime * 10 + posePhase) * 4.5 : 0;
  const drawLeg = (sx: number, kx: number, ky: number, fx: number, fy: number) => {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(sx, 8);
    ctx.lineTo(kx, ky);
    ctx.lineTo(fx, fy);
    ctx.stroke();

    ctx.strokeStyle = '#eef5fc';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(sx, 8);
    ctx.lineTo(kx, ky);
    ctx.lineTo(fx, fy);
    ctx.stroke();

    // Corrugated knee joint bellows ring
    ctx.fillStyle = '#94a3b8';
    ctx.beginPath();
    ctx.arc(kx, ky, 2.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 0.8;
    ctx.stroke();

    // Sculpted metallic EVA boot
    const bootGrad = ctx.createRadialGradient(fx - f * 1, fy - 1, 0.5, fx, fy + 1, 4.2);
    bootGrad.addColorStop(0, '#e2e8f0');
    bootGrad.addColorStop(0.55, '#64748b');
    bootGrad.addColorStop(1, '#1e293b');
    ctx.fillStyle = bootGrad;
    ctx.beginPath();
    ctx.ellipse(fx + f * 1.2, fy + 1.5, 4.2, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  drawLeg(-3.2, -5.5 * f - legSwing * 0.4, 13.5, -6.5 * f - legSwing * 0.7, 19);
  drawLeg(3.2, 4 * f + legSwing * 0.4, 13, 5.5 * f + legSwing * 0.7, 18);

  // ---- 3. Sculpted Hard Upper Torso (HUT) + Shoulder Bearings + DCM Pack ----
  const torsoGrad = ctx.createLinearGradient(-10, -10, 10, 12);
  torsoGrad.addColorStop(0, '#ffffff');
  torsoGrad.addColorStop(0.28, '#eef5fc');
  torsoGrad.addColorStop(0.68, '#a6bcd4');
  torsoGrad.addColorStop(0.92, '#475f7d');
  torsoGrad.addColorStop(1, '#5882b0');
  ctx.fillStyle = torsoGrad;
  ctx.strokeStyle = '#3f536b';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.roundRect(-10, -9.5, 20, 21, 6.2);
  ctx.fill();
  ctx.save();
  ctx.clip();
  if (grain) {
    ctx.fillStyle = grain;
    ctx.fillRect(-10, -9.5, 20, 21);
  }
  // Curved Feitian crimson & aerospace blue mission stripes
  ctx.fillStyle = '#dc2626';
  ctx.fillRect(-9, -4.5, 18, 2.3);
  ctx.fillStyle = '#0284c7';
  ctx.fillRect(-9, -1.8, 18, 1.4);
  ctx.restore();
  ctx.stroke();

  // Metallic waist & shoulder scye bearing rings
  ctx.fillStyle = '#64748b';
  ctx.fillRect(-9, 8.2, 18, 2);

  // Beveled DCM Chest Control Box with glowing thermal bar
  const tempStripColor = suitTemp > 30 ? '#ef4444' : suitTemp < 14 ? '#38bdf8' : '#22c55e';
  const tempRgb = suitTemp > 30 ? '239, 68, 68' : suitTemp < 14 ? '56, 189, 248' : '34, 197, 94';
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.roundRect(-6.5, 1.2, 13, 6, 1.6);
  ctx.fill();
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 0.8;
  ctx.stroke();
  drawAdditiveGlow(ctx, 0, 4.2, 7.5, tempRgb, 0.45);
  ctx.fillStyle = tempStripColor;
  ctx.fillRect(-4.8, 2.8, 9.6, 2.6);

  // ---- 4. Articulated Reaching Arm + Red Disconnect Cuff + Pressurized Glove ----
  const armWave = exercising ? Math.sin(simTime * 11 + posePhase) * 4.5 : 0;
  const elbowX = 9.5 * f;
  const elbowY = -2.2 + armWave * 0.4;
  const handX = 15 * f;
  const handY = (grabbing ? 2.2 : -1.2) + armWave;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 5.8;
  ctx.beginPath();
  ctx.moveTo(4.8 * f, -4.2);
  ctx.lineTo(elbowX, elbowY);
  ctx.lineTo(handX, handY);
  ctx.stroke();

  ctx.strokeStyle = '#eef5fc';
  ctx.lineWidth = 4.2;
  ctx.beginPath();
  ctx.moveTo(4.8 * f, -4.2);
  ctx.lineTo(elbowX, elbowY);
  ctx.lineTo(handX, handY);
  ctx.stroke();
  ctx.restore();

  // Red wrist cuff + sculpted glove
  ctx.fillStyle = '#dc2626';
  ctx.beginPath();
  ctx.arc(handX - 2.4 * f, (elbowY + handY) * 0.5, 2.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#cbd5e1';
  ctx.beginPath();
  ctx.arc(handX, handY, 2.6, 0, Math.PI * 2);
  ctx.fill();

  // ---- 5. Spherical Helmet + Side Floodlight + 24K Reflective Gold Visor ----
  const helmGrad = ctx.createRadialGradient(-3.2 * f, -20.5, 1.5, 0, -16, 11.2);
  helmGrad.addColorStop(0, '#ffffff');
  helmGrad.addColorStop(0.45, '#e6f0fa');
  helmGrad.addColorStop(0.82, '#7d95b2');
  helmGrad.addColorStop(1, '#3b5d85');
  ctx.fillStyle = helmGrad;
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(0, -16, 10.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Side helmet spotlight pod
  drawAdditiveGlow(ctx, 1.5 * f, -23.5, 8, '224, 242, 254', 0.45);
  ctx.fillStyle = '#e0f2fe';
  ctx.beginPath();
  ctx.roundRect(-2 * f, -25, 4.5, 2.8, 1);
  ctx.fill();

  // Reflective 24K gold sun visor with Earth-limb reflection & crescent glare
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(3.6 * f, -16, 6.6, 7.1, 0, 0, Math.PI * 2);
  const visorGrad = ctx.createRadialGradient(5.2 * f, -19.5, 1.2, 3.2 * f, -15.5, 8.2);
  visorGrad.addColorStop(0, '#fffbeb');
  visorGrad.addColorStop(0.24, '#fde047');
  visorGrad.addColorStop(0.58, '#d97706');
  visorGrad.addColorStop(0.86, '#78350f');
  visorGrad.addColorStop(1, '#451a03');
  ctx.fillStyle = visorGrad;
  ctx.fill();
  ctx.clip();

  ctx.strokeStyle = 'rgba(125, 211, 252, 0.58)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(3.6 * f, -9.2, 6.4, Math.PI * 1.15, Math.PI * 1.85);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.lineWidth = 1.7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(
    3.2 * f,
    -15.8,
    4.6,
    f > 0 ? -Math.PI * 0.62 : -Math.PI * 0.85,
    f > 0 ? -Math.PI * 0.15 : -Math.PI * 0.38
  );
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = 'rgba(254, 243, 199, 0.78)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(3.6 * f, -16, 6.6, 7.1, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}

export interface RoboticArm3DOptions {
  baseX: number;
  baseY: number;
  elbowX: number;
  elbowY: number;
  tipX: number;
  tipY: number;
  boomThickness?: number;
  jointRadius?: number;
  effectorSize?: number;
  bend1X?: number;
  bend1Y?: number;
  bend2X?: number;
  bend2Y?: number;
  stress?: number;
  carrying?: boolean;
  showLaserCone?: boolean;
  boomLabels?: [string, string];
}

/**
 * Modular Studio-Lit 3D Space Robotic Arm Renderer (Tiangong CSS Core & Mengtian Arm):
 * - Articulated 3D PBR cylindrical boom barrels with Kapton gold cuffs & external umbilical cables
 * - Harmonic-drive rotary actuator drums (`robot-arm-joint.png`) with stress-reactive encoder rings
 * - Symmetrical End-Effector snare capture head (`robot-arm-effector.png`) + optional laser alignment cone
 */
export function drawRoboticArm3D(
  ctx: CanvasRenderingContext2D,
  opts: RoboticArm3DOptions
): void {
  const boomImg = getModelSprite('robot-arm-boom');
  const jointImg = getModelSprite('robot-arm-joint');
  const effImg = getModelSprite('robot-arm-effector');

  const boomH = (opts.boomThickness ?? 18) * 1.78;
  const jR = opts.jointRadius ?? 15;
  const effSz = opts.effectorSize ?? 34;
  const stress = opts.stress ?? 0;
  const sColor = stress < 45 ? '#22c55e' : stress < 78 ? '#f59e0b' : '#ef4444';
  const sRgb = stress < 45 ? '34, 197, 94' : stress < 78 ? '245, 158, 11' : '239, 68, 68';

  const drawSegment3D = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    bx = 0,
    by = 0,
    label?: string
  ) => {
    const drawHalf = (ax: number, ay: number, ex: number, ey: number) => {
      const dx = ex - ax;
      const dy = ey - ay;
      const len = Math.hypot(dx, dy);
      if (len < 3) return;
      const ang = Math.atan2(dy, dx);
      ctx.save();
      ctx.translate(ax, ay);
      ctx.rotate(ang);
      if (ang > Math.PI * 0.5 || ang < -Math.PI * 0.5) {
        ctx.scale(1, -1);
      }
      if (boomImg) {
        ctx.drawImage(boomImg, -1, -boomH * 0.5, len + 2, boomH);
      } else {
        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(0, -boomH * 0.24, len, boomH * 0.48);
      }
      ctx.restore();
    };

    const bendMag = Math.hypot(bx, by);
    if (bendMag > 1.2) {
      const mx = (x1 + x2) * 0.5 + bx;
      const my = (y1 + y2) * 0.5 + by;
      drawHalf(x1, y1, mx, my);
      drawHalf(mx, my, x2, y2);
    } else {
      drawHalf(x1, y1, x2, y2);
    }

    const cx = (x1 + x2) * 0.5 + bx;
    const cy = (y1 + y2) * 0.5 + by;
    if (stress > 55) {
      ctx.strokeStyle = `rgba(${sRgb}, 0.55)`;
      ctx.lineWidth = Math.max(2.5, (opts.boomThickness ?? 18) * 0.22);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo(cx, cy, x2, y2);
      ctx.stroke();
    }

    if (label && (opts.boomThickness ?? 18) >= 14) {
      const ang = Math.atan2(y2 - y1, x2 - x1);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ang > Math.PI / 2 || ang < -Math.PI / 2 ? ang + Math.PI : ang);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
      ctx.fillRect(-27, -6.5, 54, 12.5);
      ctx.font = '700 8px "JetBrains Mono", monospace';
      ctx.fillStyle = stress > 55 ? '#fde68a' : '#7dd3fc';
      ctx.textAlign = 'center';
      ctx.fillText(label, 0, 2.5);
      ctx.restore();
    }
  };

  ctx.save();
  drawSegment3D(
    opts.baseX,
    opts.baseY,
    opts.elbowX,
    opts.elbowY,
    opts.bend1X ?? 0,
    opts.bend1Y ?? 0,
    opts.boomLabels?.[0]
  );
  drawSegment3D(
    opts.elbowX,
    opts.elbowY,
    opts.tipX,
    opts.tipY,
    opts.bend2X ?? 0,
    opts.bend2Y ?? 0,
    opts.boomLabels?.[1]
  );

  // Motorized Harmonic-Drive 3D Rotary Joint Drums (zero additive/shadowBlur)
  const drawJoint = (jx: number, jy: number, r: number) => {
    if (jointImg) {
      ctx.drawImage(jointImg, jx - r, jy - r, r * 2, r * 2);
      ctx.strokeStyle = sColor;
      ctx.lineWidth = Math.max(1.2, r * 0.13);
      ctx.beginPath();
      ctx.arc(jx, jy, r * 0.76, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = sColor;
      ctx.beginPath();
      ctx.arc(jx, jy, Math.max(1.5, r * 0.14), 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = '#f5a623';
      ctx.beginPath();
      ctx.arc(jx, jy, r * 0.72, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  drawJoint(opts.baseX, opts.baseY, jR);
  drawJoint(opts.elbowX, opts.elbowY, jR * 0.88);

  // Symmetrical End-Effector Snare Head + flat translucent laser cone ('source-over')
  const tipAng = Math.atan2(opts.tipY - opts.elbowY, opts.tipX - opts.elbowX);
  const carrying = opts.carrying ?? false;
  const laserRgb = carrying ? '34, 197, 94' : '167, 139, 250';

  ctx.save();
  ctx.translate(opts.tipX, opts.tipY);
  ctx.rotate(tipAng);

  if (opts.showLaserCone) {
    const startX = effSz * 0.36;
    const coneLen = 56;
    const coneHalfW = 13;
    ctx.fillStyle = `rgba(${laserRgb}, 0.14)`;
    ctx.beginPath();
    ctx.moveTo(startX, -2.5);
    ctx.lineTo(startX + coneLen, -coneHalfW);
    ctx.lineTo(startX + coneLen, coneHalfW);
    ctx.lineTo(startX, 2.5);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = `rgba(${laserRgb}, 0.72)`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(startX, 0);
    ctx.lineTo(startX + coneLen * 0.88, 0);
    ctx.stroke();
  }

  if (effImg) {
    ctx.drawImage(effImg, -effSz * 0.44, -effSz * 0.5, effSz, effSz);
    if (carrying) {
      ctx.strokeStyle = '#4ade80';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(effSz * 0.34, 0, effSz * 0.24, -Math.PI * 0.45, Math.PI * 0.45);
      ctx.stroke();
    }
  } else {
    ctx.fillStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.arc(0, 0, effSz * 0.32, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
  ctx.restore();
}

export interface SciencePayloadOptions {
  x: number;
  y: number;
  tilt?: number;
  docked?: boolean;
  carrying?: boolean;
  readyToGrab?: boolean;
}

/**
 * High-Craft 3D Extravehicular 4.2t Science Experiment Payload Module:
 * - Studio-raymarched 3D PBR payload sprite (`science-payload.png`) with titanium truss,
 *   crinkled Kapton MLI panels, radiator louvers, sapphire spectrometer lens & PDGF grapple shaft
 * - Layered with dynamic optical capture status LED & grapple-ready glow ring
 */
export function drawSciencePayload3D(
  ctx: CanvasRenderingContext2D,
  opts: SciencePayloadOptions
): void {
  const payloadImg = getModelSprite('science-payload');
  if (payloadImg) {
    ctx.save();
    ctx.translate(opts.x, opts.y);
    if (opts.tilt) ctx.rotate(opts.tilt);

    ctx.drawImage(payloadImg, -28, -32, 56, 45);

    if (opts.docked || opts.carrying) {
      ctx.strokeStyle = opts.docked ? '#4ade80' : '#c4b5fd';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.roundRect(-24, -18, 48, 30, 5);
      ctx.stroke();
    }

    // Crisp Top Grapple Fixture Lock Pin Indicator (zero gradient/shadowBlur)
    ctx.fillStyle = opts.readyToGrab ? '#bbf7d0' : '#e0f2fe';
    ctx.beginPath();
    ctx.arc(0, -24, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = opts.readyToGrab || opts.docked ? '#4ade80' : '#38bdf8';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    ctx.restore();
    return;
  }

  const mli = getMLIPattern(ctx);
  const grain = getTitaniumPattern(ctx);
  const rimCol = opts.docked ? '#4ade80' : opts.carrying ? '#c4b5fd' : 'rgba(241, 248, 255, 0.88)';

  ctx.save();
  ctx.translate(opts.x, opts.y);
  if (opts.tilt) ctx.rotate(opts.tilt);

  // Ambient drop shadow
  ctx.fillStyle = 'rgba(2, 6, 18, 0.55)';
  ctx.beginPath();
  ctx.roundRect(-21, -13, 44, 32, 6);
  ctx.fill();

  // Outer machined brushed-titanium truss chassis
  const hullGrad = ctx.createLinearGradient(-22, -16, -22, 16);
  hullGrad.addColorStop(0, '#eef5fc');
  hullGrad.addColorStop(0.28, '#ffffff');
  hullGrad.addColorStop(0.65, '#8fa6c2');
  hullGrad.addColorStop(1, '#2a3c55');
  ctx.fillStyle = hullGrad;
  ctx.beginPath();
  ctx.roundRect(-22, -16, 44, 32, 5.5);
  ctx.fill();

  if (grain) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(-22, -16, 44, 32, 5.5);
    ctx.clip();
    ctx.fillStyle = grain;
    ctx.fillRect(-22, -16, 44, 32);
    ctx.restore();
  }

  // Crinkled real 24K gold Kapton MLI thermal wrap inset
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(-19, -13, 38, 26, 4);
  ctx.clip();
  ctx.fillStyle = mli ?? '#d97706';
  ctx.fillRect(-19, -13, 38, 26);
  const foilShade = ctx.createLinearGradient(-19, -13, 19, 13);
  foilShade.addColorStop(0, 'rgba(255, 252, 225, 0.3)');
  foilShade.addColorStop(0.45, 'rgba(255, 255, 255, 0.08)');
  foilShade.addColorStop(0.85, 'rgba(12, 8, 2, 0.45)');
  foilShade.addColorStop(1, 'rgba(30, 58, 100, 0.3)');
  ctx.fillStyle = foilShade;
  ctx.fillRect(-19, -13, 38, 26);

  // Side white thermal radiator louver panel
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(6, -11, 11, 22);
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.45)';
  ctx.lineWidth = 0.9;
  for (let ly = -8; ly <= 8; ly += 3.5) {
    ctx.beginPath();
    ctx.moveTo(7.5, ly);
    ctx.lineTo(15.5, ly);
    ctx.stroke();
  }
  ctx.restore();

  // Outer status rim & corner rivets
  ctx.strokeStyle = rimCol;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.roundRect(-21.5, -15.5, 43, 31, 5);
  ctx.stroke();

  // Recessed dark optical spectrometer aperture + dual telemetry LEDs
  ctx.fillStyle = '#071020';
  ctx.beginPath();
  ctx.roundRect(-16, -9, 20, 18, 3);
  ctx.fill();
  ctx.strokeStyle = 'rgba(148, 197, 255, 0.55)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Optical lens turret ring
  const lensGrad = ctx.createRadialGradient(-9.5, -1.5, 0.5, -8.5, -0.5, 5.5);
  lensGrad.addColorStop(0, '#bae6fd');
  lensGrad.addColorStop(0.45, '#0284c7');
  lensGrad.addColorStop(1, '#082f49');
  ctx.fillStyle = lensGrad;
  ctx.beginPath();
  ctx.arc(-8.5, -0.5, 4.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 1;
  ctx.stroke();

  const led1Rgb = opts.docked ? '74, 222, 128' : '56, 189, 248';
  drawAdditiveGlow(ctx, 0.5, -3.5, 7, led1Rgb, 0.55);
  ctx.fillStyle = opts.docked ? '#4ade80' : '#38bdf8';
  ctx.fillRect(-1.5, -5.2, 4, 3);
  drawAdditiveGlow(ctx, 0.5, 3.2, 6, '251, 191, 36', 0.45);
  ctx.fillStyle = '#fbbf24';
  ctx.fillRect(-1.5, 1.8, 4, 3);

  // Machined Top Grapple Fixture Base & Pin
  ctx.fillStyle = '#cbd5e1';
  ctx.fillRect(-6, -18, 12, 3);
  ctx.strokeStyle = '#e2ecf8';
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.moveTo(0, -16.5);
  ctx.lineTo(0, -23.5);
  ctx.stroke();

  drawAdditiveGlow(
    ctx,
    0,
    -23.5,
    opts.readyToGrab ? 18 : 12,
    opts.readyToGrab || opts.docked ? '74, 222, 128' : '56, 189, 248',
    opts.readyToGrab ? 0.78 : 0.48
  );
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(0, -23.5, 3.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = opts.readyToGrab ? '#4ade80' : '#38bdf8';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  ctx.restore();
}

export interface DebrisModelOptions {
  x: number;
  y: number;
  radius: number;
  angle: number;
  seed: number;
  danger?: boolean;
}

/**
 * High-Craft Derelict Orbital Satellite / Rocket Debris Fragment Renderer:
 * Combines scorched titanium plating, torn crinkled gold Kapton foil, broken solar wing shards,
 * exposed structural truss struts, and crisp orbital rim lighting.
 */
export function drawDebrisModel3D(
  ctx: CanvasRenderingContext2D,
  opts: DebrisModelOptions
): void {
  const r = Math.max(8, opts.radius);
  const variant = Math.abs(Math.floor(opts.seed * 13)) % 3;
  const mli = getMLIPattern(ctx);
  const wingImg = getModelSprite('solar-wing');
  const rimCol = opts.danger ? '#fb7185' : '#cbd5e1';

  ctx.save();
  ctx.translate(opts.x, opts.y);
  ctx.rotate(opts.angle);

  if (variant === 0) {
    // Variant 0: Derelict broken micro-satellite bus with snapped solar wing stub
    if (wingImg) {
      ctx.save();
      ctx.rotate(-0.22);
      ctx.drawImage(wingImg, -r * 1.15, -r * 0.28, r * 1.1, r * 0.42);
      ctx.restore();
      ctx.save();
      ctx.rotate(0.18);
      ctx.drawImage(wingImg, r * 0.15, -r * 0.18, r * 0.85, r * 0.36);
      ctx.restore();
    } else {
      ctx.fillStyle = '#1e3a5f';
      ctx.fillRect(-r * 1.1, -r * 0.25, r * 2.1, r * 0.5);
    }

    // Torn gold Kapton bus core (flat fill, zero gradient)
    ctx.fillStyle = '#475569';
    ctx.beginPath();
    ctx.roundRect(-r * 0.48, -r * 0.44, r * 0.96, r * 0.88, 3);
    ctx.fill();

    if (mli) {
      ctx.fillStyle = mli;
      ctx.beginPath();
      ctx.roundRect(-r * 0.36, -r * 0.32, r * 0.52, r * 0.64, 2);
      ctx.fill();
    }

    ctx.strokeStyle = rimCol;
    ctx.lineWidth = opts.danger ? 1.5 : 1.1;
    ctx.beginPath();
    ctx.roundRect(-r * 0.48, -r * 0.44, r * 0.96, r * 0.88, 3);
    ctx.stroke();

    // Small broken parabolic antenna dish
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(r * 0.35, -r * 0.45, r * 0.28, Math.PI * 0.2, Math.PI * 1.1);
    ctx.stroke();
  } else if (variant === 1) {
    // Variant 1: Torn upper-stage titanium fuselage fragment with exposed struts
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-r * 0.8, -r * 0.35);
    ctx.lineTo(r * 0.85, -r * 0.15);
    ctx.moveTo(-r * 0.6, r * 0.4);
    ctx.lineTo(r * 0.75, r * 0.25);
    ctx.stroke();

    ctx.fillStyle = '#64748b';
    ctx.beginPath();
    ctx.moveTo(-r * 0.75, -r * 0.4);
    ctx.lineTo(r * 0.45, -r * 0.52);
    ctx.lineTo(r * 0.78, 0.1 * r);
    ctx.lineTo(r * 0.28, r * 0.58);
    ctx.lineTo(-r * 0.65, r * 0.36);
    ctx.closePath();
    ctx.fill();

    if (mli) {
      ctx.fillStyle = mli;
      ctx.fillRect(-r * 0.2, -r * 0.35, r * 0.42, r * 0.7);
    }

    ctx.strokeStyle = rimCol;
    ctx.lineWidth = opts.danger ? 1.5 : 1.1;
    ctx.stroke();
  } else {
    // Variant 2: Sheared GaAs solar array wing shard (zero per-debris clip())
    if (wingImg) {
      ctx.drawImage(wingImg, -r * 0.9, -r * 0.42, r * 1.8, r * 0.84);
    } else {
      ctx.fillStyle = '#1e3a8a';
      ctx.fillRect(-r * 0.9, -r * 0.42, r * 1.8, r * 0.84);
    }

    ctx.strokeStyle = opts.danger ? '#fb7185' : '#93c5fd';
    ctx.lineWidth = opts.danger ? 1.5 : 1.1;
    ctx.strokeRect(-r * 0.9, -r * 0.42, r * 1.8, r * 0.84);
  }

  ctx.restore();
}

export interface ControlGyroscopeOptions {
  cx: number;
  cy: number;
  radius: number;
  rotorAngle: number;
  gimbalTiltRad: number;
  rpmNorm: number;
  simTime: number;
}

/**
 * Precision Machined Aerospace Control Moment Gyroscope (CMG) Renderer:
 * - Outer brushed titanium mounting bezel with 12 socket cap screws & degree vernier scale
 * - Articulated middle gimbal ring tilting smoothly in pseudo-3D
 * - Spun-gold & steel high-speed flywheel rotor with optical motion-blur shimmer
 */
export function drawControlGyroscope3D(
  ctx: CanvasRenderingContext2D,
  opts: ControlGyroscopeOptions
): void {
  const { cx, cy, radius: r, rotorAngle, gimbalTiltRad, rpmNorm } = opts;
  const tiltScale = clamp(Math.cos(gimbalTiltRad), 0.36, 1);

  ctx.save();
  ctx.translate(cx, cy);

  // Outer fixed titanium gimbal housing (flat stroke, zero gradient)
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = Math.max(5, r * 0.14);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.9, 0, Math.PI * 2);
  ctx.stroke();

  // Vernier tick ring + 12 socket bolts
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6;
    const bx = Math.cos(a) * r * 0.9;
    const by = Math.sin(a) * r * 0.9;
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(bx, by, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }

  // Articulated Inner Gimbal Ring (foreshortened by gimbalTiltRad)
  ctx.save();
  ctx.scale(1, tiltScale);

  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = Math.max(4, r * 0.1);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.72, 0, Math.PI * 2);
  ctx.stroke();

  // Spun-brass / gold high-speed flywheel rotor (flat concentric rings, zero radial gradient)
  const rotorR = r * 0.56;
  ctx.fillStyle = '#d97706';
  ctx.beginPath();
  ctx.arc(0, 0, rotorR, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f59e0b';
  ctx.beginPath();
  ctx.arc(0, 0, rotorR * 0.72, 0, Math.PI * 2);
  ctx.fill();

  // Rotor radial machined spokes & optical encoder markings
  ctx.save();
  ctx.rotate(rotorAngle);
  for (let s = 0; s < 6; s++) {
    const sa = (s * Math.PI) / 3;
    ctx.strokeStyle = s % 2 === 0 ? 'rgba(255, 251, 235, 0.72)' : 'rgba(15, 23, 42, 0.48)';
    ctx.lineWidth = Math.max(2, r * 0.06);
    ctx.beginPath();
    ctx.moveTo(Math.cos(sa) * rotorR * 0.28, Math.sin(sa) * rotorR * 0.28);
    ctx.lineTo(Math.cos(sa) * rotorR * 0.84, Math.sin(sa) * rotorR * 0.84);
    ctx.stroke();
  }
  ctx.restore();

  // High-RPM kinetic rim shimmer
  if (rpmNorm > 0.12) {
    ctx.strokeStyle = `rgba(253, 224, 71, ${(0.25 + rpmNorm * 0.55).toFixed(2)})`;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(0, 0, rotorR * 0.92, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Central sapphire/titanium rotor axle hub
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.arc(0, 0, rotorR * 0.28, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 1.6;
  ctx.stroke();

  ctx.fillStyle = '#bae6fd';
  ctx.beginPath();
  ctx.arc(0, 0, rotorR * 0.11, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  // Left & Right Brass Gimbal Trunnion Bearings
  for (const sx of [-r * 0.84, r * 0.84]) {
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.roundRect(sx - 4, -5, 8, 10, 2);
    ctx.fill();
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.restore();
}
