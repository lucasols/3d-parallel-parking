/** Street layout (meters). The street runs along X; +Z is the right-hand side when driving towards +X. */
export const CURB_Z = 6.0;
export const CURB_WIDTH = 0.3;
export const CURB_HEIGHT = 0.15;
export const PARKING_LANE_WIDTH = 2.4;
export const LANE_LINE_Z = CURB_Z - PARKING_LANE_WIDTH;
export const TRAVEL_LANE_CENTER_Z = LANE_LINE_Z / 2;
export const SIDEWALK_WIDTH = 3.6;
export const BUILDING_Z = CURB_Z + CURB_WIDTH + SIDEWALK_WIDTH;
export const STREET_HALF_LENGTH = 130;
export const CROSSWALK_X: readonly number[] = [-72, 72];
export const CROSSWALK_HALF_WIDTH = 6;

export const PHYSICS_STEP = 1 / 120;
