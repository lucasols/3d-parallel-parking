import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GameAudio } from './audio';
import { createCarVisual, type CarVisual } from './carModel';
import { BUILDING_Z, CURB_Z, LANE_LINE_Z, PHYSICS_STEP } from './constants';
import { Guides } from './guides';
import { Hud } from './hud';
import { Input } from './input';
import { generateLevel, type Level } from './level';
import {
  ackermann,
  centerOffset,
  maxSteerRad,
  forwardVec,
  integrate,
  normalizeAngle,
  obbCorners,
  obbOverlap,
  sensorDistance,
  tireOuterPoints,
  updateSteering,
  vehicleOBB,
  type DriveInput,
  type OBB,
  type VehicleState,
} from './physics';
import { createRng } from './rng';
import { Tutorial, TutorialGhost, type TutorialContext } from './tutorial';
import { evaluateParking, measurePlacement } from './scoring';
import { DEFAULT_SETTINGS, FPV_FOV_RANGE, SEAT_HEIGHT_RANGE, getBest, loadSettings, recordBest, saveSettings, type Settings } from './settings';
import { randomPlateText } from './textures';
import { getVehicle, rearOverhang, type VehicleSpec } from './vehicles';
import { World, type TodPreset } from './world';

type GameState = 'menu' | 'playing' | 'paused' | 'result';
type CameraMode = 'fpv' | 'chase' | 'elevated' | 'birdseye' | 'orbit' | 'curb';
type Gear = 'D' | 'N' | 'R';

const CAMERA_MODES: readonly CameraMode[] = ['fpv', 'chase', 'elevated', 'birdseye', 'orbit', 'curb'];
const CAMERA_LABELS: Readonly<Record<CameraMode, string>> = {
  fpv: 'Driver view',
  chase: 'Chase cam',
  elevated: 'Elevated cam',
  birdseye: "Bird's-eye cam",
  orbit: 'Orbit cam · drag to look',
  curb: 'Curb cam',
};

interface Collider {
  obb: OBB;
  kind: 'car' | 'object';
}

interface Attempt {
  time: number;
  started: boolean;
  hits: number;
  curbHits: number;
  directionChanges: number;
  lastDir: number;
}

const freshAttempt = (): Attempt => ({ time: 0, started: false, hits: 0, curbHits: 0, directionChanges: 0, lastDir: 0 });

const UP = new THREE.Vector3(0, 1, 0);
const NORTH_UP = new THREE.Vector3(0, 0, -1);
const X_AXIS = new THREE.Vector3(1, 0, 0);
/** Passenger mirror dip in reverse (radians; the reflected view drops by twice this). */
const MIRROR_DIP = 0.09;

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera = new THREE.PerspectiveCamera(52, 1, 0.1, 2500);
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly world: World;
  private readonly controls: OrbitControls;
  private readonly guides = new Guides();
  private readonly input = new Input();
  private readonly audio = new GameAudio();
  private readonly hud: Hud;

  private readonly rearCam = new THREE.PerspectiveCamera(78, 16 / 9, 0.05, 300);
  private readonly rearTarget = new THREE.WebGLRenderTarget(640, 360, { type: THREE.HalfFloatType, samples: 4 });
  private readonly pipScene = new THREE.Scene();
  private readonly pipCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly headlights: THREE.SpotLight[] = [];

  private settings: Settings;
  private spec: VehicleSpec;
  private level: Level;
  private player: CarVisual;
  private parked: CarVisual[] = [];
  private colliders: Collider[] = [];
  private preset: TodPreset;

  private state: GameState = 'menu';
  private vs: VehicleState;
  private attempt: Attempt = freshAttempt();
  private gear: Gear = 'N';
  private lastInput: DriveInput = { throttle: 0, reverse: 0, brake: 0, steerAxis: 0, analogSteer: false };
  private carContact = false;
  private curbContact = false;
  private contactClear = 0;
  private wheelSpin = 0;
  private accelSmooth = 0;
  private stillInSpot = 0;
  private accumulator = 0;
  private lastTime = performance.now();

  private cameraMode: CameraMode = 'chase';
  private readonly camPos = new THREE.Vector3(0, 5, -10);
  private readonly camLook = new THREE.Vector3();
  private shake = 0;
  private menuTime = 0;
  private lookYaw = 0;
  private lookPitch = 0;
  private keyYaw = 0;
  private keyPitch = 0;
  /** 0..1 blend toward the mirror close-up field of view while glancing. */
  private glanceZoom = 0;
  private glanceFov = 62;
  private readonly headOffset = new THREE.Vector3();
  private mirrorDip = 0;
  /** Whether the passenger mirror is tilted down (toggled with T, set automatically on entering/leaving reverse). */
  private mirrorTilted = false;
  private tiltGear: Gear = 'N';
  private nearestSensor: number | null = null;
  private viewSaveTimer = 0;
  private dragging = false;
  /** Active guided lesson, or null in normal play. */
  private tutorial: Tutorial | null = null;
  private readonly tutorialGhost = new TutorialGhost();
  private ghostPose: VehicleState | null = null;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    container.appendChild(this.renderer.domElement);

    this.world = new World(this.renderer);
    this.world.sun.shadow.radius = 2.5;
    this.world.scene.add(this.guides.group, this.tutorialGhost.group);

    const size = new THREE.Vector2(window.innerWidth, window.innerHeight);
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(size.x, size.y);
    this.composer.addPass(new RenderPass(this.world.scene, this.camera));
    this.bloom = new UnrealBloomPass(size, 0.2, 0.45, 1.6);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enabled = false;
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 30;
    this.controls.enablePan = false;

    this.rearTarget.texture.repeat.set(-1, 1);
    this.rearTarget.texture.offset.set(1, 0);
    this.pipScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: this.rearTarget.texture })));
    this.rearCam.rotation.set(-0.5, Math.PI / 2, 0, 'YXZ');

    this.settings = loadSettings();
    this.hud = new Hud(this.settings);
    this.spec = getVehicle(this.settings.vehicleId);
    this.preset = this.world.setTimeOfDay(this.settings.timeOfDay);
    this.level = generateLevel(this.newSeed(), this.settings.difficulty, this.spec);
    this.vs = { ...this.level.start };
    this.player = this.createPlayer();
    this.applyLevel();
    this.applyPreset();

    this.hud.bindMenu({
      onChange: (settings, rebuild) => this.onSettingsChange(settings, rebuild),
      onStart: () => this.startDriving(),
      onTutorial: () => this.startTutorial(),
    });
    this.hud.setBestScore(getBest(this.spec.id, this.settings.difficulty));

    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.isFpv()) return;
      this.dragging = true;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.lookYaw = THREE.MathUtils.clamp(this.lookYaw - e.movementX * 0.005, -2.4, 2.4);
      this.lookPitch = THREE.MathUtils.clamp(this.lookPitch - e.movementY * 0.004, -0.7, 0.5);
    });
    const endDrag = (): void => {
      this.dragging = false;
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('dblclick', () => this.recenterView(false));
    canvas.addEventListener(
      'wheel',
      (e) => {
        if (!this.isFpv()) return;
        e.preventDefault();
        this.setFpvView(this.settings.fpvFov + e.deltaY * 0.025, this.settings.seatHeight);
      },
      { passive: false },
    );

    window.addEventListener('resize', () => this.onResize());
    this.onResize();
    this.setCameraMode('chase', true);
    this.enterMenu();
    this.hud.hideLoading();
    requestAnimationFrame(this.frame);
  }

  // ---------- setup ----------

  private newSeed(): number {
    return Math.floor(Math.random() * 1e9);
  }

  private createPlayer(): CarVisual {
    const visual = createCarVisual(this.spec, this.settings.color, 'PARK 3D', true);
    this.world.scene.add(visual.root);
    const s = this.spec;
    const ro = rearOverhang(s);
    const frontX = s.length - ro;
    this.headlights.length = 0;
    for (const side of [-1, 1]) {
      const light = new THREE.SpotLight('#fff1dc', 0, 55, 0.48, 0.55, 1.5);
      light.position.set(frontX - 0.15, s.hoodHeight - 0.12, side * (s.width / 2 - 0.35));
      light.target.position.set(frontX + 12, 0, side * (s.width / 2 - 0.35) * 1.6);
      visual.root.add(light, light.target);
      this.headlights.push(light);
    }
    this.rearCam.position.set(-ro - 0.08, Math.min(s.deckHeight, 1.15) - 0.08, 0);
    visual.root.add(this.rearCam);
    return visual;
  }

  private replacePlayer(): void {
    this.player.root.remove(this.rearCam);
    this.world.scene.remove(this.player.root);
    this.player.dispose();
    this.player = this.createPlayer();
    this.applyPreset();
  }

  private applyLevel(): void {
    for (const car of this.parked) {
      this.world.scene.remove(car.root);
      car.dispose();
    }
    const rng = createRng(this.level.seed ^ 0x5bd1e995);
    this.parked = this.level.parked.map((p) => {
      const visual = createCarVisual(p.spec, p.color, p.plate || randomPlateText(rng), false);
      visual.root.position.set(p.state.x, 0, p.state.z);
      visual.root.rotation.y = p.state.heading;
      visual.root.matrixAutoUpdate = false;
      visual.root.updateMatrix();
      this.world.scene.add(visual.root);
      return visual;
    });
    this.colliders = [
      ...this.level.parked.map((p): Collider => ({ obb: p.obb, kind: 'car' })),
      ...this.world.obstacles.map((obb): Collider => ({ obb, kind: 'object' })),
      ...this.world.extraObstacles(this.level.spot).map((obb): Collider => ({ obb, kind: 'object' })),
    ];
    this.world.setSpot(this.level.spot);
    this.guides.setSpot(this.level.spot);
    this.hud.setLevelInfo(this.spec, this.level.difficulty, this.level);
    this.resetAttempt();
  }

  private applyPreset(): void {
    const p = this.preset;
    this.bloom.strength = p.bloom;
    this.bloom.enabled = p.bloom > 0.01;
    for (const light of this.headlights) light.intensity = p.headlights ? 900 : 0;
    this.player.lights.head.emissiveIntensity = p.headlights ? 4 : 0.6;
    this.player.interior?.setDisplayBrightness(p.exposure);
  }

  private onSettingsChange(incoming: Settings, rebuildLevel: boolean): void {
    const prev = this.settings;
    // the driver-view fields are owned by the game, not the menu
    const settings: Settings = { ...incoming, fpvFov: prev.fpvFov, seatHeight: prev.seatHeight };
    this.settings = settings;
    saveSettings(settings);
    if (settings.timeOfDay !== prev.timeOfDay) {
      this.preset = this.world.setTimeOfDay(settings.timeOfDay);
      this.applyPreset();
    }
    const vehicleChanged = settings.vehicleId !== prev.vehicleId;
    if (vehicleChanged) this.spec = getVehicle(settings.vehicleId);
    if (vehicleChanged || settings.color !== prev.color) this.replacePlayer();
    if (rebuildLevel) {
      this.level = generateLevel(this.newSeed(), settings.difficulty, this.spec);
      this.applyLevel();
    }
    this.hud.setBestScore(getBest(this.spec.id, settings.difficulty));
  }

  private isFpv(): boolean {
    return this.cameraMode === 'fpv' && this.state !== 'menu';
  }

  private recenterView(resetZoom: boolean): void {
    this.lookYaw = 0;
    this.lookPitch = 0;
    if (resetZoom) this.setFpvView(DEFAULT_SETTINGS.fpvFov, this.settings.seatHeight);
  }

  private setFpvView(fov: number, seatHeight: number): void {
    const fpvFov = THREE.MathUtils.clamp(fov, FPV_FOV_RANGE[0], FPV_FOV_RANGE[1]);
    const seat = THREE.MathUtils.clamp(seatHeight, SEAT_HEIGHT_RANGE[0], SEAT_HEIGHT_RANGE[1]);
    if (fpvFov === this.settings.fpvFov && seat === this.settings.seatHeight) return;
    this.settings = { ...this.settings, fpvFov, seatHeight: seat };
    this.viewSaveTimer = 0.6;
  }

  /** Driver-view look controls: glances, look-back, free look, zoom and seat height. */
  private updateLook(dt: number): void {
    const active = this.state === 'playing' && this.isFpv();
    const back = active && this.input.lookBack();
    const glance = active ? this.input.glance() : 0;
    const k = Math.min(1, dt * 6);
    let yawTarget = 0;
    let pitchTarget = 0;
    let zoomTarget = 0;
    if (back) {
      yawTarget = -2.45;
      pitchTarget = -0.12;
    } else if (glance !== 0) {
      // glances go straight to the door mirror on that side, overriding free look
      const mirror = this.player.interior?.mirrors.find((mm) => mm.side === (glance > 0 ? -1 : 1));
      if (mirror) {
        yawTarget = mirror.gaze.yaw - this.lookYaw;
        pitchTarget = mirror.gaze.pitch + 0.1 - this.lookPitch;
        this.glanceFov = mirror.gaze.fov;
        zoomTarget = 1;
      } else {
        yawTarget = glance * 1.2;
      }
    }
    this.keyYaw += (yawTarget - this.keyYaw) * k;
    this.keyPitch += (pitchTarget - this.keyPitch) * k;
    this.glanceZoom += (zoomTarget - this.glanceZoom) * k;
    if (active) {
      const rate = this.input.lookRate();
      this.lookYaw = THREE.MathUtils.clamp(this.lookYaw + rate.yaw * 1.8 * dt, -2.4, 2.4);
      this.lookPitch = THREE.MathUtils.clamp(this.lookPitch + rate.pitch * 1.2 * dt, -0.7, 0.5);
      const zoom = this.input.zoom();
      const seat = this.input.seat();
      if (zoom !== 0 || seat !== 0) this.setFpvView(this.settings.fpvFov - zoom * 35 * dt, this.settings.seatHeight + seat * 0.08 * dt);
    }
    // the head follows the gaze: lean toward the centre when looking back, forward when looking down
    const yaw = this.lookYaw + this.keyYaw;
    const pitch = this.lookPitch + this.keyPitch;
    const turnRight = THREE.MathUtils.smoothstep(-yaw, 0.9, 2.4);
    const turnLeft = THREE.MathUtils.smoothstep(yaw, 1.0, 2.2);
    const lookDown = THREE.MathUtils.smoothstep(-pitch, 0.2, 0.7);
    const target = new THREE.Vector3(0.07 * lookDown - 0.05 * turnRight, 0.03 * turnRight, 0.14 * turnRight - 0.05 * turnLeft);
    this.headOffset.lerp(target, Math.min(1, dt * 5));
    if (this.viewSaveTimer > 0) {
      this.viewSaveTimer -= dt;
      if (this.viewSaveTimer <= 0) saveSettings(this.settings);
    }
  }

  private resetAttempt(): void {
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.keyYaw = 0;
    this.keyPitch = 0;
    this.glanceZoom = 0;
    this.headOffset.set(0, 0, 0);
    this.mirrorDip = 0;
    this.mirrorTilted = false;
    this.tiltGear = 'N';
    this.nearestSensor = null;
    this.vs = { ...this.level.start };
    this.attempt = freshAttempt();
    this.gear = 'N';
    this.carContact = false;
    this.curbContact = false;
    this.contactClear = 0;
    this.accelSmooth = 0;
    this.stillInSpot = 0;
    this.accumulator = 0;
    this.updatePlayerVisual(0);
    this.hud.setStats(0, 0, 0, 0);
  }

  // ---------- state transitions ----------

  private enterMenu(): void {
    if (this.tutorial) this.endTutorial();
    this.state = 'menu';
    this.input.enabled = false;
    this.resetAttempt();
    this.hud.showMenu(true);
    this.hud.showHud(false);
    this.hud.showPause(false);
    this.hud.showResult(null);
    this.hud.setHint(null);
    this.controls.enabled = false;
    this.hud.setBestScore(getBest(this.spec.id, this.settings.difficulty));
  }

  private startDriving(): void {
    this.audio.start();
    this.state = 'playing';
    this.input.enabled = true;
    this.input.clearActions();
    this.resetAttempt();
    this.hud.showMenu(false);
    this.hud.showHud(true);
    this.hud.showResult(null);
    this.hud.showPause(false);
    this.camera.clearViewOffset();
    this.setCameraMode(this.cameraMode, true);
    this.hud.toast(this.tutorial ? 'Tutorial: follow the steps on the left' : 'Find the green space', 'info');
  }

  /** A guided lesson on a roomy (Easy) space with every driving aid on. */
  private startTutorial(): void {
    this.tutorial = new Tutorial();
    this.level = generateLevel(this.newSeed(), 'easy', this.spec);
    this.applyLevel();
    this.startDriving();
  }

  /** Leaves the lesson and restores a street for the chosen difficulty. */
  private endTutorial(): void {
    this.tutorial = null;
    this.ghostPose = null;
    this.hud.setTutorial(null);
    this.level = generateLevel(this.newSeed(), this.settings.difficulty, this.spec);
    this.applyLevel();
  }

  private retry(): void {
    this.hud.showResult(null);
    this.hud.showPause(false);
    this.state = 'playing';
    this.input.clearActions();
    this.resetAttempt();
    this.tutorial?.reset();
    this.setCameraMode(this.cameraMode, true);
  }

  private nextStreet(): void {
    // "Next street" after the lesson moves on to normal play
    if (this.tutorial) {
      this.endTutorial();
      this.retry();
      return;
    }
    this.level = generateLevel(this.newSeed(), this.settings.difficulty, this.spec);
    this.applyLevel();
    this.retry();
  }

  private togglePause(): void {
    if (this.state === 'playing') {
      this.state = 'paused';
      this.hud.showPause(true, {
        resume: () => this.togglePause(),
        restart: () => this.retry(),
        menu: () => this.enterMenu(),
      });
    } else if (this.state === 'paused') {
      this.state = 'playing';
      this.hud.showPause(false);
    }
  }

  private finish(): void {
    if (Math.abs(this.vs.speed) > 0.08) {
      this.hud.toast('Stop the car first', 'warn');
      return;
    }
    const result = evaluateParking(this.vs, this.spec, this.level, this.attempt);
    const previous = this.tutorial ? null : getBest(this.spec.id, this.settings.difficulty);
    const record = !this.tutorial && result.success && recordBest(this.spec.id, this.settings.difficulty, result.total);
    this.ghostPose = null;
    this.hud.setTutorial(null);
    this.state = 'result';
    this.hud.setHint(null);
    this.hud.showResult(result, {
      best: previous,
      record,
      handlers: {
        retry: () => this.retry(),
        next: () => this.nextStreet(),
        menu: () => this.enterMenu(),
      },
    });
  }

  private setCameraMode(mode: CameraMode, snap = false): void {
    this.cameraMode = mode;
    this.controls.enabled = mode === 'orbit' && this.state === 'playing';
    this.hud.setCameraLabel(CAMERA_LABELS[mode]);
    this.hud.setSteeringVisible(mode !== 'fpv');
    this.hud.setKeysHint(mode === 'fpv' ? 'fpv' : 'drive');
    if (mode === 'orbit') {
      this.controls.target.copy(this.carCenter()).setY(0.8);
    }
    if (snap) this.updateCamera(0, true);
  }

  // ---------- frame ----------

  private readonly frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.tick(dt, true);
  };

  /** Dev-only: advance the simulation by fixed 60 Hz steps (useful when the tab is not visible). */
  advance(seconds: number): void {
    const steps = Math.max(1, Math.round(seconds * 60));
    for (let i = 0; i < steps; i++) this.tick(1 / 60, i === steps - 1);
  }

  private tick(dt: number, draw: boolean): void {
    this.input.poll();
    this.handleActions();

    if (this.state === 'playing') this.updateDriving(dt);
    else this.audio.update(dt, { active: this.state === 'paused' || this.state === 'result', speed: 0, throttle: 0, sensor: null });

    this.updateLook(dt);
    this.updatePlayerVisual(dt);
    const showPath = this.state === 'playing' && (this.settings.pathGuides || this.tutorial !== null) && this.gear !== 'N';
    this.tutorialGhost.update(dt, this.state === 'playing' ? this.ghostPose : null, this.spec);
    const placement = measurePlacement(this.vs, this.spec, this.level);
    const parkedNow = placement.insideSpot && Math.abs(this.vs.speed) < 0.05;
    this.guides.update(dt, this.vs, this.spec, this.gear === 'R' ? -1 : 1, showPath, this.settings.spotHighlight && this.state !== 'menu', parkedNow);
    this.updateCamera(dt, false);
    if (draw) this.render();
  }

  private handleActions(): void {
    const i = this.input;
    switch (this.state) {
      case 'menu':
        if (i.consume('finish')) this.startDriving();
        break;
      case 'playing': {
        if (i.consume('pause')) this.togglePause();
        if (i.consume('camera')) {
          const idx = CAMERA_MODES.indexOf(this.cameraMode);
          this.setCameraMode(CAMERA_MODES[(idx + 1) % CAMERA_MODES.length] ?? 'chase');
        }
        const digit = i.consumeDigit();
        if (digit !== null) {
          const mode = CAMERA_MODES[digit - 1];
          if (mode) this.setCameraMode(mode);
        }
        if (i.consume('recenter') && this.isFpv()) this.recenterView(true);
        if (i.consume('mirrorTilt')) {
          this.mirrorTilted = !this.mirrorTilted;
          this.hud.toast(this.mirrorTilted ? 'Passenger mirror tilted down' : 'Passenger mirror raised', 'info');
        }
        if (i.consume('finish')) this.finish();
        if (i.consume('restart')) this.retry();
        if (i.consume('next')) this.nextStreet();
        if (i.consume('guides')) {
          const on = !this.settings.pathGuides;
          this.settings = { ...this.settings, pathGuides: on, spotHighlight: on };
          saveSettings(this.settings);
          this.hud.syncSettings(this.settings);
          this.hud.toast(on ? 'Guides on' : 'Guides off', 'info');
        }
        if (i.consume('mute')) {
          this.audio.setMuted(!this.audio.isMuted);
          this.hud.toast(this.audio.isMuted ? 'Sound off' : 'Sound on', 'info');
        }
        break;
      }
      case 'paused':
        if (i.consume('pause')) this.togglePause();
        if (i.consume('restart')) this.retry();
        break;
      case 'result':
        if (i.consume('restart')) this.retry();
        if (i.consume('next') || i.consume('finish')) this.nextStreet();
        break;
    }
    i.clearActions();
  }

  private updateDriving(dt: number): void {
    const input = this.input.drive();
    this.lastInput = input;
    const prevSpeed = this.vs.speed;
    this.accumulator += dt;
    while (this.accumulator >= PHYSICS_STEP) {
      this.physicsStep(PHYSICS_STEP, input);
      this.accumulator -= PHYSICS_STEP;
    }
    const accel = dt > 0 ? (this.vs.speed - prevSpeed) / dt : 0;
    this.accelSmooth += (accel - this.accelSmooth) * Math.min(1, dt * 5);

    const v = this.vs.speed;
    if (v > 0.05) this.gear = 'D';
    else if (v < -0.05) this.gear = 'R';
    else if (input.reverse > 0) this.gear = 'R';
    else if (input.throttle > 0) this.gear = 'D';

    if (this.attempt.started) this.attempt.time += dt;
    this.hud.setStats(this.attempt.time, this.attempt.directionChanges, this.attempt.hits, this.attempt.curbHits);

    const steerDeg = (this.vs.steer * 180) / Math.PI;
    this.hud.setDrive({ speedKmh: v * 3.6, gear: this.gear, steerDeg, wheelTurnDeg: -steerDeg * 14 });

    const sensors = this.readSensors();
    const placement = measurePlacement(this.vs, this.spec, this.level);
    const angleDeg = Math.abs((normalizeAngle(this.vs.heading) * 180) / Math.PI);
    this.hud.setSensors({
      graphic: this.settings.sensors,
      readouts: this.settings.readouts,
      front: sensors.front,
      rear: sensors.rear,
      curb: this.vs.z > LANE_LINE_Z - 1.5 ? Math.max(0, placement.curbGap) : null,
      angleDeg: angleDeg > 90 ? 180 - angleDeg : angleDeg,
    });
    const nearest = this.settings.sensors ? Math.min(sensors.front ?? Infinity, sensors.rear ?? Infinity) : Infinity;
    this.nearestSensor = Number.isFinite(nearest) ? nearest : null;
    this.audio.update(dt, {
      active: true,
      speed: v,
      throttle: Math.max(input.throttle, input.reverse),
      sensor: Number.isFinite(nearest) && Math.abs(v) > 0.01 ? nearest : null,
    });

    if (placement.insideSpot && Math.abs(v) < 0.05) this.stillInSpot += dt;
    else this.stillInSpot = 0;
    this.hud.setHint(this.stillInSpot > 0.6 && !this.tutorial ? 'In the space — press Enter to finish' : null);

    if (this.tutorial) {
      const ctx: TutorialContext = {
        vs: this.vs,
        spec: this.spec,
        level: this.level,
        gear: this.gear,
        maxSteer: maxSteerRad(this.spec),
        placement,
        rearSensor: sensors.rear,
        hits: this.attempt.hits,
      };
      if (this.tutorial.update(dt, ctx)) {
        this.hud.toast('Step complete ✓', 'info');
        this.audio.chime();
      }
      this.hud.setTutorial(this.tutorial.view(ctx));
      this.ghostPose = this.tutorial.ghost(ctx);
    }

    if (this.settings.minimap) this.hud.drawMinimap({
      level: this.level,
      parked: this.level.parked.map((p) => p.obb),
      obstacles: this.world.obstacles,
      player: vehicleOBB(this.vs, this.spec),
      playerColor: '#30d158',
    });
  }

  private physicsStep(dt: number, input: DriveInput): void {
    const steer = updateSteering(this.vs, this.spec, input, dt, this.settings.selfCenter);
    const current: VehicleState = { ...this.vs, steer };
    const next = integrate(current, this.spec, input, dt);
    const collision = this.findCollision(next);
    if (collision) {
      this.onContact(collision, Math.abs(current.speed));
      this.vs = { ...current, speed: 0 };
      this.contactClear = 0;
    } else {
      this.vs = next;
      if (Math.abs(next.speed) > 0.01) {
        this.contactClear += dt;
        if (this.contactClear > 0.3) {
          this.carContact = false;
          this.curbContact = false;
        }
      }
    }
    const v = this.vs.speed;
    if (Math.abs(v) > 0.15) {
      const dir = Math.sign(v);
      if (this.attempt.lastDir !== 0 && dir !== this.attempt.lastDir) this.attempt.directionChanges++;
      this.attempt.lastDir = dir;
      this.attempt.started = true;
    }
    this.wheelSpin += (v * dt) / this.spec.wheelRadius;
  }

  private findCollision(state: VehicleState): 'car' | 'object' | 'curb' | null {
    const obb = vehicleOBB(state, this.spec);
    for (const c of this.colliders) {
      if (Math.abs(c.obb.cx - obb.cx) > 10 || Math.abs(c.obb.cz - obb.cz) > 8) continue;
      if (obbOverlap(obb, c.obb)) return c.kind;
    }
    for (const p of tireOuterPoints(state, this.spec)) {
      if (p.z > CURB_Z || p.z < -CURB_Z) return 'curb';
    }
    const corners = obbCorners(obb);
    if (corners.some((c) => Math.abs(c.z) > BUILDING_Z - 0.2)) return 'object';
    return null;
  }

  private onContact(kind: 'car' | 'object' | 'curb', impact: number): void {
    if (kind === 'curb') {
      if (this.curbContact) return;
      this.curbContact = true;
      this.attempt.curbHits++;
      this.audio.curb();
      this.hud.toast('Curb!', 'warn');
      this.shake = Math.max(this.shake, 0.08);
      return;
    }
    if (this.carContact) return;
    this.carContact = true;
    this.attempt.hits++;
    this.audio.collision(impact);
    this.hud.toast(kind === 'car' ? 'Collision!' : 'Hit an obstacle!', 'danger');
    this.shake = Math.max(this.shake, 0.25);
  }

  private readSensors(): { front: number | null; rear: number | null } {
    const obstacles = this.colliders.map((c) => c.obb);
    return {
      front: sensorDistance(this.vs, this.spec, 1, obstacles, 2.5),
      rear: sensorDistance(this.vs, this.spec, -1, obstacles, 2.5),
    };
  }

  private carCenter(): THREE.Vector3 {
    const f = forwardVec(this.vs.heading);
    const off = centerOffset(this.spec);
    return new THREE.Vector3(this.vs.x + f.x * off, 0, this.vs.z + f.z * off);
  }

  private updatePlayerVisual(dt: number): void {
    const p = this.player;
    p.root.position.set(this.vs.x, 0, this.vs.z);
    p.root.rotation.y = this.vs.heading;
    const { left, right } = ackermann(this.vs.steer, this.spec);
    for (const w of p.wheels) {
      if (w.front) w.steer.rotation.y = w.left ? left : right;
      w.spin.rotation.z = -this.wheelSpin;
    }
    const lateral = (this.vs.speed * this.vs.speed * Math.tan(this.vs.steer)) / this.spec.wheelbase;
    const pitch = THREE.MathUtils.clamp(this.accelSmooth * 0.006, -0.03, 0.03);
    const roll = THREE.MathUtils.clamp(lateral * 0.012, -0.035, 0.035);
    const k = Math.min(1, dt * 8);
    p.body.rotation.z += (pitch - p.body.rotation.z) * k;
    p.body.rotation.x += (roll - p.body.rotation.x) * k;

    const input = this.state === 'playing' ? this.lastInput : { throttle: 0, reverse: 0, brake: 0 };
    const v = this.vs.speed;
    const braking = input.brake > 0 || (input.reverse > 0 && v > 0.05) || (input.throttle > 0 && v < -0.05) || (this.state === 'playing' && Math.abs(v) < 0.05 && input.throttle === 0 && input.reverse === 0);
    const night = this.preset.headlights;
    p.lights.tail.emissiveIntensity = braking ? 5 : night ? 1.2 : 0.2;
    p.lights.reverse.emissiveIntensity = this.gear === 'R' && this.state === 'playing' ? 4 : 0;
    if (p.interior) {
      p.interior.steeringWheel.rotation.z = -this.vs.steer * 14;
      const fpv = this.isFpv();
      // the passenger mirror dips in reverse so the curb stays in view
      // like real cars: tilt down when shifting into reverse, back up when leaving it; T overrides
      if (this.gear !== this.tiltGear) {
        if (this.gear === 'R') this.mirrorTilted = true;
        else if (this.tiltGear === 'R') this.mirrorTilted = false;
        this.tiltGear = this.gear;
      }
      this.mirrorDip += ((this.mirrorTilted ? 1 : 0) - this.mirrorDip) * Math.min(1, dt * 3);
      const dip = new THREE.Quaternion().setFromAxisAngle(X_AXIS, MIRROR_DIP * this.mirrorDip);
      for (const mirror of p.interior.mirrors) {
        mirror.reflector.visible = fpv;
        mirror.standIn.visible = !fpv;
        if (mirror.side === 1) mirror.pivot.quaternion.copy(mirror.baseQuaternion).multiply(dip);
      }
      if (fpv) p.interior.updateCluster({ speedKmh: v * 3.6, gear: this.gear, sensor: this.state === 'playing' ? this.nearestSensor : null });
    }
  }

  private updateCamera(dt: number, snap: boolean): void {
    const center = this.carCenter();
    const s = this.spec;
    const k = snap ? 1 : 1 - Math.exp(-dt * 4.5);
    const desiredPos = new THREE.Vector3();
    const desiredLook = new THREE.Vector3();
    let desiredUp = UP;

    const fpv = this.isFpv();
    const near = fpv ? 0.04 : 0.1;
    const base = this.settings.fpvFov;
    const fov = fpv ? Math.round((base + (Math.min(base, this.glanceFov) - base) * this.glanceZoom) * 100) / 100 : 52;
    if (this.camera.near !== near || this.camera.fov !== fov) {
      this.camera.near = near;
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    const interior = this.player.interior;
    if (fpv && interior) {
      const body = this.player.body;
      body.updateWorldMatrix(true, false);
      // body-local axes: +x forward, +z right; the seat raises the eye
      const eye = interior.eye.clone().add(this.headOffset);
      eye.y += this.settings.seatHeight;
      const pos = body.localToWorld(eye);
      const yaw = THREE.MathUtils.clamp(this.lookYaw + this.keyYaw, -2.6, 2.6);
      const pitch = THREE.MathUtils.clamp(this.lookPitch + this.keyPitch, -0.8, 0.5);
      const look = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.1 + pitch, -Math.PI / 2 + yaw, 0, 'YXZ'));
      this.camera.position.copy(pos);
      this.camera.quaternion.copy(body.getWorldQuaternion(new THREE.Quaternion())).multiply(look);
      this.camera.up.copy(UP);
      this.camPos.copy(pos);
      this.camLook.copy(pos).add(new THREE.Vector3(0, 0, -5).applyQuaternion(this.camera.quaternion));
      return;
    }

    if (this.state === 'menu') {
      this.menuTime += dt;
      const a = -Math.PI / 2 + Math.sin(this.menuTime * 0.18) * 1.15;
      const r = s.length * 0.75 + 4.2;
      desiredPos.set(center.x + Math.cos(a) * r, 1.2 + s.height * 0.55, Math.max(-LANE_LINE_Z + 0.8, center.z + Math.sin(a) * r));
      desiredLook.set(center.x, s.height * 0.45, center.z);
      const width = window.innerWidth;
      if (width > 900) this.camera.setViewOffset(width, window.innerHeight, -Math.min(250, width * 0.2), 0, width, window.innerHeight);
      else this.camera.clearViewOffset();
    } else {
      switch (this.cameraMode) {
        case 'chase': {
          const f = forwardVec(this.vs.heading);
          const dist = s.length * 0.5 + 5.2;
          desiredPos.set(center.x - f.x * dist, 2.6 + s.height * 0.6, center.z - f.z * dist);
          desiredLook.set(center.x + f.x * 2, 0.7, center.z + f.z * 2);
          break;
        }
        case 'elevated':
          desiredPos.set(center.x - 8 - s.length * 0.4, 7 + s.length * 0.4, Math.min(center.z - 3.5, -1.5));
          desiredLook.set(center.x + 1.5, 0, center.z + 1.2);
          break;
        case 'birdseye':
          desiredPos.set(center.x, 11 + s.length * 1.3, center.z + 0.6);
          desiredLook.set(center.x, 0, center.z + 0.6);
          desiredUp = NORTH_UP;
          break;
        case 'curb': {
          const sx = this.level.spot.centerX;
          desiredPos.set(sx - 3, 2.4, BUILDING_Z - 0.6);
          desiredLook.set(sx, 0.3, CURB_Z - 1.4);
          break;
        }
        case 'orbit': {
          const target = center.clone().setY(0.8);
          const delta = target.clone().sub(this.controls.target);
          this.camera.position.add(delta);
          this.controls.target.copy(target);
          this.camera.up.copy(UP);
          this.controls.update();
          this.camPos.copy(this.camera.position);
          this.camLook.copy(target);
          return;
        }
      }
    }

    this.camPos.lerp(desiredPos, k);
    this.camLook.lerp(desiredLook, k);
    this.camera.up.lerp(desiredUp, snap ? 1 : k).normalize();
    this.camera.position.copy(this.camPos);
    if (this.shake > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.exp(-dt * 7);
    }
    this.camera.lookAt(this.camLook);
  }

  private pipRect(): { x: number; y: number; w: number; h: number } {
    const w = Math.min(380, window.innerWidth * 0.32);
    const h = (w * 9) / 16;
    return { x: (window.innerWidth - w) / 2, y: 16, w, h };
  }

  private render(): void {
    const center = this.carCenter();
    this.world.updateShadowFocus(center);
    this.renderer.shadowMap.needsUpdate = true;
    const rearFeed = this.state === 'playing' && this.settings.backupCamera && this.gear === 'R';
    const interior = this.player.interior;
    const showPip = rearFeed && !this.isFpv();
    if (rearFeed) {
      if (interior) interior.screen.visible = false;
      this.renderer.setRenderTarget(this.rearTarget);
      this.renderer.render(this.world.scene, this.rearCam);
      this.renderer.setRenderTarget(null);
      if (interior) interior.screen.visible = true;
    }
    if (interior) interior.screenMaterial.map = rearFeed ? this.rearTarget.texture : interior.idleScreen;
    this.composer.render();
    if (showPip) {
      const r = this.pipRect();
      const y = window.innerHeight - r.y - r.h;
      this.renderer.setScissorTest(true);
      this.renderer.setScissor(r.x, y, r.w, r.h);
      this.renderer.setViewport(r.x, y, r.w, r.h);
      this.renderer.render(this.pipScene, this.pipCamera);
      this.renderer.setScissorTest(false);
      this.renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
      this.hud.setPip(r);
    } else {
      this.hud.setPip(null);
    }
  }

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
  }
}
