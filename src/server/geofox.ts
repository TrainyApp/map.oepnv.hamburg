import { createHmac } from 'node:crypto';
import { CourseStop, JourneyCourse, LiveVehicle, TimeType, VehicleJourney } from '../shared/vehicle-types';
import {
  GtiCourseElement,
  GtiDeparture,
  GtiResponse,
  GtiSDName,
  GtiService,
  GtiSimpleServiceType,
  GTITime
} from './types/geofox/gti';
import { LineListEntry, LLResponse } from './types/geofox/LLResponse';
import { StationDeparture } from './types/mosaic';
import { Temporal } from '@js-temporal/polyfill';
import Instant = Temporal.Instant;
import Duration = Temporal.Duration;

const GTI_BASE_URL = 'https://gti.geofox.de/gti/public';
const GTI_VERSION = 63;

const DEPARTURES_WINDOW_MINUTES = 80;

export interface VehicleJourneysResult {
  departures: StationDeparture[];
  parsedJourneys: Map<string, VehicleJourney>;
}

export const STATIONS = [
  'de:02000:63900', // Farmsen
  'de:02000:65900', // Berne
  'Master:9910950', // Hauptbahnhof
  'de:02000:10002', // Hauptbahnhof/ZOB
  'de:02000:10905', // Hauptbahnhof Nord
  'de:02000:10906', // Hauptbahnhof Süd
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
  'de:02000:10952', // Berliner Tor
  'de:02000:84960', // Eidelstedt
];

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
    const text = await response.text();
    result = JSON.parse(text) as T;
  } catch {
    throw new Error(`geofox ${method}: HTTP ${response.status}`);
  }
  if (result.returnCode !== 'OK') {
    const detail = result.errorText ?? result.errorDevInfo ?? result.detail ?? '';
    const status = result.returnCode ?? result.status ?? '';
    throw new Error(`geofox ${method}: ${status} ${detail}`.trim());
  }

  return result;
}

function toGtiTime(instant: Instant): string {
  return instant.toString({ fractionalSecondDigits: 3 }).replace('Z', '+0000');
}

function toGTITime(instant: Instant): GTITime {
  const zoned = instant.toZonedDateTimeISO('Europe/Berlin');

  const hour = zoned.hour.toString().padStart(2, '0');
  const minute = zoned.minute.toString().padStart(2, '0');
  const time = `${hour}:${minute}`;

  const year = zoned.year.toString();
  const month = zoned.month.toString().padStart(2, '0');
  const day = zoned.day.toString().padStart(2, '0');
  const date = `${day}.${month}.${year}`;

  return { date, time };
}

function toGtiStationId(stationId: string): string {
  const match = stationId.match(/^de:\d+:(\d+)$/);
  return match ? `Master:${match[1]}` : stationId;
}

function toTimeType(
  delay: number | undefined,
  scheduled: string | undefined,
): TimeType | undefined {
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

async function fetchDepartures(stationIds: string[], time: Instant): Promise<GtiDeparture[]> {
  const response = await gti<GtiResponse & { departures: GtiDeparture[] }>('departureList', {
    stations: stationIds.map(
      (stationId) => <GtiSDName>{ id: toGtiStationId(stationId), type: 'STATION' },
    ),
    serviceTypes: [
      'BUS',
      'STADTBUS',
      'METROBUS',
      'SCHNELLBUS',
      'NACHTBUS',
      'XPRESSBUS',
      'FAEHRE',
      'UBAHN',
    ],
    maxList: 10000,
    maxTimeOffset: DEPARTURES_WINDOW_MINUTES,
    useRealtime: true,
    allStationsInChangingNode: true,
    time: toGTITime(time),
  });

  return response.departures;
}

export async function fetchVehicleJourneys(
  hvvLines?: Map<string, LineListEntry>,
): Promise<VehicleJourneysResult> {
  const now = Temporal.Now.instant();
  const time = Temporal.Now.instant().subtract({ hours: 1 });

  const results = await fetchDepartures(STATIONS, time);

  const departures: StationDeparture[] = [];
  const bestTime = new Map<string, Instant>();
  const journeys = new Map<string, VehicleJourney>();
  for (const departure of results) {
    departures.push(<StationDeparture>{
      stationId: departure.station.id ?? '',
      requestTime: time,
      departure: departure,
    });
    const when = departureTime(departure, time);
    for (let vehicle of departure.vehicles ?? []) {
      const vehicleId = vehicle?.id;
      if (!vehicleId) continue;

      const previous = bestTime.get(vehicleId);

      if (
        previous &&
        Temporal.Instant.compare(when, previous) === 1 &&
        Temporal.Instant.compare(when, now) === 1
      ) {
        const diffInMins = when.since(now);

        if (Temporal.Duration.compare(diffInMins, Duration.from({ minutes: 15 })) == 1) {
          continue;
        }
      }

      bestTime.set(vehicleId, when);
      journeys.set(vehicleId, {
        stationId: departure.station.id,
        geofoxLineId: hvvLines?.get(normalizeLineName(departure.line?.name ?? ''))?.id ?? '',
        journeyId: departure.serviceId.toString(),
        lineId: departure.line?.id ?? '',
        lineName: departure.line?.name ?? '?',
        transitMode: departure.line?.type.simpleType ?? '',
        category: categorize(departure.line),
        destination: departure.line.direction,
        plannedDeparture: time.add({ minutes: departure.timeOffset }),
      });
    }
  }

  return { departures, parsedJourneys: journeys };
}

export async function fetchJourneyCourse(
  vehicle: LiveVehicle,
  departure: StationDeparture | undefined,
): Promise<JourneyCourse> {
  const journey = vehicle.journey;

  const lineId = departure?.departure?.line?.id ?? journey?.lineId;
  const stationId = departure?.stationId ?? journey?.stationId;
  const destination = departure?.departure?.line?.direction ?? journey?.destination;
  const plannedDeparture = departure?.getPlannedDeparture() ?? journey?.plannedDeparture;

  if (!lineId || !stationId || !destination || !plannedDeparture) {
    throw new Error('Keine Verbindung zum Fahrplan');
  }

  const response = await gti<GtiResponse & { courseElements?: GtiCourseElement[] }>(
    'departureCourse',
    {
      lineKey: lineId,
      station: { id: toGtiStationId(stationId), type: 'STATION' },
      time: toGtiTime(plannedDeparture),
      serviceId: departure?.departure.serviceId ?? Number.parseInt(vehicle.journey?.journeyId!),
      segments: 'ALL',
      showPath: true,
      coordinateType: 'EPSG_4326',
    },
  );
  const courseElements = response.courseElements ?? [];
  if (courseElements.length === 0) throw new Error('Kein Fahrtverlauf gefunden');

  const lineName = departure?.departure.line?.name ?? journey?.lineName;
  const destinationName = departure?.departure.line.direction ?? journey?.destination;
  const category = departure?.departure?.line?.type.simpleType ?? journey?.category;

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

function departureTime(departure: GtiDeparture, startTime: Instant): Instant {
  return startTime.add({ minutes: departure.timeOffset }).add({ seconds: departure.delay ?? 0 });
}

function categorize(line: GtiService): string {
  const mode = line.type.simpleType ?? '';
  if (mode === GtiSimpleServiceType.BUS && /^X\d/i.test(line?.name ?? '')) return 'XPRESSBUS';
  if (mode === GtiSimpleServiceType.TRAIN) return line.type.shortInfo;
  return mode;
}

export function normalizeLineName(name: string): string {
  return name.replace(/\s+/g, '').toUpperCase();
}
