import type { Server as HttpServer } from 'node:http';
import mqtt from 'mqtt';
import { Server as SocketIOServer } from 'socket.io';
import { createServer, ServerResponse } from 'node:http';
import {
  EV_REMOVE,
  EV_SNAPSHOT,
  EV_STATUS,
  EV_UPDATE,
  JourneyCourse,
  LiveVehicle,
  LocationSource,
  RelayStatus,
  VehicleJourney,
  VehicleOccupancy,
} from '../shared/vehicle-types';
import { fetchJourneyCourse, fetchLines } from './geofox';
import { fetchVehicleJourneys, normalizeLineName } from './mosaic';
import { fetchRisJourneyCourse } from './ris-journeys';
import { LineListEntry } from './types/geofox/LLResponse';
import { GeoCoordinate, MosaicOccupancy, MosaicVehicleLocation } from './types/mosaic';
import { RisJourneyPosition } from './types/ris';
import { sectionMidpoint } from './ubahn-lines';

const POSITION_PREFIX = 'mosaic/out/v2/vehicle-position/hvv/';
const OCCUPANCY_PREFIX = 'mosaic/out/v1/vehicle-occupancy/hvv/';
const RIS_POSITION_PREFIX = 'RISSERVICES/PROD/journey-positions/filtered/';

const RIS_ADMINISTRATIONS = [
  '0S', // S-Bahn Hamburg
  'R1', // metronom
  '800201', // DB Regio N, Schleswig-Holstein (Netz Mitte)
  '800292', // DB Regio N, VB Kiel - Netz E-Ost
  '800293', // DB Regio N, VB Kiel - Netz RB81
  '800155', // DB Regio NO, Ostseeküste
  'RSUE', // Regionalverkehre Start Deutschland GmbH
  'O0', // Nordbahn Eisenbahngesellschaft
  '8002B5', // DB Regio N, Kiel (Netz West)
];

function risPositionTopic(administration: string): string {
  return `${RIS_POSITION_PREFIX}v1/+/${administration}`;
}

const RIS_CATEGORY_BY_TYPE: Record<string, string> = {
  CITY_TRAIN: 'S',
  REGIONAL_TRAIN: 'R',
  INTER_REGIONAL_TRAIN: 'R',
  INTERCITY_TRAIN: 'LONG_DISTANCE',
  HIGH_SPEED_TRAIN: 'LONG_DISTANCE',
  SUBWAY: 'U',
  TRAM: 'TRAM',
  BUS: 'BUS',
  FERRY: 'FERRY',
};

const BROADCAST_INTERVAL_MS = 200;
const STALE_SWEEP_INTERVAL_MS = 10_000;
const REMOVE_AFTER_MS = 3 * 60_000;
const JOURNEY_REFRESH_MS = 20_000;
const COURSE_CACHE_MS = 60_000;
const LINES_RETRY_MS = 60_000;

class MosaicRelay {
  private readonly apiKey = process.env['MOSAIC_API_KEY']!;
  private readonly io: SocketIOServer;

  private readonly vehicles = new Map<string, LiveVehicle>();
  private readonly occupancies = new Map<string, VehicleOccupancy>();

  private journeys = new Map<string, VehicleJourney>();
  public hvvLines: Map<string, LineListEntry> | undefined;

  private readonly courseCache = new Map<string, { at: number; course: JourneyCourse }>();
  private readonly dirty = new Set<string>();

  private mqttConnected = false;
  private attached = false;

  constructor() {
    this.io = new SocketIOServer({ serveClient: false });
    this.io.on('connection', (socket) => {
      socket.emit(EV_SNAPSHOT, [...this.vehicles.values()]);
      socket.emit(EV_STATUS, this.status());
    });

    setInterval(() => this.flush(), BROADCAST_INTERVAL_MS);
    setInterval(() => this.sweepStale(), STALE_SWEEP_INTERVAL_MS);

    this.connectMqtt();
    this.loadHvvLines();
    this.startJourneyPolling();
  }

  private async loadHvvLines(): Promise<void> {
    try {
      this.hvvLines = await fetchLines();
      console.log(`mosaic: ${this.hvvLines!.size} hvv lines loaded`);
    } catch (err) {
      console.warn('mosaic: lines fetch failed, retrying:', (err as Error).message);
      setTimeout(() => this.loadHvvLines(), LINES_RETRY_MS);
    }
  }

  attach(server: HttpServer): void {
    if (this.attached) return;
    this.attached = true;
    this.io.attach(server);
  }

  listenStandalone(port: number): void {
    if (this.attached) return;
    this.attached = true;
    const server = createServer((req, res) => {
      const match = req.url?.match(/^\/api\/course\/([^/?]+)/);
      if (match) {
        void this.serveCourse(decodeURIComponent(match[1]), res);
      } else {
        res.writeHead(404).end();
      }
    });
    this.io.attach(server);
    server.listen(port, () => console.log(`relay listening on :${port}`));
  }

  async serveCourse(vehicleId: string, res: ServerResponse): Promise<void> {
    try {
      const course = await this.courseFor(vehicleId);
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(course));
    } catch (err) {
      res
        .writeHead(502, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ error: (err as Error).message }));
    }
  }

  private connectMqtt(): void {
    const url = process.env['MOSAIC_BROKER_URL'];
    const username = process.env['EMQX_CLIENT_ID'];
    const password = process.env['EMQX_CLIENT_SECRET'];

    if (!url || !username || !password) {
      throw new Error(
        'MOSAIC_BROKER_URL, EMQX_CLIENT_ID, and EMQX_CLIENT_SECRET must be set in environment variables',
      );
    }

    const client = mqtt.connect(url, {
      username,
      password,
      clean: true,
      reconnectPeriod: 5000,
    });

    client.on('connect', () => {
      this.mqttConnected = true;

      console.log(`mosaic: connected to ${url}`);
      const topics = ['mosaic/#', ...RIS_ADMINISTRATIONS.map(risPositionTopic)];
      client.subscribe(topics, { qos: 0 }, (err) => {
        if (err) {
          console.error('subscribe failed:', err.message);
          return;
        }
      });

      this.io.emit(EV_STATUS, this.status());
    });

    client.on('close', () => {
      if (this.mqttConnected) {
        this.mqttConnected = false;
        console.warn('MQTT connection lost, reconnecting…');
        this.io.emit(EV_STATUS, this.status());
      }
    });
    client.on('error', (err) => console.error('MQTT error:', err.message));
    client.on('message', (topic, payload) => {
      try {
        this.onMessage(topic, payload.toString('utf8'));
      } catch (err) {
        console.warn(`bad payload on ${topic}:`, (err as Error).message);
      }
    });
  }

  private onMessage(topic: string, payload: string): void {
    if (topic.startsWith(RIS_POSITION_PREFIX)) {
      this.onRisPosition(JSON.parse(payload) as RisJourneyPosition);
    } else if (topic.startsWith(POSITION_PREFIX)) {
      this.onPosition(JSON.parse(payload) as MosaicVehicleLocation);
    } else if (topic.startsWith(OCCUPANCY_PREFIX)) {
      this.onOccupancy(JSON.parse(payload) as MosaicOccupancy);
    }
  }

  private onPosition(location: MosaicVehicleLocation): void {
    const coordinate = this.resolveCoordinate(location);
    if (!coordinate) return;

    const id = location.vehicleId;
    this.vehicles.set(id, {
      id,
      kind: location.type,
      lat: coordinate.latitude,
      lon: coordinate.longitude,
      lastReceived: location.lastReceived,
      occupancy: this.occupancies.get(id),
      journey: this.journeys.get(id) ?? this.vehicles.get(id)?.journey,
      locationSource: 'GPS',
    });
    this.dirty.add(id);
  }

  private onRisPosition(position: RisJourneyPosition): void {
    const { journeyID, latitude, longitude } = position;
    if (!journeyID || latitude === undefined || longitude === undefined) return;

    const transport = position.info?.transportAtStart;
    if (this.hvvLines && !this.hvvLines.has(normalizeLineName(transport?.line ?? ''))) {
      console.warn('Ignoring position from line: ', transport?.line);
      return;
    }

    let locationSource: LocationSource = 'GPS';
    if (position.metaSource) {
      switch (position.metaSource) {
        case 'SIGNALLING':
          locationSource = 'LST';
          break;
        default:
          locationSource = 'UNKNOWN';
          console.warn('Unknown metaSource:', position.metaSource);
      }
    }

    this.vehicles.set(journeyID, {
      id: journeyID,
      kind: 'POSITION',
      lat: latitude,
      lon: longitude,
      lastReceived:
        position.meta?.timeInformation ?? position.meta?.timeCreated ?? new Date().toISOString(),
      speed: position.speed,
      locationSource: locationSource,
      journey: {
        journeyId: journeyID,
        lineId: '',
        geofoxLineId: this.hvvLines?.get(normalizeLineName(transport?.line ?? ''))?.id ?? '',
        lineName: transport?.line ?? transport?.journeyName ?? '?',
        transitMode: transport?.category ?? '',
        category: RIS_CATEGORY_BY_TYPE[transport?.type ?? ''] ?? '',
        destination: position.info?.destination?.name ?? '',
      },
    });
    this.dirty.add(journeyID);
  }

  private async courseFor(vehicleId: string): Promise<JourneyCourse> {
    const vehicle = this.vehicles.get(vehicleId);
    if (!vehicle) throw new Error('Fahrzeug nicht mehr aktiv');

    const cacheKey = vehicle.journey?.journeyId ?? vehicleId;
    const cached = this.courseCache.get(cacheKey);
    if (cached && Date.now() - cached.at < COURSE_CACHE_MS) {
      return cached.course;
    }

    const journey = vehicle.journey;
    const isRisVehicle =
      !journey?.stationId && !!journey?.journeyId && journey.journeyId === vehicle.id;
    const course = isRisVehicle
      ? await fetchRisJourneyCourse(vehicle)
      : await fetchJourneyCourse(vehicle, undefined);
    this.courseCache.set(cacheKey, { at: Date.now(), course });
    for (const [key, entry] of this.courseCache) {
      if (Date.now() - entry.at >= COURSE_CACHE_MS) this.courseCache.delete(key);
    }

    course.lineId = this.hvvLines?.get(normalizeLineName(course.lineName))?.id;

    return course;
  }

  private startJourneyPolling(): void {
    const refresh = async () => {
      try {
        const result = await fetchVehicleJourneys(this.apiKey, this.hvvLines);
        this.journeys = result.parsedJourneys;
        console.log(`mosaic: resolved journeys for ${this.journeys.size} vehicles`);
        for (const [id, vehicle] of this.vehicles) {
          const journey = this.journeys.get(id);
          if (journey && vehicle.journey?.journeyId !== journey.journeyId) {
            vehicle.journey = journey;
            this.dirty.add(id);
          }
        }
      } catch (err) {
        console.warn('mosaic: journey refresh failed:', (err as Error).message);
      }
    };

    void refresh();
    setInterval(() => void refresh(), JOURNEY_REFRESH_MS);
  }

  private resolveCoordinate(location: MosaicVehicleLocation): GeoCoordinate | undefined {
    if (location.type === 'SECTION') {
      const begin = location.sectionBegin;
      const end = location.sectionEnd;
      if (!begin || !end) {
        return undefined;
      }

      const snapped = sectionMidpoint(begin, end);
      if (snapped) {
        return snapped;
      }

      return {
        latitude: (begin.position.latitude + end.position.latitude) / 2,
        longitude: (begin.position.longitude + end.position.longitude) / 2,
      };
    }

    return location.position;
  }

  private onOccupancy(raw: MosaicOccupancy): void {
    const occupancy: VehicleOccupancy = {
      level: raw.occupancyLevel,
      count: raw.occupancy,
      vehicleType: raw.vehicleType,
      vehicleModel: raw.vehicleModel,
      predicted: raw.predicted,
      timestamp: raw.timestamp,
    };

    this.occupancies.set(raw.vehicleId, occupancy);
    const vehicle = this.vehicles.get(raw.vehicleId);
    if (vehicle) {
      vehicle.occupancy = occupancy;
      this.dirty.add(raw.vehicleId);
    }
  }

  private sweepStale(): void {
    const cutoff = Date.now() - REMOVE_AFTER_MS;
    const removed: string[] = [];
    for (const [id, vehicle] of this.vehicles) {
      if (Date.parse(vehicle.lastReceived) < cutoff) {
        this.vehicles.delete(id);
        this.occupancies.delete(id);
        this.dirty.delete(id);
        removed.push(id);
      }
    }

    for (const [id, occupancy] of this.occupancies) {
      if (!this.vehicles.has(id) && Date.parse(occupancy.timestamp) < cutoff) {
        this.occupancies.delete(id);
      }
    }

    if (removed.length > 0) {
      this.io.emit(EV_REMOVE, removed);
    }
  }

  private flush(): void {
    if (this.dirty.size === 0) return;

    if (this.io.sockets.sockets.size === 0) {
      this.dirty.clear();
      return;
    }

    const updates: LiveVehicle[] = [];
    for (const id of this.dirty) {
      const vehicle = this.vehicles.get(id);
      if (vehicle) {
        updates.push(vehicle);
      }
    }
    this.dirty.clear();
    this.io.emit(EV_UPDATE, updates);
  }

  status(): RelayStatus {
    return { mqttConnected: this.mqttConnected, vehicleCount: this.vehicles.size };
  }
}

export function getRelay(): MosaicRelay {
  const holder = globalThis as { __mosaicRelay?: MosaicRelay };
  return (holder.__mosaicRelay ??= new MosaicRelay());
}
