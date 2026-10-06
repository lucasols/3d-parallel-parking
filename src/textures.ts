import * as THREE from 'three';
import { createRng, range, type Rng } from './rng';

function hash(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

/** Tileable value noise; x and y are in lattice units, wrapping every `period` cells. */
function noise2(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const x0 = ((xi % period) + period) % period;
  const y0 = ((yi % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y1 = (y0 + 1) % period;
  const a = hash(x0, y0, seed);
  const b = hash(x1, y0, seed);
  const c = hash(x0, y1, seed);
  const d = hash(x1, y1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Tileable fractal noise for u, v in [0, 1). */
function fbm(u: number, v: number, basePeriod: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let period = basePeriod;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise2(u * period, v * period, period, seed + o * 17);
    norm += amp;
    amp *= 0.5;
    period *= 2;
  }
  return sum / norm;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

interface CanvasPair {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

function createCanvas(width: number, height: number): CanvasPair {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not supported');
  return { canvas, ctx };
}

function toTexture(canvas: HTMLCanvasElement, srgb: boolean): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

function normalMapFromHeight(height: Float32Array, size: number, strength: number): THREE.CanvasTexture {
  const { canvas, ctx } = createCanvas(size, size);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    const up = ((y - 1 + size) % size) * size;
    const down = ((y + 1) % size) * size;
    const row = y * size;
    for (let x = 0; x < size; x++) {
      const l = height[row + ((x - 1 + size) % size)];
      const r = height[row + ((x + 1) % size)];
      const u = height[up + x];
      const d = height[down + x];
      let nx = (l - r) * strength;
      let ny = (d - u) * strength;
      let nz = 1;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (row + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(canvas, false);
}

export interface PbrTextures {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
}

export function createAsphaltTextures(): PbrTextures {
  const size = 1024;
  const height = new Float32Array(size * size);
  const color = createCanvas(size, size);
  const rough = createCanvas(size, size);
  const colorImg = color.ctx.createImageData(size, size);
  const roughImg = rough.ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const large = fbm(u, v, 3, 3, 11);
      const grain = noise2(u * 256, v * 256, 256, 23);
      const stoneN = noise2(u * 200, v * 200, 200, 37);
      const fine = hash(x, y, 5);
      const stone = smoothstep(0.74, 0.84, stoneN);
      const pit = smoothstep(0.2, 0.13, stoneN);
      const h = grain * 0.25 + stone * 0.35 - pit * 0.25 + fine * 0.06;
      const i = y * size + x;
      height[i] = h;
      const base = 60 + (large - 0.5) * 30 + (grain - 0.5) * 10 + stone * 22 - pit * 14 + (fine - 0.5) * 10;
      const p = i * 4;
      colorImg.data[p] = base;
      colorImg.data[p + 1] = base;
      colorImg.data[p + 2] = base + 3;
      colorImg.data[p + 3] = 255;
      const r = 225 - stone * 50 + (large - 0.5) * 30;
      roughImg.data[p] = r;
      roughImg.data[p + 1] = r;
      roughImg.data[p + 2] = r;
      roughImg.data[p + 3] = 255;
    }
  }
  color.ctx.putImageData(colorImg, 0, 0);
  rough.ctx.putImageData(roughImg, 0, 0);
  return {
    map: toTexture(color.canvas, true),
    normalMap: normalMapFromHeight(height, size, 1.2),
    roughnessMap: toTexture(rough.canvas, false),
  };
}

/** Concrete sidewalk slabs: 512px covers 3m × 3m with 2 × 2 slabs. */
export function createSidewalkTextures(): PbrTextures {
  const size = 512;
  const slab = size / 2;
  const height = new Float32Array(size * size);
  const color = createCanvas(size, size);
  const colorImg = color.ctx.createImageData(size, size);
  const rough = createCanvas(size, size);
  const roughImg = rough.ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const large = fbm(u, v, 4, 4, 91);
      const grain = noise2(u * 128, v * 128, 128, 7);
      const fine = hash(x, y, 77);
      const dx = Math.min(x % slab, slab - (x % slab));
      const dy = Math.min(y % slab, slab - (y % slab));
      const joint = 1 - smoothstep(1, 3.5, Math.min(dx, dy));
      const slabTone = hash(Math.floor(x / slab), Math.floor(y / slab), 3) - 0.5;
      const i = y * size + x;
      height[i] = grain * 0.3 + fine * 0.15 - joint * 1.2;
      const base = 162 + (large - 0.5) * 40 + (grain - 0.5) * 16 + (fine - 0.5) * 18 + slabTone * 14 - joint * 70;
      const p = i * 4;
      colorImg.data[p] = base;
      colorImg.data[p + 1] = base - 1;
      colorImg.data[p + 2] = base - 4;
      colorImg.data[p + 3] = 255;
      const r = 215 + (fine - 0.5) * 30;
      roughImg.data[p] = r;
      roughImg.data[p + 1] = r;
      roughImg.data[p + 2] = r;
      roughImg.data[p + 3] = 255;
    }
  }
  color.ctx.putImageData(colorImg, 0, 0);
  rough.ctx.putImageData(roughImg, 0, 0);
  return {
    map: toTexture(color.canvas, true),
    normalMap: normalMapFromHeight(height, size, 1.6),
    roughnessMap: toTexture(rough.canvas, false),
  };
}

export function createConcreteTexture(seed: number, tone: number): THREE.CanvasTexture {
  const size = 256;
  const { canvas, ctx } = createCanvas(size, size);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm(x / size, y / size, 4, 4, seed);
      const fine = hash(x, y, seed + 1);
      const base = tone + (n - 0.5) * 50 + (fine - 0.5) * 22;
      const p = (y * size + x) * 4;
      img.data[p] = base;
      img.data[p + 1] = base;
      img.data[p + 2] = base - 3;
      img.data[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(canvas, true);
}

export interface FacadeStyle {
  readonly wall: string;
  readonly frame: string;
  readonly brick: boolean;
  readonly windowWidth: number;
  readonly windowHeight: number;
  readonly sill: string;
}

export const FACADE_STYLES: readonly FacadeStyle[] = [
  { wall: '#86513d', frame: '#ece6da', brick: true, windowWidth: 0.42, windowHeight: 0.56, sill: '#d8d0c0' },
  { wall: '#d6c9ad', frame: '#4c3f33', brick: false, windowWidth: 0.5, windowHeight: 0.52, sill: '#efe8d8' },
  { wall: '#9a9c9e', frame: '#2c2f33', brick: false, windowWidth: 0.66, windowHeight: 0.6, sill: '#b8babc' },
  { wall: '#ecebe6', frame: '#38393b', brick: false, windowWidth: 0.46, windowHeight: 0.55, sill: '#ffffff' },
  { wall: '#5b382b', frame: '#d9d4c7', brick: true, windowWidth: 0.4, windowHeight: 0.58, sill: '#c9c1b2' },
  { wall: '#c4a57d', frame: '#f4f1ea', brick: false, windowWidth: 0.44, windowHeight: 0.56, sill: '#e8dcc6' },
];

export interface FacadeTextures {
  map: THREE.Texture;
  emissiveMap: THREE.Texture;
  /** Roughness in G, metalness in B (three.js channel convention). */
  roughMetal: THREE.Texture;
}

function noisyFill(ctx: CanvasRenderingContext2D, size: number, base: string, amount: number, brick: boolean, seed: number): void {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const img = ctx.getImageData(0, 0, size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p = (y * size + x) * 4;
      let delta = (fbm(x / size, y / size, 8, 3, seed) - 0.5) * amount + (hash(x, y, seed) - 0.5) * amount * 0.6;
      if (brick) {
        const row = Math.floor(y / 5);
        const bx = Math.floor((x + (row % 2) * 5) / 10);
        delta += (hash(bx, row, seed + 9) - 0.5) * 34;
        if (y % 5 === 0 || (x + (row % 2) * 5) % 10 === 0) delta += 38;
      }
      img.data[p] = img.data[p] + delta;
      img.data[p + 1] = img.data[p + 1] + delta;
      img.data[p + 2] = img.data[p + 2] + delta;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** 512px tile = 4 bays × 4 floors. */
export function createFacadeTextures(style: FacadeStyle, seed: number): FacadeTextures {
  const size = 512;
  const cell = size / 4;
  const rng = createRng(seed);
  const color = createCanvas(size, size);
  const emissive = createCanvas(size, size);
  const rm = createCanvas(size, size);
  noisyFill(color.ctx, size, style.wall, 22, style.brick, seed);
  emissive.ctx.fillStyle = '#000';
  emissive.ctx.fillRect(0, 0, size, size);
  rm.ctx.fillStyle = 'rgb(0, 235, 0)';
  rm.ctx.fillRect(0, 0, size, size);

  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const ww = cell * style.windowWidth;
      const wh = cell * style.windowHeight;
      const wx = col * cell + (cell - ww) / 2;
      const wy = row * cell + cell * 0.2;
      const c = color.ctx;
      c.fillStyle = 'rgba(0,0,0,0.25)';
      c.fillRect(wx - 5, wy - 5, ww + 10, wh + 12);
      c.fillStyle = style.frame;
      c.fillRect(wx - 3, wy - 3, ww + 6, wh + 6);
      const glass = c.createLinearGradient(wx, wy, wx + ww * 0.4, wy + wh);
      glass.addColorStop(0, '#3a4a5c');
      glass.addColorStop(0.55, '#1c2530');
      glass.addColorStop(1, '#2a3440');
      c.fillStyle = glass;
      c.fillRect(wx, wy, ww, wh);
      // interior hint (curtains / blinds)
      if (rng() < 0.45) {
        c.fillStyle = rng() < 0.5 ? 'rgba(220,210,190,0.35)' : 'rgba(120,110,100,0.35)';
        const blind = wh * range(rng, 0.15, 0.6);
        c.fillRect(wx, wy, ww, blind);
      }
      c.fillStyle = style.frame;
      c.fillRect(wx + ww / 2 - 1.5, wy, 3, wh);
      c.fillRect(wx, wy + wh * 0.32, ww, 3);
      c.fillStyle = style.sill;
      c.fillRect(wx - 6, wy + wh + 3, ww + 12, 5);
      c.fillStyle = 'rgba(0,0,0,0.25)';
      c.fillRect(wx - 6, wy + wh + 8, ww + 12, 2);

      rm.ctx.fillStyle = 'rgb(0, 28, 150)';
      rm.ctx.fillRect(wx, wy, ww, wh);

      if (rng() < 0.38) {
        const warm = rng();
        const e = emissive.ctx;
        const grad = e.createLinearGradient(wx, wy, wx, wy + wh);
        const tint = warm < 0.7 ? [255, 196, 120] : [200, 220, 255];
        const intensity = range(rng, 0.55, 1);
        grad.addColorStop(0, `rgba(${tint[0]},${tint[1]},${tint[2]},${intensity * 0.7})`);
        grad.addColorStop(1, `rgba(${tint[0]},${tint[1]},${tint[2]},${intensity})`);
        e.fillStyle = grad;
        e.fillRect(wx, wy, ww, wh);
        e.fillStyle = '#000';
        e.fillRect(wx + ww / 2 - 1.5, wy, 3, wh);
        e.fillRect(wx, wy + wh * 0.32, ww, 3);
      }
    }
  }
  // floor band
  color.ctx.fillStyle = 'rgba(0,0,0,0.12)';
  for (let row = 0; row < 4; row++) color.ctx.fillRect(0, row * cell, size, 3);

  return {
    map: toTexture(color.canvas, true),
    emissiveMap: toTexture(emissive.canvas, true),
    roughMetal: toTexture(rm.canvas, false),
  };
}

const SHOP_COLORS = ['#1f3a2e', '#3b1d1d', '#1b2a44', '#2b2b2b', '#5a3b1c', '#40304f'];
const SHOP_NAMES = ['CAFÉ', 'BAKERY', 'BOOKS', 'FLOWERS', 'DELI', 'PHARMACY', 'BARBER', 'WINE', 'OPTICS', 'GROCERY'];

/** 1024 × 256 tile covering two shopfronts (14m × 4.2m). */
export function createShopfrontTextures(seed: number): FacadeTextures {
  const w = 1024;
  const h = 256;
  const rng = createRng(seed);
  const color = createCanvas(w, h);
  const emissive = createCanvas(w, h);
  const rm = createCanvas(w, h);
  const c = color.ctx;
  c.fillStyle = '#c9c2b4';
  c.fillRect(0, 0, w, h);
  emissive.ctx.fillStyle = '#000';
  emissive.ctx.fillRect(0, 0, w, h);
  rm.ctx.fillStyle = 'rgb(0, 220, 0)';
  rm.ctx.fillRect(0, 0, w, h);

  for (let unit = 0; unit < 2; unit++) {
    const x0 = unit * (w / 2);
    const uw = w / 2;
    const brand = SHOP_COLORS[Math.floor(rng() * SHOP_COLORS.length)] ?? '#2b2b2b';
    const name = SHOP_NAMES[Math.floor(rng() * SHOP_NAMES.length)] ?? 'SHOP';
    // pilasters
    c.fillStyle = '#b3ab9c';
    c.fillRect(x0, 0, 16, h);
    c.fillRect(x0 + uw - 16, 0, 16, h);
    // sign band
    c.fillStyle = brand;
    c.fillRect(x0 + 16, 8, uw - 32, 46);
    c.fillStyle = '#f4efe2';
    c.font = 'bold 30px Georgia, serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(name, x0 + uw / 2, 32);
    emissive.ctx.fillStyle = 'rgba(255,230,180,0.85)';
    emissive.ctx.font = 'bold 30px Georgia, serif';
    emissive.ctx.textAlign = 'center';
    emissive.ctx.textBaseline = 'middle';
    emissive.ctx.fillText(name, x0 + uw / 2, 32);
    // frames
    const gy = 66;
    const gh = h - gy - 14;
    c.fillStyle = brand;
    c.fillRect(x0 + 24, gy - 6, uw - 48, gh + 10);
    const doorW = 70;
    const doorX = x0 + (rng() < 0.5 ? 36 : uw - 36 - doorW);
    const panes: [number, number][] = [];
    if (doorX < x0 + uw / 2) panes.push([doorX + doorW + 10, x0 + uw - 32]);
    else panes.push([x0 + 32, doorX - 10]);
    for (const [a, b] of panes) {
      const grad = c.createLinearGradient(a, gy, b, gy + gh);
      grad.addColorStop(0, '#45566a');
      grad.addColorStop(0.5, '#1d252f');
      grad.addColorStop(1, '#303c48');
      c.fillStyle = grad;
      c.fillRect(a, gy, b - a, gh - 30);
      // shelves inside
      c.fillStyle = 'rgba(200,170,120,0.18)';
      for (let s = 0; s < 3; s++) c.fillRect(a + 10, gy + 30 + s * 40, b - a - 20, 6);
      rm.ctx.fillStyle = 'rgb(0, 20, 140)';
      rm.ctx.fillRect(a, gy, b - a, gh - 30);
      const glow = emissive.ctx.createLinearGradient(a, gy, a, gy + gh - 30);
      glow.addColorStop(0, 'rgba(255, 214, 160, 0.8)');
      glow.addColorStop(1, 'rgba(200, 130, 70, 0.35)');
      emissive.ctx.fillStyle = glow;
      emissive.ctx.fillRect(a, gy, b - a, gh - 30);
      emissive.ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      for (let s = 0; s < 3; s++) emissive.ctx.fillRect(a + 10, gy + 30 + s * 40, b - a - 20, 10);
      for (let k = a + 40; k < b - 20; k += 70) emissive.ctx.fillRect(k, gy + 20, 6, gh - 60);
      c.fillStyle = '#8f887a';
      c.fillRect(a - 4, gy + gh - 30, b - a + 8, 30);
    }
    c.fillStyle = '#1a1a1a';
    c.fillRect(doorX, gy, doorW, gh);
    c.fillStyle = '#2d3946';
    c.fillRect(doorX + 8, gy + 8, doorW - 16, gh - 30);
    emissive.ctx.fillStyle = 'rgba(255, 205, 140, 0.6)';
    emissive.ctx.fillRect(doorX + 8, gy + 8, doorW - 16, gh - 30);
    c.fillStyle = '#c8b27a';
    c.fillRect(doorX + doorW - 16, gy + gh / 2, 5, 22);
  }
  return {
    map: toTexture(color.canvas, true),
    emissiveMap: toTexture(emissive.canvas, true),
    roughMetal: toTexture(rm.canvas, false),
  };
}

export function createLeafTexture(seed: number): THREE.CanvasTexture {
  const size = 256;
  const rng = createRng(seed);
  const { canvas, ctx } = createCanvas(size, size);
  ctx.clearRect(0, 0, size, size);
  for (let i = 0; i < 260; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * size * 0.46;
    const x = size / 2 + Math.cos(a) * r;
    const y = size / 2 + Math.sin(a) * r;
    const len = range(rng, 9, 17);
    const hue = range(rng, 78, 118);
    const sat = range(rng, 32, 58);
    const light = range(rng, 16, 38);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rng() * Math.PI * 2);
    ctx.fillStyle = `hsl(${hue}, ${sat}%, ${light}%)`;
    ctx.beginPath();
    ctx.ellipse(0, 0, len, len * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `hsla(${hue}, ${sat}%, ${light + 12}%, 0.6)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-len, 0);
    ctx.lineTo(len, 0);
    ctx.stroke();
    ctx.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function randomPlateText(rng: Rng): string {
  const letters = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  const l = (): string => letters[Math.floor(rng() * letters.length)] ?? 'A';
  const d = (): string => String(Math.floor(rng() * 10));
  return `${l()}${l()} ${d()}${d()}${d()} ${l()}${l()}`;
}

export function createPlateTexture(text: string): THREE.CanvasTexture {
  const { canvas, ctx } = createCanvas(256, 56);
  ctx.fillStyle = '#f3f3ee';
  ctx.fillRect(0, 0, 256, 56);
  ctx.strokeStyle = '#1b1b1b';
  ctx.lineWidth = 4;
  ctx.strokeRect(3, 3, 250, 50);
  ctx.fillStyle = '#1e4fa0';
  ctx.fillRect(5, 5, 22, 46);
  ctx.fillStyle = '#16181c';
  ctx.font = 'bold 34px "Helvetica Neue", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 140, 30);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function createParkingSignTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = createCanvas(256, 384);
  ctx.fillStyle = '#f5f5f5';
  ctx.fillRect(0, 0, 256, 384);
  ctx.fillStyle = '#1559b5';
  ctx.fillRect(10, 10, 236, 236);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 200px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('P', 128, 136);
  ctx.fillStyle = '#16181c';
  ctx.font = 'bold 44px Arial, sans-serif';
  ctx.fillText('2 HR', 128, 290);
  ctx.font = '28px Arial, sans-serif';
  ctx.fillText('8AM – 6PM', 128, 340);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createScreenIdleTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = createCanvas(512, 288);
  const grad = ctx.createLinearGradient(0, 0, 512, 288);
  grad.addColorStop(0, '#0d1626');
  grad.addColorStop(1, '#05080e');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 288);
  // stylised map
  ctx.strokeStyle = 'rgba(90, 120, 160, 0.35)';
  ctx.lineWidth = 10;
  for (const y of [70, 160, 240]) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(512, y - 30);
    ctx.stroke();
  }
  ctx.lineWidth = 6;
  for (const x of [120, 300, 430]) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 40, 288);
    ctx.stroke();
  }
  ctx.fillStyle = '#1559b5';
  ctx.beginPath();
  ctx.arc(256, 128, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 36px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('P', 256, 130);
  ctx.font = '600 18px Arial, sans-serif';
  ctx.fillStyle = 'rgba(220, 230, 245, 0.8)';
  ctx.fillText('Shift into R for the rear camera', 256, 200);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export interface InteriorTextures {
  leatherNormal: THREE.Texture;
  perforatedNormal: THREE.Texture;
  perforatedMap: THREE.Texture;
  stippleNormal: THREE.Texture;
  fabricMap: THREE.Texture;
  fabricNormal: THREE.Texture;
  carpetMap: THREE.Texture;
  brushedRoughness: THREE.Texture;
  speakerMap: THREE.Texture;
}

function heightField(size: number, fn: (x: number, y: number) => number): Float32Array {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[y * size + x] = fn(x, y);
  return h;
}

function grayTexture(size: number, fn: (x: number, y: number) => number, srgb: boolean): THREE.CanvasTexture {
  const { canvas, ctx } = createCanvas(size, size);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = fn(x, y);
      const p = (y * size + x) * 4;
      img.data[p] = v;
      img.data[p + 1] = v;
      img.data[p + 2] = v;
      img.data[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(canvas, srgb);
}

function leatherHeight(x: number, y: number, size: number): number {
  const u = x / size;
  const v = y / size;
  const wrinkles = Math.abs(noise2(u * 24, v * 24, 24, 301) - 0.5) * 2;
  const pores = noise2(u * 96, v * 96, 96, 302);
  return (1 - wrinkles) * 0.6 + pores * 0.4 + fbm(u, v, 6, 3, 303) * 0.3;
}

export function createInteriorTextures(): InteriorTextures {
  const size = 256;
  const leather = heightField(size, (x, y) => leatherHeight(x, y, size));
  const perfSpacing = 16;
  const perfDot = (x: number, y: number): number => {
    const row = Math.floor(y / perfSpacing);
    const ox = (x + (row % 2) * (perfSpacing / 2)) % perfSpacing;
    const oy = y % perfSpacing;
    const d = Math.hypot(ox - perfSpacing / 2, oy - perfSpacing / 2);
    return 1 - smoothstep(1.6, 2.8, d);
  };
  const perforated = heightField(size, (x, y) => leatherHeight(x, y, size) - perfDot(x, y) * 2.5);
  const stipple = heightField(size, (x, y) => noise2((x / size) * 128, (y / size) * 128, 128, 401) * 0.7 + hash(x, y, 402) * 0.3);
  const weave = (x: number, y: number): number => {
    const a = Math.sin((x / size) * Math.PI * 2 * 64) * Math.sin((y / size) * Math.PI * 2 * 64);
    return a * 0.5 + 0.5 + (hash(x, y, 501) - 0.5) * 0.4;
  };
  const fabric = heightField(size, weave);
  return {
    leatherNormal: normalMapFromHeight(leather, size, 1.4),
    perforatedNormal: normalMapFromHeight(perforated, size, 1.6),
    perforatedMap: grayTexture(size, (x, y) => 255 - perfDot(x, y) * 190, true),
    stippleNormal: normalMapFromHeight(stipple, size, 0.9),
    fabricMap: grayTexture(size, (x, y) => 215 + weave(x, y) * 40 + (fbm(x / size, y / size, 4, 3, 502) - 0.5) * 20, true),
    fabricNormal: normalMapFromHeight(fabric, size, 0.6),
    carpetMap: grayTexture(size, (x, y) => 150 + (hash(x, y, 601) - 0.5) * 120 + (fbm(x / size, y / size, 8, 3, 602) - 0.5) * 60, true),
    brushedRoughness: grayTexture(size, (x, y) => 80 + noise2((x / size) * 2, (y / size) * 256, 256, 701) * 90 + hash(x, y, 702) * 20, false),
    speakerMap: grayTexture(size, (x, y) => (((x % 8) - 4) ** 2 + ((y % 8) - 4) ** 2 < 5 ? 10 : 70), true),
  };
}

export interface ClusterState {
  speedKmh: number;
  gear: 'D' | 'N' | 'R';
  sensor: number | null;
}

/** Draws the digital instrument cluster. */
export function drawCluster(ctx: CanvasRenderingContext2D, w: number, h: number, state: ClusterState): void {
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#0b0f16');
  bg.addColorStop(1, '#020305');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // speed arc (left)
  const cx = h * 0.62;
  const cy = h * 0.55;
  const r = h * 0.4;
  const start = Math.PI * 0.8;
  const end = Math.PI * 2.2;
  ctx.lineWidth = 7;
  ctx.strokeStyle = 'rgba(120,150,190,0.25)';
  ctx.beginPath();
  ctx.arc(cx, cy, r, start, end);
  ctx.stroke();
  const frac = Math.min(1, Math.abs(state.speedKmh) / 60);
  ctx.strokeStyle = '#4fb4ff';
  ctx.beginPath();
  ctx.arc(cx, cy, r, start, start + (end - start) * frac);
  ctx.stroke();
  ctx.fillStyle = '#f2f6fb';
  ctx.font = `600 ${Math.round(h * 0.34)}px "Helvetica Neue", Arial, sans-serif`;
  ctx.fillText(String(Math.round(Math.abs(state.speedKmh))), cx, cy - h * 0.02);
  ctx.fillStyle = 'rgba(200,215,235,0.7)';
  ctx.font = `500 ${Math.round(h * 0.1)}px Arial, sans-serif`;
  ctx.fillText('km/h', cx, cy + h * 0.2);

  // gear strip (centre)
  const gears: ('P' | 'R' | 'N' | 'D')[] = ['P', 'R', 'N', 'D'];
  gears.forEach((g, i) => {
    const active = g === state.gear;
    ctx.font = `${active ? 700 : 500} ${Math.round(h * (active ? 0.2 : 0.13))}px Arial, sans-serif`;
    ctx.fillStyle = active ? (g === 'R' ? '#ffb340' : '#4cd964') : 'rgba(200,210,225,0.35)';
    ctx.fillText(g, w * 0.43 + i * w * 0.07, h * 0.3);
  });

  // park assist (right)
  const px = w * 0.8;
  ctx.fillStyle = 'rgba(200,210,225,0.55)';
  ctx.font = `600 ${Math.round(h * 0.085)}px Arial, sans-serif`;
  ctx.fillText('PARK ASSIST', px, h * 0.18);
  ctx.fillStyle = '#d8dde3';
  ctx.beginPath();
  ctx.roundRect(px - h * 0.08, h * 0.32, h * 0.16, h * 0.34, h * 0.04);
  ctx.fill();
  const levels = state.sensor === null ? 0 : state.sensor < 0.4 ? 3 : state.sensor < 0.9 ? 2 : state.sensor < 1.5 ? 1 : 0;
  const colors = ['#30d158', '#ffd60a', '#ff453a'];
  for (let i = 0; i < 3; i++) {
    ctx.strokeStyle = i < levels ? (colors[levels - 1] ?? '#fff') : 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 5;
    const yy = state.gear === 'R' ? h * 0.72 + i * h * 0.07 : h * 0.26 - i * h * 0.07;
    ctx.beginPath();
    ctx.moveTo(px - h * 0.1 - i * 6, yy);
    ctx.quadraticCurveTo(px, yy + (state.gear === 'R' ? 8 : -8), px + h * 0.1 + i * 6, yy);
    ctx.stroke();
  }
  ctx.fillStyle = '#f2f6fb';
  ctx.font = `600 ${Math.round(h * 0.11)}px Arial, sans-serif`;
  ctx.fillText(state.sensor === null ? '—' : `${Math.round(state.sensor * 100)} cm`, w * 0.43 + w * 0.105, h * 0.72);
  ctx.fillStyle = 'rgba(200,210,225,0.45)';
  ctx.font = `500 ${Math.round(h * 0.08)}px Arial, sans-serif`;
  ctx.fillText('nearest obstacle', w * 0.43 + w * 0.105, h * 0.86);
}

export function createClusterCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; texture: THREE.CanvasTexture } {
  const { canvas, ctx } = createCanvas(640, 200);
  drawCluster(ctx, 640, 200, { speedKmh: 0, gear: 'N', sensor: null });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { canvas, ctx, texture };
}
