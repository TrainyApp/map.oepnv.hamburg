import { Component, computed, inject, signal } from '@angular/core';
import { LiveVehiclesService } from './live-vehicles.service';
import { VehicleMap } from './vehicle-map/vehicle-map';
import { CATEGORY_ORDER, colorForType, labelForCategory } from './vehicle-palette';

@Component({
  selector: 'app-root',
  imports: [VehicleMap],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly live = inject(LiveVehiclesService);
  protected readonly filtersOpen = signal(false);

  protected readonly legend = computed(() => {
    const hidden = this.live.hiddenTypes();
    const rank = (category: string) => {
      const index = CATEGORY_ORDER.indexOf(category);
      return index === -1 ? CATEGORY_ORDER.length : index;
    };

    return Object.entries(this.live.typeCounts())
      .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b, 'de'))
      .map(([type, count]) => ({
        type,
        label: labelForCategory(type),
        count,
        color: colorForType(type),
        hidden: hidden.has(type),
      }));
  });

  protected toggleFilters(): void {
    this.filtersOpen.update((open) => !open);
  }
}
