import { CURB_Z, LANE_LINE_Z } from './constants';
import type { Level } from './level';
import { normalizeAngle, obbCorners, tireOuterPoints, vehicleOBB, type VehicleState } from './physics';
import type { VehicleSpec } from './vehicles';

export interface ScoreItem {
  label: string;
  detail: string;
  points: number;
  max: number;
}

export interface ParkResult {
  success: boolean;
  headline: string;
  reason: string;
  total: number;
  stars: number;
  items: ScoreItem[];
  time: number;
}

export interface AttemptStats {
  time: number;
  hits: number;
  curbHits: number;
  directionChanges: number;
}

export interface Placement {
  insideSpot: boolean;
  curbGap: number;
  angleDeg: number;
  frontGap: number;
  rearGap: number;
  wrongWay: boolean;
}

export function measurePlacement(state: VehicleState, spec: VehicleSpec, level: Level): Placement {
  const corners = obbCorners(vehicleOBB(state, spec));
  const minX = Math.min(...corners.map((c) => c.x));
  const maxX = Math.max(...corners.map((c) => c.x));
  const minZ = Math.min(...corners.map((c) => c.z));
  const rightTires = tireOuterPoints(state, spec).filter((p) => p.side === 1);
  const curbGap = CURB_Z - Math.max(...rightTires.map((p) => p.z));
  const heading = normalizeAngle(state.heading);
  const angleDeg = (Math.abs(heading) * 180) / Math.PI;
  const tolerance = 0.03;
  return {
    insideSpot: minX >= level.spot.rearX - tolerance && maxX <= level.spot.frontX + tolerance && minZ >= LANE_LINE_Z - 0.2,
    curbGap,
    angleDeg,
    frontGap: level.spot.frontX - maxX,
    rearGap: minX - level.spot.rearX,
    wrongWay: angleDeg > 90,
  };
}

function cm(m: number): string {
  return `${Math.round(m * 100)} cm`;
}

export function evaluateParking(state: VehicleState, spec: VehicleSpec, level: Level, stats: AttemptStats): ParkResult {
  const p = measurePlacement(state, spec, level);
  const fail = (headline: string, reason: string): ParkResult => ({
    success: false,
    headline,
    reason,
    total: 0,
    stars: 0,
    items: [],
    time: stats.time,
  });

  if (p.wrongWay) return fail('Wrong way', 'You must park facing the direction of traffic.');
  if (!p.insideSpot) {
    if (p.rearGap < -0.03) return fail('Not in the space', `Your rear is ${cm(-p.rearGap)} outside the space.`);
    if (p.frontGap < -0.03) return fail('Not in the space', `Your front is ${cm(-p.frontGap)} outside the space.`);
    return fail('Not in the space', 'Part of your car is still sticking out into the traffic lane.');
  }
  if (p.curbGap > 0.6) return fail('Too far from the curb', `You are ${cm(p.curbGap)} from the curb. Aim for 30 cm or less.`);

  const items: ScoreItem[] = [];

  const curbPts = p.curbGap <= 0.3 ? 30 : Math.max(0, 30 * (1 - (p.curbGap - 0.3) / 0.3));
  items.push({
    label: 'Distance to curb',
    detail: `${cm(p.curbGap)}${p.curbGap <= 0.3 ? ' — within 30 cm' : ' — aim for ≤ 30 cm'}`,
    points: curbPts,
    max: 30,
  });

  const alignPts = p.angleDeg <= 1.5 ? 25 : Math.max(0, 25 * (1 - (p.angleDeg - 1.5) / 8.5));
  items.push({ label: 'Alignment', detail: `${p.angleDeg.toFixed(1)}° from parallel`, points: alignPts, max: 25 });

  const totalGap = Math.max(0.001, p.frontGap + p.rearGap);
  const balance = 1 - Math.abs(p.frontGap - p.rearGap) / totalGap;
  items.push({
    label: 'Centered in space',
    detail: `front ${cm(p.frontGap)} · rear ${cm(p.rearGap)}`,
    points: 15 * Math.max(0, balance),
    max: 15,
  });

  const cleanPts = Math.max(0, 20 - stats.hits * 10 - stats.curbHits * 4);
  const cleanDetail = stats.hits === 0 && stats.curbHits === 0 ? 'No contact' : `${stats.hits} collision${stats.hits === 1 ? '' : 's'}, ${stats.curbHits} curb strike${stats.curbHits === 1 ? '' : 's'}`;
  items.push({ label: 'Clean driving', detail: cleanDetail, points: cleanPts, max: 20 });

  const moves = stats.directionChanges;
  const movePts = moves <= 2 ? 10 : Math.max(0, 10 - (moves - 2) * 2);
  items.push({ label: 'Efficiency', detail: `${moves} direction change${moves === 1 ? '' : 's'}`, points: movePts, max: 10 });

  const total = Math.round(items.reduce((sum, item) => sum + item.points, 0));
  const stars = total >= 90 ? 3 : total >= 72 ? 2 : total >= 50 ? 1 : 0;
  const headline = total >= 90 ? 'Perfect park!' : total >= 72 ? 'Nicely done' : total >= 50 ? 'Parked' : 'Parked… just';
  return { success: true, headline, reason: '', total, stars, items, time: stats.time };
}
