import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LiveVehicle } from '../../shared/vehicle-types';
import { fetchVehicleJourneys } from '../mosaic';
import { fetchJourneyCourse } from '../geofox';
import { StationDeparture } from '../types/mosaic';
import { StoredLine } from '../types/ubahn';

try {
  process.loadEnvFile();
} catch {}

const UBAHN_TRANSIT_MODE = 'U';
const OUTPUT = join(process.cwd(), 'src/server/gen/ubahn-lines.json');

async function main(): Promise<void> {
  const apiKey = process.env['MOSAIC_API_KEY'];
  if (!apiKey) throw new Error('MOSAIC_API_KEY nicht gesetzt (.env)');

  const { departures } = await fetchVehicleJourneys(apiKey);
  const ubahn = departures.filter((d) => d.departure.line?.transitMode === UBAHN_TRANSIT_MODE);

  const variants = new Map<string, StationDeparture>();
  for (const d of ubahn) {
    const key = `${d.departure.line?.name ?? '?'}|${d.departure.direction?.passengerDestination ?? '?'}`;
    if (!variants.has(key)) variants.set(key, d);
  }
  console.log(`ubahn-gen: ${ubahn.length} U-Bahn-Abfahrten, ${variants.size} Varianten`);

  const out: StoredLine[] = [];
  for (const [variant, dep] of variants) {
    try {
      const course = await fetchJourneyCourse({} as LiveVehicle, dep);
      if (course.path.length < 2) {
        console.warn(`ubahn-gen: "${variant}" ohne Polyline übersprungen`);
        continue;
      }
      out.push({
        line: dep.departure.line?.name ?? course.lineName,
        destination: dep.departure.direction?.passengerDestination ?? course.destination,
        polyline: course.path,
      });
      console.log(`ubahn-gen: "${variant}" -> ${course.path.length} Punkte`);
    } catch (err) {
      console.warn(`ubahn-gen: "${variant}" fehlgeschlagen: ${(err as Error).message}`);
    }
  }

  out.sort((a, b) => `${a.line}|${a.destination}`.localeCompare(`${b.line}|${b.destination}`));
  writeFileSync(OUTPUT, JSON.stringify({ lines: out }, null, 2) + '\n', 'utf8');
  console.log(`ubahn-gen: ${out.length} Linienverläufe geschrieben -> ${OUTPUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
