import { Component, computed, inject, signal } from '@angular/core';
import { LiveVehiclesService } from './live-vehicles.service';
import { VehicleMap } from './vehicle-map/vehicle-map';
import { categoryRank, colorForType, labelForCategory } from './vehicle-palette';

@Component({
  selector: 'app-root',
  imports: [VehicleMap],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  host: {
    '(document:keydown.escape)': 'closeDialogs()',
  },
})
export class App {
  protected readonly live = inject(LiveVehiclesService);
  protected readonly filtersOpen = signal(false);
  protected readonly faqOpen = signal(false);
  protected readonly privacyOpen = signal(false);

  protected readonly activeFilterCount = computed(
    () => this.live.hiddenTypes().size + (this.live.selectedLine() ? 1 : 0),
  );

  protected readonly lineQuery = signal('');
  protected readonly lineListOpen = signal(false);
  protected readonly activeLineIndex = signal(0);

  protected readonly legend = computed(() => {
    const hidden = this.live.hiddenTypes();

    return Object.entries(this.live.typeCounts())
      .sort(([a], [b]) => categoryRank(a) - categoryRank(b) || a.localeCompare(b, 'de'))
      .map(([type, count]) => ({
        type,
        label: labelForCategory(type),
        count,
        color: colorForType(type),
        hidden: hidden.has(type),
      }));
  });

  protected readonly lineSuggestions = computed(() => {
    const query = this.lineQuery().trim().toLowerCase();
    const lines = this.live.lines().map((line) => ({
      ...line,
      label: labelForCategory(line.category),
    }));
    if (!query) {
      return lines;
    }

    const starts = lines.filter((line) => line.name.toLowerCase().startsWith(query));
    const contains = lines.filter(
      (line) =>
        !line.name.toLowerCase().startsWith(query) && line.name.toLowerCase().includes(query),
    );
    return [...starts, ...contains];
  });

  protected toggleFilters(): void {
    this.filtersOpen.update((open) => !open);
  }

  protected openFaq(): void {
    this.faqOpen.set(true);
  }

  protected closeFaq(): void {
    this.faqOpen.set(false);
  }

  protected onFaqBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.closeFaq();
    }
  }

  protected openPrivacy(): void {
    this.privacyOpen.set(true);
  }

  protected closePrivacy(): void {
    this.privacyOpen.set(false);
  }

  protected onPrivacyBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.closePrivacy();
    }
  }

  protected closeDialogs(): void {
    this.closeFaq();
    this.closePrivacy();
  }

  protected onLineQuery(event: Event): void {
    this.lineQuery.set((event.target as HTMLInputElement).value);
    this.activeLineIndex.set(0);
    this.lineListOpen.set(true);
    if (this.live.selectedLine()) {
      this.live.selectedLine.set(null);
    }
  }

  protected selectLine(name: string): void {
    this.live.selectedLine.set(name);
    this.lineQuery.set(name);
    this.lineListOpen.set(false);
  }

  protected clearLineSearch(): void {
    this.live.selectedLine.set(null);
    this.lineQuery.set('');
    this.activeLineIndex.set(0);
  }

  protected onLineKeydown(event: KeyboardEvent): void {
    const suggestions = this.lineSuggestions();
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.lineListOpen.set(true);
        this.activeLineIndex.update((index) => Math.min(index + 1, suggestions.length - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.activeLineIndex.update((index) => Math.max(index - 1, 0));
        break;
      case 'Enter': {
        const active = suggestions[this.activeLineIndex()] ?? suggestions[0];
        if (this.lineListOpen() && active) {
          this.selectLine(active.name);
        }
        break;
      }
      case 'Escape':
        this.lineListOpen.set(false);
        break;
    }
  }

  protected onSearchFocusout(event: FocusEvent): void {
    const container = event.currentTarget as HTMLElement;
    if (!container.contains(event.relatedTarget as Node | null)) {
      this.lineListOpen.set(false);
    }
  }
}
