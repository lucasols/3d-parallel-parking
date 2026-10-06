interface EngineNodes {
  ctx: AudioContext;
  master: GainNode;
  oscA: OscillatorNode;
  oscB: OscillatorNode;
  filter: BiquadFilterNode;
  engineGain: GainNode;
  beepOsc: OscillatorNode;
  beepGain: GainNode;
  noise: AudioBuffer;
}

export interface AudioFrame {
  active: boolean;
  speed: number;
  throttle: number;
  /** Closest parking-sensor reading in meters, or null when nothing is in range. */
  sensor: number | null;
}

export class GameAudio {
  private nodes: EngineNodes | null = null;
  private muted = false;
  private beepClock = 0;

  /** Must be called from a user gesture. */
  start(): void {
    if (this.nodes) {
      void this.nodes.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 0.8;
    master.connect(ctx.destination);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500;
    filter.Q.value = 2;
    const engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    filter.connect(engineGain);
    engineGain.connect(master);

    const oscA = ctx.createOscillator();
    oscA.type = 'sawtooth';
    oscA.frequency.value = 38;
    const oscB = ctx.createOscillator();
    oscB.type = 'square';
    oscB.frequency.value = 19.3;
    const gainB = ctx.createGain();
    gainB.gain.value = 0.5;
    oscA.connect(filter);
    oscB.connect(gainB);
    gainB.connect(filter);
    oscA.start();
    oscB.start();

    const beepOsc = ctx.createOscillator();
    beepOsc.type = 'sine';
    beepOsc.frequency.value = 2200;
    const beepGain = ctx.createGain();
    beepGain.gain.value = 0;
    beepOsc.connect(beepGain);
    beepGain.connect(master);
    beepOsc.start();

    const noise = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    this.nodes = { ctx, master, oscA, oscB, filter, engineGain, beepOsc, beepGain, noise };
  }

  get isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.nodes) this.nodes.master.gain.setTargetAtTime(muted ? 0 : 0.8, this.nodes.ctx.currentTime, 0.05);
  }

  update(dt: number, frame: AudioFrame): void {
    const n = this.nodes;
    if (!n) return;
    const t = n.ctx.currentTime;
    const rev = Math.min(1, Math.abs(frame.speed) / 8);
    const freq = 36 + rev * 50 + frame.throttle * 16;
    n.oscA.frequency.setTargetAtTime(freq, t, 0.08);
    n.oscB.frequency.setTargetAtTime(freq * 0.505, t, 0.08);
    n.filter.frequency.setTargetAtTime(300 + frame.throttle * 900 + rev * 600, t, 0.1);
    n.engineGain.gain.setTargetAtTime(frame.active ? 0.07 + frame.throttle * 0.06 : 0, t, 0.15);

    if (!frame.active || frame.sensor === null || frame.sensor > 1.6) {
      n.beepGain.gain.setTargetAtTime(0, t, 0.01);
      this.beepClock = 0;
      return;
    }
    if (frame.sensor < 0.3) {
      n.beepGain.gain.setTargetAtTime(0.09, t, 0.01);
      return;
    }
    const interval = 0.08 + ((frame.sensor - 0.3) / 1.3) * 0.55;
    this.beepClock -= dt;
    if (this.beepClock <= 0) {
      this.beepClock = interval;
      n.beepGain.gain.cancelScheduledValues(t);
      n.beepGain.gain.setValueAtTime(0.09, t);
      n.beepGain.gain.setValueAtTime(0, t + 0.065);
    }
  }

  private thump(frequency: number, volume: number, duration: number): void {
    const n = this.nodes;
    if (!n) return;
    const src = n.ctx.createBufferSource();
    src.buffer = n.noise;
    const filter = n.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = frequency;
    const gain = n.ctx.createGain();
    const t = n.ctx.currentTime;
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(n.master);
    src.start(t);
    src.stop(t + duration);
  }

  collision(impactSpeed: number): void {
    this.thump(900, Math.min(1, 0.35 + impactSpeed * 0.4), 0.35);
  }

  curb(): void {
    this.thump(180, 0.6, 0.25);
  }

  /** Two-note confirmation, e.g. for a completed tutorial step. */
  chime(): void {
    const n = this.nodes;
    if (!n) return;
    const t = n.ctx.currentTime;
    [880, 1318.5].forEach((frequency, i) => {
      const osc = n.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = frequency;
      const gain = n.ctx.createGain();
      const start = t + i * 0.11;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.12, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);
      osc.connect(gain);
      gain.connect(n.master);
      osc.start(start);
      osc.stop(start + 0.4);
    });
  }
}
