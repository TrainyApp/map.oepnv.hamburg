import type * as Leaflet from 'leaflet';
import { LiveVehicle } from '../shared/vehicle-types';

export interface VehicleChange {
  upserts: LiveVehicle[];
  removals: string[];
  reset: boolean;
}

export interface LineOption {
  name: string;
  category: string;
  geofoxLineId: string;
  count: number;
}

export interface MarkerEntry {
  marker: Leaflet.CircleMarker;
  type: string;
  lineName?: string;
  visible: boolean;
}
