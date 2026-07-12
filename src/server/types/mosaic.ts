import { OccupancyLevel } from '../../shared/vehicle-types';

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

export interface StationDeparture {
  departure: MosaicDeparture;
  stationId: string;
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
