import { silhouettePath } from './carModel';
import { CURB_Z, LANE_LINE_Z } from './constants';
import { DIFFICULTIES, type Difficulty, type Level } from './level';
import { obbCorners, type OBB, type Vec2 } from './physics';
import type { ParkResult } from './scoring';
import type { Settings } from './settings';
import type { TutorialView } from './tutorial';
import { PAINT_COLORS, VEHICLES, rearOverhang, turningCircle, type VehicleSpec } from './vehicles';
import { TIME_OF_DAY, type TimeOfDay } from './world';

function byId<T extends Element>(id: string, ctor: { new (): T; prototype: T }): T {
  const el = document.getElementById(id);
  if (!(el instanceof ctor)) throw new Error(`Missing element #${id}`);
  return el;
}

const div = (id: string): HTMLDivElement => byId(id, HTMLDivElement);
const span = (id: string): HTMLSpanElement => byId(id, HTMLSpanElement);

const DRIVE_KEYS = '<b>W/S</b> drive · <b>A/D</b> steer · <b>Space</b> brake · <b>Shift</b> creep · <b>C</b>/<b>1–6</b> camera · <b>Enter</b> finish · <b>Esc</b> pause';
const FPV_KEYS =
  '<b>Drag</b>/<b>IJKL</b> look · <b>Q/E</b> glance · <b>B</b> look back · <b>Scroll</b>/<b>Z X</b> zoom · <b>[ ]</b> seat height · <b>V</b> recentre · <b>T</b> tilt mirror · <b>C</b> camera';
const button = (id: string): HTMLButtonElement => byId(id, HTMLButtonElement);

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

function formatDistance(m: number | null): string {
  if (m === null) return '—';
  if (m >= 2) return `${m.toFixed(1)} m`;
  return `${Math.round(m * 100)} cm`;
}

type BooleanSetting = 'pathGuides' | 'spotHighlight' | 'sensors' | 'backupCamera' | 'selfCenter' | 'minimap' | 'readouts';

export interface MenuHandlers {
  onChange(settings: Settings, rebuildLevel: boolean): void;
  onStart(): void;
  onTutorial(): void;
}

export interface DriveReadout {
  speedKmh: number;
  gear: 'D' | 'N' | 'R';
  steerDeg: number;
  wheelTurnDeg: number;
}

export interface SensorReadout {
  /** Sensor arcs around the car icon. */
  graphic: boolean;
  /** Numeric front/rear/curb/angle values. */
  readouts: boolean;
  front: number | null;
  rear: number | null;
  curb: number | null;
  angleDeg: number;
}

export interface MinimapData {
  level: Level;
  parked: readonly OBB[];
  obstacles: readonly OBB[];
  player: OBB;
  playerColor: string;
}

export class Hud {
  private readonly loading = div('loading');
  private readonly hud = div('hud');
  private readonly menu = div('menu');
  private readonly pause = div('pause');
  private readonly result = div('result');
  private readonly toastEl = div('toast');
  private readonly hintEl = div('hud-hint');
  private readonly pipFrame = div('pip-frame');
  private readonly cameraLabel = div('camera-label');
  private readonly keysHint = div('keys-hint');
  private readonly minimap = byId('minimap', HTMLCanvasElement);
  private readonly minimapCtx: CanvasRenderingContext2D;
  private readonly wheel = byId('hud-wheel', SVGSVGElement);
  private readonly sensorPanel = div('hud-sensors');
  private toastTimer = 0;
  private settings: Settings;
  private handlers: MenuHandlers | null = null;

  constructor(settings: Settings) {
    this.settings = { ...settings };
    const ctx = this.minimap.getContext('2d');
    if (!ctx) throw new Error('2D canvas is not supported');
    this.minimapCtx = ctx;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.minimap.width = 200 * dpr;
    this.minimap.height = 200 * dpr;
    ctx.scale(dpr, dpr);
  }

  hideLoading(): void {
    this.loading.classList.add('hidden');
  }

  // ---------- Menu ----------

  bindMenu(handlers: MenuHandlers): void {
    this.handlers = handlers;
    button('start-btn').addEventListener('click', () => handlers.onStart());
    button('tutorial-btn').addEventListener('click', () => handlers.onTutorial());
    this.renderMenu();
  }

  /** Adopts settings changed outside the menu (e.g. keyboard toggles). */
  syncSettings(settings: Settings): void {
    this.settings = { ...settings };
    this.renderMenu();
  }

  private update(patch: Partial<Settings>, rebuildLevel: boolean): void {
    this.settings = { ...this.settings, ...patch };
    this.renderMenu();
    this.handlers?.onChange(this.settings, rebuildLevel);
  }

  setBestScore(best: number | null): void {
    div('best-score').textContent = best === null ? 'No score yet for this car & difficulty' : `Personal best: ${best} / 100`;
  }

  private renderMenu(): void {
    const s = this.settings;
    const grid = div('vehicle-grid');
    grid.replaceChildren(
      ...VEHICLES.map((v) => {
        const card = document.createElement('button');
        card.className = `vehicle-card${v.id === s.vehicleId ? ' selected' : ''}`;
        card.innerHTML = `${vehicleSvg(v)}<div class="name">${v.name}</div><div class="len">${v.length.toFixed(2)} m · ${v.category}</div>`;
        card.addEventListener('click', () => {
          if (v.id !== s.vehicleId) this.update({ vehicleId: v.id, color: v.defaultColor }, true);
        });
        return card;
      }),
    );
    const v = VEHICLES.find((x) => x.id === s.vehicleId) ?? VEHICLES[0];
    if (v) {
      div('vehicle-detail').innerHTML = `${v.description}<div class="specs">
        <span>Length <b>${v.length.toFixed(2)} m</b></span>
        <span>Width <b>${v.width.toFixed(2)} m</b></span>
        <span>Wheelbase <b>${v.wheelbase.toFixed(2)} m</b></span>
        <span>Rear overhang <b>${rearOverhang(v).toFixed(2)} m</b></span>
        <span>Turning circle <b>${turningCircle(v).toFixed(1)} m</b></span></div>`;
    }

    div('swatches').replaceChildren(
      ...PAINT_COLORS.map((c) => {
        const sw = document.createElement('button');
        sw.className = `swatch${c.hex.toLowerCase() === s.color.toLowerCase() ? ' selected' : ''}`;
        sw.style.background = c.hex;
        sw.title = c.name;
        sw.addEventListener('click', () => this.update({ color: c.hex }, false));
        return sw;
      }),
    );

    div('difficulty').replaceChildren(
      ...DIFFICULTIES.map((d) => {
        const b = document.createElement('button');
        b.textContent = d.label;
        b.title = `Space = car length + ${d.margin.toFixed(2)} m`;
        if (d.id === s.difficulty) b.className = 'selected';
        // the projected path defaults to on for Easy only; it can be toggled afterwards on any difficulty
        b.addEventListener('click', () => this.update(d.id === s.difficulty ? {} : { difficulty: d.id, pathGuides: d.id === 'easy' }, true));
        return b;
      }),
    );

    const tods: TimeOfDay[] = ['day', 'sunset', 'night'];
    div('tod').replaceChildren(
      ...tods.map((t) => {
        const b = document.createElement('button');
        b.textContent = TIME_OF_DAY[t].label;
        if (t === s.timeOfDay) b.className = 'selected';
        b.addEventListener('click', () => this.update({ timeOfDay: t }, false));
        return b;
      }),
    );

    const toggles: [BooleanSetting, string][] = [
      ['pathGuides', 'Projected path'],
      ['spotHighlight', 'Highlight space'],
      ['sensors', 'Parking sensors'],
      ['readouts', 'Distance & angle readouts'],
      ['backupCamera', 'Backup camera'],
      ['selfCenter', 'Self-centering wheel'],
      ['minimap', 'Minimap'],
    ];
    this.minimap.classList.toggle('hidden', !s.minimap);
    div('toggles').replaceChildren(
      ...toggles.map(([key, label]) => {
        const row = document.createElement('label');
        row.className = 'toggle';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = s[key];
        input.addEventListener('change', () => {
          const patch: Partial<Settings> = {};
          patch[key] = input.checked;
          this.update(patch, false);
        });
        row.append(label, input);
        return row;
      }),
    );
  }

  showMenu(visible: boolean): void {
    this.menu.classList.toggle('hidden', !visible);
  }

  showHud(visible: boolean): void {
    this.hud.classList.toggle('hidden', !visible);
  }

  // ---------- Pause / results ----------

  showPause(visible: boolean, handlers?: { resume(): void; restart(): void; menu(): void }): void {
    this.pause.classList.toggle('hidden', !visible);
    if (handlers) {
      button('resume-btn').onclick = handlers.resume;
      button('pause-restart-btn').onclick = handlers.restart;
      button('pause-menu-btn').onclick = handlers.menu;
    }
  }

  showResult(result: ParkResult | null, extras?: { best: number | null; record: boolean; handlers: { retry(): void; next(): void; menu(): void } }): void {
    this.result.classList.toggle('hidden', result === null);
    if (!result || !extras) return;
    div('result-stars').innerHTML = [0, 1, 2].map((i) => `<span class="${i < result.stars ? 'on' : 'off'}">★</span>`).join('');
    byId('result-title', HTMLHeadingElement).textContent = result.headline;
    div('result-score').innerHTML = result.success ? `${result.total}<small> / 100</small>` : '';
    byId('result-reason', HTMLParagraphElement).textContent = result.reason;
    div('result-items').innerHTML = result.items
      .map(
        (item) => `<div class="result-item">
          <span class="label">${item.label}</span>
          <span class="pts">${Math.round(item.points)} / ${item.max}</span>
          <span class="detail">${item.detail}</span>
          <span class="bar"><i style="width:${(item.points / item.max) * 100}%"></i></span>
        </div>`,
      )
      .join('');
    const parts = [`Time ${formatTime(result.time)}`];
    if (extras.record) parts.push('<span class="record">New personal best!</span>');
    else if (extras.best !== null) parts.push(`Best ${extras.best}`);
    div('result-meta').innerHTML = parts.join(' · ');
    button('result-retry-btn').onclick = extras.handlers.retry;
    button('result-next-btn').onclick = extras.handlers.next;
    button('result-menu-btn').onclick = extras.handlers.menu;
  }

  // ---------- In-game ----------

  setLevelInfo(spec: VehicleSpec, difficulty: Difficulty, level: Level): void {
    span('hud-vehicle').textContent = spec.name;
    span('hud-difficulty').textContent = DIFFICULTIES.find((d) => d.id === difficulty)?.label ?? difficulty;
    div('hud-spot').textContent = `Space ${level.spot.length.toFixed(2)} m · your car ${spec.length.toFixed(2)} m (+${(level.spot.length - spec.length).toFixed(2)} m)`;
  }

  setStats(time: number, moves: number, hits: number, curbHits: number): void {
    span('hud-time').textContent = formatTime(time);
    span('hud-moves').textContent = String(moves);
    const h = span('hud-hits');
    h.textContent = String(hits);
    h.classList.toggle('bad', hits > 0);
    const c = span('hud-curb');
    c.textContent = String(curbHits);
    c.classList.toggle('bad', curbHits > 0);
  }

  setDrive(d: DriveReadout): void {
    span('hud-speed').textContent = String(Math.round(Math.abs(d.speedKmh)));
    for (const g of ['D', 'N', 'R']) span(`gear-${g}`).classList.toggle('active', g === d.gear);
    this.wheel.style.transform = `rotate(${d.wheelTurnDeg.toFixed(1)}deg)`;
    const dir = Math.abs(d.steerDeg) < 0.5 ? '' : d.steerDeg > 0 ? ' L' : ' R';
    div('hud-steer').textContent = `${Math.abs(d.steerDeg).toFixed(0)}°${dir}`;
  }

  setSensors(r: SensorReadout): void {
    this.sensorPanel.classList.toggle('hidden', !r.graphic && !r.readouts);
    this.sensorPanel.querySelector('svg')?.classList.toggle('hidden', !r.graphic);
    div('sensor-readouts').classList.toggle('hidden', !r.readouts);
    if (!r.graphic && !r.readouts) return;
    const level = (d: number | null): number => (d === null ? 0 : d < 0.4 ? 3 : d < 0.9 ? 2 : d < 1.5 ? 1 : 0);
    const paint = (prefix: string, d: number | null): void => {
      const lv = level(d);
      for (let i = 1; i <= 3; i++) {
        const arc = document.getElementById(`${prefix}${i}`);
        if (!arc) continue;
        arc.setAttribute('class', `arc${lv >= i ? ` on-${lv}` : ''}`);
      }
    };
    paint('sf', r.front);
    paint('sr', r.rear);
    const setVal = (id: string, text: string, cls: string): void => {
      const el = span(id);
      el.textContent = text;
      el.className = cls;
    };
    const proxClass = (d: number | null): string => (d === null ? '' : d < 0.4 ? 'bad' : d < 0.9 ? 'warn' : '');
    setVal('sens-front', formatDistance(r.front), proxClass(r.front));
    setVal('sens-rear', formatDistance(r.rear), proxClass(r.rear));
    const curbClass = r.curb === null ? '' : r.curb <= 0.3 ? 'good' : r.curb <= 0.6 ? 'warn' : '';
    setVal('sens-curb', r.curb === null || r.curb > 3 ? '—' : formatDistance(r.curb), curbClass);
    setVal('sens-angle', `${r.angleDeg.toFixed(1)}°`, r.angleDeg <= 2 ? 'good' : r.angleDeg <= 8 ? 'warn' : '');
  }

  setSteeringVisible(visible: boolean): void {
    div('hud-wheel-wrap').classList.toggle('hidden', !visible);
  }

  setTutorial(view: TutorialView | null): void {
    div('tutorial-panel').classList.toggle('hidden', view === null);
    if (!view) return;
    span('tutorial-step').textContent = `Tutorial · step ${view.index + 1} of ${view.count}`;
    const progress = div('tutorial-progress');
    if (progress.childElementCount !== view.count) progress.replaceChildren(...Array.from({ length: view.count }, () => document.createElement('span')));
    Array.from(progress.children).forEach((el, i) => {
      el.className = i < view.index ? 'done' : i === view.index ? 'current' : '';
    });
    const title = div('tutorial-title');
    if (title.textContent !== view.title) {
      title.textContent = view.title;
      div('tutorial-text').innerHTML = view.text;
    }
    const status = div('tutorial-status');
    status.textContent = view.warning ?? view.status ?? '';
    status.classList.toggle('warn', view.warning !== null);
  }

  setKeysHint(mode: 'drive' | 'fpv'): void {
    this.keysHint.innerHTML = mode === 'fpv' ? FPV_KEYS : DRIVE_KEYS;
  }

  setCameraLabel(label: string): void {
    this.cameraLabel.textContent = label;
  }

  setHint(text: string | null): void {
    if (text) this.hintEl.textContent = text;
    this.hintEl.classList.toggle('visible', text !== null);
  }

  toast(text: string, kind: 'danger' | 'warn' | 'info'): void {
    this.toastEl.textContent = text;
    this.toastEl.className = `toast ${kind} visible`;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('visible'), 1100);
  }

  setPip(rect: { x: number; y: number; w: number; h: number } | null): void {
    this.pipFrame.classList.toggle('hidden', rect === null);
    if (!rect) return;
    this.pipFrame.style.left = `${rect.x}px`;
    this.pipFrame.style.top = `${rect.y}px`;
    this.pipFrame.style.width = `${rect.w}px`;
    this.pipFrame.style.height = `${rect.h}px`;
  }

  drawMinimap(data: MinimapData): void {
    const ctx = this.minimapCtx;
    const size = 200;
    const scale = 5.2;
    const center: Vec2 = { x: data.player.cx, z: Math.max(-4, Math.min(4, data.player.cz)) };
    const tx = (p: Vec2): [number, number] => [size / 2 + (p.x - center.x) * scale, size / 2 + (p.z - center.z) * scale];
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#20252b';
    ctx.fillRect(0, 0, size, size);
    // sidewalks
    ctx.fillStyle = '#4a4f55';
    const [, roadTop] = tx({ x: 0, z: -CURB_Z });
    const [, roadBottom] = tx({ x: 0, z: CURB_Z });
    ctx.fillRect(0, 0, size, roadTop);
    ctx.fillRect(0, roadBottom, size, size - roadBottom);
    ctx.fillStyle = '#2c3137';
    ctx.fillRect(0, roadTop, size, roadBottom - roadTop);
    // lane lines
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    for (const z of [-LANE_LINE_Z, LANE_LINE_Z]) {
      const [, y] = tx({ x: 0, z });
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,200,40,0.6)';
    const [, cy] = tx({ x: 0, z: 0 });
    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(size, cy);
    ctx.stroke();
    // spot
    const spot = data.level.spot;
    const [sx0, sy0] = tx({ x: spot.rearX, z: LANE_LINE_Z });
    const [sx1, sy1] = tx({ x: spot.frontX, z: CURB_Z });
    ctx.fillStyle = 'rgba(48,209,88,0.28)';
    ctx.fillRect(sx0, sy0, sx1 - sx0, sy1 - sy0);
    ctx.strokeStyle = 'rgba(48,209,88,0.9)';
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(sx0, sy0, sx1 - sx0, sy1 - sy0);
    ctx.setLineDash([]);

    const poly = (o: OBB, fill: string): void => {
      const pts = obbCorners(o).map(tx);
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    };
    for (const o of data.obstacles) {
      if (Math.abs(o.cx - center.x) < 30 && o.hx < 1) poly(o, '#8b929a');
    }
    for (const o of data.parked) {
      if (Math.abs(o.cx - center.x) < 30) poly(o, '#6b737c');
    }
    poly(data.player, data.playerColor);
    // heading tick
    const corners = obbCorners(data.player);
    const fl = corners[1];
    const fr = corners[2];
    if (fl && fr) {
      const [ax, ay] = tx(fl);
      const [bx, by] = tx(fr);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
  }
}

function vehicleSvg(v: VehicleSpec): string {
  const maxLen = 5.8;
  const ro = rearOverhang(v);
  const pad = (maxLen - v.length) / 2;
  const wheels = [ro, ro + v.wheelbase]
    .map((x) => `<circle class="tire" cx="${x.toFixed(3)}" cy="${(-v.wheelRadius).toFixed(3)}" r="${v.wheelRadius.toFixed(3)}" />`)
    .join('');
  return `<svg viewBox="${(-pad).toFixed(3)} -2.6 ${maxLen} 2.7" preserveAspectRatio="xMidYMax meet"><path class="silhouette" d="${silhouettePath(v)}" />${wheels}</svg>`;
}
