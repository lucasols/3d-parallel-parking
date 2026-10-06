export type BodyStyle = 'micro' | 'hatch' | 'sedan' | 'coupe' | 'suv' | 'pickup' | 'van';

export interface PillarSplit {
  readonly x: number;
  readonly width: number;
}

export interface CabinProfile {
  /** All x values are measured from the rear bumper (0) towards the front bumper (length). */
  readonly rearBase: number;
  readonly roofRear: number;
  readonly roofFront: number;
  readonly frontBase: number;
  readonly widthFactor: number;
  readonly rearRoofRadius: number;
  readonly frontRoofRadius: number;
}

export interface VehicleSpec {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly description: string;
  readonly style: BodyStyle;
  readonly length: number;
  readonly width: number;
  readonly height: number;
  readonly wheelbase: number;
  readonly frontOverhang: number;
  readonly track: number;
  readonly wheelRadius: number;
  readonly tireWidth: number;
  readonly groundClearance: number;
  readonly beltHeight: number;
  readonly hoodHeight: number;
  readonly deckHeight: number;
  readonly cabin: CabinProfile;
  readonly sideWindowMinX: number;
  readonly pillars: readonly PillarSplit[];
  readonly doors: readonly (readonly [number, number])[];
  /** Fraction of the rear slope covered by glass, or null for no rear glass. */
  readonly rearGlass: readonly [number, number] | null;
  readonly tailLight: { readonly y: number; readonly height: number; readonly width: number };
  readonly maxSteerDeg: number;
  /** m/s */
  readonly maxSpeedFwd: number;
  /** m/s */
  readonly maxSpeedRev: number;
  /** m/s² */
  readonly accel: number;
  readonly parkedWeight: number;
  readonly defaultColor: string;
  readonly roofRails: boolean;
  readonly tonneau: boolean;
  readonly spoiler: boolean;
}

export interface SideMirrorLayout {
  /** Glass size in metres. */
  width: number;
  height: number;
  /** Glass centre in profile coordinates (x from the rear bumper); z is the distance from the centreline. */
  x: number;
  y: number;
  z: number;
}

/** Typical side-mirror glass sizes (width, height in metres) for each body style. */
const SIDE_MIRROR_GLASS: Readonly<Record<BodyStyle, readonly [number, number]>> = {
  micro: [0.18, 0.12],
  hatch: [0.21, 0.14],
  sedan: [0.21, 0.14],
  coupe: [0.2, 0.125],
  suv: [0.24, 0.16],
  pickup: [0.26, 0.19],
  van: [0.24, 0.28],
};

/** Exterior mirror placement, shared by the body shell and the driver-view reflectors. */
export function sideMirrorLayout(spec: VehicleSpec): SideMirrorLayout {
  const [width, height] = SIDE_MIRROR_GLASS[spec.style];
  return {
    width,
    height,
    // at the front corner of the side window, behind the A-pillar as seen from the driver's seat
    x: spec.cabin.frontBase - 0.36,
    y: spec.beltHeight + 0.035 + height / 2,
    z: (spec.width * spec.cabin.widthFactor) / 2 + 0.035 + width / 2,
  };
}

export function rearOverhang(spec: VehicleSpec): number {
  return spec.length - spec.wheelbase - spec.frontOverhang;
}

/** Approximate curb-to-curb turning circle diameter. */
export function turningCircle(spec: VehicleSpec): number {
  const steer = (spec.maxSteerDeg * Math.PI) / 180;
  return 2 * (spec.wheelbase / Math.sin(steer) + spec.track / 2);
}

const MICRO: VehicleSpec = {
  id: 'micro',
  name: 'City Micro',
  category: 'Microcar',
  description: 'Tiny two-seater. Fits almost anywhere — a great first car to learn with.',
  style: 'micro',
  length: 2.7,
  width: 1.66,
  height: 1.55,
  wheelbase: 1.87,
  frontOverhang: 0.42,
  track: 1.45,
  wheelRadius: 0.29,
  tireWidth: 0.18,
  groundClearance: 0.15,
  beltHeight: 0.92,
  hoodHeight: 0.8,
  deckHeight: 0.92,
  cabin: { rearBase: 0.06, roofRear: 0.18, roofFront: 1.62, frontBase: 2.22, widthFactor: 0.9, rearRoofRadius: 0.16, frontRoofRadius: 0.26 },
  sideWindowMinX: 0,
  pillars: [],
  doors: [[0.95, 2.16]],
  rearGlass: [0.35, 0.95],
  tailLight: { y: 0.62, height: 0.32, width: 0.12 },
  maxSteerDeg: 40,
  maxSpeedFwd: 7.5,
  maxSpeedRev: 3,
  accel: 2.4,
  parkedWeight: 0.5,
  defaultColor: '#e3b51f',
  roofRails: false,
  tonneau: false,
  spoiler: false,
};

const HATCH: VehicleSpec = {
  id: 'hatch',
  name: 'Hatchback',
  category: 'Compact',
  description: 'Nimble five-door compact with short overhangs and a tight turning circle.',
  style: 'hatch',
  length: 4.26,
  width: 1.79,
  height: 1.46,
  wheelbase: 2.63,
  frontOverhang: 0.88,
  track: 1.54,
  wheelRadius: 0.32,
  tireWidth: 0.21,
  groundClearance: 0.14,
  beltHeight: 0.98,
  hoodHeight: 0.9,
  deckHeight: 0.98,
  cabin: { rearBase: 0.12, roofRear: 0.42, roofFront: 2.38, frontBase: 3.12, widthFactor: 0.88, rearRoofRadius: 0.18, frontRoofRadius: 0.24 },
  sideWindowMinX: 0,
  pillars: [
    { x: 1.62, width: 0.11 },
    { x: 0.62, width: 0.22 },
  ],
  doors: [
    [1.64, 3.06],
    [0.82, 1.6],
  ],
  rearGlass: [0.3, 0.95],
  tailLight: { y: 0.82, height: 0.14, width: 0.36 },
  maxSteerDeg: 36,
  maxSpeedFwd: 8.3,
  maxSpeedRev: 3,
  accel: 2.6,
  parkedWeight: 1.4,
  defaultColor: '#1d4f91',
  roofRails: false,
  tonneau: false,
  spoiler: false,
};

const SEDAN: VehicleSpec = {
  id: 'sedan',
  name: 'Sedan',
  category: 'Mid-size',
  description: 'Classic four-door with a long rear overhang. The standard driving-test car.',
  style: 'sedan',
  length: 4.88,
  width: 1.84,
  height: 1.44,
  wheelbase: 2.82,
  frontOverhang: 0.98,
  track: 1.58,
  wheelRadius: 0.33,
  tireWidth: 0.22,
  groundClearance: 0.14,
  beltHeight: 0.98,
  hoodHeight: 0.9,
  deckHeight: 1.02,
  cabin: { rearBase: 0.95, roofRear: 1.62, roofFront: 2.88, frontBase: 3.58, widthFactor: 0.86, rearRoofRadius: 0.3, frontRoofRadius: 0.26 },
  sideWindowMinX: 0,
  pillars: [{ x: 2.3, width: 0.1 }],
  doors: [
    [2.32, 3.54],
    [1.3, 2.28],
  ],
  rearGlass: [0.06, 0.9],
  tailLight: { y: 0.86, height: 0.12, width: 0.42 },
  maxSteerDeg: 35,
  maxSpeedFwd: 8.3,
  maxSpeedRev: 3,
  accel: 2.6,
  parkedWeight: 1.6,
  defaultColor: '#7d1c1f',
  roofRails: false,
  tonneau: false,
  spoiler: false,
};

const COUPE: VehicleSpec = {
  id: 'coupe',
  name: 'Sports Coupe',
  category: 'Sports',
  description: 'Low, wide and long-nosed. Poor visibility and a big turning circle.',
  style: 'coupe',
  length: 4.5,
  width: 1.9,
  height: 1.26,
  wheelbase: 2.56,
  frontOverhang: 1.0,
  track: 1.62,
  wheelRadius: 0.34,
  tireWidth: 0.27,
  groundClearance: 0.11,
  beltHeight: 0.84,
  hoodHeight: 0.72,
  deckHeight: 0.9,
  cabin: { rearBase: 0.5, roofRear: 1.38, roofFront: 2.45, frontBase: 3.28, widthFactor: 0.84, rearRoofRadius: 0.4, frontRoofRadius: 0.28 },
  sideWindowMinX: 0,
  pillars: [{ x: 1.58, width: 0.16 }],
  doors: [[1.5, 3.24]],
  rearGlass: [0.08, 0.88],
  tailLight: { y: 0.74, height: 0.1, width: 0.5 },
  maxSteerDeg: 33,
  maxSpeedFwd: 10,
  maxSpeedRev: 3,
  accel: 3.4,
  parkedWeight: 0.4,
  defaultColor: '#c4521c',
  roofRails: false,
  tonneau: false,
  spoiler: true,
};

const SUV: VehicleSpec = {
  id: 'suv',
  name: 'SUV',
  category: 'Crossover',
  description: 'Tall and wide. High seating, but the bulky rear hides the curb.',
  style: 'suv',
  length: 4.75,
  width: 1.92,
  height: 1.74,
  wheelbase: 2.83,
  frontOverhang: 0.95,
  track: 1.64,
  wheelRadius: 0.37,
  tireWidth: 0.24,
  groundClearance: 0.21,
  beltHeight: 1.15,
  hoodHeight: 1.08,
  deckHeight: 1.15,
  cabin: { rearBase: 0.1, roofRear: 0.3, roofFront: 2.7, frontBase: 3.42, widthFactor: 0.9, rearRoofRadius: 0.16, frontRoofRadius: 0.24 },
  sideWindowMinX: 0,
  pillars: [
    { x: 2.05, width: 0.11 },
    { x: 0.9, width: 0.18 },
  ],
  doors: [
    [2.07, 3.4],
    [1.05, 2.03],
  ],
  rearGlass: [0.42, 0.95],
  tailLight: { y: 0.98, height: 0.16, width: 0.3 },
  maxSteerDeg: 34,
  maxSpeedFwd: 8.3,
  maxSpeedRev: 3,
  accel: 2.5,
  parkedWeight: 1.5,
  defaultColor: '#e9e9e6',
  roofRails: true,
  tonneau: false,
  spoiler: false,
};

const PICKUP: VehicleSpec = {
  id: 'pickup',
  name: 'Pickup Truck',
  category: 'Full-size truck',
  description: 'Huge wheelbase and a 5.6 m body. Parallel parking this is a real challenge.',
  style: 'pickup',
  length: 5.6,
  width: 2.03,
  height: 1.92,
  wheelbase: 3.6,
  frontOverhang: 1.0,
  track: 1.72,
  wheelRadius: 0.4,
  tireWidth: 0.27,
  groundClearance: 0.24,
  beltHeight: 1.28,
  hoodHeight: 1.24,
  deckHeight: 1.28,
  cabin: { rearBase: 2.22, roofRear: 2.27, roofFront: 3.52, frontBase: 4.12, widthFactor: 0.92, rearRoofRadius: 0.12, frontRoofRadius: 0.2 },
  sideWindowMinX: 0,
  pillars: [{ x: 2.98, width: 0.1 }],
  doors: [
    [3.0, 4.08],
    [2.24, 2.96],
  ],
  rearGlass: [0.35, 0.8],
  tailLight: { y: 0.98, height: 0.42, width: 0.13 },
  maxSteerDeg: 33,
  maxSpeedFwd: 8.3,
  maxSpeedRev: 3,
  accel: 2.6,
  parkedWeight: 0.6,
  defaultColor: '#3a3f46',
  roofRails: false,
  tonneau: true,
  spoiler: false,
};

const VAN: VehicleSpec = {
  id: 'van',
  name: 'Cargo Van',
  category: 'Commercial',
  description: 'Tall delivery van with no rear side windows. Trust your mirrors and sensors.',
  style: 'van',
  length: 5.5,
  width: 2.05,
  height: 2.45,
  wheelbase: 3.4,
  frontOverhang: 0.95,
  track: 1.74,
  wheelRadius: 0.36,
  tireWidth: 0.23,
  groundClearance: 0.19,
  beltHeight: 1.18,
  hoodHeight: 1.12,
  deckHeight: 1.18,
  cabin: { rearBase: 0.02, roofRear: 0.05, roofFront: 3.85, frontBase: 4.48, widthFactor: 0.97, rearRoofRadius: 0.14, frontRoofRadius: 0.32 },
  sideWindowMinX: 3.62,
  pillars: [],
  doors: [
    [3.62, 4.45],
    [2.0, 3.5],
  ],
  rearGlass: [0.5, 0.9],
  tailLight: { y: 0.82, height: 0.4, width: 0.14 },
  maxSteerDeg: 33,
  maxSpeedFwd: 7.5,
  maxSpeedRev: 2.8,
  accel: 2.2,
  parkedWeight: 0.5,
  defaultColor: '#f2f2f0',
  roofRails: false,
  tonneau: false,
  spoiler: false,
};

export const DEFAULT_VEHICLE = SEDAN;

export const VEHICLES: readonly VehicleSpec[] = [MICRO, HATCH, SEDAN, COUPE, SUV, PICKUP, VAN];

export function getVehicle(id: string): VehicleSpec {
  return VEHICLES.find((v) => v.id === id) ?? DEFAULT_VEHICLE;
}

export interface PaintColor {
  readonly name: string;
  readonly hex: string;
}

export const PAINT_COLORS: readonly PaintColor[] = [
  { name: 'Arctic White', hex: '#eeeeea' },
  { name: 'Obsidian Black', hex: '#0d0e10' },
  { name: 'Liquid Silver', hex: '#a9adb2' },
  { name: 'Graphite', hex: '#4b5058' },
  { name: 'Racing Red', hex: '#a5141b' },
  { name: 'Burgundy', hex: '#7d1c1f' },
  { name: 'Ocean Blue', hex: '#1d4f91' },
  { name: 'Forest Green', hex: '#264536' },
  { name: 'Sunburst Yellow', hex: '#e3b51f' },
  { name: 'Copper Orange', hex: '#c4521c' },
];

export const PARKED_COLORS: readonly { item: string; weight: number }[] = [
  { item: '#eeeeea', weight: 24 },
  { item: '#0d0e10', weight: 18 },
  { item: '#a9adb2', weight: 15 },
  { item: '#4b5058', weight: 17 },
  { item: '#1d3a66', weight: 7 },
  { item: '#8e1418', weight: 6 },
  { item: '#b9a88a', weight: 3 },
  { item: '#264536', weight: 3 },
  { item: '#4a3426', weight: 3 },
  { item: '#2f6fb3', weight: 3 },
];
