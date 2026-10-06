import { rearOverhang, type VehicleSpec } from './vehicles';

export interface Vec2 {
  x: number;
  z: number;
}

/**
 * Oriented bounding box on the ground plane. `angle` uses the same convention as
 * Object3D.rotation.y: local +X maps to (cos a, -sin a) in world XZ.
 */
export interface OBB {
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  angle: number;
}

/** Position is the center of the rear axle (on the ground). Steering angle is positive to the left. */
export interface VehicleState {
  x: number;
  z: number;
  heading: number;
  speed: number;
  steer: number;
}

export interface DriveInput {
  throttle: number;
  reverse: number;
  brake: number;
  /** -1 (left) … +1 (right) */
  steerAxis: number;
  analogSteer: boolean;
}

const BRAKE_DECEL = 7;
const ROLLING_RESIST = 0.35;
const ENGINE_BRAKE = 0.9;

export function forwardVec(heading: number): Vec2 {
  return { x: Math.cos(heading), z: -Math.sin(heading) };
}

export function rightVec(heading: number): Vec2 {
  return { x: Math.sin(heading), z: Math.cos(heading) };
}

export function maxSteerRad(spec: VehicleSpec): number {
  return (spec.maxSteerDeg * Math.PI) / 180;
}

/** Seconds to turn from centre to full lock with a steering key held down. */
const KEYBOARD_STEER_TIME = 1.8;

export function updateSteering(state: VehicleState, spec: VehicleSpec, input: DriveInput, dt: number, selfCenter: boolean): number {
  const max = maxSteerRad(spec);
  let steer = state.steer;
  if (input.analogSteer) {
    const target = -input.steerAxis * max;
    const rate = (max / 0.7) * dt;
    steer += Math.max(-rate, Math.min(rate, target - steer));
  } else if (input.steerAxis !== 0) {
    steer += -input.steerAxis * (max / KEYBOARD_STEER_TIME) * dt;
  } else if (selfCenter) {
    const rate = Math.min(1, Math.abs(state.speed) / 2.5) * (max / 0.7) * dt;
    steer = Math.abs(steer) <= rate ? 0 : steer - Math.sign(steer) * rate;
  }
  return Math.max(-max, Math.min(max, steer));
}

export function integrate(state: VehicleState, spec: VehicleSpec, input: DriveInput, dt: number): VehicleState {
  let v = state.speed;
  let drive = 0;
  let resist = ROLLING_RESIST;

  if (input.throttle > 0) {
    if (v < -0.05) resist += BRAKE_DECEL * input.throttle;
    else drive += spec.accel * input.throttle * Math.max(0, 1 - v / spec.maxSpeedFwd);
  }
  if (input.reverse > 0) {
    if (v > 0.05) resist += BRAKE_DECEL * input.reverse;
    else drive -= spec.accel * 0.8 * input.reverse * Math.max(0, 1 + v / spec.maxSpeedRev);
  }
  if (input.throttle === 0 && input.reverse === 0) resist += ENGINE_BRAKE;
  resist += BRAKE_DECEL * input.brake;

  v += drive * dt;
  const dv = resist * dt;
  v = Math.abs(v) <= dv ? 0 : v - Math.sign(v) * dv;

  const yawRate = (v * Math.tan(state.steer)) / spec.wheelbase;
  const heading = state.heading + yawRate * dt;
  const mid = (state.heading + heading) / 2;
  return {
    x: state.x + Math.cos(mid) * v * dt,
    z: state.z - Math.sin(mid) * v * dt,
    heading,
    speed: v,
    steer: state.steer,
  };
}

/** Offset (along the forward axis) from the rear axle to the body center. */
export function centerOffset(spec: VehicleSpec): number {
  return spec.length / 2 - rearOverhang(spec);
}

export function vehicleOBB(state: VehicleState, spec: VehicleSpec): OBB {
  const f = forwardVec(state.heading);
  const off = centerOffset(spec);
  return {
    cx: state.x + f.x * off,
    cz: state.z + f.z * off,
    hx: spec.length / 2,
    hz: spec.width / 2,
    angle: state.heading,
  };
}

export function obbAxes(o: OBB): [Vec2, Vec2] {
  return [forwardVec(o.angle), rightVec(o.angle)];
}

/** Corners in order: rear-left, front-left, front-right, rear-right. */
export function obbCorners(o: OBB): Vec2[] {
  const [f, r] = obbAxes(o);
  const corner = (sx: number, sz: number): Vec2 => ({
    x: o.cx + f.x * o.hx * sx + r.x * o.hz * sz,
    z: o.cz + f.z * o.hx * sx + r.z * o.hz * sz,
  });
  return [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
}

function project(points: readonly Vec2[], axis: Vec2): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    const d = p.x * axis.x + p.z * axis.z;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return [min, max];
}

export function obbOverlap(a: OBB, b: OBB): boolean {
  const ca = obbCorners(a);
  const cb = obbCorners(b);
  for (const axis of [...obbAxes(a), ...obbAxes(b)]) {
    const [minA, maxA] = project(ca, axis);
    const [minB, maxB] = project(cb, axis);
    if (maxA < minB || maxB < minA) return false;
  }
  return true;
}

export function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const lenSq = abx * abx + abz * abz;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / lenSq));
  const dx = a.x + abx * t - p.x;
  const dz = a.z + abz * t - p.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/** Minimum distance between a segment and a closed polygon (assumes no intersection). */
export function segmentPolygonDistance(a: Vec2, b: Vec2, poly: readonly Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    best = Math.min(best, pointSegmentDistance(a, p, q), pointSegmentDistance(b, p, q), pointSegmentDistance(p, a, b));
  }
  return best;
}

export interface WheelPoint {
  x: number;
  z: number;
  side: -1 | 1;
}

/** Outer contact edges (front/back of the footprint) of all four tires. */
export function tireOuterPoints(state: VehicleState, spec: VehicleSpec): WheelPoint[] {
  const f = forwardVec(state.heading);
  const r = rightVec(state.heading);
  const lateral = spec.track / 2 + spec.tireWidth / 2;
  const points: WheelPoint[] = [];
  for (const axle of [0, spec.wheelbase]) {
    for (const side of [-1, 1] as const) {
      for (const along of [-0.16, 0.16]) {
        const ax = axle + along;
        points.push({
          x: state.x + f.x * ax + r.x * lateral * side,
          z: state.z + f.z * ax + r.z * lateral * side,
          side,
        });
      }
    }
  }
  return points;
}

/** Signed road-wheel angles for the left and right front wheels (Ackermann geometry). */
export function ackermann(steer: number, spec: VehicleSpec): { left: number; right: number } {
  if (Math.abs(steer) < 1e-4) return { left: steer, right: steer };
  const radius = spec.wheelbase / Math.tan(Math.abs(steer));
  const inner = Math.atan(spec.wheelbase / (radius - spec.track / 2));
  const outer = Math.atan(spec.wheelbase / (radius + spec.track / 2));
  return steer > 0 ? { left: inner, right: outer } : { left: -outer, right: -inner };
}

export function normalizeAngle(a: number): number {
  let r = a % (Math.PI * 2);
  if (r > Math.PI) r -= Math.PI * 2;
  if (r < -Math.PI) r += Math.PI * 2;
  return r;
}

/** Distance along a ray (unit direction) to the first hit on an OBB, or null if it misses. */
export function rayOBB(origin: Vec2, dir: Vec2, o: OBB): number | null {
  const [f, r] = obbAxes(o);
  const lx = (origin.x - o.cx) * f.x + (origin.z - o.cz) * f.z;
  const lz = (origin.x - o.cx) * r.x + (origin.z - o.cz) * r.z;
  const dx = dir.x * f.x + dir.z * f.z;
  const dz = dir.x * r.x + dir.z * r.z;
  let tMin = 0;
  let tMax = Infinity;
  for (const [p, d, h] of [
    [lx, dx, o.hx],
    [lz, dz, o.hz],
  ]) {
    if (Math.abs(d) < 1e-9) {
      if (p < -h || p > h) return null;
      continue;
    }
    let t1 = (-h - p) / d;
    let t2 = (h - p) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }
  return tMin;
}

/**
 * Ultrasonic-style parking sensors: rays fan out from four points on a bumper.
 * `end` is +1 for the front bumper, -1 for the rear.
 */
export function sensorDistance(state: VehicleState, spec: VehicleSpec, end: 1 | -1, obstacles: readonly OBB[], range: number): number | null {
  const f = forwardVec(state.heading);
  const r = rightVec(state.heading);
  const along = end > 0 ? spec.length - rearOverhang(spec) : -rearOverhang(spec);
  let best = Infinity;
  for (const frac of [-0.42, -0.14, 0.14, 0.42]) {
    const lateral = frac * spec.width;
    const origin = { x: state.x + f.x * along + r.x * lateral, z: state.z + f.z * along + r.z * lateral };
    const spread = Math.abs(frac) > 0.3 ? Math.sign(frac) * 0.45 : Math.sign(frac) * 0.12;
    const cos = Math.cos(spread);
    const sin = Math.sin(spread);
    const dir = { x: (f.x * cos + r.x * sin) * end, z: (f.z * cos + r.z * sin) * end };
    for (const o of obstacles) {
      if (Math.abs(o.cx - origin.x) > range + o.hx + 1 || Math.abs(o.cz - origin.z) > range + o.hx + 1) continue;
      const t = rayOBB(origin, dir, o);
      if (t !== null && t < best) best = t;
    }
  }
  return best <= range ? best : null;
}
