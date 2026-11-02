import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createResidenceSearch } from '../services/residence-search.service.js';

test('location search restricts Tanzania, deduplicates labels and caches without sending patient identity', async () => {
  let count = 0;
  const search = createResidenceSearch((async (url: URL, options: RequestInit) => {
    count++;
    assert.equal(url.searchParams.get('q'), 'Dodoma');
    assert.equal(url.searchParams.get('countrycode'), 'TZ');
    assert.equal(JSON.stringify(options).includes('patient-private-id'), false);
    const properties = { name: 'Dodoma', county: 'Dodoma City', state: 'Dodoma Region', country: 'Tanzania', countrycode: 'TZ' };
    return Response.json({ features: [
      { properties }, { properties },
      { properties: { name: 'Dodoma', countrycode: 'KE' } },
      { properties: { countrycode: 'TZ' } },
      { properties: { name: 'Dodoma Region', country: 'Tanzania', countrycode: 'TZ' } },
    ] });
  }) as typeof fetch);
  const result = await search({ q: ' Dodoma ' }, 'patient-private-id');
  assert.equal(result.places.length, 2);
  assert.equal(result.places[0]!.label, 'Dodoma, Dodoma City, Dodoma Region, Tanzania');
  assert.equal(result.attribution.url, 'https://www.openstreetmap.org/copyright');
  assert.deepEqual(await search({ q: 'dodoma' }, 'another-patient'), result);
  assert.equal(count, 1);
});

test('invalid queries never reach provider; provider failures stay recoverable and are not cached', async () => {
  let count = 0, time = 10000;
  const search = createResidenceSearch((async () => {
    count++;
    return count === 1 ? new Response('', { status: 503 }) : Response.json({ features: [] });
  }) as typeof fetch, () => time);
  for (const body of [{ q: 'Do' }, { q: 'x'.repeat(101) }, { q: 'Dodoma', latitude: 1 }]) await assert.rejects(() => search(body, 'test'));
  assert.equal(count, 0);
  await assert.rejects(() => search({ q: 'Dodoma' }, 'test'), { code: 'SERVICE_UNAVAILABLE', statusCode: 503 });
  time += 1000;
  assert.deepEqual((await search({ q: 'Dodoma' }, 'test')).places, []);
  assert.equal(count, 2);
});

test('concurrent matching searches share one provider request and new-query bursts are limited', async () => {
  let resolve!: (r: Response) => void;
  let count = 0;
  const search = createResidenceSearch((async () => {
    count++;
    if (count === 1) return new Promise<Response>(r => { resolve = r; });
    return Response.json({ features: [] });
  }) as typeof fetch, () => 10000);
  const a = search({ q: 'Dodoma' }, 'one');
  const b = search({ q: 'Dodoma' }, 'two');
  resolve(Response.json({ features: [] }));
  await Promise.all([a, b]);
  assert.equal(count, 1);
  await search({ q: 'Arusha' }, 'one');
  await assert.rejects(() => search({ q: 'Mwanza' }, 'one'), { code: 'RATE_LIMITED', statusCode: 429 });
  assert.equal(count, 2);
});
