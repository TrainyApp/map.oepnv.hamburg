import { OccupancyLevel } from '../../shared/vehicle-types';
import { GtiDeparture } from './geofox/gti';
import { Temporal } from '@js-temporal/polyfill';
import Instant = Temporal.Instant;

export interface GeoCoordinate {
  latitude: number;
  longitude: number;
}

export interface SectionEndpoint {
  dhid: string;
  position: GeoCoordinate;
}

export interface MosaicDeparture {
  direction?: { passengerDestination?: string; reference?: string };
  journeyId: string;
  line?: { additionalInfo?: string; id?: string; name?: string; transitMode?: string };
  planned?: { departure?: string; platform?: string };
  predicted?: { departure?: string; platform?: string };
  status?: string;
  vehicleIds?: string[];
}

export interface MosaicDeparturesResponse {
  departuresAtStation?: {
    station?: { id?: string };
    departuresAtStopPoint?: {
      departures?: MosaicDeparture[];
    }[];
  }[];
}

export abstract class StationDeparture {
  abstract requestTime: Instant;
  abstract departure: GtiDeparture;
  abstract stationId: string;

  getPlannedDeparture(): Instant {
    return this.requestTime.add({ minutes: this.departure.timeOffset });
  }

  getRealTime(): Instant | undefined {
    if (this.departure.delay == undefined) return undefined;
    return this.getPlannedDeparture().add({ seconds: this.departure.delay });
  }
}

export interface MosaicVehicleLocation {
  type: 'POSITION' | 'STATION' | 'SECTION';
  vehicleId: string;
  position?: GeoCoordinate;
  sectionBegin?: SectionEndpoint;
  sectionEnd?: SectionEndpoint;
  lastReceived: string;
}

export interface MosaicOccupancy {
  vehicleId: string;
  vehicleType: string;
  vehicleModel: string;
  occupancy: number;
  occupancyLevel: OccupancyLevel;
  timestamp: string;
  predicted: boolean;
}
