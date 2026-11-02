# Health & Regional Insights

The unified staff portal exposes this module at `/admin/dashboard` and the focused
`/admin/insights` route. The heading uses a capital **R**. It preserves the existing
A-Health green/teal palette and shares the heart/pulse BrandMark between sign-in and
the staff shell. Existing department home routing remains authoritative for all
seven staff roles; only platform administrators can enter these admin routes.

## Source and publication

The main view is disease-first. Selecting a region, district or other recorded
area shows its disease ranking and per-disease monthly series. Rank by latest
published case count or largest percentage increase. Each row shows latest and
previous month counts, absolute/percentage change, and total cases over the
selected period. The chart follows the first three diseases in that ranking.
Selecting a disease filters the geographic map and cross-area comparison; the
all-diseases area table also shows each area's leading disease in the latest month.

Month-to-month change requires published counts for both the latest month in the
view and its immediately preceding calendar month within the selected range.
A suppressed count, absent month or one-month view produces unavailable change,
not a zero baseline, new-case claim or outbreak alert. Percentage change is rounded
to one decimal. These comparisons describe published service cases and can change
with reporting coverage; they do not establish population disease prevalence.

The source is existing signed A-Health consultation notes, grouped by their UTC
signing month and recorded patient administrative area. This is service activity,
not a population prevalence estimate. A case is one signed consultation per
diagnosis code; duplicate occurrences of a code in a note count once. Names come
from unambiguous existing standard ICD10/ICD11 condition mappings; otherwise the
diagnosis code is shown. Free-text diagnosis narratives are never published.

An active platform administrator opens **Manage authorized monthly reports**,
selects a completed month, confirms the data is authorized for this purpose, and
publishes it. Both publication and catalogue import are audited. The server
rechecks the administrator's current database role and active status, including
when the token still contains an old role. Months before 2020, current months and
future months cannot be published.

A monthly release is immutable and idempotent, including concurrent requests.
Later notes, corrections or catalogue imports do not rewrite a published release.
This deliberately trades live updates for stable privacy protection. Review
geography before publication. No report is automatically published by deployment.
On 26 October 2026 the local database contained signed notes only in October 2026;
there was therefore no completed month eligible for an initial report.

## Small-cell protection

Each base cell is `(month, recorded area, diagnosis code)`. It contributes only
when it contains at least **10 distinct patient profiles**. Multiple consultations
from one patient cannot satisfy this threshold. The outgoing snapshot contains
case counts, never patient counts, identifiers, notes, birth dates or coordinates
from patient profiles.

All filters, parents, comparison tables, maps and trend series sum exactly the
same already-published cells. There is no separately computed raw parent disease
total that could reveal a hidden child by subtraction. Missing and suppressed
cells are both represented as unavailable; they are never labelled zero. Trend
gaps stay null and lines do not bridge them. Totals exclude withheld cells.

The older `/surveillance/conditions` and `/surveillance/trends` APIs also read
these releases. Their date filters select whole months; `national` aliases
`country`. Expected bounds and model version are null; no outbreak prediction is
fabricated. The operational admin analytics endpoint no longer exposes live
disease counts. Raw daily rollups remain internal to the existing worker.

## Recorded geography

The hierarchy is **Country → Region → District → Ward → Village**. A profile may
link to any recorded level via optional `reporting_area_code`. Its ancestors come
only from the authorized catalogue. Existing valid region codes continue to work:
when they have no matching catalogue region, the report preserves the code as
`recorded-region:<code>` with unknown country and null coordinates. It never
guesses a district, ward, village, country name or centroid. Profiles without a
usable area contribute only to eligible unlocated cells.

The authenticated, clinical-data-free `GET /surveillance/reporting-areas` endpoint
lists the catalogue. The existing patient profile update endpoint accepts
`reporting_area_code` (an existing catalogue code), or null to clear it, under its
normal ownership/role/version checks. This change does not add a mobile address
editor or bulk infer addresses for existing profiles.

Administrators can optionally import an authorized JSON file under **Import an
administrative geography catalogue**. For example, the following is an
illustrative format only, not a dataset to import into real records:

```json
{
  "source": "Authorized catalogue name and version",
  "administrative_centroids_confirmed": true,
  "areas": [
    { "code": "EX", "name": "Example country", "level": "country", "parent_code": null },
    { "code": "EX-R", "name": "Example region", "level": "region", "parent_code": "EX" }
  ]
}
```

Imports accept up to 1,000 areas per batch (the UI limits files to 1 MB). Each
non-country requires a parent at the preceding level in the catalogue or same
batch. Codes are unique; existing metadata cannot be overwritten. Coordinates are
optional, but latitude and longitude must both be supplied or both absent. The
confirmation explicitly requires administrative centroids, never home locations.
The `recorded-region:` prefix is reserved for preserved legacy codes.

The interactive map uses OpenStreetMap raster tiles through Leaflet 1.9.4.
Open **Fullscreen map** to fill the browser viewport, or go directly to
`/admin/insights?map=fullscreen`. The fullscreen view keeps disease/location/month
filters available, supports keyboard/touch area selection, pan, zoom and fit-to-area,
and exits with Escape or **Exit fullscreen**. Focus returns to the opening button.
It resizes when filters open or the device rotates and stays open during filtering.

Only publishable areas with recorded administrative centroids receive count markers.
Unknown coordinates are not inferred. With no eligible reports, the world basemap
still opens without clinical markers. OpenStreetMap attribution remains visible in
normal and fullscreen modes. Tile failures have a retry state; the aggregate tables
remain available. Only standard tile coordinates are requested from the provider;
patient coordinates, diagnosis codes, case counts and API credentials are not sent.

The default tile URL is `https://tile.openstreetmap.org/{z}/{x}/{y}.png`. The optional
`NEXT_PUBLIC_OSM_TILE_URL` build-time environment variable can point to a suitable
OSM-compatible tile service; rebuild the web app after changing it. Keep required
provider attribution when changing service. Browser caching and referrer headers
are retained, with no offline tile download or prefetch feature. Follow the
[OpenStreetMap tile usage policy](https://operations.osmfoundation.org/policies/tiles/).
Leaflet documentation: https://leafletjs.com/reference.html.

## API and deployment

- `GET /surveillance/regional-insights`: active administrator, no-store; filters
  `from`, `to` (YYYY-MM), `area`, `condition`, and `level` (default region).
- `POST /surveillance/regional-insights/releases`: `{ "period": "YYYY-MM" }`.
- `GET /surveillance/reporting-areas`: authenticated administrative catalogue.
- `POST /surveillance/reporting-areas`: active administrator catalogue import.

The OpenAPI contract and generated TypeScript schema include these APIs, nullable
trend counts and the optional patient geography link. Apply migration
`20261026100000_regional_insights`, regenerate Prisma, then restart services using
the new client. This migration was applied to the local development database.

## Verification

- 18 isolated-database surveillance tests cover distinct-patient suppression,
  duplicate diagnoses, role revocation, import validation, immutable/concurrent
  publication, legacy codes, compatibility readers, null gaps, region/district
  disease changes, unavailable comparisons and rollup behavior.
- 26 verification tests cover department routing, cross-department denial and
  operational aggregate disclosure behavior.
- `verification/regional-insights-browser.cjs` checks real local administrator
  login/API access and doctor denial, then uses clearly labelled browser-only
  synthetic aggregates for five-level filters, map selection, comparisons,
  responsive light/dark, empty/error/retry states. No synthetic clinical counts
  are inserted into the live database. Its marked review account is suspended
  after testing.
- `verification/insight-map-browser.cjs` uses synthetic clinical aggregates and
  real OpenStreetMap tiles to check fullscreen desktop/mobile/dark layouts, retained
  filters, markers, attribution, zoom, Escape/focus return, direct URLs, no-data and
  tile-error recovery states. No clinical fixtures are written to the live database.
- Surveillance and patient TypeScript builds and staff/analytics portal type
  checks are required. OpenAPI generation validates schema references.

The isolated database helper `.local/regional-db.cjs --test` is local-only and
creates an owned test schema. Do not run clinical fixture tests against production.
