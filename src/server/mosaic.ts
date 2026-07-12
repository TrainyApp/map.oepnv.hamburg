import { VehicleJourney } from '../shared/vehicle-types';
import { LineListEntry } from './types/geofox/LLResponse';
import { MosaicDeparture, MosaicDeparturesResponse, StationDeparture } from './types/mosaic';

const STATIONS = [
  'de:02000:63900', // Farmsen,
  'de:02000:65900', // Berne,
  'Master:9910950', // Hauptbahnhof
  'de:02000:80953', // Altona
  'de:02000:60902', // Wandsbek Markt
  'de:02000:70950', // Barmbek
  'de:02000:71904', // Volksdorf
  'de:02000:61904', // Billstedt
  'de:02000:25950', // Bergedorf
  'de:02000:49950', // Harburg
  'de:02000:40950', // Harburg Rathaus
  'de:02000:71953', // Poppenbüttel
  'de:02000:11950', // Jungfernstieg
  'de:02000:63010', // Bramfelder Dorfplatz
  'de:02000:8002558', // Rahlstedt
  'de:02000:63902', // Wandsbek Gartenstadt
  'de:02000:92903', // Langenhorn Markt
  'de:02000:70013', // Winterhunde Marktplatz
  'de:02000:62020', // Jenfelder Allee
  'de:02000:54006', // Wilhelmsburg
  'de:02000:41951', // Neugraben
  'de:02000:51980', // Finkenwerder
  'de:02000:86961', // Schnelsen
  'de:02000:70952', // Rübenkamp
  'de:02000:91903', // Niendorf Markt
  'de:02000:84903', // Schlump
];

const DEPARTURES_WINDOW_MINUTES = 80;

export function normalizeLineName(name: string): string {
  return name.replace(/\s+/g, '').toUpperCase();
}

function apiBaseUrl(): string {
  return process.env['MOSAIC_API_URL'] ?? 'https://api.hochbahn.cloud';
}

async function fetchStationDepartures(
  stationId: string,
  apiKey: string,
  time: string,
): Promise<StationDeparture[]> {
  const url = `${apiBaseUrl()}/v3/departures/hvv/${stationId}?time=${encodeURIComponent(time)}&maxMinuteOffset=${DEPARTURES_WINDOW_MINUTES}`;
  const response = await fetch(url, { headers: { 'mosaic-api-key': apiKey } });
  if (!response.ok) {
    throw new Error(`departures ${stationId}: HTTP ${response.status}`);
  }

  const body = (await response.json()) as MosaicDeparturesResponse;
  const departures: StationDeparture[] = [];
  for (const station of body.departuresAtStation ?? []) {
    for (const stopPoint of station.departuresAtStopPoint ?? []) {
      for (const departure of stopPoint.departures ?? []) {
        departures.push({ departure, stationId: station.station?.id ?? stationId });
      }
    }
  }

  return departures;
}

function categorize(line: MosaicDeparture['line']): string {
  const mode = line?.transitMode ?? '';
  if (mode === 'BUS' && /^X\d/i.test(line?.name ?? '')) return 'XPRESSBUS';
  return mode;
}

function departureTime(departure: MosaicDeparture): number {
  const iso = departure.predicted?.departure ?? departure.planned?.departure;
  return iso ? Date.parse(iso) : Number.POSITIVE_INFINITY;
}

export interface VehicleJourneysResult {
  departures: StationDeparture[];
  parsedJourneys: Map<string, VehicleJourney>;
}

export async function fetchVehicleJourneys(
  apiKey: string,
  hvvLines?: Map<string, LineListEntry>,
): Promise<VehicleJourneysResult> {
  const today = new Date();
  const time = new Date(today.getTime() - 1000 * 60 * 60).toISOString().replace(/\.\d{3}Z$/, 'Z');

  const results = await Promise.allSettled(
    STATIONS.map((stationId) => fetchStationDepartures(stationId, apiKey, time)),
  );

  const departures: StationDeparture[] = [];
  const bestTime = new Map<string, number>();
  const journeys = new Map<string, VehicleJourney>();
  for (const [index, result] of results.entries()) {
    if (result.status === 'rejected') {
      console.warn(`mosaic: ${STATIONS[index]} failed:`, (result.reason as Error).message);
      continue;
    }

    departures.push(...result.value);

    const now = Date.now();
    for (const { departure, stationId } of result.value) {
      const when = departureTime(departure);
      for (const vehicleId of departure.vehicleIds ?? []) {
        const previous = bestTime.get(vehicleId);

        if (previous && when > previous && when > now) {
          const diffInMins = Math.round((when - now) / 60000);

          if (diffInMins > 15) {
            continue;
          }
        }

        bestTime.set(vehicleId, when);
        journeys.set(vehicleId, {
          stationId,
          geofoxLineId: hvvLines?.get(normalizeLineName(departure.line?.name ?? ''))?.id ?? '',
          journeyId: departure.journeyId,
          lineId: departure.line?.id ?? '',
          lineName: departure.line?.name ?? '?',
          transitMode: departure.line?.transitMode ?? '',
          category: categorize(departure.line),
          destination: departure.direction?.passengerDestination ?? '',
          plannedDeparture: departure.planned?.departure,
        });
      }
    }
  }

  return { departures, parsedJourneys: journeys };
}
