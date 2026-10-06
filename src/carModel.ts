import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rearOverhang, sideMirrorLayout, type VehicleSpec } from './vehicles';
import { createPlateTexture } from './textures';
import { buildInterior, interiorMaterials, type InteriorVisual } from './interior';

interface P2 {
  x: number;
  y: number;
}

export interface ProfilePoint extends P2 {
  r: number;
}

const ARCH_GAP = 0.07;

function archRadius(spec: VehicleSpec): number {
  return spec.wheelRadius + ARCH_GAP;
}

/** Half-width of a wheel arch where it meets the bottom of the body. */
function archHalfSpan(spec: VehicleSpec): number {
  const r = archRadius(spec);
  const dy = spec.wheelRadius - spec.groundClearance;
  return Math.sqrt(Math.max(0, r * r - dy * dy));
}

function archPoints(spec: VehicleSpec, cx: number, segments: number): ProfilePoint[] {
  const radius = archRadius(spec);
  const cy = spec.wheelRadius;
  const a0 = -Math.asin(Math.min(1, (cy - spec.groundClearance) / radius));
  const points: ProfilePoint[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = a0 + ((Math.PI - 2 * a0) * i) / segments;
    points.push({ x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius, r: 0 });
  }
  return points;
}

/** Side profile of the lower body, x from rear bumper (0) to front bumper (length). */
export function lowerBodyPoints(s: VehicleSpec): ProfilePoint[] {
  const L = s.length;
  const gc = s.groundClearance;
  const ro = rearOverhang(s);
  const xf = L - s.frontOverhang;
  const dx = archHalfSpan(s);
  const pts: ProfilePoint[] = [
    { x: 0.05, y: gc + 0.1, r: 0.08 },
    { x: 0, y: gc + 0.3, r: 0.1 },
    { x: 0, y: s.deckHeight - 0.12, r: 0.08 },
    { x: 0.1, y: s.deckHeight, r: 0.12 },
    { x: Math.max(s.cabin.rearBase, 0.16), y: s.beltHeight, r: 0 },
    { x: s.cabin.frontBase, y: s.beltHeight, r: 0 },
    { x: L - 0.3, y: s.hoodHeight, r: 0.25 },
    { x: L - 0.01, y: s.hoodHeight - 0.12, r: 0.1 },
    { x: L, y: gc + 0.3, r: 0.12 },
    { x: L - 0.08, y: gc + 0.04, r: 0.06 },
  ];
  if (xf + dx + 0.15 < L - 0.1) pts.push({ x: xf + dx + 0.06, y: gc, r: 0.04 });
  pts.push(...archPoints(s, xf, 14));
  pts.push(...archPoints(s, ro, 14));
  if (ro - dx > 0.25) pts.push({ x: 0.2, y: gc, r: 0.05 });
  return pts;
}

export function cabinPoints(s: VehicleSpec): ProfilePoint[] {
  const c = s.cabin;
  return [
    { x: c.rearBase, y: s.beltHeight - 0.06, r: 0 },
    { x: c.roofRear, y: s.height, r: c.rearRoofRadius },
    { x: c.roofFront, y: s.height, r: c.frontRoofRadius },
    { x: c.frontBase, y: s.beltHeight - 0.06, r: 0 },
  ];
}

export function roundedShape(points: readonly ProfilePoint[]): THREE.Shape {
  const shape = new THREE.Shape();
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const cur = points[i];
    const next = points[(i + 1) % n];
    const first = i === 0;
    if (cur.r <= 0) {
      if (first) shape.moveTo(cur.x, cur.y);
      else shape.lineTo(cur.x, cur.y);
      continue;
    }
    const dPrev = Math.hypot(prev.x - cur.x, prev.y - cur.y);
    const dNext = Math.hypot(next.x - cur.x, next.y - cur.y);
    const cut = Math.min(cur.r, dPrev * 0.5, dNext * 0.5);
    const ax = cur.x + ((prev.x - cur.x) / dPrev) * cut;
    const ay = cur.y + ((prev.y - cur.y) / dPrev) * cut;
    const bx = cur.x + ((next.x - cur.x) / dNext) * cut;
    const by = cur.y + ((next.y - cur.y) / dNext) * cut;
    if (first) shape.moveTo(ax, ay);
    else shape.lineTo(ax, ay);
    shape.quadraticCurveTo(cur.x, cur.y, bx, by);
  }
  shape.closePath();
  return shape;
}

function signedArea(pts: readonly P2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

interface OffsetLine {
  px: number;
  py: number;
  ex: number;
  ey: number;
}

function intersectLines(a: OffsetLine, b: OffsetLine): P2 {
  const det = -a.ex * b.ey + a.ey * b.ex;
  if (Math.abs(det) < 1e-9) return { x: b.px, y: b.py };
  const dx = b.px - a.px;
  const dy = b.py - a.py;
  const t = (-dx * b.ey + dy * b.ex) / det;
  return { x: a.px + t * a.ex, y: a.py + t * a.ey };
}

/** Insets a convex polygon; insets[i] applies to the edge from vertex i to vertex i+1. */
function insetConvex(pts: readonly P2[], insets: readonly number[]): P2[] {
  const n = pts.length;
  const ccw = signedArea(pts) > 0;
  const lines: OffsetLine[] = pts.map((p, i) => {
    const q = pts[(i + 1) % n];
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    const ex = (q.x - p.x) / len;
    const ey = (q.y - p.y) / len;
    const nx = ccw ? -ey : ey;
    const ny = ccw ? ex : -ex;
    const d = insets[i] ?? 0;
    return { px: p.x + nx * d, py: p.y + ny * d, ex, ey };
  });
  return pts.map((_, i) => intersectLines(lines[(i - 1 + n) % n], lines[i]));
}

function clipX(pts: readonly P2[], c: number, keepGreater: boolean): P2[] {
  const inside = (p: P2): boolean => (keepGreater ? p.x >= c : p.x <= c);
  const cross = (a: P2, b: P2): P2 => {
    const t = (c - a.x) / (b.x - a.x);
    return { x: c, y: a.y + (b.y - a.y) * t };
  };
  const out: P2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const cur = pts[i];
    const prev = pts[(i - 1 + pts.length) % pts.length];
    if (inside(cur)) {
      if (!inside(prev)) out.push(cross(prev, cur));
      out.push(cur);
    } else if (inside(prev)) {
      out.push(cross(prev, cur));
    }
  }
  return out;
}

function sideWindowPolygons(s: VehicleSpec): P2[][] {
  const quad = cabinPoints(s).map((p) => ({ x: p.x, y: p.y }));
  // edges: rear pillar, roof, front pillar, belt
  let poly = insetConvex(quad, [0.09, 0.075, 0.085, 0.1]);
  if (s.sideWindowMinX > 0) poly = clipX(poly, s.sideWindowMinX, true);
  const pieces: P2[][] = [];
  const pillars = [...s.pillars].sort((a, b) => b.x - a.x);
  for (const pillar of pillars) {
    pieces.push(clipX(poly, pillar.x + pillar.width / 2, true));
    poly = clipX(poly, pillar.x - pillar.width / 2, false);
  }
  pieces.push(poly);
  return pieces.filter((p) => p.length >= 3 && Math.abs(signedArea(p)) > 0.02);
}

interface SharedMaterials {
  glass: THREE.MeshPhysicalMaterial;
  trim: THREE.MeshStandardMaterial;
  chrome: THREE.MeshStandardMaterial;
  black: THREE.MeshStandardMaterial;
  tire: THREE.MeshStandardMaterial;
  rim: THREE.MeshStandardMaterial;
  rimDark: THREE.MeshStandardMaterial;
  tonneau: THREE.MeshStandardMaterial;
  plateBack: THREE.MeshStandardMaterial;
  lightsOff: CarLightMaterials;
}

export interface CarLightMaterials {
  head: THREE.MeshPhysicalMaterial;
  tail: THREE.MeshPhysicalMaterial;
  reverse: THREE.MeshPhysicalMaterial;
}

export function createLightMaterials(): CarLightMaterials {
  return {
    head: new THREE.MeshPhysicalMaterial({
      color: '#d7dde4',
      metalness: 0.3,
      roughness: 0.08,
      clearcoat: 1,
      emissive: '#fff4dc',
      emissiveIntensity: 0.15,
    }),
    tail: new THREE.MeshPhysicalMaterial({
      color: '#6a0507',
      metalness: 0.1,
      roughness: 0.15,
      clearcoat: 1,
      emissive: '#ff1408',
      emissiveIntensity: 0.12,
    }),
    reverse: new THREE.MeshPhysicalMaterial({
      color: '#c9cdd2',
      metalness: 0.2,
      roughness: 0.1,
      clearcoat: 1,
      emissive: '#ffffff',
      emissiveIntensity: 0,
    }),
  };
}

let shared: SharedMaterials | null = null;

function sharedMaterials(): SharedMaterials {
  if (shared) return shared;
  shared = {
    glass: new THREE.MeshPhysicalMaterial({
      color: '#0a0f14',
      metalness: 0.1,
      roughness: 0.04,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      envMapIntensity: 1.6,
      side: THREE.DoubleSide,
    }),
    trim: new THREE.MeshStandardMaterial({ color: '#141518', roughness: 0.62, metalness: 0.05 }),
    chrome: new THREE.MeshStandardMaterial({ color: '#e5e7ea', roughness: 0.12, metalness: 1 }),
    black: new THREE.MeshStandardMaterial({ color: '#050505', roughness: 0.9, side: THREE.DoubleSide }),
    tire: new THREE.MeshStandardMaterial({ color: '#191919', roughness: 0.88, side: THREE.DoubleSide }),
    rim: new THREE.MeshStandardMaterial({ color: '#c3c7cc', roughness: 0.22, metalness: 0.95 }),
    rimDark: new THREE.MeshStandardMaterial({ color: '#2a2c30', roughness: 0.45, metalness: 0.7, side: THREE.DoubleSide }),
    tonneau: new THREE.MeshStandardMaterial({ color: '#1b1c1e', roughness: 0.75 }),
    plateBack: new THREE.MeshStandardMaterial({ color: '#202124', roughness: 0.6 }),
    lightsOff: createLightMaterials(),
  };
  shared.lightsOff.head.emissiveIntensity = 0;
  shared.lightsOff.head.roughness = 0.3;
  shared.lightsOff.tail.emissiveIntensity = 0;
  return shared;
}

export function createPaintMaterial(hex: string): THREE.MeshPhysicalMaterial {
  const color = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  const light = hsl.l > 0.75;
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: light ? 0.12 : 0.55,
    roughness: light ? 0.28 : 0.32,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
  });
}

function addMesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, name: string): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function box(parent: THREE.Object3D, size: [number, number, number], pos: [number, number, number], material: THREE.Material, name: string): THREE.Mesh {
  const mesh = addMesh(parent, new THREE.BoxGeometry(size[0], size[1], size[2]), material, name);
  mesh.position.set(pos[0], pos[1], pos[2]);
  return mesh;
}

const wheelCache = new Map<string, { tire: THREE.BufferGeometry; rim: THREE.BufferGeometry; rimDark: THREE.BufferGeometry }>();

function wheelGeometries(radius: number, width: number): { tire: THREE.BufferGeometry; rim: THREE.BufferGeometry; rimDark: THREE.BufferGeometry } {
  const key = `${radius}:${width}`;
  const cached = wheelCache.get(key);
  if (cached) return cached;
  const rimR = radius * 0.66;
  const hw = width / 2;
  const tireProfile = [
    new THREE.Vector2(rimR, -hw + 0.01),
    new THREE.Vector2(radius - 0.05, -hw),
    new THREE.Vector2(radius - 0.015, -hw + 0.02),
    new THREE.Vector2(radius, -hw + 0.05),
    new THREE.Vector2(radius, hw - 0.05),
    new THREE.Vector2(radius - 0.015, hw - 0.02),
    new THREE.Vector2(radius - 0.05, hw),
    new THREE.Vector2(rimR, hw - 0.01),
  ];
  const tire = new THREE.LatheGeometry(tireProfile, 40);
  tire.rotateX(Math.PI / 2);

  const face = hw - 0.035;
  const lip = new THREE.TorusGeometry(rimR - 0.012, 0.016, 8, 40);
  lip.translate(0, 0, face);
  const hub = new THREE.CylinderGeometry(0.065, 0.08, 0.05, 18);
  hub.rotateX(Math.PI / 2);
  hub.translate(0, 0, face - 0.02);
  const metalParts: THREE.BufferGeometry[] = [lip, hub];
  const spokeLen = rimR - 0.07;
  for (let k = 0; k < 5; k++) {
    for (const twist of [-0.13, 0.13]) {
      const spoke = new THREE.BoxGeometry(0.038, spokeLen, 0.03);
      spoke.translate(0, spokeLen / 2 + 0.05, 0);
      spoke.rotateZ((k * Math.PI * 2) / 5 + twist);
      spoke.translate(0, 0, face - 0.03);
      metalParts.push(spoke);
    }
  }
  const rim = mergeGeometries(metalParts);
  const disc = new THREE.CircleGeometry(rimR - 0.01, 32);
  disc.translate(0, 0, face - 0.07);
  const barrel = new THREE.CylinderGeometry(rimR, rimR, width - 0.04, 32, 1, true);
  barrel.rotateX(Math.PI / 2);
  const brake = new THREE.CylinderGeometry(rimR - 0.06, rimR - 0.06, 0.025, 28);
  brake.rotateX(Math.PI / 2);
  brake.translate(0, 0, face - 0.1);
  const rimDark = mergeGeometries([disc, barrel, brake]);
  const result = { tire, rim, rimDark };
  wheelCache.set(key, result);
  return result;
}

function seamBottom(s: VehicleSpec, x: number): number {
  const ro = rearOverhang(s);
  const xf = s.length - s.frontOverhang;
  const r = archRadius(s) + 0.03;
  let bottom = s.groundClearance + 0.2;
  for (const axle of [ro, xf]) {
    const dx = Math.abs(x - axle);
    if (dx < r) bottom = Math.max(bottom, s.wheelRadius + Math.sqrt(r * r - dx * dx) + 0.03);
  }
  return bottom;
}

/**
 * Drops the lower body's flat top face under the greenhouse so the cabin is hollow
 * (needed for the driver's view; parked cars keep it closed).
 */
function openCabinFloor(geo: THREE.BufferGeometry, x0: number, x1: number, y: number): THREE.BufferGeometry {
  const source = geo.index ? geo.toNonIndexed() : geo;
  const pos = source.getAttribute('position');
  const names = ['position', 'normal', 'uv'];
  const kept: number[][] = names.map(() => []);
  for (let t = 0; t < pos.count; t += 3) {
    let inside = true;
    for (let k = 0; k < 3; k++) {
      const vx = pos.getX(t + k);
      const vy = pos.getY(t + k);
      if (Math.abs(vy - y) > 0.003 || vx < x0 - 0.01 || vx > x1 + 0.01) inside = false;
    }
    if (inside) continue;
    names.forEach((name, n) => {
      const attr = source.getAttribute(name);
      for (let k = 0; k < 3; k++) {
        for (let c = 0; c < attr.itemSize; c++) kept[n].push(attr.getComponent(t + k, c));
      }
    });
  }
  const out = new THREE.BufferGeometry();
  names.forEach((name, n) => {
    out.setAttribute(name, new THREE.Float32BufferAttribute(kept[n], source.getAttribute(name).itemSize));
  });
  return out;
}

function buildTemplate(s: VehicleSpec, hollow: boolean): THREE.Group {
  const m = sharedMaterials();
  const W = s.width;
  const L = s.length;
  const ro = rearOverhang(s);
  const gc = s.groundClearance;
  const placeholder = m.trim;

  const root = new THREE.Group();
  const body = new THREE.Group();
  body.name = 'body';
  root.add(body);
  const shell = new THREE.Group();
  shell.position.x = -ro;
  body.add(shell);

  // Lower body
  const bt = 0.12;
  const bs = 0.06;
  const lower = new THREE.ExtrudeGeometry(roundedShape(lowerBodyPoints(s)), {
    depth: W - 2 * bt,
    bevelEnabled: true,
    bevelThickness: bt,
    bevelSize: bs,
    bevelOffset: -bs,
    bevelSegments: 5,
    curveSegments: 10,
  });
  lower.translate(0, 0, -(W - 2 * bt) / 2);
  addMesh(shell, hollow ? openCabinFloor(lower, Math.max(s.cabin.rearBase, 0.16), s.cabin.frontBase, s.beltHeight) : lower, placeholder, 'paint');

  // Cabin / greenhouse
  const Wc = W * s.cabin.widthFactor;
  const cbt = 0.1;
  const cbs = 0.05;
  const cabin = new THREE.ExtrudeGeometry(roundedShape(cabinPoints(s)), {
    depth: Wc - 2 * cbt,
    bevelEnabled: true,
    bevelThickness: cbt,
    bevelSize: cbs,
    bevelOffset: -cbs,
    bevelSegments: 5,
    curveSegments: 10,
  });
  cabin.translate(0, 0, -(Wc - 2 * cbt) / 2);
  addMesh(shell, cabin, placeholder, 'paint');

  // Side windows
  for (const poly of sideWindowPolygons(s)) {
    const geo = new THREE.ShapeGeometry(roundedShape(poly.map((p) => ({ x: p.x, y: p.y, r: 0.05 }))), 6);
    for (const side of [-1, 1]) {
      const glass = addMesh(shell, geo, m.glass, 'glass');
      glass.position.z = side * (Wc / 2 + 0.003);
      glass.castShadow = false;
    }
  }

  // Windshield and rear glass
  const c = s.cabin;
  const beltLow = s.beltHeight - 0.06;
  const slopeGlass = (baseX: number, topX: number, roundCut: number, from: number, to: number, outwardSign: number): void => {
    const dx = topX - baseX;
    const dy = s.height - beltLow;
    const len = Math.hypot(dx, dy);
    const start = Math.max(len * from, 0.04);
    const end = Math.min(len * to, len - roundCut - 0.03);
    if (end - start < 0.15) return;
    const ux = dx / len;
    const uy = dy / len;
    let nx = uy;
    let ny = -ux;
    if (Math.sign(nx) !== outwardSign && Math.abs(nx) > 1e-6) {
      nx = -nx;
      ny = -ny;
    }
    const mid = (start + end) / 2;
    const geo = new THREE.BoxGeometry(end - start, 0.012, Wc - 0.24);
    const glass = addMesh(shell, geo, m.glass, 'glass');
    glass.position.set(baseX + ux * mid + nx * 0.004, beltLow + uy * mid + ny * 0.004, 0);
    glass.rotation.z = Math.atan2(dy, dx);
    glass.castShadow = false;
  };
  slopeGlass(c.frontBase, c.roofFront, c.frontRoofRadius, 0.07, 0.97, 1);
  if (s.rearGlass) slopeGlass(c.rearBase, c.roofRear, c.rearRoofRadius, s.rearGlass[0], s.rearGlass[1], -1);

  // Wheel arch liners and wells
  const aR = archRadius(s);
  const a0 = -Math.asin(Math.min(1, (s.wheelRadius - gc) / aR));
  const liner = new THREE.CylinderGeometry(aR - 0.006, aR - 0.006, W - 0.05, 22, 1, true, a0 + Math.PI / 2, Math.PI - 2 * a0);
  liner.rotateX(Math.PI / 2);
  const well = new THREE.BoxGeometry(aR * 1.7, aR + s.wheelRadius - gc, Math.max(0.2, s.track - s.tireWidth - 0.12));
  for (const axle of [ro, L - s.frontOverhang]) {
    const l = addMesh(shell, liner, m.black, 'liner');
    l.position.set(axle, s.wheelRadius, 0);
    l.castShadow = false;
    const w = addMesh(shell, well, m.black, 'well');
    w.position.set(axle, gc + (aR + s.wheelRadius - gc) / 2, 0);
    w.castShadow = false;
  }

  // Bumper trims, grille, intake
  const isTruck = s.style === 'pickup' || s.style === 'van';
  box(shell, [0.14, 0.12, W - 0.22], [L - 0.07, gc + 0.11, 0], m.trim, 'trim');
  box(shell, [0.14, 0.13, W - 0.22], [0.05, gc + 0.12, 0], m.trim, 'trim');
  const grilleH = isTruck ? 0.3 : 0.16;
  const grille = box(shell, [0.06, grilleH, W * (isTruck ? 0.55 : 0.4)], [L - 0.025, s.hoodHeight - 0.16 - grilleH / 2, 0], m.trim, 'trim');
  grille.castShadow = false;
  if (isTruck) box(shell, [0.07, 0.035, W * 0.55], [L - 0.02, s.hoodHeight - 0.16 - grilleH / 2, 0], m.chrome, 'chrome');
  box(shell, [0.05, 0.09, W * 0.48], [L - 0.04, gc + 0.22, 0], m.black, 'intake');

  // Headlights
  for (const side of [-1, 1]) {
    const hw = isTruck ? 0.3 : 0.36;
    const hl = box(shell, [0.16, isTruck ? 0.16 : 0.1, hw], [L - 0.1, s.hoodHeight - 0.14, side * (W / 2 - hw / 2 - 0.1)], placeholder, 'head');
    hl.castShadow = false;
  }

  // Tail and reverse lights
  const t = s.tailLight;
  for (const side of [-1, 1]) {
    const tl = box(shell, [0.14, t.height, t.width], [0.05, t.y, side * (W / 2 - t.width / 2 - 0.07)], placeholder, 'tail');
    tl.castShadow = false;
    const vertical = t.height > t.width;
    const rz = vertical ? side * (W / 2 - t.width / 2 - 0.07) : side * (W / 2 - t.width - 0.16);
    const ry = vertical ? t.y - t.height / 2 - 0.06 : t.y;
    const rl = box(shell, [0.12, 0.07, vertical ? t.width : 0.12], [0.045, ry, rz], placeholder, 'reverse');
    rl.castShadow = false;
  }

  // License plates
  const plateGeo = new THREE.PlaneGeometry(0.52, 0.11);
  const frontPlateY = gc + 0.3;
  box(shell, [0.03, 0.13, 0.55], [L + 0.0, frontPlateY, 0], m.plateBack, 'plate-back');
  const fp = addMesh(shell, plateGeo, placeholder, 'plate');
  fp.position.set(L + 0.017, frontPlateY, 0);
  fp.rotation.y = Math.PI / 2;
  fp.castShadow = false;
  const rearPlateY = Math.max(gc + 0.32, Math.min(s.deckHeight - 0.32, (gc + s.deckHeight) / 2 + 0.05));
  box(shell, [0.03, 0.13, 0.55], [0.0, rearPlateY, 0], m.plateBack, 'plate-back');
  const rp = addMesh(shell, plateGeo, placeholder, 'plate');
  rp.position.set(-0.017, rearPlateY, 0);
  rp.rotation.y = -Math.PI / 2;
  rp.castShadow = false;

  // Mirrors
  const mirror = sideMirrorLayout(s);
  // the player's hollow body gets detailed mirrors from the interior instead
  for (const side of hollow ? [] : [-1, 1]) {
    box(shell, [0.08, 0.04, 0.12], [mirror.x + 0.09, s.beltHeight + 0.04, side * (Wc / 2 + 0.04)], m.trim, 'trim');
    box(shell, [0.13, mirror.height + 0.02, mirror.width + 0.02], [mirror.x + 0.075, mirror.y, side * mirror.z], placeholder, 'paint');
  }

  // Door seams and handles
  const seamXs = new Set<number>();
  for (const [a, b] of s.doors) {
    seamXs.add(a);
    seamXs.add(b);
  }
  for (const x of seamXs) {
    const bottom = seamBottom(s, x);
    const top = s.beltHeight - 0.04;
    if (top - bottom < 0.1) continue;
    for (const side of [-1, 1]) {
      const seam = box(shell, [0.007, top - bottom, 0.004], [x, (top + bottom) / 2, side * (W / 2 + 0.001)], m.black, 'seam');
      seam.castShadow = false;
    }
  }
  for (const [a] of s.doors) {
    for (const side of [-1, 1]) {
      const handle = box(shell, [0.15, 0.03, 0.025], [a + 0.18, s.beltHeight - 0.13, side * (W / 2 + 0.008)], m.chrome, 'chrome');
      handle.castShadow = false;
    }
  }

  // Side skirts
  const dx = archHalfSpan(s);
  const skirtStart = ro + dx + 0.02;
  const skirtEnd = L - s.frontOverhang - dx - 0.02;
  if (skirtEnd > skirtStart) {
    for (const side of [-1, 1]) {
      box(shell, [skirtEnd - skirtStart, 0.08, 0.05], [(skirtStart + skirtEnd) / 2, gc + 0.04, side * (W / 2 - 0.05)], m.trim, 'trim');
    }
  }

  // Exhaust
  const exhaust = new THREE.CylinderGeometry(0.035, 0.035, 0.16, 14);
  exhaust.rotateZ(Math.PI / 2);
  const ex = addMesh(shell, exhaust, m.chrome, 'chrome');
  ex.position.set(0.03, gc + 0.06, W / 2 - 0.45);

  // Extras
  if (s.roofRails) {
    for (const side of [-1, 1]) {
      box(shell, [c.roofFront - c.roofRear - 0.3, 0.04, 0.045], [(c.roofFront + c.roofRear) / 2, s.height + 0.03, side * (Wc / 2 - 0.13)], m.trim, 'trim');
    }
  }
  if (s.spoiler) {
    box(shell, [0.2, 0.025, W - 0.42], [0.2, s.deckHeight + 0.07, 0], placeholder, 'paint');
    for (const side of [-1, 1]) box(shell, [0.06, 0.06, 0.03], [0.22, s.deckHeight + 0.03, side * (W / 2 - 0.4)], m.trim, 'trim');
  }
  if (s.tonneau) {
    const bedEnd = c.rearBase - 0.06;
    box(shell, [bedEnd - 0.12, 0.03, W - 0.2], [0.06 + bedEnd / 2, s.deckHeight + 0.005, 0], m.tonneau, 'tonneau');
    box(shell, [0.04, 0.05, W - 0.14], [c.rearBase - 0.02, s.deckHeight + 0.02, 0], m.trim, 'trim');
  }

  // Wheels
  const wheel = wheelGeometries(s.wheelRadius, s.tireWidth);
  const wheels: [number, number][] = [
    [0, -1],
    [0, 1],
    [s.wheelbase, -1],
    [s.wheelbase, 1],
  ];
  wheels.forEach(([x, side], i) => {
    const steer = new THREE.Group();
    steer.name = `steer-${i}`;
    steer.position.set(x, s.wheelRadius, (side * s.track) / 2);
    const spin = new THREE.Group();
    spin.name = `spin-${i}`;
    steer.add(spin);
    const model = new THREE.Group();
    if (side < 0) model.rotation.y = Math.PI;
    spin.add(model);
    addMesh(model, wheel.tire, m.tire, 'tire');
    addMesh(model, wheel.rim, m.rim, 'rim');
    addMesh(model, wheel.rimDark, m.rimDark, 'rim-dark');
    root.add(steer);
  });

  return root;
}

const templateCache = new Map<string, THREE.Group>();
const staticTemplateCache = new Map<string, THREE.Group>();
const SWAPPED_PARTS = new Set(['paint', 'head', 'tail', 'reverse', 'plate']);

function getTemplate(spec: VehicleSpec, hollow = false): THREE.Group {
  const key = `${spec.id}:${hollow ? 'hollow' : 'solid'}`;
  const cached = templateCache.get(key);
  if (cached) return cached;
  const built = buildTemplate(spec, hollow);
  templateCache.set(key, built);
  return built;
}

/** Same car with every part baked into one mesh per material — far fewer draw calls for parked cars. */
function getStaticTemplate(spec: VehicleSpec): THREE.Group {
  const cached = staticTemplateCache.get(spec.id);
  if (cached) return cached;
  const source = getTemplate(spec);
  source.updateMatrixWorld(true);
  const buckets = new Map<string, { name: string; material: THREE.Material; geometries: THREE.BufferGeometry[]; shadow: boolean }>();
  source.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || !(obj.material instanceof THREE.Material)) return;
    const swapped = SWAPPED_PARTS.has(obj.name);
    const key = swapped ? obj.name : obj.material.uuid;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { name: swapped ? obj.name : 'static', material: obj.material, geometries: [], shadow: false };
      buckets.set(key, bucket);
    }
    const geo = obj.geometry.index ? obj.geometry.toNonIndexed() : obj.geometry.clone();
    for (const name of Object.keys(geo.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
    }
    geo.applyMatrix4(obj.matrixWorld);
    bucket.geometries.push(geo);
    bucket.shadow ||= obj.castShadow;
  });
  const group = new THREE.Group();
  for (const bucket of buckets.values()) {
    const merged = mergeGeometries(bucket.geometries);
    for (const g of bucket.geometries) g.dispose();
    const mesh = new THREE.Mesh(merged, bucket.material);
    mesh.name = bucket.name;
    mesh.castShadow = bucket.shadow;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  staticTemplateCache.set(spec.id, group);
  return group;
}

export interface WheelVisual {
  steer: THREE.Object3D;
  spin: THREE.Object3D;
  front: boolean;
  left: boolean;
}


export interface CarVisual {
  root: THREE.Group;
  body: THREE.Object3D;
  wheels: WheelVisual[];
  spec: VehicleSpec;
  lights: CarLightMaterials;
  interior: InteriorVisual | null;
  dispose(): void;
}

/** `animated` cars keep separate wheel/body nodes; static ones are merged for rendering speed. */
export function createCarVisual(spec: VehicleSpec, colorHex: string, plateText: string, animated: boolean): CarVisual {
  const ownLights = animated;
  const root = (animated ? getTemplate(spec, true) : getStaticTemplate(spec)).clone(true);
  const paint = createPaintMaterial(colorHex);
  const plateTexture = createPlateTexture(plateText);
  const plate = new THREE.MeshStandardMaterial({ map: plateTexture, roughness: 0.4, metalness: 0.1 });
  const lights = ownLights ? createLightMaterials() : sharedMaterials().lightsOff;
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    switch (obj.name) {
      case 'paint':
        obj.material = paint;
        break;
      case 'head':
        obj.material = lights.head;
        break;
      case 'tail':
        obj.material = lights.tail;
        break;
      case 'reverse':
        obj.material = lights.reverse;
        break;
      case 'plate':
        obj.material = plate;
        break;
      case 'glass':
        if (animated) obj.material = interiorMaterials().playerGlass;
        break;
      default:
        break;
    }
  });
  const wheels: WheelVisual[] = [];
  let body: THREE.Object3D = root;
  if (animated) {
    for (let i = 0; i < 4; i++) {
      const steer = root.getObjectByName(`steer-${i}`);
      const spin = root.getObjectByName(`spin-${i}`);
      if (!steer || !spin) throw new Error('Car template is missing wheel nodes');
      wheels.push({ steer, spin, front: i >= 2, left: i % 2 === 0 });
    }
    const named = root.getObjectByName('body');
    if (!named) throw new Error('Car template is missing body node');
    body = named;
  }
  const interior = animated ? buildInterior(spec) : null;
  if (interior) {
    interior.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.name === 'paint') obj.material = paint;
    });
    body.add(interior.group);
  }
  return {
    root,
    body,
    wheels,
    spec,
    lights,
    interior,
    dispose: () => {
      interior?.dispose();
      paint.dispose();
      plate.dispose();
      plateTexture.dispose();
      if (ownLights) {
        lights.head.dispose();
        lights.tail.dispose();
        lights.reverse.dispose();
      }
    },
  };
}

/** SVG path data for the vehicle's side silhouette (y flipped, units in meters). */
export function silhouettePath(spec: VehicleSpec): string {
  const toPath = (points: readonly ProfilePoint[]): string => {
    const pts = roundedShape(points).getPoints(6);
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(3)},${(-p.y).toFixed(3)}`).join(' ') + ' Z';
  };
  return `${toPath(lowerBodyPoints(spec))} ${toPath(cabinPoints(spec))}`;
}
