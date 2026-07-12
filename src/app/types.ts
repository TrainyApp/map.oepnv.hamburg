import type * as Leaflet from 'leaflet';
import { LiveVehicle } from '../shared/vehicle-types';

export interface VehicleChange {
  upserts: LiveVehicle[];
  removals: string[];
  reset: boolean;
}

export interface MarkerEntry {
  marker: Leaflet.CircleMarker;
  type: string;
  visible: boolean;
}
