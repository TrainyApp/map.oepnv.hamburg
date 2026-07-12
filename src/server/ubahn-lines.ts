import { along } from '@turf/along';
import { lineString } from '@turf/helpers';
import { nearestPointOnLine } from '@turf/nearest-point-on-line';
import lineData from './gen/ubahn-lines.json';
import { GeoCoordinate, SectionEndpoint } from './types/mosaic';
import { StoredLine } from './types/ubahn';

const MATCH_TOLERANCE_KM = 0.2;

const lines = (lineData as unknown as { lines: StoredLine[] }).lines
  .filter((l) => l.polyline.length >= 2)
  .map((l) => lineString(l.polyline.map(([lat, lon]) => [lon, lat])));

const cache = new Map<string, GeoCoordinate | null>();

export function sectionMidpoint(
  begin: SectionEndpoint,
  end: SectionEndpoint,
): GeoCoordinate | undefined {
  const key = begin.dhid <= end.dhid ? `${begin.dhid}|${end.dhid}` : `${end.dhid}|${begin.dhid}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached ?? undefined;

  let best: { line: (typeof lines)[number]; midLocation: number; dist: number } | undefined;
  for (const line of lines) {
    const pb = nearestPointOnLine(line, [begin.position.longitude, begin.position.latitude]);
    const pe = nearestPointOnLine(line, [end.position.longitude, end.position.latitude]);
    const dist = pb.properties.dist + pe.properties.dist;
    if (!best || dist < best.dist) {
      best = { line, dist, midLocation: (pb.properties.location + pe.properties.location) / 2 };
    }
  }

  let result: GeoCoordinate | null = null;
  if (best && best.dist / 2 <= MATCH_TOLERANCE_KM) {
    const [longitude, latitude] = along(best.line, best.midLocation).geometry.coordinates;
    result = { latitude, longitude };
  }

  cache.set(key, result);
  return result ?? undefined;
}
