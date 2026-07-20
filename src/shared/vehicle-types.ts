export type OccupancyLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';

export type LocationKind = 'POSITION' | 'STATION' | 'SECTION';

export type LocationSource = 'GPS' | 'LST' | 'UNKNOWN';

export interface VehicleOccupancy {
  level: OccupancyLevel;
  count: number;
  vehicleType: string;
  vehicleModel: string;
  predicted: boolean;
  timestamp: string;
}

export type VehicleCategory = string;

export interface VehicleJourney {
  journeyId: string;
  lineId: string;
  geofoxLineId: string;
  lineName: string;
  transitMode: string;
  category: VehicleCategory;
  destination: string;
  plannedDeparture?: string;
  stationId?: string;
}

export enum TimeType {
  REPORTED = 'REPORTED',
  ESTIMATED = 'ESTIMATED',
  SCHEDULED = 'SCHEDULED',
}

export interface CourseStop {
  id: string;
  name: string;
  isLocalName?: boolean;
  lat?: number;
  lon?: number;
  arrTime?: string;
  depTime?: string;
  arrDelay?: number;
  depDelay?: number;
  platform?: string;
  cancelled?: boolean;
  extra?: boolean;
  departureTimeType?: TimeType;
  arrivalTimeType?: TimeType;
}

export interface Path {
  track: { x: number; y: number }[];
}

export interface JourneyCourse {
  lineName: string;
  lineId: string | undefined;
  destination: string;
  category: VehicleCategory;
  stops: CourseStop[];
  path: [number, number][];
}

export interface LiveVehicle {
  id: string;
  kind: LocationKind;
  lat: number;
  lon: number;
  lastReceived: string;
  speed?: number;
  occupancy?: VehicleOccupancy;
  journey?: VehicleJourney;
  locationSource: LocationSource;
}

export interface RelayStatus {
  mqttConnected: boolean;
  vehicleCount: number;
}

export const EV_SNAPSHOT = 'snapshot';
export const EV_UPDATE = 'update';
export const EV_REMOVE = 'remove';
export const EV_STATUS = 'status';
