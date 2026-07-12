import {
  Component,
  ElementRef,
  OnDestroy,
  afterNextRender,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import type * as Leaflet from 'leaflet';
import { Subscription } from 'rxjs';
import { CourseStop, JourneyCourse, LiveVehicle } from '../../shared/vehicle-types';
import { LiveVehiclesService } from '../live-vehicles.service';
import { MarkerEntry, VehicleChange } from '../types';
import {
  OCCUPANCY_COLOR,
  OCCUPANCY_LABEL,
  categoryOf,
  colorForType,
  getPolylineColor,
} from '../vehicle-palette';

const HAMBURG_CENTER: [number, number] = [53.5503, 9.9937];

@Component({
  selector: 'app-vehicle-map',
  templateUrl: './vehicle-map.html',
  styleUrl: './vehicle-map.scss',
})
export class VehicleMap implements OnDestroy {
  private readonly mapEl = viewChild.required<ElementRef<HTMLDivElement>>('mapEl');
  private readonly service = inject(LiveVehiclesService);

  private L: typeof Leaflet | undefined;
  private map: Leaflet.Map | undefined;
  private subscription: Subscription | undefined;

  private vehicleRenderer: Leaflet.Renderer | undefined;
  private lineRenderer: Leaflet.Renderer | undefined;
  private readonly markers = new Map<string, MarkerEntry>();
  private courseLayer: Leaflet.LayerGroup | undefined;
  private courseRequest = 0;

  protected readonly selected = signal<LiveVehicle | null>(null);
  protected readonly course = signal<JourneyCourse | null>(null);
  protected readonly courseLoading = signal(false);
  protected readonly courseError = signal<string | null>(null);

  protected readonly OCCUPANCY_COLOR = OCCUPANCY_COLOR;
  protected readonly OCCUPANCY_LABEL = OCCUPANCY_LABEL;
  protected readonly kindLabel = kindLabel;

  constructor() {
    afterNextRender(() => void this.init());
    effect(() => {
      this.service.hiddenTypes();
      this.applyVisibility();
    });
  }

  private async init(): Promise<void> {
    const mod: typeof Leaflet & { default?: typeof Leaflet } = await import('leaflet');
    const L = (this.L = mod.default ?? mod);
    const map = (this.map = L.map(this.mapEl().nativeElement, {
      center: HAMBURG_CENTER,
      zoom: 12,
      preferCanvas: true,
    }));

    map.createPane('routeLine').style.zIndex = '410';
    map.createPane('vehicles').style.zIndex = '415';

    this.lineRenderer = L.canvas({ pane: 'routeLine' });
    this.vehicleRenderer = L.canvas({ tolerance: 6, pane: 'vehicles' });

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    this.subscription = this.service.changes.subscribe((change) => this.onChange(change));

    this.onChange({ upserts: [...this.service.vehicles.values()], removals: [], reset: true });
    this.service.connect();
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
    this.map?.remove();
  }

  private onChange(change: VehicleChange): void {
    if (!this.map) {
      return;
    }

    if (change.reset) {
      for (const entry of this.markers.values()) {
        entry.marker.remove();
      }

      this.markers.clear();
    }

    for (const id of change.removals) {
      this.markers.get(id)?.marker.remove();
      this.markers.delete(id);
    }

    for (const vehicle of change.upserts) {
      this.upsert(vehicle);
    }

    const selectedId = this.selected()?.id;
    if (selectedId) {
      const updated = change.upserts.find((v) => v.id === selectedId);
      if (updated) {
        this.selected.set(updated);
      }
    }
  }

  private upsert(vehicle: LiveVehicle): void {
    const L = this.L!;
    const type = categoryOf(vehicle);

    let entry = this.markers.get(vehicle.id);
    if (!entry) {
      const marker = L.circleMarker([vehicle.lat, vehicle.lon], {
        renderer: this.vehicleRenderer,
        radius: 5,
        weight: 1.5,
        color: '#ffffff',
        fillColor: colorForType(type),
        fillOpacity: 0.9,
      });

      const id = vehicle.id;
      marker.on('click', () => void this.select(id));
      entry = { marker, type, visible: false };
      this.markers.set(vehicle.id, entry);
    } else {
      entry.marker.setLatLng([vehicle.lat, vehicle.lon]);
      if (entry.type !== type) {
        entry.type = type;
        entry.marker.setStyle({ fillColor: colorForType(type) });
      }
    }

    this.setVisible(entry, !this.service.hiddenTypes().has(entry.type));
  }

  private async select(vehicleId: string): Promise<void> {
    const request = ++this.courseRequest;
    this.clearCourse();
    this.selected.set(this.service.vehicles.get(vehicleId) ?? null);
    this.courseLoading.set(true);

    try {
      const course = await this.service.loadCourse(vehicleId);
      if (request !== this.courseRequest) {
        return;
      }

      this.course.set(course);
      this.drawCourse(course);
    } catch (err) {
      if (request !== this.courseRequest) {
        return;
      }

      this.courseError.set((err as Error).message);
    } finally {
      if (request === this.courseRequest) {
        this.courseLoading.set(false);
      }
    }
  }

  private drawCourse(course: JourneyCourse): void {
    const L = this.L;
    if (!L || !this.map) {
      return;
    }

    const color = getPolylineColor(course);
    const layer = (this.courseLayer = L.layerGroup());

    L.polyline(course.path, {
      renderer: this.lineRenderer,
      interactive: false,
      color,
      weight: 6,
      opacity: 0.9,
    }).addTo(layer);

    for (const stop of course.stops) {
      if (stop.lat === undefined || stop.lon === undefined) continue;
      L.circleMarker([stop.lat, stop.lon], {
        renderer: this.vehicleRenderer,
        radius: 4,
        weight: 2,
        color,
        fillColor: '#ffffff',
        fillOpacity: 1,
      })
        .bindTooltip(`${stop.name}${this.stopTime(stop) ? ` - ${this.stopTime(stop)}` : ''}`)
        .addTo(layer);
    }

    layer.addTo(this.map);
  }

  protected clearCourse(): void {
    this.courseLayer?.remove();
    this.courseLayer = undefined;
    this.selected.set(null);
    this.course.set(null);
    this.courseError.set(null);
    this.courseLoading.set(false);
  }

  protected stopTime(stop: CourseStop): string {
    const time = stop.depTime ?? stop.arrTime;
    if (!time) {
      return '';
    }

    return new Date(time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  }

  protected stopDelay(stop: CourseStop): string | null {
    const seconds = stop.depDelay ?? stop.arrDelay;
    if (!seconds) return null;
    const minutes = Math.round(seconds / 60);
    if (minutes === 0) return null;
    return minutes > 0 ? `+${minutes}` : `${minutes}`;
  }

  protected roundedSpeed(vehicle: LiveVehicle): number {
    return Math.round(vehicle.speed ?? 0);
  }

  protected receivedTime(vehicle: LiveVehicle): string {
    return new Date(vehicle.lastReceived).toLocaleTimeString('de-DE');
  }

  private applyVisibility(): void {
    const hidden = this.service.hiddenTypes();
    for (const entry of this.markers.values()) {
      this.setVisible(entry, !hidden.has(entry.type));
    }
  }

  private setVisible(entry: MarkerEntry, visible: boolean): void {
    if (!this.map || entry.visible === visible) return;
    entry.visible = visible;
    if (visible) {
      entry.marker.addTo(this.map);
    } else {
      entry.marker.remove();
    }
  }
}

function kindLabel(kind: LiveVehicle['kind']): string {
  switch (kind) {
    case 'POSITION':
      return 'GPS';
    case 'STATION':
      return 'an Haltestelle';
    case 'SECTION':
      return 'zwischen Haltestellen';
  }
}
