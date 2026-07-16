import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import {
  EV_REMOVE,
  EV_SNAPSHOT,
  EV_STATUS,
  EV_UPDATE,
  JourneyCourse,
  LiveVehicle,
  RelayStatus,
} from '../shared/vehicle-types';
import { LineOption, VehicleChange } from './types';
import { categoryOf, categoryRank } from './vehicle-palette';

@Injectable({ providedIn: 'root' })
export class LiveVehiclesService {
  private readonly platformId = inject(PLATFORM_ID);
  private socket: Socket | undefined;

  readonly vehicles = new Map<string, LiveVehicle>();
  readonly changes = new Subject<VehicleChange>();

  readonly socketConnected = signal(false);
  readonly mqttConnected = signal(false);

  readonly typeCounts = signal<Record<string, number>>({});
  readonly vehicleCount = computed(() =>
    Object.values(this.typeCounts()).reduce((sum, count) => sum + count, 0),
  );
  readonly hiddenTypes = signal<ReadonlySet<string>>(new Set());
  readonly selectedLine = signal<string | null>(null);
  readonly lines = signal<LineOption[]>([]);

  connect(): void {
    if (!isPlatformBrowser(this.platformId) || this.socket) {
      return;
    }

    const socket = io({ transports: ['websocket'] });
    this.socket = socket;

    socket.on('connect', () => this.socketConnected.set(true));
    socket.on('disconnect', () => this.socketConnected.set(false));
    socket.on(EV_STATUS, (status: RelayStatus) => this.mqttConnected.set(status.mqttConnected));

    socket.on(EV_SNAPSHOT, (all: LiveVehicle[]) => {
      this.vehicles.clear();
      for (const vehicle of all) {
        this.vehicles.set(vehicle.id, vehicle);
      }

      this.afterMutation({ upserts: all, removals: [], reset: true });
    });

    socket.on(EV_UPDATE, (updates: LiveVehicle[]) => {
      for (const vehicle of updates) {
        this.vehicles.set(vehicle.id, vehicle);
      }

      this.afterMutation({ upserts: updates, removals: [], reset: false });
    });

    socket.on(EV_REMOVE, (ids: string[]) => {
      for (const id of ids) {
        this.vehicles.delete(id);
      }

      this.afterMutation({ upserts: [], removals: ids, reset: false });
    });
  }

  async loadCourse(vehicleId: string): Promise<JourneyCourse> {
    const response = await fetch(`/api/course/${vehicleId}`);
    const body = (await response.json()) as JourneyCourse | { error: string };
    if (!response.ok || 'error' in body) {
      throw new Error('error' in body ? body.error : `HTTP ${response.status}`);
    }

    return body;
  }

  matchesLine(lineName: string | undefined): boolean {
    const selected = this.selectedLine();
    return !selected || lineName === selected;
  }

  toggleType(type: string): void {
    const hidden = new Set(this.hiddenTypes());
    if (!hidden.delete(type)) {
      hidden.add(type);
    }

    this.hiddenTypes.set(hidden);
  }

  private afterMutation(change: VehicleChange): void {
    const counts: Record<string, number> = {};
    const lines = new Map<string, LineOption>();
    const seenJourneys = new Set<string>();

    for (const vehicle of this.vehicles.values()) {
      const journey = vehicle.journey;
      const journeyKey = journey?.journeyId || vehicle.id;
      if (seenJourneys.has(journeyKey)) {
        continue;
      }
      seenJourneys.add(journeyKey);

      const category = categoryOf(vehicle);
      counts[category] = (counts[category] ?? 0) + 1;
      if (journey?.lineName) {
        const line = lines.get(journey.lineName);
        if (line) {
          line.count++;
        } else {
          lines.set(journey.lineName, {
            name: journey.lineName,
            category,
            geofoxLineId: journey.geofoxLineId,
            count: 1,
          });
        }
      }
    }

    this.typeCounts.set(counts);
    this.lines.set([...lines.values()].sort(compareLines));
    this.changes.next(change);
  }
}

function compareLines(a: LineOption, b: LineOption): number {
  return (
    categoryRank(a.category) - categoryRank(b.category) ||
    a.name.localeCompare(b.name, 'de', { numeric: true })
  );
}
