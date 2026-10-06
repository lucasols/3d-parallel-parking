import * as THREE from 'three';
import { CURB_Z, LANE_LINE_Z } from './constants';
import type { Spot } from './level';
import { forwardVec, rightVec, type VehicleState } from './physics';
import { rearOverhang, type VehicleSpec } from './vehicles';

const STEPS = 46;
const STEP_LENGTH = 0.13;
const RIBBON_WIDTH = 0.07;

class Ribbon {
  readonly mesh: THREE.Mesh;
  private readonly positions: Float32Array;
  private readonly geometry: THREE.BufferGeometry;

  constructor(material: THREE.Material) {
    this.positions = new Float32Array(STEPS * 2 * 3);
    const colors = new Float32Array(STEPS * 2 * 4);
    const indices: number[] = [];
    for (let i = 0; i < STEPS; i++) {
      const dist = i * STEP_LENGTH;
      const c = dist < 1 ? new THREE.Color('#ff3b30') : dist < 2.5 ? new THREE.Color('#ffd60a') : new THREE.Color('#34c759');
      const alpha = 0.9 * (1 - i / STEPS) + 0.1;
      for (let k = 0; k < 2; k++) {
        const o = (i * 2 + k) * 4;
        colors[o] = c.r;
        colors[o + 1] = c.g;
        colors[o + 2] = c.b;
        colors[o + 3] = alpha;
      }
      if (i < STEPS - 1) {
        const a = i * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    this.geometry.setIndex(indices);
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  update(points: readonly { x: number; z: number }[]): void {
    for (let i = 0; i < STEPS; i++) {
      const p = points[i];
      const prev = points[Math.max(0, i - 1)];
      const next = points[Math.min(points.length - 1, i + 1)];
      if (!p || !prev || !next) continue;
      let tx = next.x - prev.x;
      let tz = next.z - prev.z;
      const len = Math.hypot(tx, tz) || 1;
      tx /= len;
      tz /= len;
      const nx = -tz * (RIBBON_WIDTH / 2);
      const nz = tx * (RIBBON_WIDTH / 2);
      const o = i * 6;
      this.positions[o] = p.x + nx;
      this.positions[o + 1] = 0.03;
      this.positions[o + 2] = p.z + nz;
      this.positions[o + 3] = p.x - nx;
      this.positions[o + 4] = 0.03;
      this.positions[o + 5] = p.z - nz;
    }
    const attr = this.geometry.getAttribute('position');
    attr.needsUpdate = true;
  }
}

/** Projected path of the car's leading corners, plus a highlight over the target space. */
export class Guides {
  readonly group = new THREE.Group();
  private readonly left: Ribbon;
  private readonly right: Ribbon;
  private readonly spotMesh: THREE.Mesh;
  private readonly spotMaterial = new THREE.MeshBasicMaterial({
    color: '#34c759',
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });
  private time = 0;

  constructor() {
    const material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.left = new Ribbon(material);
    this.right = new Ribbon(material);
    this.spotMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.spotMaterial);
    this.spotMesh.rotation.x = -Math.PI / 2;
    this.spotMesh.renderOrder = 1;
    this.group.add(this.left.mesh, this.right.mesh, this.spotMesh);
  }

  setSpot(spot: Spot): void {
    const width = CURB_Z - LANE_LINE_Z - 0.1;
    this.spotMesh.scale.set(spot.length - 0.1, width, 1);
    this.spotMesh.position.set(spot.centerX, 0.008, LANE_LINE_Z + 0.05 + width / 2);
  }

  update(dt: number, state: VehicleState, spec: VehicleSpec, direction: 1 | -1, showPath: boolean, showSpot: boolean, parked: boolean): void {
    this.time += dt;
    this.left.mesh.visible = showPath;
    this.right.mesh.visible = showPath;
    this.spotMesh.visible = showSpot;
    this.spotMaterial.color.set(parked ? '#30d158' : '#34c759');
    this.spotMaterial.opacity = parked ? 0.32 : 0.12 + Math.sin(this.time * 3) * 0.05;
    if (!showPath) return;

    const ro = rearOverhang(spec);
    const leadX = direction > 0 ? spec.length - ro : -ro;
    const halfW = spec.width / 2;
    const leftPts: { x: number; z: number }[] = [];
    const rightPts: { x: number; z: number }[] = [];
    let x = state.x;
    let z = state.z;
    let heading = state.heading;
    const tan = Math.tan(state.steer);
    for (let i = 0; i < STEPS; i++) {
      const f = forwardVec(heading);
      const r = rightVec(heading);
      leftPts.push({ x: x + f.x * leadX - r.x * halfW, z: z + f.z * leadX - r.z * halfW });
      rightPts.push({ x: x + f.x * leadX + r.x * halfW, z: z + f.z * leadX + r.z * halfW });
      const ds = STEP_LENGTH * direction;
      heading += (ds * tan) / spec.wheelbase;
      x += Math.cos(heading) * ds;
      z -= Math.sin(heading) * ds;
    }
    this.left.update(leftPts);
    this.right.update(rightPts);
  }
}
