import { createHmac } from 'node:crypto';
import { CourseStop, JourneyCourse, LiveVehicle } from '../shared/vehicle-types';
import { normalizeLineName } from './mosaic';
import { GtiCourseElement, GtiResponse } from './types/geofox/gti';
import { LineListEntry, LLResponse } from './types/geofox/LLResponse';
import { StationDeparture } from './types/mosaic';
import { TimeType } from '../shared/vehicle-types';

const GTI_BASE_URL = 'https://gti.geofox.de/gti/public';
const GTI_VERSION = 63;

async function gti<T extends GtiResponse>(method: string, body: object): Promise<T> {
  const user = process.env['GEOFOX_AUTH_USER'];
  const password = process.env['GEOFOX_AUTH_PASSWORD'];
  if (!user || !password) {
    throw new Error('GEOFOX_AUTH_USER / GEOFOX_AUTH_PASSWORD nicht gesetzt');
  }

  const payload = JSON.stringify({ version: GTI_VERSION, language: 'de', ...body });
  const signature = createHmac('sha1', Buffer.from(password, 'utf8'))
    .update(payload, 'utf8')
    .digest('base64');

  const response = await fetch(`${GTI_BASE_URL}/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      Accept: 'application/json',
      'geofox-auth-type': 'HmacSHA1',
      'geofox-auth-user': user,
      'geofox-auth-signature': signature,
    },
    body: payload,
  });

  let result: T;
  try {
    result = (await response.json()) as T;
  } catch {
    throw new Error(`geofox ${method}: HTTP ${response.status}`);
  }
  if (result.returnCode !== 'OK') {
    const detail = result.errorText ?? result.errorDevInfo ?? '';
    throw new Error(`geofox ${method}: ${result.returnCode} ${detail}`.trim());
  }

  return result;
}

function toGtiTime(iso: string): string {
  return new Date(iso).toISOString().replace('Z', '+0000');
}

function toGtiStationId(stationId: string): string {
  const match = stationId.match(/^de:\d+:(\d+)$/);
  return match ? `Master:${match[1]}` : stationId;
}

function toTimeType(delay: number | undefined, scheduled: string | undefined): TimeType | undefined {
  if (scheduled === undefined) return undefined;
  return delay === undefined ? TimeType.SCHEDULED : TimeType.ESTIMATED;
}

function toStops(courseElements: GtiCourseElement[]): CourseStop[] {
  const stops: CourseStop[] = [];
  const first = courseElements[0];
  stops.push({
    id: first.fromStation.id ?? '',
    name: first.fromStation.name ?? first.fromStation.combinedName ?? '?',
    lat: first.fromStation.coordinate?.y,
    lon: first.fromStation.coordinate?.x,
    depTime: first.depTime,
    depDelay: first.depDelay,
    platform: first.fromPlatform,
    cancelled: first.fromCancelled,
    extra: first.fromExtra,
    departureTimeType: toTimeType(first.depDelay, first.depTime),
    arrivalTimeType: toTimeType(first.arrDelay, first.arrTime),
  });

  for (const [index, element] of courseElements.entries()) {
    const next = courseElements[index + 1];
    stops.push({
      id: element.toStation.id ?? '',
      name: element.toStation.name ?? element.toStation.combinedName ?? '?',
      lat: element.toStation.coordinate?.y,
      lon: element.toStation.coordinate?.x,
      arrTime: element.arrTime,
      arrDelay: element.arrDelay,
      depTime: next?.depTime,
      depDelay: next?.depDelay,
      platform: element.toPlatform ?? next?.fromPlatform,
      cancelled: element.toCancelled,
      extra: element.toExtra,
      departureTimeType: toTimeType(element.depDelay, element.depTime),
      arrivalTimeType: toTimeType(element.arrDelay, element.arrTime),
    });
  }
  return stops;
}

export async function fetchLines(): Promise<Map<string, LineListEntry>> {
  const response = await gti<GtiResponse & LLResponse>('listLines', {});

  const names = new Map<string, LineListEntry>();
  for (const line of response.lines ?? []) {
    if (line.name) {
      names.set(normalizeLineName(line.name), line);
    }
  }

  return names;
}

export async function fetchJourneyCourse(
  vehicle: LiveVehicle,
  departure: StationDeparture | undefined,
): Promise<JourneyCourse> {
  const journey = vehicle.journey;

  const lineId = departure?.departure?.line?.id ?? journey?.lineId;
  const stationId = departure?.stationId ?? journey?.stationId;
  const destination = departure?.departure?.direction ?? journey?.destination;
  const plannedDeparture = departure?.departure?.planned?.departure ?? journey?.plannedDeparture;

  if (!lineId || !stationId || !destination || !plannedDeparture) {
    throw new Error('Keine Verbindung zum Fahrplan');
  }

  const response = await gti<GtiResponse & { courseElements?: GtiCourseElement[] }>(
    'departureCourse',
    {
      lineId,
      station: { id: toGtiStationId(stationId), type: 'STATION' },
      time: toGtiTime(plannedDeparture),
      direction: destination,
      segments: 'ALL',
      showPath: true,
      coordinateType: 'EPSG_4326',
    },
  );
  const courseElements = response.courseElements ?? [];
  if (courseElements.length === 0) throw new Error('Kein Fahrtverlauf gefunden');

  const lineName = departure?.departure.line?.name ?? journey?.lineName;
  const destinationName =
    departure?.departure.direction?.passengerDestination ?? journey?.destination;
  const category = departure?.departure?.line?.transitMode ?? journey?.category;

  if (!lineName || !destinationName || !category) {
    throw new Error('Keine Verbindung zum Fahrplan');
  }

  const stops = toStops(courseElements);

  let path: [number, number][] = [];
  for (const stop of courseElements) {
    if (stop.path) {
      for (const { x, y } of stop.path.track) {
        path.push([y, x]);
      }
    }
  }

  if (path.length === 0) {
    path = stops
      .filter((s) => s.lat !== undefined && s.lon !== undefined)
      .map((s) => [s.lat!, s.lon!]);
  }

  return {
    lineId: undefined,
    lineName: lineName,
    destination: destinationName,
    category: category,
    stops,
    path,
  };
}
