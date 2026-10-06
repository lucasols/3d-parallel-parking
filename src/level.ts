import { CROSSWALK_HALF_WIDTH, CROSSWALK_X, CURB_Z, STREET_HALF_LENGTH, TRAVEL_LANE_CENTER_Z } from './constants';
import { vehicleOBB, type OBB, type VehicleState } from './physics';
import { createRng, range, weightedPick, type Rng } from './rng';
import { PARKED_COLORS, VEHICLES, rearOverhang, type VehicleSpec } from './vehicles';
import { randomPlateText } from './textures';

export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';

export const DIFFICULTIES: readonly { id: Difficulty; label: string; margin: number }[] = [
  { id: 'easy', label: 'Easy', margin: 2.4 },
  { id: 'medium', label: 'Medium', margin: 1.6 },
  { id: 'hard', label: 'Hard', margin: 1.05 },
  { id: 'expert', label: 'Expert', margin: 0.75 },
];

export function difficultyMargin(d: Difficulty): number {
  return DIFFICULTIES.find((x) => x.id === d)?.margin ?? 1.6;
}

export interface ParkedCar {
  spec: VehicleSpec;
  color: string;
  plate: string;
  state: VehicleState;
  obb: OBB;
}

export interface Spot {
  rearX: number;
  frontX: number;
  length: number;
  centerX: number;
}

export interface Level {
  seed: number;
  difficulty: Difficulty;
  spot: Spot;
  parked: ParkedCar[];
  start: VehicleState;
}

function inCrosswalk(minX: number, maxX: number): boolean {
  return CROSSWALK_X.some((cx) => maxX > cx - CROSSWALK_HALF_WIDTH && minX < cx + CROSSWALK_HALF_WIDTH);
}

function randomSpec(rng: Rng): VehicleSpec {
  return weightedPick(
    rng,
    VEHICLES.map((v) => ({ item: v, weight: v.parkedWeight })),
  );
}

/** Creates a car whose body spans [minX, minX + length] along X, parked against the curb on `side`. */
function makeParked(rng: Rng, spec: VehicleSpec, side: 1 | -1, minX: number, curbGap?: number): ParkedCar {
  const ro = rearOverhang(spec);
  const gap = curbGap ?? range(rng, 0.14, 0.32);
  const lateral = side * (CURB_Z - gap - spec.width / 2);
  const heading = (side === 1 ? 0 : Math.PI) + range(rng, -0.012, 0.012);
  const rearAxleX = side === 1 ? minX + ro : minX + spec.length - ro;
  const state: VehicleState = { x: rearAxleX, z: lateral, heading, speed: 0, steer: 0 };
  return {
    spec,
    color: weightedPick(rng, PARKED_COLORS),
    plate: randomPlateText(rng),
    state,
    obb: vehicleOBB(state, spec),
  };
}

export function generateLevel(seed: number, difficulty: Difficulty, player: VehicleSpec): Level {
  const rng = createRng(seed);
  const length = player.length + difficultyMargin(difficulty);
  const rearX = range(rng, -6, 6);
  const spot: Spot = { rearX, frontX: rearX + length, length, centerX: rearX + length / 2 };
  const parked: ParkedCar[] = [];
  const limit = STREET_HALF_LENGTH - 6;

  // Right side, behind the spot
  let cursor = spot.rearX;
  let first = true;
  while (cursor > -limit) {
    const spec = randomSpec(rng);
    const minX = cursor - spec.length;
    if (minX < -limit) break;
    if (inCrosswalk(minX, cursor)) {
      cursor -= 3;
      continue;
    }
    parked.push(makeParked(rng, spec, 1, minX, first ? range(rng, 0.16, 0.26) : undefined));
    first = false;
    cursor = minX - range(rng, 0.7, 1.9);
  }

  // Right side, ahead of the spot
  cursor = spot.frontX;
  first = true;
  while (cursor < limit) {
    const spec = randomSpec(rng);
    const maxX = cursor + spec.length;
    if (maxX > limit) break;
    if (inCrosswalk(cursor, maxX)) {
      cursor += 3;
      continue;
    }
    parked.push(makeParked(rng, spec, 1, cursor, first ? range(rng, 0.16, 0.26) : undefined));
    first = false;
    cursor = maxX + range(rng, 0.7, 1.9);
  }

  // Opposite side
  cursor = -limit;
  while (cursor < limit) {
    const spec = randomSpec(rng);
    const maxX = cursor + spec.length;
    if (maxX > limit) break;
    if (inCrosswalk(cursor, maxX) || rng() < 0.08) {
      cursor += 3;
      continue;
    }
    parked.push(makeParked(rng, spec, -1, cursor));
    cursor = maxX + range(rng, 0.8, 2.4);
  }

  const start: VehicleState = {
    x: spot.rearX - 7 - (player.length - rearOverhang(player)),
    z: TRAVEL_LANE_CENTER_Z,
    heading: 0,
    speed: 0,
    steer: 0,
  };

  return { seed, difficulty, spot, parked, start };
}
