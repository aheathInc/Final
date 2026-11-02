import { z } from 'zod';
import { AppError, rateLimited } from '@a-health/http';

export const residenceQuery = z.object({ q: z.string().trim().min(3).max(100) }).strict();
const source = { name: 'OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright' };
const featureCollection = z.object({ features: z.array(z.object({ properties: z.object({
  name: z.string().optional(), countrycode: z.string().optional(),
  district: z.string().optional(), city: z.string().optional(), county: z.string().optional(),
  state: z.string().optional(), country: z.string().optional(),
}) })) });

// A configurable Photon proxy: never send a patient's token, name, phone, or GPS upstream.
// This in-memory budget is per instance; production replicas need a shared gateway budget.
export function createResidenceSearch(fetcher: typeof fetch = fetch, clock = Date.now) {
  type Result = { places: { label: string; name: string; context: string }[]; attribution: typeof source };
  const cache = new Map<string, { value: Result; expires: number }>();
  const inFlight = new Map<string, Promise<Result>>();
  const callers = new Map<string, { start: number; count: number }>();
  let windowStart = 0, requests = 0;
  return async (raw: unknown, callerId: string): Promise<Result> => {
    const { q } = residenceQuery.parse(raw);
    const now = clock(), key = q.toLocaleLowerCase('en');
    const cached = cache.get(key);
    if (cached && cached.expires > now) return cached.value;
    if (cached) cache.delete(key);
    const pending = inFlight.get(key);
    if (pending) return pending;
    const caller = callers.get(callerId);
    const budget = caller && now - caller.start < 60_000 ? caller : { start: now, count: 0 };
    if (budget.count >= 40) throw rateLimited('Subiri kidogo kabla ya kutafuta eneo tena.');
    if (now - windowStart >= 1000) { windowStart = now; requests = 0; }
    if (requests >= 2 || inFlight.size >= 4) throw rateLimited('Subiri kidogo kabla ya kutafuta eneo tena.');
    budget.count++; requests++;
    if (callers.size >= 2000) {
      for (const [id, item] of callers) if (now - item.start >= 60_000) callers.delete(id);
      if (callers.size >= 2000) throw rateLimited();
    }
    callers.set(callerId, budget);
    const work = (async () => {
      try {
        const url = new URL(process.env.LOCATION_SEARCH_URL || 'https://photon.komoot.io/api/');
        if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname))) throw new Error('Invalid geocoder URL');
        if (url.hostname === 'nominatim.openstreetmap.org') throw new Error('Nominatim public autocomplete is not permitted');
        url.searchParams.set('q', q);
        url.searchParams.set('countrycode', 'TZ');
        url.searchParams.set('lang', 'en');
        url.searchParams.set('limit', '8');
        for (const layer of ['city', 'state', 'county', 'district', 'locality']) url.searchParams.append('layer', layer);
        const response = await fetcher(url, { signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'A-Health-ResidenceSearch/1.0', Accept: 'application/json' } });
        if (!response.ok) throw new Error('Geocoder unavailable');
        const data = featureCollection.parse(await response.json());
        const seen = new Set<string>();
        const places: Result['places'] = [];
        for (const { properties: p } of data.features) {
          if (p.countrycode?.toUpperCase() !== 'TZ' || !p.name?.trim()) continue;
          const parts = [...new Set([p.name, p.district, p.city, p.county, p.state, p.country].filter((s): s is string => !!s?.trim()).map(s => s.trim()))];
          const label = parts.join(', ');
          if (label.length > 250 || seen.has(label.toLowerCase())) continue;
          seen.add(label.toLowerCase());
          places.push({ label, name: p.name.trim(), context: parts.slice(1).join(', ') });
          if (places.length === 5) break;
        }
        const value = { places, attribution: source };
        if (cache.size >= 500) cache.delete(cache.keys().next().value!);
        cache.set(key, { value, expires: clock() + 24 * 60 * 60_000 });
        return value;
      } catch {
        throw new AppError('SERVICE_UNAVAILABLE', 503, 'Mapendekezo ya maeneo hayapatikani sasa. Unaweza kuandika eneo mwenyewe.');
      }
    })().finally(() => { inFlight.delete(key); });
    inFlight.set(key, work);
    return work;
  };
}

export const searchResidence = createResidenceSearch();
