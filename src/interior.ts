import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { rearOverhang, sideMirrorLayout, type VehicleSpec } from './vehicles';
import { createClusterCanvas, createInteriorTextures, createScreenIdleTexture, drawCluster, type ClusterState } from './textures';

/** Profile point (x forward, y up) with a corner radius. */
type ProfileCorner = readonly [x: number, y: number, r: number];

interface InteriorMaterials {
  softTouch: THREE.MeshStandardMaterial;
  plastic: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  leather: THREE.MeshStandardMaterial;
  perforated: THREE.MeshStandardMaterial;
  wheelLeather: THREE.MeshStandardMaterial;
  headliner: THREE.MeshStandardMaterial;
  carpet: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  aluminium: THREE.MeshStandardMaterial;
  chrome: THREE.MeshStandardMaterial;
  pianoBlack: THREE.MeshPhysicalMaterial;
  speaker: THREE.MeshStandardMaterial;
  vent: THREE.MeshStandardMaterial;
  domeLens: THREE.MeshStandardMaterial;
  standInGlass: THREE.MeshPhysicalMaterial;
  playerGlass: THREE.MeshPhysicalMaterial;
  idleScreen: THREE.Texture;
}

let shared: InteriorMaterials | null = null;

function withRepeat(texture: THREE.Texture, repeat: number): THREE.Texture {
  const t = texture.clone();
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

export function interiorMaterials(): InteriorMaterials {
  if (shared) return shared;
  const tex = createInteriorTextures();
  const stipple = withRepeat(tex.stippleNormal, 5);
  const leatherNormal = withRepeat(tex.leatherNormal, 9);
  const perfNormal = withRepeat(tex.perforatedNormal, 8);
  const perfMap = withRepeat(tex.perforatedMap, 8);
  const fabricMap = withRepeat(tex.fabricMap, 6);
  const fabricNormal = withRepeat(tex.fabricNormal, 6);
  const carpetMap = withRepeat(tex.carpetMap, 4);
  const brushed = withRepeat(tex.brushedRoughness, 2);
  const speakerMap = withRepeat(tex.speakerMap, 6);
  const env = 1.35;
  shared = {
    softTouch: new THREE.MeshStandardMaterial({ color: '#36373b', roughness: 0.82, normalMap: stipple, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: env }),
    plastic: new THREE.MeshStandardMaterial({ color: '#45464a', roughness: 0.72, normalMap: stipple, normalScale: new THREE.Vector2(0.45, 0.45), envMapIntensity: env }),
    accent: new THREE.MeshStandardMaterial({ color: '#8a7865', roughness: 0.58, normalMap: leatherNormal, normalScale: new THREE.Vector2(0.25, 0.25), envMapIntensity: env }),
    leather: new THREE.MeshStandardMaterial({ color: '#8e806f', roughness: 0.52, normalMap: leatherNormal, normalScale: new THREE.Vector2(0.3, 0.3), envMapIntensity: env }),
    perforated: new THREE.MeshStandardMaterial({ color: '#8e806f', map: perfMap, roughness: 0.6, normalMap: perfNormal, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: env }),
    wheelLeather: new THREE.MeshStandardMaterial({ color: '#1f1f21', roughness: 0.5, normalMap: leatherNormal, normalScale: new THREE.Vector2(0.4, 0.4), envMapIntensity: env }),
    headliner: new THREE.MeshStandardMaterial({ color: '#d2ccc1', map: fabricMap, roughness: 0.96, normalMap: fabricNormal, normalScale: new THREE.Vector2(0.4, 0.4), side: THREE.DoubleSide, envMapIntensity: env }),
    carpet: new THREE.MeshStandardMaterial({ color: '#2c2c2f', map: carpetMap, roughness: 1, envMapIntensity: env }),
    rubber: new THREE.MeshStandardMaterial({ color: '#141416', roughness: 0.9, envMapIntensity: env }),
    aluminium: new THREE.MeshStandardMaterial({ color: '#c3c7cc', metalness: 1, roughness: 0.32, roughnessMap: brushed, envMapIntensity: 1.2 }),
    chrome: new THREE.MeshStandardMaterial({ color: '#e8eaec', metalness: 1, roughness: 0.08, envMapIntensity: 1.2 }),
    pianoBlack: new THREE.MeshPhysicalMaterial({ color: '#060607', roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.1 }),
    speaker: new THREE.MeshStandardMaterial({ color: '#58595d', map: speakerMap, metalness: 0.6, roughness: 0.55, envMapIntensity: env }),
    vent: new THREE.MeshStandardMaterial({ color: '#0b0b0c', roughness: 0.9 }),
    domeLens: new THREE.MeshStandardMaterial({ color: '#e9e6df', roughness: 0.35, transparent: true, opacity: 0.85, envMapIntensity: env }),
    standInGlass: new THREE.MeshPhysicalMaterial({ color: '#1b2229', metalness: 0.2, roughness: 0.05, envMapIntensity: 1.6 }),
    playerGlass: new THREE.MeshPhysicalMaterial({
      color: '#0d151c',
      metalness: 0,
      roughness: 0.04,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      envMapIntensity: 1.2,
      side: THREE.DoubleSide,
    }),
    idleScreen: createScreenIdleTexture(),
  };
  return shared;
}

// ---------- geometry helpers ----------

/**
 * Box-projected UVs in metres so procedural textures keep a consistent scale
 * regardless of the size of each part.
 */
function boxUV(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nor.getX(i));
    const ay = Math.abs(nor.getY(i));
    const az = Math.abs(nor.getZ(i));
    let u: number;
    let v: number;
    if (ax >= ay && ax >= az) {
      u = pos.getZ(i);
      v = pos.getY(i);
    } else if (ay >= az) {
      u = pos.getX(i);
      v = pos.getZ(i);
    } else {
      u = pos.getX(i);
      v = pos.getY(i);
    }
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

function profileShape(points: readonly ProfileCorner[]): THREE.Shape {
  const shape = new THREE.Shape();
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const cur = points[i];
    const next = points[(i + 1) % n];
    if (!prev || !cur || !next) continue;
    const [cx, cy, r] = cur;
    if (r <= 0) {
      if (i === 0) shape.moveTo(cx, cy);
      else shape.lineTo(cx, cy);
      continue;
    }
    const dPrev = Math.hypot(prev[0] - cx, prev[1] - cy);
    const dNext = Math.hypot(next[0] - cx, next[1] - cy);
    const cut = Math.min(r, dPrev * 0.5, dNext * 0.5);
    const ax = cx + ((prev[0] - cx) / dPrev) * cut;
    const ay = cy + ((prev[1] - cy) / dPrev) * cut;
    const bx = cx + ((next[0] - cx) / dNext) * cut;
    const by = cy + ((next[1] - cy) / dNext) * cut;
    if (i === 0) shape.moveTo(ax, ay);
    else shape.lineTo(ax, ay);
    shape.quadraticCurveTo(cx, cy, bx, by);
  }
  shape.closePath();
  return shape;
}

/** Extrudes a side profile across the car (along z), centred on z = 0, with rounded side edges. */
function extrudeProfile(points: readonly ProfileCorner[], width: number, bevel: number): THREE.BufferGeometry {
  const b = Math.min(bevel, width * 0.3);
  const geo = new THREE.ExtrudeGeometry(profileShape(points), {
    depth: width - b * 2,
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    bevelOffset: -b,
    bevelSegments: 4,
    curveSegments: 10,
  });
  geo.translate(0, 0, -(width - b * 2) / 2);
  return boxUV(toCreasedNormals(geo, 0.7));
}

/** Extrudes a shape drawn in the XY plane along +z, starting at `z0`. */
function extrudeFlat(shape: THREE.Shape, depth: number, bevel: number, z0: number): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, depth - bevel * 2),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel,
    bevelSegments: 3,
    curveSegments: 12,
  });
  geo.translate(0, 0, z0 + bevel);
  return boxUV(toCreasedNormals(geo, 0.7));
}

function roundedBox(w: number, h: number, d: number, r: number): THREE.BufferGeometry {
  const radius = Math.min(r, w / 2 - 0.0005, h / 2 - 0.0005, d / 2 - 0.0005);
  return boxUV(new RoundedBoxGeometry(w, h, d, 3, Math.max(0.0005, radius)));
}

interface PartOptions {
  rotZ?: number;
  rotX?: number;
  rotY?: number;
  shadow?: boolean;
}

class Builder {
  constructor(readonly group: THREE.Object3D) {}

  mesh(geometry: THREE.BufferGeometry, material: THREE.Material, pos: readonly [number, number, number], opts: PartOptions = {}, parent: THREE.Object3D = this.group): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.rotation.set(opts.rotX ?? 0, opts.rotY ?? 0, opts.rotZ ?? 0);
    mesh.receiveShadow = true;
    mesh.castShadow = opts.shadow ?? false;
    parent.add(mesh);
    return mesh;
  }

  box(size: readonly [number, number, number], r: number, material: THREE.Material, pos: readonly [number, number, number], opts: PartOptions = {}, parent: THREE.Object3D = this.group): THREE.Mesh {
    return this.mesh(roundedBox(size[0], size[1], size[2], r), material, pos, opts, parent);
  }

  /** A rounded bar between two profile points (x, y) at lateral position z. */
  bar(from: readonly [number, number], to: readonly [number, number], z: number, thickness: number, depth: number, material: THREE.Material): void {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const len = Math.hypot(dx, dy);
    if (len < 0.15) return;
    this.box([len, thickness, depth], Math.min(thickness, depth) * 0.45, material, [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, z], { rotZ: Math.atan2(dy, dx) });
  }
}

// ---------- mirrors ----------

/** Mirror render targets follow the screen's pixel density (capped like the main renderer). */
/** Fraction of the screen height a door mirror fills while the driver glances at it. */
const MIRROR_SCREEN_FRACTION = 0.2;
const MIRROR_PIXEL_RATIO = Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio, 2);

export interface MirrorVisual {
  reflector: Reflector;
  /** Non-reflective stand-in shown when the driver's view is not active. */
  standIn: THREE.Mesh;
  /** Pivot holding the glass; tilted to dip the mirror. */
  pivot: THREE.Object3D;
  baseQuaternion: THREE.Quaternion;
  /** -1 left, 1 right, 0 interior rear-view mirror. */
  side: -1 | 0 | 1;
  /**
   * Driver-view look angles (yaw +left, pitch +up, radians) that centre this mirror, and the
   * vertical field of view (degrees) at which it fills a comfortable part of the screen.
   */
  gaze: { yaw: number; pitch: number; fov: number };
}

/** Glass outline in the mirror's plane: rounded rectangle for the rear-view mirror, tapered for door mirrors. */
function mirrorOutline(width: number, height: number, outer: -1 | 0 | 1, grow: number): THREE.Shape {
  const w = width / 2 + grow;
  const h = height / 2 + grow;
  if (outer === 0) {
    const r = Math.min(w, h) * 0.55;
    return profileShape([
      [-w, -h, r],
      [w, -h, r],
      [w, h, r],
      [-w, h, r],
    ]);
  }
  // inner edge full height; the outer end is shorter, with a top that falls away and a big radius
  const o = outer;
  return profileShape([
    [-o * w, -h, h * 0.25],
    [o * w, -h * 0.95, h * 0.85],
    [o * w, h * 0.35, h * 0.9],
    [-o * w * 0.55, h, h * 0.6],
    [-o * w, h, h * 0.3],
  ]);
}

/**
 * A mirror whose glass is oriented so that the driver sees along `viewDir` (body-local),
 * using the law of reflection: the normal bisects the eye direction and the view direction.
 */
function createMirror(b: Builder, pos: THREE.Vector3, eye: THREE.Vector3, viewDir: THREE.Vector3, width: number, height: number, texWidth: number, side: -1 | 0 | 1): MirrorVisual {
  const m = interiorMaterials();
  const toEye = eye.clone().sub(pos);
  const normal = toEye.clone().normalize().add(viewDir.clone().normalize()).normalize();
  // keep the glass level: local x horizontal, local y as close to up as the normal allows
  const xAxis = new THREE.Vector3(0, 1, 0).cross(normal).normalize();
  const yAxis = normal.clone().cross(xAxis).normalize();
  const quat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, normal));
  const pivot = new THREE.Group();
  pivot.position.copy(pos);
  pivot.quaternion.copy(quat);
  b.group.add(pivot);

  // local +x points toward +z (the car's right) for both door mirrors, so the outer end is +x on the right
  const outer: -1 | 0 | 1 = side === 0 ? 0 : side > 0 ? 1 : -1;
  const outerSign: -1 | 0 | 1 = side === 0 ? 0 : xAxis.z * side > 0 ? 1 : -1;
  const geo = new THREE.ShapeGeometry(mirrorOutline(width, height, outerSign, 0), 10);
  const reflector = new Reflector(geo, {
    color: '#d9dcdf',
    textureWidth: Math.round(texWidth * MIRROR_PIXEL_RATIO),
    textureHeight: Math.round((texWidth * MIRROR_PIXEL_RATIO * height) / width),
    clipBias: 0.003,
    multisample: 4,
  });
  reflector.visible = false;
  const standIn = new THREE.Mesh(geo, m.standInGlass);
  standIn.position.z = -0.001;
  pivot.add(reflector, standIn);

  // fixed shell around the glass (the glass dips inside it)
  const shell = new THREE.Group();
  shell.position.copy(pos);
  shell.quaternion.copy(quat);
  b.group.add(shell);
  const rim = mirrorOutline(width, height, outerSign, 0.012);
  rim.holes.push(mirrorOutline(width, height, outerSign, -0.002));
  b.mesh(extrudeFlat(rim, 0.018, 0.004, -0.014), m.rubber, [0, 0, 0], { shadow: true }, shell);
  if (outer === 0) {
    b.mesh(extrudeFlat(mirrorOutline(width, height, 0, 0.01), 0.035, 0.012, -0.045), m.plastic, [0, 0, 0], { shadow: true }, shell);
  } else {
    const housing = b.mesh(extrudeFlat(mirrorOutline(width, height, outerSign, 0.014), 0.12, 0.035, -0.128), m.plastic, [0, 0, 0], { shadow: true }, shell);
    housing.name = 'paint';
  }
  const gaze = toEye.clone().negate();
  return {
    reflector,
    standIn,
    pivot,
    baseQuaternion: quat.clone(),
    side,
    gaze: {
      yaw: Math.atan2(-gaze.z, gaze.x),
      pitch: Math.atan2(gaze.y, Math.hypot(gaze.x, gaze.z)),
      fov: THREE.MathUtils.radToDeg(2 * Math.atan(height / MIRROR_SCREEN_FRACTION / 2 / gaze.length())),
    },
  };
}

// ---------- interior ----------

export interface InteriorVisual {
  group: THREE.Group;
  steeringWheel: THREE.Object3D;
  screen: THREE.Mesh;
  screenMaterial: THREE.MeshBasicMaterial;
  idleScreen: THREE.Texture;
  mirrors: MirrorVisual[];
  /** Driver eye position in body-local coordinates. */
  eye: THREE.Vector3;
  /** Redraws the instrument cluster when the shown values change. */
  updateCluster(state: ClusterState): void;
  /** Scales screen brightness so displays stay readable under any exposure. */
  setDisplayBrightness(exposure: number): void;
  dispose(): void;
}

interface Seat {
  /** Hip point: rear-top of the cushion. */
  hx: number;
  hy: number;
  z: number;
  width: number;
  /** Height of the headrest centre above the hip point. */
  headY: number;
}

const BACK_RAKE = 0.3;

function buildSeat(b: Builder, seat: Seat, floorY: number): void {
  const m = interiorMaterials();
  const { hx, hy, z, width } = seat;
  const insert = width * 0.52;
  const bolsterW = (width - insert) / 2 + 0.01;
  const bolsterZ = insert / 2 + bolsterW / 2 - 0.012;

  // pedestal and rails
  b.box([0.42, hy - floorY - 0.08, width - 0.12], 0.02, m.plastic, [hx + 0.2, (hy + floorY - 0.08) / 2, z]);
  for (const s of [-1, 1]) b.box([0.5, 0.025, 0.035], 0.008, m.rubber, [hx + 0.2, floorY + 0.012, z + s * (width / 2 - 0.12)]);

  // cushion
  const cushion = new THREE.Group();
  cushion.position.set(hx, hy, z);
  cushion.rotation.z = 0.07;
  b.group.add(cushion);
  b.box([0.47, 0.09, insert], 0.035, m.perforated, [0.24, -0.045, 0], { shadow: true }, cushion);
  b.box([0.5, 0.06, width - 0.04], 0.03, m.leather, [0.25, -0.1, 0], {}, cushion);
  b.box([0.07, 0.11, width - 0.06], 0.04, m.leather, [0.46, -0.06, 0], {}, cushion);
  for (const s of [-1, 1]) b.box([0.5, 0.13, bolsterW], 0.05, m.leather, [0.24, -0.035, s * bolsterZ], { shadow: true }, cushion);

  // backrest
  const back = new THREE.Group();
  back.position.set(hx + 0.01, hy - 0.03, z);
  back.rotation.z = BACK_RAKE;
  b.group.add(back);
  const headY = seat.headY / Math.cos(BACK_RAKE);
  const backTop = Math.max(0.42, headY - 0.17);
  const panelH = backTop - 0.1;
  b.box([0.09, panelH, insert], 0.035, m.perforated, [-0.06, 0.04 + panelH / 2, 0], { shadow: true }, back);
  b.box([0.1, backTop, width - 0.04], 0.035, m.leather, [-0.115, backTop / 2, 0], {}, back);
  for (const s of [-1, 1]) {
    b.box([0.17, panelH * 0.9, bolsterW], 0.06, m.leather, [-0.05, 0.03 + (panelH * 0.9) / 2, s * bolsterZ], { shadow: true }, back);
  }
  b.box([0.14, 0.13, width - 0.03], 0.055, m.leather, [-0.085, backTop - 0.03, 0], { shadow: true }, back);
  // headrest on two posts
  for (const s of [-1, 1]) {
    b.mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.1, 8), m.chrome, [-0.085, backTop + 0.05, s * 0.07], {}, back);
  }
  b.box([0.11, 0.18, Math.min(0.28, insert + 0.02)], 0.05, m.leather, [-0.08, Math.max(backTop + 0.12, headY), 0], { shadow: true }, back);
}

function buildRearBench(b: Builder, hx: number, hy: number, width: number, maxTop: (x: number) => number, floorY: number): void {
  const m = interiorMaterials();
  b.box([0.46, hy - floorY - 0.08, width - 0.04], 0.03, m.plastic, [hx + 0.2, (hy + floorY - 0.08) / 2, 0]);
  const cushion = new THREE.Group();
  cushion.position.set(hx, hy, 0);
  cushion.rotation.z = 0.06;
  b.group.add(cushion);
  b.box([0.48, 0.12, width], 0.05, m.leather, [0.23, -0.06, 0], { shadow: true }, cushion);
  const rake = 0.36;
  // largest backrest that stays under the roof / rear glass
  let height = 0.62;
  while (height > 0.3) {
    const topX = hx - height * Math.sin(rake) - 0.1;
    if (hy + height * Math.cos(rake) + 0.12 < maxTop(topX)) break;
    height -= 0.02;
  }
  const back = new THREE.Group();
  back.position.set(hx, hy - 0.03, 0);
  back.rotation.z = rake;
  b.group.add(back);
  b.box([0.14, height, width], 0.055, m.leather, [-0.09, height / 2, 0], { shadow: true }, back);
  const seats = [-1, 1];
  for (const s of seats) {
    const z = s * width * 0.27;
    b.box([0.04, height * 0.78, width * 0.3], 0.018, m.perforated, [-0.012, height * 0.45, z], {}, back);
    b.box([0.38, 0.02, width * 0.3], 0.008, m.perforated, [0.23, -0.002, z], {}, cushion);
    b.box([0.1, 0.15, 0.25], 0.045, m.leather, [-0.1, height + 0.09, z], { shadow: true }, back);
    b.mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.06, 8), m.chrome, [-0.1, height + 0.01, z - 0.07], {}, back);
    b.mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.06, 8), m.chrome, [-0.1, height + 0.01, z + 0.07], {}, back);
  }
}

function buildSteeringWheel(b: Builder, center: THREE.Vector3, columnLength: number): THREE.Object3D {
  const m = interiorMaterials();
  const tilt = new THREE.Group();
  tilt.position.copy(center);
  tilt.rotation.z = -0.42;
  b.group.add(tilt);

  // column shroud, smooth lathe running from behind the hub into the dash
  const shroudProfile = [
    new THREE.Vector2(0.0, 0.03),
    new THREE.Vector2(0.03, 0.032),
    new THREE.Vector2(0.046, 0.05),
    new THREE.Vector2(0.052, 0.09),
    new THREE.Vector2(0.056, columnLength * 0.7),
    new THREE.Vector2(0.07, columnLength),
  ];
  const shroud = new THREE.Mesh(boxUV(new THREE.LatheGeometry(shroudProfile, 24)), m.softTouch);
  shroud.rotation.z = -Math.PI / 2;
  shroud.castShadow = true;
  shroud.receiveShadow = true;
  tilt.add(shroud);
  // indicator and wiper stalks
  for (const s of [-1, 1]) {
    const stalk = new THREE.Group();
    stalk.position.set(0.075, 0.015, s * 0.045);
    stalk.rotation.set(s * 0.1, 0, 0);
    tilt.add(stalk);
    b.mesh(new THREE.CylinderGeometry(0.0055, 0.007, 0.13, 10), m.softTouch, [0, 0, s * 0.065], { rotX: Math.PI / 2 }, stalk);
    b.mesh(new THREE.CapsuleGeometry(0.0085, 0.035, 4, 10), m.plastic, [0, 0, s * 0.13], { rotX: Math.PI / 2 }, stalk);
  }

  const face = new THREE.Group();
  face.rotation.y = Math.PI / 2;
  tilt.add(face);
  const spin = new THREE.Group();
  face.add(spin);

  const R = 0.183;
  const rimGeo = new THREE.TorusGeometry(R, 0.0165, 16, 72);
  rimGeo.scale(1, 1, 1.4);
  const rim = b.mesh(boxUV(rimGeo), m.wheelLeather, [0, 0, 0], { shadow: true }, spin);
  rim.name = 'rim';
  // 12 o'clock marker stitched into the rim
  const markerGeo = new THREE.TorusGeometry(R, 0.0172, 12, 6, 0.1);
  markerGeo.scale(1, 1, 1.4);
  markerGeo.rotateZ(Math.PI / 2 - 0.05);
  b.mesh(markerGeo, m.accent, [0, 0, 0], {}, spin);

  // spokes (driver side is -z in this frame)
  const spokeShape = (pts: readonly (readonly [number, number])[]): THREE.Shape => {
    const sh = new THREE.Shape();
    pts.forEach(([x, y], i) => (i === 0 ? sh.moveTo(x, y) : sh.lineTo(x, y)));
    sh.closePath();
    return sh;
  };
  for (const s of [-1, 1]) {
    const pts: (readonly [number, number])[] = [
      [s * 0.055, 0.03],
      [s * (R - 0.004), 0.012],
      [s * (R - 0.004), -0.03],
      [s * 0.07, -0.05],
    ];
    b.mesh(extrudeFlat(spokeShape(pts), 0.02, 0.006, -0.018), m.softTouch, [0, 0, 0], { shadow: true }, spin);
    // aluminium bezel and switch pads on the spoke
    b.box([0.07, 0.04, 0.01], 0.006, m.pianoBlack, [s * 0.11, -0.008, -0.019], {}, spin);
    for (const [bx, by] of [
      [-0.018, 0.008],
      [0.018, 0.008],
      [-0.018, -0.012],
      [0.018, -0.012],
    ] as const) {
      b.box([0.014, 0.011, 0.006], 0.003, m.plastic, [s * 0.11 + bx, -0.008 + by, -0.025], {}, spin);
    }
    b.box([0.085, 0.004, 0.006], 0.002, m.aluminium, [s * 0.11, 0.0175, -0.019], {}, spin);
  }
  const lower: (readonly [number, number])[] = [
    [-0.04, -0.05],
    [0.04, -0.05],
    [0.022, -(R - 0.004)],
    [-0.022, -(R - 0.004)],
  ];
  b.mesh(extrudeFlat(spokeShape(lower), 0.018, 0.006, -0.016), m.softTouch, [0, 0, 0], {}, spin);
  b.box([0.012, 0.09, 0.006], 0.003, m.aluminium, [0, -0.11, -0.017], {}, spin);

  // airbag pad
  const pad = new THREE.Shape();
  const pw = 0.072;
  const ph = 0.056;
  pad.moveTo(-pw, ph * 0.3);
  pad.quadraticCurveTo(-pw, ph, -pw * 0.55, ph);
  pad.lineTo(pw * 0.55, ph);
  pad.quadraticCurveTo(pw, ph, pw, ph * 0.3);
  pad.lineTo(pw * 0.8, -ph * 0.7);
  pad.quadraticCurveTo(pw * 0.72, -ph * 1.05, pw * 0.35, -ph * 1.05);
  pad.lineTo(-pw * 0.35, -ph * 1.05);
  pad.quadraticCurveTo(-pw * 0.72, -ph * 1.05, -pw * 0.8, -ph * 0.7);
  pad.closePath();
  b.mesh(extrudeFlat(pad, 0.05, 0.016, -0.05), m.wheelLeather, [0, 0, 0], { shadow: true }, spin);
  // badge
  b.mesh(new THREE.TorusGeometry(0.017, 0.0032, 8, 32), m.chrome, [0, 0.002, -0.0505], {}, spin);
  b.box([0.024, 0.005, 0.003], 0.0015, m.chrome, [0, 0.002, -0.0505], {}, spin);
  return spin;
}

function buildVent(b: Builder, x: number, y: number, z: number, width: number, tilt: number): void {
  const m = interiorMaterials();
  const vent = new THREE.Group();
  vent.position.set(x, y, z);
  vent.rotation.z = tilt;
  b.group.add(vent);
  const h = 0.05;
  b.box([0.022, h + 0.014, width + 0.014], 0.008, m.aluminium, [0, 0, 0], {}, vent);
  b.box([0.024, h, width], 0.005, m.vent, [-0.002, 0, 0], {}, vent);
  for (let i = 0; i < 4; i++) {
    b.box([0.016, 0.0035, width - 0.008], 0.0015, m.pianoBlack, [-0.006, -h / 2 + 0.008 + i * ((h - 0.016) / 3), 0], { rotZ: 0.25 }, vent);
  }
  b.box([0.012, 0.012, 0.008], 0.003, m.aluminium, [-0.012, 0.0, 0], {}, vent);
}

export function buildInterior(s: VehicleSpec): InteriorVisual {
  const m = interiorMaterials();
  const ro = rearOverhang(s);
  const c = s.cabin;
  const bl = s.beltHeight;
  const H = s.height;
  const W = s.width;
  const Wc = W * c.widthFactor;
  const gc = s.groundClearance;
  const group = new THREE.Group();
  group.name = 'interior';
  group.position.x = -ro;
  const b = new Builder(group);

  const floorY = gc + 0.12;
  const cabinStart = c.rearBase < 0.3 ? 0.1 : c.rearBase - 0.05;
  const fx = c.frontBase;
  const driverZ = -W * 0.22;
  const eyeX = Math.max(cabinStart + 0.6, c.roofFront - 0.45);
  const eyeY = Math.min(H - 0.2, bl + 0.3);
  const dx = fx - 0.46;
  const cabinLen = fx - cabinStart;
  const innerHalf = Wc / 2 - 0.07;
  const windshieldSlope = (H - (bl - 0.06)) / Math.max(0.01, fx - c.roofFront);
  /** Roof / rear-glass underside height at profile x. */
  const roofAt = (x: number): number => {
    if (x >= c.roofRear) return H - 0.05;
    const t = THREE.MathUtils.clamp((x - c.rearBase) / Math.max(0.01, c.roofRear - c.rearBase), 0, 1);
    return bl + (H - 0.05 - bl) * t;
  };

  // ---- floor, mats and pedals ----
  b.box([cabinLen, 0.05, Wc - 0.08], 0.02, m.carpet, [cabinStart + cabinLen / 2, floorY - 0.02, 0]);
  b.box([0.2, 0.08, 0.3], 0.03, m.carpet, [cabinStart + cabinLen * 0.55, floorY + 0.02, 0]);
  for (const z of [driverZ, -driverZ]) {
    b.box([0.46, 0.012, 0.44], 0.006, m.rubber, [Math.min(fx - 0.38, eyeX + 0.48), floorY + 0.012, z]);
  }
  const pedalX = fx - 0.2;
  b.box([0.022, 0.2, 0.065], 0.01, m.rubber, [pedalX + 0.02, floorY + 0.13, driverZ + 0.13], { rotZ: -0.35 });
  b.box([0.024, 0.075, 0.11], 0.012, m.rubber, [pedalX - 0.04, floorY + 0.21, driverZ - 0.03], { rotZ: -0.3 });
  b.box([0.03, 0.14, 0.02], 0.008, m.plastic, [pedalX, floorY + 0.3, driverZ - 0.03], { rotZ: 0.4 });

  // ---- dashboard: sculpted upper (soft-touch) and lower (two-tone) sections ----
  const dashW = Wc - 0.04;
  const upper: ProfileCorner[] = [
    [fx + 0.03, bl - 0.1, 0],
    [fx - 0.12, bl - 0.025, 0.06],
    [dx + 0.22, bl + 0.035, 0.12],
    [dx - 0.01, bl + 0.03, 0.045],
    [dx - 0.045, bl - 0.03, 0.04],
    [dx - 0.03, bl - 0.135, 0.03],
    [dx + 0.06, bl - 0.155, 0],
    [fx + 0.03, bl - 0.155, 0],
  ];
  b.mesh(extrudeProfile(upper, dashW, 0.03), m.softTouch, [0, 0, 0], { shadow: true });
  const lowerDash: ProfileCorner[] = [
    [dx + 0.0, bl - 0.13, 0.02],
    [dx + 0.05, bl - 0.3, 0.1],
    [dx + 0.24, bl - 0.44, 0.1],
    [fx - 0.12, floorY + 0.14, 0.12],
    [fx - 0.06, floorY - 0.01, 0],
    [fx + 0.03, floorY - 0.01, 0],
    [fx + 0.03, bl - 0.13, 0],
  ];
  b.mesh(extrudeProfile(lowerDash, dashW - 0.02, 0.03), m.plastic, [0, 0, 0]);
  // leatherette band and aluminium trim strip between upper and lower dash
  b.box([0.03, 0.05, dashW - 0.06], 0.012, m.accent, [dx - 0.022, bl - 0.12, 0], { rotZ: -0.15 });
  b.box([0.012, 0.012, dashW - 0.07], 0.005, m.aluminium, [dx - 0.04, bl - 0.093, 0]);
  // glovebox seam and handle (passenger side)
  b.box([0.004, 0.004, 0.42], 0.0015, m.vent, [dx + 0.025, bl - 0.2, -driverZ], { rotZ: 0.3 });
  b.box([0.012, 0.016, 0.1], 0.005, m.aluminium, [dx + 0.01, bl - 0.17, -driverZ], { rotZ: 0.3 });

  // vents
  for (const sd of [-1, 1]) {
    buildVent(b, dx - 0.05, bl - 0.048, sd * (Wc / 2 - 0.15), 0.12, -0.12);
    buildVent(b, dx - 0.05, bl - 0.048, sd * 0.155, 0.1, -0.12);
  }

  // instrument binnacle with live digital cluster
  const binnacle: ProfileCorner[] = [
    [dx - 0.02, bl + 0.0, 0],
    [dx + 0.24, bl + 0.0, 0],
    [dx + 0.2, bl + 0.08, 0.05],
    [dx + 0.03, bl + 0.15, 0.06],
    [dx - 0.05, bl + 0.128, 0.012],
    [dx - 0.008, bl + 0.112, 0],
  ];
  b.mesh(extrudeProfile(binnacle, 0.38, 0.02), m.softTouch, [0, 0, driverZ], { shadow: true });
  const cluster = createClusterCanvas();
  const clusterMaterial = new THREE.MeshBasicMaterial({ map: cluster.texture });
  const clusterTilt = Math.atan2(0.012, 0.112);
  const clusterMesh = b.mesh(new THREE.PlaneGeometry(0.3, 0.094), clusterMaterial, [dx - 0.017, bl + 0.058, driverZ]);
  clusterMesh.rotation.set(-clusterTilt, -Math.PI / 2, 0, 'YXZ');
  b.box([0.01, 0.1, 0.31], 0.004, m.pianoBlack, [dx - 0.01, bl + 0.058, driverZ], { rotZ: -clusterTilt });

  // centre touchscreen on a slim piano-black tablet
  const screenMaterial = new THREE.MeshBasicMaterial({ map: m.idleScreen });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.135), screenMaterial);
  screen.rotation.set(-0.22, -Math.PI / 2, 0, 'YXZ');
  screen.position.set(dx - 0.032, bl + 0.08, 0);
  group.add(screen);
  const bezel = b.box([0.27, 0.165, 0.018], 0.01, m.pianoBlack, [dx - 0.02, bl + 0.08, 0]);
  bezel.rotation.set(-0.22, -Math.PI / 2, 0, 'YXZ');
  bezel.position.addScaledVector(new THREE.Vector3(1, 0, 0), 0.002);

  // climate panel on the centre stack
  const climate = new THREE.Group();
  climate.position.set(dx + 0.022, bl - 0.215, 0);
  climate.rotation.z = 0.24;
  group.add(climate);
  b.box([0.018, 0.085, 0.3], 0.008, m.pianoBlack, [0, 0, 0], {}, climate);
  for (const sd of [-1, 1]) {
    b.mesh(new THREE.CylinderGeometry(0.022, 0.024, 0.02, 32), m.aluminium, [-0.018, 0, sd * 0.105], { rotZ: Math.PI / 2 }, climate);
    b.mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.004, 32), m.plastic, [-0.029, 0, sd * 0.105], { rotZ: Math.PI / 2 }, climate);
  }
  for (let i = 0; i < 5; i++) {
    b.box([0.008, 0.018, 0.026], 0.004, m.plastic, [-0.011, 0.016, -0.06 + i * 0.03], {}, climate);
    b.box([0.008, 0.018, 0.026], 0.004, m.plastic, [-0.011, -0.016, -0.06 + i * 0.03], {}, climate);
  }

  // ---- centre console with gear selector, cupholders and armrest ----
  const consoleRear = Math.max(cabinStart + 0.2, eyeX - 0.52);
  const consoleTop = floorY + 0.3;
  const consoleProfile: ProfileCorner[] = [
    [dx + 0.12, bl - 0.24, 0],
    [dx + 0.02, bl - 0.3, 0.06],
    [eyeX + 0.2, consoleTop, 0.1],
    [consoleRear, consoleTop, 0.03],
    [consoleRear, floorY, 0],
    [dx + 0.12, floorY, 0],
  ];
  const seatW = Math.min(0.54, Wc / 2 - 0.2);
  const consoleW = THREE.MathUtils.clamp(2 * (Math.abs(driverZ) - seatW / 2) - 0.03, 0.14, 0.26);
  b.mesh(extrudeProfile(consoleProfile, consoleW, 0.04), m.plastic, [0, 0, 0], { shadow: true });
  b.box([0.3, 0.012, consoleW - 0.06], 0.005, m.pianoBlack, [eyeX + 0.08, consoleTop + 0.005, 0]);
  // gear selector
  const gearX = eyeX + 0.14;
  b.mesh(new THREE.TorusGeometry(0.03, 0.004, 8, 32), m.chrome, [gearX, consoleTop + 0.012, 0], { rotX: Math.PI / 2 });
  b.mesh(new THREE.CylinderGeometry(0.018, 0.03, 0.05, 20), m.rubber, [gearX, consoleTop + 0.035, 0]);
  const knob = b.mesh(new THREE.SphereGeometry(0.03, 24, 16), m.wheelLeather, [gearX - 0.005, consoleTop + 0.085, 0], { shadow: true });
  knob.scale.set(1.25, 1, 0.95);
  b.box([0.01, 0.026, 0.026], 0.004, m.aluminium, [gearX + 0.03, consoleTop + 0.09, 0]);
  // cupholders
  for (const sd of [-1, 1]) {
    const cupZ = sd * Math.min(0.05, consoleW / 2 - 0.04);
    b.mesh(new THREE.CircleGeometry(0.032, 28), m.vent, [eyeX - 0.02 - sd * 0.035, consoleTop + 0.012, cupZ], { rotX: -Math.PI / 2 });
    b.mesh(new THREE.TorusGeometry(0.033, 0.003, 6, 28), m.aluminium, [eyeX - 0.02 - sd * 0.035, consoleTop + 0.012, cupZ], { rotX: Math.PI / 2 });
  }
  // armrest
  const armLen = Math.min(0.36, eyeX - 0.08 - consoleRear);
  if (armLen > 0.15) b.box([armLen, 0.09, consoleW - 0.02], 0.04, m.leather, [eyeX - 0.08 - armLen / 2, consoleTop + 0.07, 0], { shadow: true });

  // ---- door cards ----
  const frontDoor = s.doors.find(([a, e]) => a < eyeX && e > eyeX) ?? [eyeX - 0.5, fx];
  const pillarXs = s.pillars.map((p) => p.x).filter((x) => x > cabinStart + 0.2 && x < fx - 0.2);
  for (const side of [-1, 1]) {
    const zFace = side * innerHalf;
    const len = cabinLen - 0.04;
    const midX = cabinStart + 0.02 + len / 2;
    b.box([len, bl - floorY, 0.07], 0.02, m.plastic, [midX, (bl + floorY) / 2, side * (innerHalf + 0.035)]);
    // window sill cap bridging to the body side
    const capInner = innerHalf - 0.03;
    const capOuter = Wc / 2 + 0.01;
    b.box([len, 0.06, capOuter - capInner], 0.025, m.softTouch, [midX, bl - 0.01, side * ((capInner + capOuter) / 2)]);
    // painted body shoulder outside the glass (named so the car's paint is applied)
    const shoulderOuter = W / 2 - 0.01;
    b.box([len + 0.02, 0.05, shoulderOuter - Wc / 2 + 0.01], 0.02, m.plastic, [midX, bl - 0.022, side * ((Wc / 2 + shoulderOuter) / 2)]).name = 'paint';
    // leatherette inserts per door, split at the pillars
    const splits = [cabinStart + 0.06, ...pillarXs, fx - 0.06];
    for (let i = 0; i < splits.length - 1; i++) {
      const a = (splits[i] ?? 0) + 0.06;
      const e = (splits[i + 1] ?? 0) - 0.06;
      if (e - a < 0.25) continue;
      b.box([e - a, 0.17, 0.03], 0.012, m.accent, [(a + e) / 2, bl - 0.16, zFace - side * 0.008]);
      b.box([e - a + 0.02, 0.008, 0.012], 0.004, m.aluminium, [(a + e) / 2, bl - 0.068, zFace - side * 0.01]);
    }
    for (const px of pillarXs) {
      b.box([0.006, bl - floorY - 0.06, 0.006], 0.002, m.vent, [px, (bl + floorY) / 2, zFace - side * 0.002]);
    }
    // armrest, pull handle, opener, speaker and pocket on the front door
    const armX = THREE.MathUtils.clamp(eyeX + 0.02, frontDoor[0] + 0.25, frontDoor[1] - 0.25);
    b.box([0.42, 0.06, 0.1], 0.026, m.accent, [armX, bl - 0.28, zFace - side * 0.045], { shadow: true, rotZ: 0.04 });
    b.box([0.12, 0.05, 0.04], 0.018, m.plastic, [armX + 0.12, bl - 0.24, zFace - side * 0.08]);
    b.box([0.1, 0.022, 0.016], 0.007, m.chrome, [armX + 0.3, bl - 0.12, zFace - side * 0.02]);
    b.box([0.12, 0.034, 0.012], 0.01, m.vent, [armX + 0.3, bl - 0.12, zFace - side * 0.004]);
    if (side < 0) {
      b.box([0.14, 0.012, 0.055], 0.005, m.pianoBlack, [armX + 0.1, bl - 0.245, zFace + 0.035]);
      for (let i = 0; i < 2; i++) b.box([0.022, 0.008, 0.018], 0.003, m.plastic, [armX + 0.07 + i * 0.05, bl - 0.236, zFace + 0.032]);
    }
    const speakerX = Math.min(frontDoor[1] - 0.2, armX + 0.3);
    b.mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.012, 40), m.speaker, [speakerX, floorY + 0.17, zFace - side * 0.004], { rotX: Math.PI / 2 });
    b.mesh(new THREE.TorusGeometry(0.077, 0.005, 8, 40), m.aluminium, [speakerX, floorY + 0.17, zFace - side * 0.01], {});
    b.box([0.3, 0.08, 0.05], 0.02, m.plastic, [speakerX - 0.3, floorY + 0.11, zFace - side * 0.025]);
  }

  // ---- pillars, roof rails and headliner ----
  for (const side of [-1, 1]) {
    const z = side * (Wc / 2 - 0.06);
    b.bar([fx - 0.02, bl - 0.04], [c.roofFront, H - 0.02], z, 0.085, 0.075, m.headliner);
    b.bar([c.rearBase, bl - 0.04], [c.roofRear, H - 0.02], z, 0.12, 0.075, m.headliner);
    for (const p of s.pillars) b.box([p.width, H - bl, 0.07], 0.025, m.headliner, [p.x, (H + bl) / 2, z]);
    if (s.sideWindowMinX > 0) {
      const len = s.sideWindowMinX - cabinStart;
      b.box([len, H - bl, 0.06], 0.02, m.headliner, [cabinStart + len / 2, (H + bl) / 2, z]);
    }
    const railStart = Math.max(c.roofRear, cabinStart);
    b.box([c.roofFront - railStart, 0.1, 0.1], 0.04, m.headliner, [(c.roofFront + railStart) / 2, H - 0.075, side * (Wc / 2 - 0.06)]);
  }
  const roofStart = Math.max(c.roofRear, cabinStart) + 0.02;
  const roofLen = c.roofFront - roofStart + 0.02;
  const liner = new THREE.PlaneGeometry(roofLen, Wc - 0.08, 10, 16);
  liner.rotateX(Math.PI / 2);
  {
    const pos = liner.getAttribute('position');
    const halfW = (Wc - 0.08) / 2;
    const halfL = roofLen / 2;
    for (let i = 0; i < pos.count; i++) {
      const tz = pos.getZ(i) / halfW;
      const tx = pos.getX(i) / halfL;
      pos.setY(i, -0.045 * tz * tz * tz * tz - 0.02 * tx * tx * tx * tx);
    }
    liner.computeVertexNormals();
  }
  b.mesh(boxUV(liner), m.headliner, [(c.roofFront + roofStart) / 2, H - 0.045, 0]);
  // sun visors, overhead console with dome lights
  for (const side of [-1, 1]) {
    const vz = side * (Wc / 2 - 0.27);
    b.box([0.16, 0.014, 0.32], 0.006, m.headliner, [c.roofFront - 0.1, H - 0.072, vz], { rotZ: 0.1, shadow: true });
    b.mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.05, 8), m.plastic, [c.roofFront - 0.04, H - 0.07, vz - side * 0.19], { rotX: Math.PI / 2 });
  }
  const overheadX = c.roofFront - 0.13;
  b.box([0.2, 0.04, 0.18], 0.016, m.plastic, [overheadX, H - 0.075, 0]);
  for (const sd of [-1, 1]) b.box([0.06, 0.006, 0.05], 0.003, m.domeLens, [overheadX - 0.03, H - 0.096, sd * 0.045]);
  b.box([0.04, 0.008, 0.08], 0.003, m.pianoBlack, [overheadX + 0.06, H - 0.096, 0]);

  // ---- seats ----
  const hipX = eyeX - 0.04;
  const hipY = floorY + 0.28;
  for (const z of [driverZ, -driverZ]) buildSeat(b, { hx: hipX, hy: hipY, z, width: seatW, headY: eyeY - hipY - 0.02 }, floorY);
  if (s.style === 'van') {
    b.box([0.05, H - floorY - 0.06, Wc - 0.08], 0.02, m.plastic, [eyeX - 0.66, (H + floorY) / 2, 0]);
    b.box([0.02, (H - bl) * 0.5, Wc * 0.5], 0.01, m.pianoBlack, [eyeX - 0.63, bl + (H - bl) * 0.45, 0]);
  } else if (eyeX - 0.9 - cabinStart > 0.45) {
    buildRearBench(b, Math.max(cabinStart + 0.42, eyeX - 0.9), floorY + 0.3, Wc - 0.2, roofAt, floorY);
  }
  if (c.rearBase > 0.3) {
    b.box([0.06, bl - floorY, Wc - 0.1], 0.02, m.plastic, [c.rearBase + 0.02, (bl + floorY) / 2, 0]);
    b.box([0.42, 0.03, Wc - 0.12], 0.01, m.carpet, [c.rearBase + 0.2, bl - 0.02, 0]);
    for (const sd of [-1, 1]) b.box([0.14, 0.02, 0.24], 0.008, m.speaker, [c.rearBase + 0.22, bl, sd * (Wc / 2 - 0.25)]);
  } else {
    b.box([0.06, bl - floorY, Wc - 0.1], 0.02, m.plastic, [0.14, (bl + floorY) / 2, 0]);
  }

  // ---- steering wheel ----
  const wheelCenter = new THREE.Vector3(eyeX + 0.47, eyeY - 0.41, driverZ);
  const steeringWheel = buildSteeringWheel(b, wheelCenter, Math.max(0.2, dx + 0.12 - wheelCenter.x));

  // ---- mirrors ----
  const eye = new THREE.Vector3(eyeX, eyeY, driverZ);
  const mirrors: MirrorVisual[] = [];
  const sideMirror = sideMirrorLayout(s);
  for (const side of [-1, 1] as const) {
    const pos = new THREE.Vector3(sideMirror.x, sideMirror.y, side * sideMirror.z);
    mirrors.push(createMirror(b, pos, eye, new THREE.Vector3(-1, -0.03, side * 0.07), sideMirror.width, sideMirror.height, Math.round(sideMirror.width * 2400), side));
    // arm from the door to the housing
    const armIn = Wc / 2 - 0.01;
    const armOut = sideMirror.z - sideMirror.width / 2 + 0.04;
    b.box([0.11, 0.045, armOut - armIn], 0.018, m.rubber, [sideMirror.x + 0.075, bl + 0.045, side * ((armIn + armOut) / 2)], { shadow: true });
  }
  const rearMirrorX = c.roofFront + 0.06;
  const rearMirrorY = Math.min(H - 0.12, H - 0.06 * windshieldSlope - 0.055);
  b.box([0.05, 0.02, 0.05], 0.008, m.plastic, [rearMirrorX + 0.03, rearMirrorY + 0.075, 0], { rotZ: 0.4 });
  b.mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.06, 8), m.plastic, [rearMirrorX + 0.02, rearMirrorY + 0.045, 0]);
  mirrors.push(createMirror(b, new THREE.Vector3(rearMirrorX, rearMirrorY, 0), eye, new THREE.Vector3(-1, -0.02, 0), 0.25, 0.068, 960, 0));

  let clusterKey = '';
  const displayColor = new THREE.Color(1, 1, 1);
  return {
    group,
    steeringWheel,
    screen,
    screenMaterial,
    idleScreen: m.idleScreen,
    mirrors,
    eye: new THREE.Vector3(eyeX - ro, eyeY, driverZ),
    updateCluster: (state) => {
      const sensor = state.sensor === null ? 'x' : (Math.round(state.sensor * 20) / 20).toFixed(2);
      const key = `${Math.round(Math.abs(state.speedKmh))}|${state.gear}|${sensor}`;
      if (key === clusterKey) return;
      clusterKey = key;
      drawCluster(cluster.ctx, cluster.canvas.width, cluster.canvas.height, state);
      cluster.texture.needsUpdate = true;
    },
    setDisplayBrightness: (exposure) => {
      const k = THREE.MathUtils.clamp(0.7 / exposure, 0.8, 1.55);
      displayColor.setRGB(k, k, k);
      screenMaterial.color.copy(displayColor);
      clusterMaterial.color.copy(displayColor);
    },
    dispose: () => {
      group.traverse((obj) => {
        if (obj instanceof Reflector) obj.dispose();
        else if (obj instanceof THREE.Mesh) obj.geometry.dispose();
      });
      screenMaterial.dispose();
      clusterMaterial.dispose();
      cluster.texture.dispose();
    },
  };
}
