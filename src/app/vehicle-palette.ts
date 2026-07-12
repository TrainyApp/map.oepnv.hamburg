import { JourneyCourse, LiveVehicle, OccupancyLevel } from '../shared/vehicle-types';

const NEUTRAL = '#6b6a66';

export const UNKNOWN_TYPE = 'unbekannt';

export const CATEGORY_ORDER = [
  'U',
  'S',
  'A',
  'R',
  'LONG_DISTANCE',
  'XPRESSBUS',
  'BUS',
  'FERRY',
  'DEMAND_RESPONSIVE',
  UNKNOWN_TYPE,
];

export const UBAHN_COLORS: Record<string, string> = {
  U1: '#006AB3',
  U2: '#E2001A',
  U3: '#FFDD00',
  U4: '#0098A1',
};

export const SBAHN_COLORS: Record<string, string> = {
  S1: '#00933B',
  S2: '#B51143',
  S3: '#622181',
  S5: '#008DA1',
  S7: '#C79114',
};

const CATEGORY_COLOR: Record<string, string> = {
  U: '#0069b4',
  S: '#00963e',
  A: '#f6a800',
  R: '#7b3fa0',
  LONG_DISTANCE: '#4a4a4a',
  XPRESSBUS: '#00b1aa',
  BUS: '#e2001a',
  FERRY: '#009fe3',
  DEMAND_RESPONSIVE: '#e91e63',
};

const CATEGORY_LABEL: Record<string, string> = {
  U: 'U-Bahn',
  S: 'S-Bahn',
  A: 'AKN',
  R: 'Regionalverkehr',
  LONG_DISTANCE: 'Fernverkehr',
  XPRESSBUS: 'XpressBus',
  BUS: 'Bus',
  FERRY: 'Fähre',
  DEMAND_RESPONSIVE: 'On-Demand',
  [UNKNOWN_TYPE]: 'unbekannt',
};

export function categoryOf(vehicle: LiveVehicle): string {
  return vehicle.journey?.category || UNKNOWN_TYPE;
}

export function getPolylineColor(vehicle: JourneyCourse): string {
  const category = vehicle.category;
  if (category === 'U') {
    return UBAHN_COLORS[vehicle.lineName || ''] ?? CATEGORY_COLOR[category] ?? NEUTRAL;
  } else if (category == 'S') {
    return SBAHN_COLORS[vehicle.lineName || ''] ?? CATEGORY_COLOR[category] ?? NEUTRAL;
  }

  return CATEGORY_COLOR[category] ?? NEUTRAL;
}

export function colorForType(category: string): string {
  return CATEGORY_COLOR[category] ?? NEUTRAL;
}

export function labelForCategory(category: string): string {
  return CATEGORY_LABEL[category] ?? category;
}

export const OCCUPANCY_COLOR: Record<OccupancyLevel, string> = {
  LOW: '#0ca30c',
  MEDIUM: '#fab219',
  HIGH: '#ec835a',
};

export const OCCUPANCY_LABEL: Record<OccupancyLevel, string> = {
  LOW: 'gering',
  MEDIUM: 'mittel',
  HIGH: 'hoch',
};
