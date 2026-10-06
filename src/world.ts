import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  BUILDING_Z,
  CROSSWALK_HALF_WIDTH,
  CROSSWALK_X,
  CURB_HEIGHT,
  CURB_WIDTH,
  CURB_Z,
  LANE_LINE_Z,
  SIDEWALK_WIDTH,
  STREET_HALF_LENGTH,
} from './constants';
import type { Spot } from './level';
import type { OBB } from './physics';
import { createRng, pick, range, type Rng } from './rng';
import {
  FACADE_STYLES,
  createAsphaltTextures,
  createConcreteTexture,
  createFacadeTextures,
  createLeafTexture,
  createParkingSignTexture,
  createShopfrontTextures,
  createSidewalkTextures,
  type FacadeTextures,
} from './textures';

export type TimeOfDay = 'day' | 'sunset' | 'night';

export interface TodPreset {
  readonly label: string;
  readonly elevation: number;
  readonly azimuth: number;
  readonly turbidity: number;
  readonly rayleigh: number;
  readonly mieCoefficient: number;
  readonly mieDirectionalG: number;
  readonly cloudCoverage: number;
  readonly lightElevation: number;
  readonly lightAzimuth: number;
  readonly lightColor: string;
  readonly lightIntensity: number;
  readonly hemiSky: string;
  readonly hemiGround: string;
  readonly hemiIntensity: number;
  readonly exposure: number;
  readonly fogColor: string;
  readonly fogNear: number;
  readonly fogFar: number;
  readonly envIntensity: number;
  readonly envCity: string;
  readonly lamps: number;
  readonly windows: number;
  readonly headlights: boolean;
  readonly bloom: number;
}

export const TIME_OF_DAY: Readonly<Record<TimeOfDay, TodPreset>> = {
  day: {
    label: 'Day',
    elevation: 44,
    azimuth: 150,
    turbidity: 2.2,
    rayleigh: 1.1,
    mieCoefficient: 0.004,
    mieDirectionalG: 0.8,
    cloudCoverage: 0.35,
    lightElevation: 44,
    lightAzimuth: 150,
    lightColor: '#fff1de',
    lightIntensity: 3.2,
    hemiSky: '#cfe0ff',
    hemiGround: '#6b6256',
    hemiIntensity: 0.35,
    exposure: 0.42,
    fogColor: '#a9bccf',
    fogNear: 90,
    fogFar: 330,
    envIntensity: 1,
    envCity: '#7c7f84',
    lamps: 0,
    windows: 0,
    headlights: false,
    bloom: 0.12,
  },
  sunset: {
    label: 'Sunset',
    elevation: 3.5,
    azimuth: 70,
    turbidity: 8,
    rayleigh: 2.6,
    mieCoefficient: 0.006,
    mieDirectionalG: 0.86,
    cloudCoverage: 0.3,
    lightElevation: 22,
    lightAzimuth: 83,
    lightColor: '#ffa860',
    lightIntensity: 3.2,
    hemiSky: '#ffc8a0',
    hemiGround: '#5a463b',
    hemiIntensity: 0.65,
    exposure: 0.62,
    fogColor: '#d9a07c',
    fogNear: 60,
    fogFar: 260,
    envIntensity: 0.9,
    envCity: '#4b3c39',
    lamps: 0.5,
    windows: 0.55,
    headlights: true,
    bloom: 0.18,
  },
  night: {
    label: 'Night',
    elevation: -3.2,
    azimuth: 250,
    turbidity: 2,
    rayleigh: 0.6,
    mieCoefficient: 0.003,
    mieDirectionalG: 0.8,
    cloudCoverage: 0.15,
    lightElevation: 42,
    lightAzimuth: 210,
    lightColor: '#93a9de',
    lightIntensity: 0.28,
    hemiSky: '#30406a',
    hemiGround: '#141414',
    hemiIntensity: 0.35,
    exposure: 1.05,
    fogColor: '#0d1422',
    fogNear: 40,
    fogFar: 200,
    envIntensity: 0.35,
    envCity: '#1a1d26',
    lamps: 1,
    windows: 1,
    headlights: true,
    bloom: 0.75,
  },
};

const LAMP_SPACING = 24;
const POINT_LIGHT_COUNT = 6;

function boxWithWorldUV(w: number, h: number, d: number, tileU: number, tileV: number): THREE.BoxGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.getAttribute('uv');
  const dims: [number, number][] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  dims.forEach(([fw, fh], f) => {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, (uv.getX(i) * fw) / tileU, (uv.getY(i) * fh) / tileV);
    }
  });
  uv.needsUpdate = true;
  return geo;
}

function planeXZ(width: number, depth: number, tile: number): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(width, depth);
  const uv = geo.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * width) / tile, (uv.getY(i) * depth) / tile);
  uv.needsUpdate = true;
  geo.rotateX(-Math.PI / 2);
  return geo;
}

function setUniform(sky: Sky, name: string, value: number): void {
  const entry = sky.material.uniforms[name];
  if (entry) entry.value = value;
}

function setSkyPreset(sky: Sky, preset: TodPreset, sunDir: THREE.Vector3): void {
  setUniform(sky, 'turbidity', preset.turbidity);
  setUniform(sky, 'rayleigh', preset.rayleigh);
  setUniform(sky, 'mieCoefficient', preset.mieCoefficient);
  setUniform(sky, 'mieDirectionalG', preset.mieDirectionalG);
  setUniform(sky, 'cloudCoverage', preset.cloudCoverage);
  const sun = sky.material.uniforms['sunPosition'];
  if (sun && sun.value instanceof THREE.Vector3) sun.value.copy(sunDir);
}

function directionFrom(elevationDeg: number, azimuthDeg: number): THREE.Vector3 {
  return new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - elevationDeg), THREE.MathUtils.degToRad(azimuthDeg));
}

function circleOBB(x: number, z: number, half: number): OBB {
  return { cx: x, cz: z, hx: half, hz: half, angle: 0 };
}

function buildCrownGeometry(rng: Rng, count: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const center = new THREE.Vector3(0, -0.4, 0);
  for (let i = 0; i < count; i++) {
    const p = new THREE.Vector3();
    do p.set(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1);
    while (p.lengthSq() > 1);
    p.multiply(new THREE.Vector3(1.95, 1.45, 1.95));
    const n = new THREE.Vector3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
    const t = new THREE.Vector3().crossVectors(n, Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : up).normalize();
    const b = new THREE.Vector3().crossVectors(n, t);
    const size = range(rng, 1.0, 1.6) / 2;
    const base = positions.length / 3;
    const corners: [number, number, number, number][] = [
      [-1, -1, 0, 0],
      [1, -1, 1, 0],
      [1, 1, 1, 1],
      [-1, 1, 0, 1],
    ];
    for (const [a, c, u, v] of corners) {
      const v3 = p.clone().addScaledVector(t, a * size).addScaledVector(b, c * size);
      positions.push(v3.x, v3.y, v3.z);
      const nn = v3.clone().sub(center).normalize();
      normals.push(nn.x, nn.y, nn.z);
      uvs.push(u, v);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

function buildTrunkGeometry(rng: Rng): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.1, 0.17, 3.8, 9);
  trunk.translate(0, 1.9, 0);
  const parts: THREE.BufferGeometry[] = [trunk];
  for (let i = 0; i < 4; i++) {
    const branch = new THREE.CylinderGeometry(0.035, 0.06, 1.5, 6);
    branch.translate(0, 0.75, 0);
    branch.rotateZ(range(rng, 0.5, 0.9));
    branch.rotateY((i * Math.PI) / 2 + range(rng, -0.4, 0.4));
    branch.translate(0, range(rng, 2.6, 3.4), 0);
    parts.push(branch);
  }
  return mergeGeometries(parts);
}

export class World {
  readonly scene = new THREE.Scene();
  readonly obstacles: OBB[] = [];
  readonly sun: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private readonly sky = new Sky();
  private readonly envScene = new THREE.Scene();
  private readonly envSky = new Sky();
  private readonly envCityMaterial = new THREE.MeshBasicMaterial({ color: '#7c7f84' });
  private readonly envGroundMaterial = new THREE.MeshBasicMaterial({ color: '#3b3b3b' });
  private readonly pmrem: THREE.PMREMGenerator;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private readonly lightDir = new THREE.Vector3(0, 1, 0);
  private readonly lampPositions: THREE.Vector3[] = [];
  private readonly lampLights: THREE.PointLight[] = [];
  private readonly lampGlass = new THREE.MeshStandardMaterial({ color: '#fff6e0', emissive: '#ffd59a', emissiveIntensity: 0 });
  private readonly windowMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly levelGroup = new THREE.Group();
  private readonly markingMaterial = new THREE.MeshStandardMaterial({
    color: '#e8e8e0',
    roughness: 0.7,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  private readonly signMaterial: THREE.MeshStandardMaterial;
  private readonly poleMaterial = new THREE.MeshStandardMaterial({ color: '#2b2f33', roughness: 0.45, metalness: 0.6 });
  private preset: TodPreset = TIME_OF_DAY.day;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.signMaterial = new THREE.MeshStandardMaterial({ map: createParkingSignTexture(), roughness: 0.4, metalness: 0.2 });

    this.sky.scale.setScalar(1500);
    this.scene.add(this.sky);
    this.envSky.scale.setScalar(1000);
    this.envScene.add(this.envSky);
    this.buildEnvCity();

    this.sun = new THREE.DirectionalLight('#ffffff', 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    const cam = this.sun.shadow.camera;
    cam.left = -30;
    cam.right = 30;
    cam.top = 30;
    cam.bottom = -30;
    cam.near = 1;
    cam.far = 160;
    this.sun.shadow.bias = -0.0002;
    this.sun.shadow.normalBias = 0.025;
    this.scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight('#cfe0ff', '#6b6256', 0.45);
    this.scene.add(this.hemi);

    this.scene.fog = new THREE.Fog('#bccbd8', 70, 280);

    const rng = createRng(20240917);
    this.buildGround();
    this.buildRoadMarkings();
    this.buildBuildings(rng);
    this.buildProps(rng);
    this.scene.add(this.levelGroup);

    for (let i = 0; i < POINT_LIGHT_COUNT; i++) {
      const light = new THREE.PointLight('#ffd7a0', 0, 26, 2);
      this.lampLights.push(light);
      this.scene.add(light);
    }
  }

  private buildEnvCity(): void {
    const rng = createRng(77);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(400, 32), this.envGroundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.5;
    this.envScene.add(ground);
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      const h = range(rng, 12, 45);
      const b = new THREE.Mesh(new THREE.BoxGeometry(range(rng, 14, 26), h, 10), this.envCityMaterial);
      b.position.set(Math.cos(a) * 60, h / 2 - 1.5, Math.sin(a) * 60);
      b.lookAt(0, h / 2 - 1.5, 0);
      this.envScene.add(b);
    }
  }

  private buildGround(): void {
    const len = STREET_HALF_LENGTH * 2;
    const asphalt = createAsphaltTextures();
    const roadMat = new THREE.MeshStandardMaterial({
      map: asphalt.map,
      normalMap: asphalt.normalMap,
      roughnessMap: asphalt.roughnessMap,
      normalScale: new THREE.Vector2(0.6, 0.6),
      roughness: 1,
    });
    const road = new THREE.Mesh(planeXZ(len, CURB_Z * 2 + 0.2, 5), roadMat);
    road.receiveShadow = true;
    this.scene.add(road);

    // gutters
    const gutterMat = new THREE.MeshStandardMaterial({
      color: '#2a2a2a',
      transparent: true,
      opacity: 0.35,
      roughness: 0.6,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    for (const side of [-1, 1]) {
      const g = new THREE.Mesh(planeXZ(len, 0.35, 1), gutterMat);
      g.position.set(0, 0.002, side * (CURB_Z - 0.175));
      g.receiveShadow = true;
      this.scene.add(g);
    }

    const sidewalk = createSidewalkTextures();
    const walkMat = new THREE.MeshStandardMaterial({
      map: sidewalk.map,
      normalMap: sidewalk.normalMap,
      roughnessMap: sidewalk.roughnessMap,
      roughness: 1,
    });
    const curbTex = createConcreteTexture(5, 175);
    curbTex.repeat.set(len / 1.5, 1);
    const curbMat = new THREE.MeshStandardMaterial({ map: curbTex, roughness: 0.85 });
    for (const side of [-1, 1]) {
      const curb = new THREE.Mesh(new RoundedBoxGeometry(len, CURB_HEIGHT + 0.06, CURB_WIDTH, 2, 0.035), curbMat);
      curb.position.set(0, (CURB_HEIGHT + 0.06) / 2 - 0.06, side * (CURB_Z + CURB_WIDTH / 2));
      curb.castShadow = true;
      curb.receiveShadow = true;
      this.scene.add(curb);

      const walkDepth = SIDEWALK_WIDTH + 14;
      const walk = new THREE.Mesh(boxWithWorldUV(len, CURB_HEIGHT, walkDepth, 3, 3), walkMat);
      walk.position.set(0, CURB_HEIGHT / 2 - 0.005, side * (CURB_Z + CURB_WIDTH + walkDepth / 2));
      walk.receiveShadow = true;
      this.scene.add(walk);
    }

    const under = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshStandardMaterial({ color: '#3d3e40', roughness: 1 }));
    under.rotation.x = -Math.PI / 2;
    under.position.y = -0.03;
    this.scene.add(under);
  }

  private stripe(x0: number, x1: number, z: number, width: number, material: THREE.Material, parent: THREE.Object3D): void {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, width), material);
    m.rotation.x = -Math.PI / 2;
    m.position.set((x0 + x1) / 2, 0.004, z);
    m.receiveShadow = true;
    parent.add(m);
  }

  private buildRoadMarkings(): void {
    const yellow = new THREE.MeshStandardMaterial({
      color: '#d8a222',
      roughness: 0.7,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const segments: [number, number][] = [];
    let start = -STREET_HALF_LENGTH;
    for (const cx of [...CROSSWALK_X].sort((a, b) => a - b)) {
      segments.push([start, cx - CROSSWALK_HALF_WIDTH - 2.5]);
      start = cx + CROSSWALK_HALF_WIDTH + 2.5;
    }
    segments.push([start, STREET_HALF_LENGTH]);
    for (const [a, b] of segments) {
      this.stripe(a, b, 0.11, 0.1, yellow, this.scene);
      this.stripe(a, b, -0.11, 0.1, yellow, this.scene);
      for (const side of [-1, 1]) this.stripe(a, b, side * LANE_LINE_Z, 0.12, this.markingMaterial, this.scene);
    }
    for (const cx of CROSSWALK_X) {
      for (let z = -CURB_Z + 0.6; z < CURB_Z - 0.4; z += 1.1) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.55), this.markingMaterial);
        m.rotation.x = -Math.PI / 2;
        m.position.set(cx, 0.004, z + 0.275);
        m.receiveShadow = true;
        this.scene.add(m);
      }
      for (const side of [-1, 1]) {
        const stop = new THREE.Mesh(new THREE.PlaneGeometry(0.4, CURB_Z), this.markingMaterial);
        stop.rotation.x = -Math.PI / 2;
        stop.position.set(cx - side * (CROSSWALK_HALF_WIDTH - 1.2), 0.004, (side * CURB_Z) / 2);
        this.scene.add(stop);
      }
    }
  }

  private buildBuildings(rng: Rng): void {
    const facades: FacadeTextures[] = FACADE_STYLES.map((style, i) => createFacadeTextures(style, 100 + i));
    const facadeMats = facades.map((t) => {
      const mat = new THREE.MeshStandardMaterial({
        map: t.map,
        emissiveMap: t.emissiveMap,
        emissive: '#ffffff',
        emissiveIntensity: 0,
        roughnessMap: t.roughMetal,
        metalnessMap: t.roughMetal,
        roughness: 1,
        metalness: 1,
      });
      this.windowMaterials.push(mat);
      return mat;
    });
    const shopMats = [1, 2, 3].map((seed) => {
      const t = createShopfrontTextures(seed * 31);
      const mat = new THREE.MeshStandardMaterial({
        map: t.map,
        emissiveMap: t.emissiveMap,
        emissive: '#ffffff',
        emissiveIntensity: 0,
        roughnessMap: t.roughMetal,
        metalnessMap: t.roughMetal,
        roughness: 1,
        metalness: 1,
      });
      this.windowMaterials.push(mat);
      return mat;
    });
    const roofMat = new THREE.MeshStandardMaterial({ color: '#4d4c4a', roughness: 0.95 });
    const corniceMat = new THREE.MeshStandardMaterial({ color: '#d9d3c6', roughness: 0.8 });
    const depth = 16;

    for (const side of [-1, 1]) {
      let x = -STREET_HALF_LENGTH - 30;
      while (x < STREET_HALF_LENGTH + 30) {
        const width = range(rng, 9, 18);
        const floors = 2 + Math.floor(rng() * 6);
        const facade = pick(rng, facadeMats);
        const shop = pick(rng, shopMats);
        const front = side * (BUILDING_Z + range(rng, 0, 0.35));
        const cx = x + width / 2;
        const cz = front + (side * depth) / 2;
        const groundH = 4.2;

        const ground = new THREE.Mesh(boxWithWorldUV(width, groundH, depth, 14, 4.2), [shop, shop, roofMat, roofMat, shop, shop]);
        ground.position.set(cx, groundH / 2, cz);
        ground.castShadow = true;
        ground.receiveShadow = true;
        this.scene.add(ground);

        const upperH = floors * 3.2;
        const upper = new THREE.Mesh(boxWithWorldUV(width, upperH, depth, 14, 12.8), [facade, facade, roofMat, roofMat, facade, facade]);
        upper.position.set(cx, groundH + upperH / 2, cz);
        upper.castShadow = true;
        upper.receiveShadow = true;
        this.scene.add(upper);

        const band = new THREE.Mesh(new THREE.BoxGeometry(width, 0.3, 0.3), corniceMat);
        band.position.set(cx, groundH, front - side * 0.1);
        band.castShadow = true;
        band.receiveShadow = true;
        this.scene.add(band);

        const cornice = new THREE.Mesh(new THREE.BoxGeometry(width + 0.05, 0.45, 0.6), corniceMat);
        cornice.position.set(cx, groundH + upperH + 0.2, front - side * 0.2);
        cornice.castShadow = true;
        cornice.receiveShadow = true;
        this.scene.add(cornice);

        x += width;
      }
    }
  }

  private buildProps(rng: Rng): void {
    const sidewalkY = CURB_HEIGHT;
    const nearCrosswalk = (x: number): boolean => CROSSWALK_X.some((cx) => Math.abs(x - cx) < CROSSWALK_HALF_WIDTH + 1);
    const occupied: { x: number; side: number }[] = [];
    const isFree = (x: number, side: number, gap: number): boolean => occupied.every((o) => o.side !== side || Math.abs(o.x - x) > gap);

    // Street lamps
    const poleGeo = new THREE.CylinderGeometry(0.06, 0.1, 6.3, 12);
    const armGeo = new THREE.BoxGeometry(0.07, 0.07, 1.5);
    const headGeo = new THREE.BoxGeometry(0.32, 0.13, 0.62);
    const glassGeo = new THREE.BoxGeometry(0.26, 0.02, 0.5);
    for (const side of [-1, 1]) {
      for (let x = -STREET_HALF_LENGTH + (side > 0 ? 6 : 18); x < STREET_HALF_LENGTH; x += LAMP_SPACING) {
        if (nearCrosswalk(x)) continue;
        const z = side * (CURB_Z + CURB_WIDTH + 0.45);
        const lamp = new THREE.Group();
        lamp.position.set(x, sidewalkY, z);
        const pole = new THREE.Mesh(poleGeo, this.poleMaterial);
        pole.position.y = 3.15;
        const arm = new THREE.Mesh(armGeo, this.poleMaterial);
        arm.position.set(0, 6.15, -side * 0.7);
        const head = new THREE.Mesh(headGeo, this.poleMaterial);
        head.position.set(0, 6.12, -side * 1.45);
        const glass = new THREE.Mesh(glassGeo, this.lampGlass);
        glass.position.set(0, 6.04, -side * 1.45);
        for (const m of [pole, arm, head]) {
          m.castShadow = true;
          m.receiveShadow = true;
        }
        lamp.add(pole, arm, head, glass);
        this.scene.add(lamp);
        this.lampPositions.push(new THREE.Vector3(x, sidewalkY + 5.9, z - side * 1.45));
        this.obstacles.push(circleOBB(x, z, 0.12));
        occupied.push({ x, side });
      }
    }

    // Trees
    const leafTex = createLeafTexture(9);
    const leafMat = new THREE.MeshStandardMaterial({ map: leafTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.8 });
    const innerMat = new THREE.MeshStandardMaterial({ color: '#22381a', roughness: 0.95 });
    const barkMat = new THREE.MeshStandardMaterial({ color: '#4a3b2e', roughness: 0.95 });
    const grateMat = new THREE.MeshStandardMaterial({ color: '#2b2622', roughness: 0.95 });
    const variants = [0, 1, 2].map(() => ({ crown: buildCrownGeometry(rng, 90), trunk: buildTrunkGeometry(rng) }));
    const innerGeo = new THREE.IcosahedronGeometry(1.25, 1);
    const grateGeo = new THREE.BoxGeometry(1.3, 0.02, 1.3);
    for (const side of [-1, 1]) {
      for (let x = -STREET_HALF_LENGTH + 4; x < STREET_HALF_LENGTH; x += range(rng, 11, 16)) {
        if (nearCrosswalk(x) || !isFree(x, side, 3)) continue;
        const z = side * (CURB_Z + CURB_WIDTH + 1.15);
        const v = pick(rng, variants);
        const tree = new THREE.Group();
        tree.position.set(x, sidewalkY, z);
        tree.rotation.y = rng() * Math.PI * 2;
        const s = range(rng, 0.85, 1.15);
        tree.scale.set(s, s * range(rng, 0.9, 1.15), s);
        const trunk = new THREE.Mesh(v.trunk, barkMat);
        const inner = new THREE.Mesh(innerGeo, innerMat);
        inner.position.y = 4.5;
        inner.scale.set(1.25, 0.95, 1.25);
        const crown = new THREE.Mesh(v.crown, leafMat);
        crown.position.y = 4.6;
        for (const m of [trunk, inner, crown]) {
          m.castShadow = true;
          m.receiveShadow = true;
        }
        tree.add(trunk, inner, crown);
        this.scene.add(tree);
        const grate = new THREE.Mesh(grateGeo, grateMat);
        grate.position.set(x, sidewalkY + 0.006, z);
        grate.receiveShadow = true;
        this.scene.add(grate);
        this.obstacles.push(circleOBB(x, z, 0.2));
        occupied.push({ x, side });
      }
    }

    // Parking meters
    const meterPost = new THREE.CylinderGeometry(0.035, 0.04, 1.1, 10);
    const meterHead = new THREE.BoxGeometry(0.14, 0.32, 0.18);
    const meterMat = new THREE.MeshStandardMaterial({ color: '#59616b', roughness: 0.4, metalness: 0.7 });
    const screenMat = new THREE.MeshStandardMaterial({ color: '#0d1a12', emissive: '#2ee66b', emissiveIntensity: 0.3, roughness: 0.2 });
    const screenGeo = new THREE.PlaneGeometry(0.1, 0.08);
    for (const side of [-1, 1]) {
      for (let x = -STREET_HALF_LENGTH + 3; x < STREET_HALF_LENGTH; x += 8.5) {
        if (nearCrosswalk(x) || !isFree(x, side, 1.6)) continue;
        const z = side * (CURB_Z + CURB_WIDTH + 0.35);
        const post = new THREE.Mesh(meterPost, this.poleMaterial);
        post.position.set(x, sidewalkY + 0.55, z);
        const head = new THREE.Mesh(meterHead, meterMat);
        head.position.set(x, sidewalkY + 1.25, z);
        const screen = new THREE.Mesh(screenGeo, screenMat);
        screen.position.set(x, sidewalkY + 1.3, z - side * 0.091);
        screen.rotation.y = side > 0 ? Math.PI : 0;
        for (const m of [post, head]) {
          m.castShadow = true;
          m.receiveShadow = true;
        }
        this.scene.add(post, head, screen);
        this.obstacles.push(circleOBB(x, z, 0.09));
      }
    }

    // Street ends
    this.obstacles.push({ cx: -STREET_HALF_LENGTH - 2, cz: 0, hx: 2, hz: CURB_Z, angle: 0 });
    this.obstacles.push({ cx: STREET_HALF_LENGTH + 2, cz: 0, hx: 2, hz: CURB_Z, angle: 0 });
  }

  /** Per-level dressing: bay markings at the target spot, a parking sign, and lamp lights nearby. */
  setSpot(spot: Spot): void {
    for (const child of [...this.levelGroup.children]) {
      this.levelGroup.remove(child);
      if (child instanceof THREE.Mesh) child.geometry.dispose();
    }
    for (const x of [spot.rearX, spot.frontX]) {
      const tick = new THREE.Mesh(new THREE.PlaneGeometry(0.1, CURB_Z - LANE_LINE_Z - 0.05), this.markingMaterial);
      tick.rotation.x = -Math.PI / 2;
      tick.position.set(x, 0.005, (CURB_Z + LANE_LINE_Z - 0.05) / 2);
      tick.receiveShadow = true;
      this.levelGroup.add(tick);
    }
    const signX = spot.rearX - 0.6;
    const signZ = CURB_Z + CURB_WIDTH + 0.3;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.6, 8), this.poleMaterial);
    pole.position.set(signX, CURB_HEIGHT + 1.3, signZ);
    pole.castShadow = true;
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.6, 0.4), [
      this.poleMaterial,
      this.signMaterial,
      this.poleMaterial,
      this.poleMaterial,
      this.poleMaterial,
      this.poleMaterial,
    ]);
    plate.position.set(signX - 0.03, CURB_HEIGHT + 2.3, signZ);
    plate.castShadow = true;
    this.levelGroup.add(pole, plate);

    const nearest = [...this.lampPositions].sort((a, b) => Math.abs(a.x - spot.centerX) - Math.abs(b.x - spot.centerX)).slice(0, POINT_LIGHT_COUNT);
    this.lampLights.forEach((light, i) => {
      const pos = nearest[i];
      if (pos) light.position.copy(pos);
    });
  }

  extraObstacles(spot: Spot): OBB[] {
    return [circleOBB(spot.rearX - 0.6, CURB_Z + CURB_WIDTH + 0.3, 0.05)];
  }

  setTimeOfDay(tod: TimeOfDay): TodPreset {
    const p = TIME_OF_DAY[tod];
    this.preset = p;
    const sunDir = directionFrom(p.elevation, p.azimuth);
    setSkyPreset(this.sky, p, sunDir);
    setSkyPreset(this.envSky, p, sunDir);
    this.lightDir.copy(directionFrom(p.lightElevation, p.lightAzimuth));
    this.sun.color.set(p.lightColor);
    this.sun.intensity = p.lightIntensity;
    this.hemi.color.set(p.hemiSky);
    this.hemi.groundColor.set(p.hemiGround);
    this.hemi.intensity = p.hemiIntensity;
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.set(p.fogColor);
      this.scene.fog.near = p.fogNear;
      this.scene.fog.far = p.fogFar;
    }
    this.lampGlass.emissiveIntensity = p.lamps * 6;
    for (const light of this.lampLights) light.intensity = p.lamps * 70;
    for (const mat of this.windowMaterials) mat.emissiveIntensity = p.windows * 0.85;

    this.envCityMaterial.color.set(p.envCity);
    this.envGroundMaterial.color.set(p.envCity).multiplyScalar(0.55);
    const target = this.pmrem.fromScene(this.envScene, 0.02, 0.1, 3000);
    if (this.envTarget) this.envTarget.dispose();
    this.envTarget = target;
    this.scene.environment = target.texture;
    this.scene.environmentIntensity = p.envIntensity;
    this.renderer.toneMappingExposure = p.exposure;
    return p;
  }

  get timeOfDay(): TodPreset {
    return this.preset;
  }

  /** Keeps the shadow frustum centered on the action, snapped to shadow-map texels to avoid shimmering. */
  updateShadowFocus(focus: THREE.Vector3): void {
    const cam = this.sun.shadow.camera;
    const texel = (cam.right - cam.left) / this.sun.shadow.mapSize.x;
    const forward = this.lightDir.clone().negate();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, forward).normalize();
    const a = focus.dot(right);
    const b = focus.dot(up);
    const snapped = focus
      .clone()
      .addScaledVector(right, Math.round(a / texel) * texel - a)
      .addScaledVector(up, Math.round(b / texel) * texel - b);
    this.sun.target.position.copy(snapped);
    this.sun.position.copy(snapped).addScaledVector(this.lightDir, 80);
    this.sun.target.updateMatrixWorld();
  }
}
