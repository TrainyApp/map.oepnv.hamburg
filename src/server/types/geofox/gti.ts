import { Path } from '../../../shared/vehicle-types';

export interface GtiResponse {
  returnCode: string;
  errorText?: string;
  errorDevInfo?: string;
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
