import { DIFFICULTIES, type Difficulty } from './level';
import { DEFAULT_VEHICLE, VEHICLES } from './vehicles';
import { TIME_OF_DAY, type TimeOfDay } from './world';

export interface Settings {
  vehicleId: string;
  color: string;
  difficulty: Difficulty;
  timeOfDay: TimeOfDay;
  pathGuides: boolean;
  spotHighlight: boolean;
  sensors: boolean;
  backupCamera: boolean;
  selfCenter: boolean;
  minimap: boolean;
  /** Numeric front/rear/curb distance and angle readouts. */
  readouts: boolean;
  /** Driver-view field of view in degrees. */
  fpvFov: number;
  /** Driver seat height offset in metres. */
  seatHeight: number;
}

const SETTINGS_KEY = 'parallel-park-3d.settings';
const BEST_KEY = 'parallel-park-3d.best';

export const DEFAULT_SETTINGS: Settings = {
  vehicleId: DEFAULT_VEHICLE.id,
  color: DEFAULT_VEHICLE.defaultColor,
  difficulty: 'medium',
  timeOfDay: 'day',
  pathGuides: true,
  spotHighlight: true,
  sensors: true,
  backupCamera: true,
  selfCenter: false,
  minimap: true,
  readouts: true,
  fpvFov: 62,
  seatHeight: 0,
};

export const FPV_FOV_RANGE = [40, 85] as const;
export const SEAT_HEIGHT_RANGE = [-0.06, 0.1] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isDifficulty(value: unknown): value is Difficulty {
  return DIFFICULTIES.some((d) => d.id === value);
}

function isTimeOfDay(value: unknown): value is TimeOfDay {
  return typeof value === 'string' && Object.keys(TIME_OF_DAY).includes(value);
}

function readStorage(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable (private mode etc.) — settings just won't persist
  }
}

export function loadSettings(): Settings {
  const data = readStorage(SETTINGS_KEY);
  if (!isRecord(data)) return { ...DEFAULT_SETTINGS };
  const bool = (key: keyof Settings, fallback: boolean): boolean => {
    const v = data[key];
    return typeof v === 'boolean' ? v : fallback;
  };
  const num = (key: keyof Settings, fallback: number, [min, max]: readonly [number, number]): number => {
    const v = data[key];
    return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  };
  const vehicleId = typeof data.vehicleId === 'string' && VEHICLES.some((v) => v.id === data.vehicleId) ? data.vehicleId : DEFAULT_SETTINGS.vehicleId;
  return {
    vehicleId,
    color: typeof data.color === 'string' && /^#[0-9a-f]{6}$/i.test(data.color) ? data.color : DEFAULT_SETTINGS.color,
    difficulty: isDifficulty(data.difficulty) ? data.difficulty : DEFAULT_SETTINGS.difficulty,
    timeOfDay: isTimeOfDay(data.timeOfDay) ? data.timeOfDay : DEFAULT_SETTINGS.timeOfDay,
    pathGuides: bool('pathGuides', DEFAULT_SETTINGS.pathGuides),
    spotHighlight: bool('spotHighlight', DEFAULT_SETTINGS.spotHighlight),
    sensors: bool('sensors', DEFAULT_SETTINGS.sensors),
    backupCamera: bool('backupCamera', DEFAULT_SETTINGS.backupCamera),
    selfCenter: bool('selfCenter', DEFAULT_SETTINGS.selfCenter),
    minimap: bool('minimap', DEFAULT_SETTINGS.minimap),
    readouts: bool('readouts', DEFAULT_SETTINGS.readouts),
    fpvFov: num('fpvFov', DEFAULT_SETTINGS.fpvFov, FPV_FOV_RANGE),
    seatHeight: num('seatHeight', DEFAULT_SETTINGS.seatHeight, SEAT_HEIGHT_RANGE),
  };
}

export function saveSettings(settings: Settings): void {
  writeStorage(SETTINGS_KEY, settings);
}

function loadBestMap(): Record<string, number> {
  const data = readStorage(BEST_KEY);
  const result: Record<string, number> = {};
  if (!isRecord(data)) return result;
  for (const [key, value] of Object.entries(data)) if (typeof value === 'number') result[key] = value;
  return result;
}

export function getBest(vehicleId: string, difficulty: Difficulty): number | null {
  return loadBestMap()[`${vehicleId}:${difficulty}`] ?? null;
}

/** Stores the score if it beats the previous best; returns true when it is a new record. */
export function recordBest(vehicleId: string, difficulty: Difficulty, score: number): boolean {
  const map = loadBestMap();
  const key = `${vehicleId}:${difficulty}`;
  const previous = map[key];
  if (previous !== undefined && previous >= score) return false;
  map[key] = score;
  writeStorage(BEST_KEY, map);
  return true;
}
