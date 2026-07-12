export interface RisJourneyPosition {
  meta?: { timeCreated?: string; timeInformation?: string };
  info?: {
    destination?: { name?: string; evaNumber?: string };
    origin?: { name?: string; evaNumber?: string };
    transportAtStart?: {
      category?: string;
      journeyName?: string;
      journeyNumber?: number;
      line?: string;
      type?: string;
    };
    type?: string;
  };
  journeyID: string;
  administrations?: string[];
  latitude?: number;
  longitude?: number;
  speed?: number;
}

export interface GeoJsonFeatureCollection {
  features?: {
    geometry?: {
      type?: string;
      coordinates?: unknown;
    };
  }[];
}
