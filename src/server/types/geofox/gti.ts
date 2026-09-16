import { Path } from '../../../shared/vehicle-types';

export interface GtiResponse {
  returnCode?: string;
  status?: string;
  errorText?: string;
  errorDevInfo?: string;
  detail?: string;
}

export interface GtiCoordinate {
  x: number;
  y: number;
}

export interface GtiSDName {
  id?: string;
  name?: string;
  combinedName?: string;
  type?: string;
  coordinate?: GtiCoordinate;
}

export interface GtiCourseElement {
  fromStation: GtiSDName;
  toStation: GtiSDName;
  fromPlatform?: string;
  toPlatform?: string;
  depTime?: string;
  arrTime?: string;
  depDelay?: number;
  arrDelay?: number;
  fromExtra?: boolean;
  fromCancelled?: boolean;
  toExtra?: boolean;
  toCancelled?: boolean;
  path?: Path;
}

export enum GtiSimpleServiceType {
  BUS = 'BUS',
  TRAIN = 'TRAIN',
  SHIP = 'SHIP',
  FOOTPATH = 'FOOTPATH',
  BICYCLE = 'BICYCLE',
  AIRPLANE = 'AIRPLANE',
  CHANGE = 'CHANGE',
  CHANGE_SAME_PLATFORM = 'CHANGE_SAME_PLATFORM',
  ACTIVITY_BIKE_AND_RIDE = 'ACTIVITY_BIKE_AND_RIDE',
}

export interface GtiServiceType {
  simpleType: GtiSimpleServiceType;
  shortInfo: string;
  longInfo: string;
  model: string;
}

export interface GtiService {
  name: string;
  direction: string;
  origin: string;
  type: GtiServiceType;
  id: string;
  dlid: string;
}

export interface GtiVehicle {
  id?: string;
  number?: string;
}

export interface GtiDeparture {
  line: GtiService;
  direction: number;
  timeOffset: number;
  station: GtiSDName;
  stopPoint: GtiSDName;
  serviceId: number;
  platform: string;
  delay?: number;
  extra: boolean;
  cancelled: boolean;
  realtimePlatform: string;
  vehicles?: GtiVehicle[];
}

export interface GTITime {
  date: string;
  time: string;
}
