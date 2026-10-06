import type { DriveInput } from './physics';

const DRIVE_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

/** Keyboard steering starts gently on a tap and builds to full speed when held (seconds). */
const STEER_RAMP_START = 0.12;
const STEER_RAMP_END = 0.9;
const STEER_TAP_SPEED = 0.35;
/** Stick response curve: >1 softens the centre for fine corrections. */
const STICK_EXPONENT = 1.7;

export type Action = 'camera' | 'finish' | 'restart' | 'pause' | 'mute' | 'guides' | 'next' | 'recenter' | 'mirrorTilt';

const ACTION_KEYS: Readonly<Record<string, Action>> = {
  KeyC: 'camera',
  Enter: 'finish',
  KeyR: 'restart',
  Escape: 'pause',
  KeyP: 'pause',
  KeyM: 'mute',
  KeyG: 'guides',
  KeyN: 'next',
  KeyV: 'recenter',
  KeyT: 'mirrorTilt',
};

const PAD_ACTIONS: readonly [number, Action][] = [
  [0, 'finish'],
  [3, 'camera'],
  [9, 'pause'],
  [2, 'restart'],
  [11, 'recenter'],
  [13, 'mirrorTilt'],
];

export class Input {
  private readonly down = new Set<string>();
  private readonly actions = new Set<Action>();
  private readonly digits: number[] = [];
  private padPrev: boolean[] = [];
  /** performance.now() when the current steering key press began. */
  private steerSince = 0;
  private steerDir = 0;
  enabled = false;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (this.enabled && DRIVE_KEYS.has(e.code)) e.preventDefault();
      if (!e.repeat) {
        const action = ACTION_KEYS[e.code];
        if (action) this.actions.add(action);
        if (/^Digit[1-6]$/.test(e.code)) this.digits.push(Number(e.code.slice(5)));
      }
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }

  private gamepad(): Gamepad | null {
    if (typeof navigator.getGamepads !== 'function') return null;
    for (const pad of navigator.getGamepads()) if (pad && pad.connected) return pad;
    return null;
  }

  private steerRamp(dir: number): number {
    const now = performance.now();
    if (dir !== this.steerDir) {
      this.steerDir = dir;
      this.steerSince = now;
    }
    if (dir === 0) return 0;
    const held = (now - this.steerSince) / 1000;
    const t = Math.min(1, Math.max(0, (held - STEER_RAMP_START) / (STEER_RAMP_END - STEER_RAMP_START)));
    return dir * (STEER_TAP_SPEED + (1 - STEER_TAP_SPEED) * t * t * (3 - 2 * t));
  }

  /** Call once per frame before reading actions. */
  poll(): void {
    const pad = this.gamepad();
    if (!pad) return;
    const pressed = pad.buttons.map((b) => b.pressed);
    for (const [index, action] of PAD_ACTIONS) {
      if (pressed[index] && !this.padPrev[index]) this.actions.add(action);
    }
    this.padPrev = pressed;
  }

  consume(action: Action): boolean {
    const had = this.actions.has(action);
    this.actions.delete(action);
    return had;
  }

  consumeDigit(): number | null {
    return this.digits.shift() ?? null;
  }

  clearActions(): void {
    this.actions.clear();
    this.digits.length = 0;
  }

  private axis(positive: string, negative: string): number {
    return (this.down.has(positive) ? 1 : 0) - (this.down.has(negative) ? 1 : 0);
  }

  /** Held glance in the driver view: +1 left, -1 right (Q/E, LB/RB). */
  glance(): number {
    const pad = this.gamepad();
    const padGlance = pad ? (pad.buttons[4]?.pressed ? 1 : 0) - (pad.buttons[5]?.pressed ? 1 : 0) : 0;
    return Math.max(-1, Math.min(1, this.axis('KeyQ', 'KeyE') + padGlance));
  }

  /** Held: look back over the right shoulder (B). */
  lookBack(): boolean {
    return this.down.has('KeyB');
  }

  /** Continuous look rates in [-1, 1]: yaw +left, pitch +up (IJKL, right stick). */
  lookRate(): { yaw: number; pitch: number } {
    let yaw = this.axis('KeyJ', 'KeyL');
    let pitch = this.axis('KeyI', 'KeyK');
    const pad = this.gamepad();
    if (pad) {
      const x = pad.axes[2] ?? 0;
      const y = pad.axes[3] ?? 0;
      if (Math.abs(x) > 0.12) yaw -= x;
      if (Math.abs(y) > 0.12) pitch -= y;
    }
    return { yaw: Math.max(-1, Math.min(1, yaw)), pitch: Math.max(-1, Math.min(1, pitch)) };
  }

  /** +1 zoom in, -1 zoom out (X/Z). */
  zoom(): number {
    return this.axis('KeyX', 'KeyZ');
  }

  /** +1 raise the seat, -1 lower it (]/[). */
  seat(): number {
    return this.axis('BracketRight', 'BracketLeft');
  }

  drive(): DriveInput {
    const k = (code: string): boolean => this.down.has(code);
    let throttle = k('KeyW') || k('ArrowUp') ? 1 : 0;
    let reverse = k('KeyS') || k('ArrowDown') ? 1 : 0;
    let brake = k('Space') ? 1 : 0;
    let steerAxis = this.steerRamp((k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0));
    let analogSteer = false;
    if (k('ShiftLeft') || k('ShiftRight')) {
      throttle *= 0.4;
      reverse *= 0.4;
    }
    const pad = this.gamepad();
    if (pad) {
      const axis = pad.axes[0] ?? 0;
      if (Math.abs(axis) > 0.08) {
        steerAxis = Math.sign(axis) * Math.abs(axis) ** STICK_EXPONENT;
        analogSteer = true;
      }
      const rt = pad.buttons[7]?.value ?? 0;
      const lt = pad.buttons[6]?.value ?? 0;
      if (rt > 0.05) throttle = Math.max(throttle, rt);
      if (lt > 0.05) reverse = Math.max(reverse, lt);
      if (pad.buttons[1]?.pressed) brake = 1;
    }
    return { throttle, reverse, brake, steerAxis, analogSteer };
  }
}
