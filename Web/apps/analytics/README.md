# Public health analytics portal — A-health

The read-only portal a public health partner uses: disease trends by area, and
aggregate queries over de-identified datasets.

## Running it

```bash
cp .env.local.example .env.local
openssl rand -base64 32          # NEXTAUTH_SECRET
pnpm install
pnpm --filter analytics-portal dev
```

Then http://localhost:3300. Needs `surveillance` (4020) and `research` (4019)
running, plus `auth` (4001). Sign in with a `researcher` or `platform_admin`
account.

## Screens

| Route | What it does |
|---|---|
| `/surveillance` | Ranked condition counts by area; click a row for its trend |
| `/research` | Datasets and their privacy thresholds; run an aggregate query |
| `/research/[id]` | Results, with suppressed-cell count stated |

## What this deliberately shows as empty

Three columns are always blank, and that is correct rather than broken:

- **`rate_per_100k`** — no population denominator is wired.
- **`change_percent`** — no historical baseline is computed.
- **The expected band on a trend** — no forecasting model is deployed
  (Prophet is registered but `not_deployed`).

Each is rendered as an em dash. Filling them from the data itself would invent
a baseline and make an ordinary week look like an outbreak signal, which on a
surveillance screen is the expensive kind of wrong.

## Privacy

Suppressed cells are **reported, not hidden**. A researcher who does not know a
cell was removed reads the total as complete, and the entire reason the
threshold exists is that a count of one in a district is an identity.

The group-by options are the backend's allow-list, offered as checkboxes rather
than free text: the allow-list is what makes the dataset safe, and a free field
would suggest the boundary is negotiable.

## Charting

The trend chart is plain SVG, not a charting library. The series is a handful
of daily counts, and shipping a rendering engine to draw a polyline is weight
this audience — often on a slow connection — would pay for nothing.
