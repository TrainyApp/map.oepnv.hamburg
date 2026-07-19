import {
  afterNextRender,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  OnDestroy,
  signal,
  viewChild,
} from '@angular/core';
import type * as Leaflet from 'leaflet';
import { Subscription } from 'rxjs';
import { CourseStop, JourneyCourse, LiveVehicle, TimeType } from '../../shared/vehicle-types';
import { LiveVehiclesService } from '../live-vehicles.service';
import { MarkerEntry, VehicleChange } from '../types';
import {
  categoryOf,
  colorForType,
  getPolylineColor,
  LOCATION_SOURCE_LABEL,
  OCCUPANCY_COLOR,
  OCCUPANCY_LABEL,
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
  private selectedMarkerId: string | undefined;
  private locationMarker: Leaflet.CircleMarker | undefined;
  private courseLayer: Leaflet.LayerGroup | undefined;
  private courseRequest = 0;

  protected readonly selected = signal<LiveVehicle | null>(null);
  protected readonly course = signal<JourneyCourse | null>(null);
  protected readonly courseLoading = signal(false);
  protected readonly courseError = signal<string | null>(null);
  protected readonly locationMessage = signal('');

  protected readonly sheetMaxHeight = signal<number | null>(null);
  protected readonly sheetDragging = signal(false);
  private sheetDrag: {
    pointerId: number;
    startY: number;
    startHeight: number;
    minHeight: number;
  } | null = null;
  private mobileQuery: MediaQueryList | undefined;
  private readonly onMobileChange = (): void => {
    if (this.mobileQuery && !this.mobileQuery.matches) {
      this.sheetMaxHeight.set(null);
    }
  };

  protected readonly OCCUPANCY_COLOR = OCCUPANCY_COLOR;
  protected readonly OCCUPANCY_LABEL = OCCUPANCY_LABEL;
  protected readonly LOCATION_SOURCE_LABEL = LOCATION_SOURCE_LABEL;
  protected readonly kindLabel = kindLabel;

  protected readonly progress = computed(() => {
    const course = this.course();
    const vehicle = this.selected();
    if (!course || !vehicle) return null;
    return courseProgress(course.stops, vehicle.lat, vehicle.lon);
  });

  protected isReached(index: number): boolean {
    const p = this.progress();
    return !p || index <= p.index;
  }

  protected lineFill(index: number, isLast: boolean): string {
    const fill = this.stripFill(index);
    const visible =
      index === 0 ? Math.max(0, (fill - 50) * 2) : isLast ? Math.min(100, fill * 2) : fill;
    return `${visible}%`;
  }

  private stripFill(index: number): number {
    const p = this.progress();
    if (!p) return 100;

    const t = p.atStop ? 0 : p.fraction;
    if (index < p.index) {
      return 100;
    }

    if (index === p.index) {
      return 50 + Math.min(t, 0.5) * 100;
    }

    if (index === p.index + 1) {
      return Math.max(0, (t - 0.5) * 100);
    }

    return 0;
  }

  constructor() {
    afterNextRender(() => void this.init());
    effect(() => {
      this.service.hiddenTypes();
      this.service.selectedLine();
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
    this.mobileQuery?.removeEventListener('change', this.onMobileChange);
    this.map?.remove();
  }

  protected onSheetDragStart(event: PointerEvent): void {
    if (!window.matchMedia('(max-width: 760px)').matches) return;
    if ((event.target as HTMLElement).closest('button')) return;

    const target = event.currentTarget as HTMLElement;
    const panel = target.closest<HTMLElement>('.course-panel');
    if (!panel) return;

    if (!this.mobileQuery) {
      this.mobileQuery = window.matchMedia('(max-width: 760px)');
      this.mobileQuery.addEventListener('change', this.onMobileChange);
    }

    const header = panel.querySelector<HTMLElement>('.course-header');
    const minHeight = header
      ? Math.ceil(header.getBoundingClientRect().bottom - panel.getBoundingClientRect().top) + 2
      : 90;

    this.sheetDrag = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: panel.offsetHeight,
      minHeight,
    };
    target.setPointerCapture(event.pointerId);
    this.sheetDragging.set(true);
  }

  protected onSheetDragMove(event: PointerEvent): void {
    const drag = this.sheetDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;

    const height = drag.startHeight + (drag.startY - event.clientY);
    this.sheetMaxHeight.set(Math.min(Math.max(height, drag.minHeight), window.innerHeight * 0.92));
    event.preventDefault();
  }

  protected onSheetDragEnd(event: PointerEvent): void {
    const drag = this.sheetDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this.sheetDrag = null;
    this.sheetDragging.set(false);

    const height = this.sheetMaxHeight();
    if (height === null) return;

    const viewport = window.innerHeight;
    const snaps = [
      drag.minHeight,
      viewport * 0.35,
      Math.min(viewport * 0.68, 560),
      viewport * 0.92,
    ];
    const nearest = snaps.reduce((a, b) => (Math.abs(b - height) < Math.abs(a - height) ? b : a));
    this.sheetMaxHeight.set(Math.round(nearest));
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
      if (change.removals.includes(selectedId)) {
        this.clearCourse();
        return;
      }
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
      marker.bindTooltip(this.markerLabel(vehicle), {
        direction: 'top',
        offset: [0, -5],
        className: 'vehicle-tooltip',
      });
      entry = { marker, type, lineName: vehicle.journey?.lineName, visible: false };
      this.markers.set(vehicle.id, entry);
    } else {
      entry.marker.setLatLng([vehicle.lat, vehicle.lon]);
      entry.lineName = vehicle.journey?.lineName;
      if (entry.type !== type) {
        entry.type = type;
        entry.marker.setStyle({ fillColor: colorForType(type) });
      }
      entry.marker.setTooltipContent(this.markerLabel(vehicle));
    }

    this.setVisible(entry, this.shouldShow(vehicle.id, entry));
  }

  private async select(vehicleId: string): Promise<void> {
    this.clearCourse();
    const request = ++this.courseRequest;
    this.selected.set(this.service.vehicles.get(vehicleId) ?? null);
    this.setSelectedMarker(vehicleId);
    const marker = this.markers.get(vehicleId)?.marker;
    if (marker && this.map) {
      this.map.panTo(marker.getLatLng(), { animate: true, duration: 0.35 });
    }
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
    this.courseRequest++;
    this.courseLayer?.remove();
    this.courseLayer = undefined;
    this.selected.set(null);
    this.course.set(null);
    this.courseError.set(null);
    this.courseLoading.set(false);
    this.setSelectedMarker(undefined);
  }

  protected retryCourse(): void {
    const vehicleId = this.selected()?.id;
    if (vehicleId) void this.select(vehicleId);
  }

  protected focusVehicle(): void {
    const vehicle = this.selected();
    const marker = vehicle ? this.markers.get(vehicle.id)?.marker : undefined;
    if (!marker || !this.map) return;

    const latLng = marker.getLatLng();
    const zoom = Math.max(this.map.getZoom(), 15);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) {
      this.map.setView(latLng, zoom, { animate: false });
    } else {
      this.map.flyTo(latLng, zoom, { duration: 0.6 });
    }
  }

  protected centerHamburg(): void {
    this.map?.flyTo(HAMBURG_CENTER, 12, { duration: 0.6 });
    this.locationMessage.set('Karte auf Hamburg zentriert');
  }

  protected locateUser(): void {
    if (!navigator.geolocation) {
      this.locationMessage.set('Standortbestimmung wird nicht unterstützt');
      return;
    }

    this.locationMessage.set('Standort wird bestimmt');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const latLng: Leaflet.LatLngExpression = [coords.latitude, coords.longitude];
        this.map?.flyTo(latLng, 15, { duration: 0.6 });
        if (this.L && this.map) {
          this.locationMarker?.remove();
          this.locationMarker = this.L.circleMarker(latLng, {
            radius: 7,
            weight: 3,
            color: '#fff',
            fillColor: '#1455eb',
            fillOpacity: 1,
          })
            .bindTooltip('Dein Standort')
            .addTo(this.map);
        }
        this.locationMessage.set('Eigener Standort angezeigt');
      },
      () => this.locationMessage.set('Standort konnte nicht bestimmt werden'),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    );
  }

  protected stopTime(stop: CourseStop): string {
    const time = stop.depTime ?? stop.arrTime;
    if (!time) {
      return '';
    }

    return new Date(time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  }

  protected stopTimeType(stop: CourseStop): TimeType | undefined {
    return stop.departureTimeType ?? stop.arrivalTimeType;
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
    for (const [id, entry] of this.markers) {
      this.setVisible(entry, this.shouldShow(id, entry));
    }
  }

  private shouldShow(id: string, entry: MarkerEntry): boolean {
    return (
      id === this.selectedMarkerId ||
      (!this.service.hiddenTypes().has(entry.type) && this.service.matchesLine(entry.lineName))
    );
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

  private setSelectedMarker(vehicleId: string | undefined): void {
    const previousId = this.selectedMarkerId;
    this.selectedMarkerId = vehicleId;

    if (previousId) {
      const previous = this.markers.get(previousId);
      if (previous) {
        previous.marker.setRadius(5);
        previous.marker.setStyle({ weight: 1.5, color: '#ffffff', fillOpacity: 0.9 });
        this.setVisible(previous, this.shouldShow(previousId, previous));
      }
    }

    if (!vehicleId) return;

    const selected = this.markers.get(vehicleId);
    if (selected) {
      this.setVisible(selected, true);
      selected.marker.setRadius(7);
      selected.marker.setStyle({ weight: 2.5, color: '#ffffff', fillOpacity: 1 });
      selected.marker.bringToFront();
    }
  }

  private markerLabel(vehicle: LiveVehicle): HTMLElement {
    const label = document.createElement('span');
    const line = vehicle.journey?.lineName;
    const destination = vehicle.journey?.destination;
    label.textContent = line ? `${line}${destination ? ` → ${destination}` : ''}` : 'Fahrzeug';
    return label;
  }

  protected readonly TimeType = TimeType;
}

interface CourseProgress {
  index: number;
  atStop: boolean;
  fraction: number;
}

const AT_STOP_RADIUS_M = 5;

function courseProgress(stops: CourseStop[], lat: number, lon: number): CourseProgress | null {
  const kx = Math.cos((lat * Math.PI) / 180) * 111_320;
  const ky = 111_320;
  const located: { index: number; x: number; y: number }[] = [];
  for (const [index, stop] of stops.entries()) {
    if (stop.lat === undefined || stop.lon === undefined) continue;
    located.push({ index, x: (stop.lon - lon) * kx, y: (stop.lat - lat) * ky });
  }

  if (located.length < 2) return null;

  let nearest = 0;
  for (let i = 1; i < located.length; i++) {
    if (
      Math.hypot(located[i].x, located[i].y) < Math.hypot(located[nearest].x, located[nearest].y)
    ) {
      nearest = i;
    }
  }

  if (Math.hypot(located[nearest].x, located[nearest].y) <= AT_STOP_RADIUS_M) {
    return { index: located[nearest].index, atStop: true, fraction: 0 };
  }

  const before = nearest > 0 ? project(located[nearest - 1], located[nearest]) : null;
  const after =
    nearest < located.length - 1 ? project(located[nearest], located[nearest + 1]) : null;
  if (after && (!before || after.distance <= before.distance)) {
    return { index: located[nearest].index, atStop: false, fraction: after.t };
  }

  if (before) {
    return { index: located[nearest - 1].index, atStop: false, fraction: before.t };
  }

  return null;
}

function project(
  a: { x: number; y: number },
  b: { x: number; y: number },
): { distance: number; t: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / lengthSq));
  return { distance: Math.hypot(a.x + t * dx, a.y + t * dy), t };
}

function kindLabel(kind: LiveVehicle['kind']): string | undefined {
  switch (kind) {
    case 'STATION':
      return 'an Haltestelle';
    case 'SECTION':
      return 'zwischen Haltestellen';
    default:
      return undefined;
  }
}
