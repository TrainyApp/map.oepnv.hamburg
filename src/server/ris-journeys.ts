import { CourseStop, JourneyCourse, LiveVehicle } from '../shared/vehicle-types';
import { journeyEventBasedById } from './gen/ris-journeys';
import type { JourneyEvent } from './gen/ris-journeys';
import { cacheGet, cacheSet } from './redis-cache';
import { GeoJsonFeatureCollection, StopPlacesByKeysResponse } from './types/ris';

const POLYLINE_CACHE_MS = 6 * 60 * 60_000;
const polylineCache = new Map<string, { at: number; path: [number, number][] }>();

function redisKey(journeyID: string): string {
  return `polyline:${journeyID}`;
}

async function polylineFromRedis(journeyID: string): Promise<[number, number][] | undefined> {
  const stored = await cacheGet(redisKey(journeyID));
  if (!stored) {
    return undefined;
  }

  try {
    const path = JSON.parse(stored) as [number, number][];
    return Array.isArray(path) && path.length > 0 ? path : undefined;
  } catch {
    return undefined;
  }
}

async function fetchPolyline(journeyID: string): Promise<[number, number][]> {
  const cached = polylineCache.get(journeyID);
  if (cached) {
    return cached.path;
  }

  const fromRedis = await polylineFromRedis(journeyID);
  if (fromRedis) {
    polylineCache.set(journeyID, { at: Date.now(), path: fromRedis });
    return fromRedis;
  }

  const response = await fetch(`https://rbc.trainy.app/debug/polyline/de/${journeyID}`);
  if (!response.ok) {
    throw new Error(`polyline: HTTP ${response.status}`);
  }

  const collection = (await response.json()) as GeoJsonFeatureCollection;
  const path: [number, number][] = [];
  for (const { geometry } of collection.features ?? []) {
    const lines =
      geometry?.type === 'LineString'
        ? [geometry.coordinates as [number, number][]]
        : geometry?.type === 'MultiLineString'
          ? (geometry.coordinates as [number, number][][])
          : [];
    for (const line of lines) {
      for (const [lon, lat] of line) {
        path.push([lat, lon]);
      }
    }
  }

  const now = Date.now();
  for (const [key, entry] of polylineCache) {
    if (now - entry.at >= POLYLINE_CACHE_MS) {
      polylineCache.delete(key);
    }
  }

  polylineCache.set(journeyID, { at: now, path });
  if (path.length > 0) {
    void cacheSet(redisKey(journeyID), POLYLINE_CACHE_MS / 1000, JSON.stringify(path));
  }

  return path;
}

interface StopPlacePosition {
  lat: number;
  lon: number;
}

function risStationsUrl(): string {
  return process.env['RIS_STATIONS_URL'] ?? 'https://de-stations.trainy.app';
}

async function fetchStopPlacePositions(
  evaNumbers: string[],
): Promise<Map<string, StopPlacePosition>> {
  const evas = [...new Set(evaNumbers)].filter(Boolean);
  if (evas.length === 0) {
    return new Map();
  }

  const response = await fetch(`${risStationsUrl()}/ris-stations/v1/stop-places/by-keys`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/vnd.de.db.ris+json',
      Accept: 'application/vnd.de.db.ris+json',
    },
    body: JSON.stringify({ keyType: 'EVA', keys: evas.map((key) => ({ key })) }),
  });
  if (!response.ok) {
    throw new Error(`stop-places: HTTP ${response.status}`);
  }

  const body = (await response.json()) as StopPlacesByKeysResponse;
  const result = new Map<string, StopPlacePosition>();
  for (const [key, places] of Object.entries(body)) {
    if (!Array.isArray(places)) continue;
    const place = places[0];
    const eva = place?.evaNumber ?? key;
    const lat = place?.position?.latitude;
    const lon = place?.position?.longitude;
    if (!eva || lat === undefined || lon === undefined) continue;
    result.set(eva, { lat, lon });
  }

  return result;
}

function delaySeconds(event: JourneyEvent): number | undefined {
  if (!event.time || !event.timeSchedule) {
    return undefined;
  }

  return Math.round((Date.parse(event.time) - Date.parse(event.timeSchedule)) / 1000) || undefined;
}

function toStops(events: JourneyEvent[]): CourseStop[] {
  const stops: CourseStop[] = [];
  let current: CourseStop | undefined;

  for (const event of events) {
    const eva = event.stopPlace?.evaNumber ?? '';
    if (!current || current.id !== eva || event.type === 'ARRIVAL') {
      current = { id: eva, name: event.stopPlace?.name ?? '?', extra: event.additional };
      stops.push(current);
    }

    const time = event.timeSchedule ?? event.time;
    if (event.type === 'ARRIVAL') {
      current.arrTime = time;
      current.arrDelay = delaySeconds(event);
    } else {
      current.depTime = time;
      current.depDelay = delaySeconds(event);
    }

    current.platform = event.platform ?? event.platformSchedule ?? current.platform;
    current.cancelled ||= event.cancelled;
  }

  return stops;
}

export async function fetchRisJourneyCourse(vehicle: LiveVehicle): Promise<JourneyCourse> {
  const dbApiUrl = process.env['DB_API_URL'];
  const clientId = process.env['DB_CLIENT_ID'];
  const apiKey = process.env['DB_API_KEY'];
  if (!clientId || !apiKey) {
    throw new Error('DB_CLIENT_ID / DB_API_KEY nicht gesetzt');
  }

  const [{ data: journey, error }, path] = await Promise.all([
    journeyEventBasedById({
      path: { journeyID: vehicle.id },
      baseUrl: dbApiUrl + '/ris-journeys/v2/',
      headers: {
        'DB-Client-ID': clientId,
        'DB-Api-Key': apiKey,
      },
    }),

    fetchPolyline(vehicle.id).catch((err: Error): [number, number][] => {
      console.error('ris-journeys:', err.message);
      return [];
    }),
  ]);

  if (error || !journey) {
    throw new Error(`ris-journeys: ${JSON.stringify(error)}`);
  }

  const stops = toStops(journey.events ?? []);
  if (stops.length === 0) {
    throw new Error('Kein Fahrtverlauf gefunden');
  }

  try {
    const positions = await fetchStopPlacePositions(stops.map((stop) => stop.id));
    for (const stop of stops) {
      const position = positions.get(stop.id);
      if (position) {
        stop.lat = position.lat;
        stop.lon = position.lon;
      }
    }
  } catch (err) {
    console.warn('ris-journeys: stop-places:', (err as Error).message);
  }

  return {
    lineId: undefined,
    lineName: journey.info.transportAtStart?.line ?? vehicle.journey?.lineName ?? '?',
    destination: journey.info.destination?.name ?? vehicle.journey?.destination ?? '',
    category: vehicle.journey?.category ?? 'R',
    stops,
    path,
  };
}
