import * as THREE from 'three';
import { CURB_Z } from './constants';
import type { Level } from './level';
import { normalizeAngle, obbCorners, vehicleOBB, type VehicleState } from './physics';
import type { Placement } from './scoring';
import { rearOverhang, type VehicleSpec } from './vehicles';

export interface TutorialContext {
  vs: VehicleState;
  spec: VehicleSpec;
  level: Level;
  gear: 'D' | 'N' | 'R';
  maxSteer: number;
  placement: Placement;
  rearSensor: number | null;
  hits: number;
}

/** Context plus the lesson's plan (fixed once the car is lined up). */
interface LessonContext extends TutorialContext {
  /** Heading (radians) to reverse to before straightening. */
  targetAngle: number;
}

interface Step {
  title: string;
  /** Instruction; may contain <kbd> markup. */
  text: string;
  /** Live feedback line (null hides it). */
  status?(c: LessonContext): string | null;
  /** A warning shown in place of the status when the driver is going wrong. */
  warning?(c: LessonContext): string | null;
  /** Step is complete once this holds for a moment. A step without a check waits for Enter. */
  check?(c: LessonContext): boolean;
  /** Pose (rear-axle state) to draw as a ghost footprint. */
  ghost?(c: LessonContext): VehicleState | null;
}

export interface TutorialView {
  index: number;
  count: number;
  title: string;
  text: string;
  status: string | null;
  warning: string | null;
}

const deg = (rad: number): number => Math.round((rad * 180) / Math.PI);

/** The parked car directly ahead of the space (its rear bumper bounds the space). */
function frontCar(level: Level): { minX: number; leftZ: number } | null {
  let best: { minX: number; leftZ: number } | null = null;
  for (const p of level.parked) {
    if (p.state.z <= 0) continue;
    const corners = obbCorners(p.obb);
    const minX = Math.min(...corners.map((c) => c.x));
    const leftZ = Math.min(...corners.map((c) => c.z));
    if (minX < level.spot.frontX - 0.2) continue;
    if (!best || minX < best.minX) best = { minX, leftZ };
  }
  return best;
}

function bounds(c: TutorialContext): { minX: number; maxZ: number } {
  const corners = obbCorners(vehicleOBB(c.vs, c.spec));
  return {
    minX: Math.min(...corners.map((p) => p.x)),
    maxZ: Math.max(...corners.map((p) => p.z)),
  };
}

const stopped = (c: TutorialContext): boolean => Math.abs(c.vs.speed) < 0.05;
const heading = (c: TutorialContext): number => normalizeAngle(c.vs.heading);

/** Pose next to the car ahead: rear bumpers level, about 0.8 m of side gap. */
function alongsidePose(c: TutorialContext): VehicleState | null {
  const car = frontCar(c.level);
  if (!car) return null;
  return { x: car.minX + rearOverhang(c.spec), z: car.leftZ - 0.8 - c.spec.width / 2, heading: 0, speed: 0, steer: 0 };
}

function finalPose(c: TutorialContext): VehicleState {
  const s = c.spec;
  const rearBumper = c.level.spot.centerX - s.length / 2;
  return { x: rearBumper + rearOverhang(s), z: CURB_Z - 0.2 - s.width / 2, heading: 0, speed: 0, steer: 0 };
}

const turnRadius = (c: TutorialContext): number => c.spec.wheelbase / Math.tan(c.maxSteer);

/** Front-right corner's distance from the rear-axle turning centre at full lock. */
const cornerRadius = (c: TutorialContext, radius: number): number => Math.hypot(radius + c.spec.width / 2, c.spec.length - rearOverhang(c.spec));

/** Rear-axle z that leaves `gap` between the body and the curb. */
const curbZ = (c: TutorialContext, gap: number): number => CURB_Z - gap - c.spec.width / 2;

/** How far the swinging front corner stays from the rear bumper of the car ahead, turning left from (x, z, h). */
function frontClearance(c: TutorialContext, x: number, z: number, h: number): number {
  const car = frontCar(c.level);
  if (!car) return Infinity;
  const R = turnRadius(c);
  return Math.hypot(car.minX - (x - R * Math.sin(h)), car.leftZ - (z - R * Math.cos(h))) - cornerRadius(c, R);
}

/**
 * Angle for the first (right-lock) arc. For each candidate the whole manoeuvre is laid out
 * (arc, straight reverse, opposite arc) and checked: it must end near the curb, inside the space,
 * with the front corner clearing the car ahead. The plan ending closest to the middle wins.
 */
function planAngle(c: TutorialContext): number {
  const s = c.spec;
  const R = turnRadius(c);
  const ro = rearOverhang(s);
  const { rearX, frontX, centerX } = c.level.spot;
  let best = 0.7;
  let bestScore = Infinity;
  for (const gap of [0.25, 0.35, 0.45]) {
    for (let a = 0.3; a <= 1.0; a += 0.01) {
      const x1 = c.vs.x - R * Math.sin(a);
      const z1 = c.vs.z + R * (1 - Math.cos(a));
      const d = (curbZ(c, gap) - z1 - R * (1 - Math.cos(a))) / Math.sin(a);
      if (d < 0) continue;
      const x2 = x1 - d * Math.cos(a);
      const z2 = z1 + d * Math.sin(a);
      if (frontClearance(c, x2, z2, a) < 0.2) continue;
      const rearBumper = x2 - R * Math.sin(a) - ro;
      if (rearBumper < rearX + 0.2 || rearBumper + s.length > frontX - 0.1) continue;
      const score = Math.abs(rearBumper + s.length / 2 - centerX) + gap * 2;
      if (score < bestScore) {
        bestScore = score;
        best = a;
      }
    }
    if (bestScore < Infinity) break;
  }
  return best;
}

/**
 * Reverse distance left before turning to full left lock. From the turn point the arc that brings
 * the car straight again should end about 25 cm from the curb, the swinging front corner must
 * clear the rear bumper of the car ahead, and the rear must stay clear of the car behind and the curb.
 */
function distanceToTurn(c: TutorialContext): number {
  const h = heading(c);
  if (h < 0.15) return 0;
  const R = turnRadius(c);
  const lateral = (gap: number): number => (curbZ(c, gap) - R * (1 - Math.cos(h)) - c.vs.z) / Math.sin(h);
  const ideal = lateral(0.25);
  const curbLimit = lateral(0.06);
  // the arc ends `R * sin(h)` further back; keep the rear bumper 20 cm inside the space
  const rearLimit = (c.vs.x - R * Math.sin(h) - rearOverhang(c.spec) - c.level.spot.rearX - 0.2) / Math.cos(h);
  let clear = -1;
  while (clear < 6 && frontClearance(c, c.vs.x - clear * Math.cos(h), c.vs.z + clear * Math.sin(h), h) < 0.2) clear += 0.02;
  return Math.min(Math.max(ideal, clear), rearLimit, curbLimit);
}

const STEPS: readonly Step[] = [
  {
    title: 'Pull up alongside',
    text: 'Drive forward with <kbd>W</kbd> and stop beside the car ahead of the green space, about a metre away from it, with your rear bumper level with its rear bumper (the green outline).',
    ghost: alongsidePose,
    status: (c) => {
      const car = frontCar(c.level);
      if (!car) return null;
      const off = bounds(c).minX - car.minX;
      return Math.abs(off) < 0.45 ? 'Level with its bumper — stop here' : off < 0 ? `Keep going: ${(-off).toFixed(1)} m to go` : `${off.toFixed(1)} m past it`;
    },
    warning: (c) => {
      const car = frontCar(c.level);
      if (!car) return null;
      const off = bounds(c).minX - car.minX;
      if (off > 0.6) return 'A little too far — back up with S until the bumpers are level';
      const gap = car.leftZ - bounds(c).maxZ;
      if (gap < 0.3) return 'Too close to the parked car — steer left a little';
      if (gap > 1.8) return 'Too far from the parked cars — move closer (about 1 m)';
      return null;
    },
    check: (c) => {
      const car = frontCar(c.level);
      if (!car) return true;
      const b = bounds(c);
      const gap = car.leftZ - b.maxZ;
      return stopped(c) && Math.abs(b.minX - car.minX) < 0.6 && gap > 0.3 && gap < 1.8 && Math.abs(heading(c)) < 0.12;
    },
  },
  {
    title: 'Full lock right',
    text: 'While stopped, turn the steering wheel all the way to the right: hold <kbd>D</kbd> until it stops.',
    status: (c) => `Wheel ${Math.round((-c.vs.steer / c.maxSteer) * 100)}% to the right`,
    check: (c) => c.vs.steer < -c.maxSteer * 0.9,
  },
  {
    text: 'Reverse slowly with <kbd>S</kbd> (add <kbd>Shift</kbd> to creep). The rear swings toward the curb. Stop when the car reaches the target angle below (usually 30–45°, depending on the car and the space). Check the passenger mirror (it tilts down in reverse; <kbd>T</kbd> toggles it), or hold <kbd>B</kbd> to look back.',
    title: 'Reverse to the target angle',
    status: (c) => `Angle ${deg(heading(c))}° of ${deg(c.targetAngle)}°`,
    warning: (c) =>
      heading(c) > c.targetAngle + 0.08
        ? 'Past the target — pull forward a little (W) to reduce the angle'
        : c.vs.steer > -c.maxSteer * 0.7
          ? 'Keep the wheel at full right lock (D)'
          : null,
    check: (c) => stopped(c) && Math.abs(heading(c) - c.targetAngle) < 0.07,
  },
  {
    title: 'Straighten and reverse',
    text: 'Centre the steering wheel (<kbd>A</kbd> until it reads 0°), then reverse straight back and stop at the turn point. In a real car that is roughly when your rear wheel is about a metre from the curb.',
    status: (c) => {
      const wheel = deg(c.vs.steer);
      const d = distanceToTurn(c);
      const wheelText = Math.abs(wheel) <= 2 ? 'wheel centred ✓' : `wheel ${Math.abs(wheel)}° ${wheel > 0 ? 'left' : 'right'}`;
      return `${wheelText} · ${d > 0.15 ? `turn point in ${d.toFixed(1)} m` : 'stop: turn point ✓'}`;
    },
    warning: (c) => {
      if (c.rearSensor !== null && c.rearSensor < 0.35) return 'Close to the car behind — stop!';
      return distanceToTurn(c) < -0.35 ? 'Past the turn point — pull forward a little' : null;
    },
    check: (c) => {
      const d = distanceToTurn(c);
      return stopped(c) && Math.abs(c.vs.steer) < c.maxSteer * 0.15 && d < 0.15 && d > -0.35;
    },
  },
  {
    title: 'Full lock left',
    text: 'Turn the wheel all the way to the left (<kbd>A</kbd>) and keep reversing slowly. The front swings in behind the car ahead. Stop when the car is straight.',
    status: (c) => `Angle ${deg(heading(c))}° → 0° · rear ${c.rearSensor === null ? 'clear' : `${Math.round(c.rearSensor * 100)} cm`}`,
    warning: (c) => (c.rearSensor !== null && c.rearSensor < 0.3 ? 'Too close to the car behind — stop and pull forward' : heading(c) < -0.08 ? 'Past straight — turn right a little' : null),
    check: (c) => stopped(c) && Math.abs(heading(c)) < 0.08,
  },
  {
    title: 'Centre in the space',
    text: 'Centre the wheel, then pull forward or back with <kbd>W</kbd>/<kbd>S</kbd> so the gaps in front and behind are about equal. Aim for 30 cm or less from the curb.',
    ghost: finalPose,
    status: (c) => {
      const p = c.placement;
      return `Curb ${Math.round(Math.max(0, p.curbGap) * 100)} cm · front ${p.frontGap.toFixed(1)} m · rear ${p.rearGap.toFixed(1)} m`;
    },
    warning: (c) => {
      const p = c.placement;
      if (!p.insideSpot) return 'Not fully inside the space yet';
      if (p.curbGap > 0.5) return 'Too far from the curb — try again from the left-lock step, or press R to restart';
      return null;
    },
    check: (c) => {
      const p = c.placement;
      return stopped(c) && p.insideSpot && Math.abs(c.vs.steer) < c.maxSteer * 0.2 && Math.abs(p.frontGap - p.rearGap) < 0.9 && p.curbGap < 0.5;
    },
  },
  {
    title: 'Finish',
    text: 'Well parked! Press <kbd>Enter</kbd> to get your score. Then try the real thing from the menu: smaller spaces on harder difficulties.',
    ghost: finalPose,
  },
];

/** Seconds a step's condition must hold before it counts. */
const HOLD = 0.35;

export class Tutorial {
  private index = 0;
  private held = 0;
  private targetAngle = 0.7;

  reset(): void {
    this.index = 0;
    this.held = 0;
  }

  private lesson(c: TutorialContext): LessonContext {
    // plan while the car is still lined up alongside; keep it once the manoeuvre starts
    if (this.index <= 1 && Math.abs(c.vs.speed) < 0.05) this.targetAngle = planAngle(c);
    return { ...c, targetAngle: this.targetAngle };
  }

  /** Advances the lesson; returns true when a step was just completed. */
  update(dt: number, ctx: TutorialContext): boolean {
    const c = this.lesson(ctx);
    const step = STEPS[this.index];
    if (!step?.check) return false;
    this.held = step.check(c) ? this.held + dt : 0;
    if (this.held < HOLD) return false;
    this.index = Math.min(STEPS.length - 1, this.index + 1);
    this.held = 0;
    return true;
  }

  view(ctx: TutorialContext): TutorialView {
    const c = this.lesson(ctx);
    const step = STEPS[this.index] ?? STEPS[0];
    if (!step) throw new Error('Tutorial has no steps');
    const warning = c.hits > 0 ? 'You touched another car — press R to restart the lesson' : (step.warning?.(c) ?? null);
    return { index: this.index, count: STEPS.length, title: step.title, text: step.text, status: step.status?.(c) ?? null, warning };
  }

  ghost(ctx: TutorialContext): VehicleState | null {
    return STEPS[this.index]?.ghost?.(this.lesson(ctx)) ?? null;
  }
}

/** A translucent footprint showing where the car should go. */
export class TutorialGhost {
  readonly group = new THREE.Group();
  private readonly fill: THREE.Mesh;
  private readonly outline: THREE.LineLoop;
  private time = 0;

  constructor() {
    this.fill = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: '#30d158', transparent: true, opacity: 0.18, depthWrite: false }),
    );
    this.fill.rotation.x = -Math.PI / 2;
    const pts = [new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 0, -0.5), new THREE.Vector3(0.5, 0, 0.5), new THREE.Vector3(-0.5, 0, 0.5)];
    this.outline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#7dffa0', transparent: true, opacity: 0.9 }));
    this.group.add(this.fill, this.outline);
    this.group.visible = false;
    this.group.renderOrder = 2;
  }

  update(dt: number, pose: VehicleState | null, spec: VehicleSpec): void {
    this.group.visible = pose !== null;
    if (!pose) return;
    this.time += dt;
    const obb = vehicleOBB(pose, spec);
    this.group.position.set(obb.cx, 0.03, obb.cz);
    this.group.rotation.y = pose.heading;
    this.fill.scale.set(spec.length, spec.width, 1);
    this.outline.scale.set(spec.length, 1, spec.width);
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 3.5);
    const fillMat = this.fill.material;
    if (fillMat instanceof THREE.MeshBasicMaterial) fillMat.opacity = 0.1 + 0.12 * pulse;
  }
}
