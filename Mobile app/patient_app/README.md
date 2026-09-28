# A-health patient app

Flutter, Android first. The app a patient uses to reach a clinician, follow
their treatment, and get help in an emergency.

## Running it

The platform folders are not in this repository. Generate them once, then run:

```bash
cd apps/patient_app
flutter create .          # creates android/ ios/ for this package
flutter pub get
flutter run
```

An Android emulator reaches your machine on `10.0.2.2`, not `localhost`.
A real phone must use your computer's LAN IP, for example:

```bash
flutter run --dart-define=API_HOST=192.168.1.14
```

`lib/core/config.dart` uses that override for the Web development services.
The Web `gateway` service is for telecom integrations, not patient app traffic.
Against a public API gateway that fronts the patient endpoints:

```bash
flutter run --dart-define=API_GATEWAY_URL=https://api.example.tz
```

`auth` (4001) and `consultation` (4005) must be running to sign in and ask for
help; the other screens need their own services.

## Offline

The design names three things that must survive losing signal, and these are
the three that do:

| Cached | Why |
|---|---|
| Medication schedule | A reminder that only works online is not a reminder |
| Last consultation notes | The advice is needed most when the clinic is far |
| First-aid steps | Bundled in the app, never fetched — the moment they are needed is the moment the network is worst |

Writes made offline go to an **outbox** and are replayed through
`POST /sync/batch` when the connection returns. Each carries the `op_id` it was
created with as its `Idempotency-Key`, so replaying a partly-applied batch is
always safe.

Nothing is ever shown as sent when it is only queued. A message waiting to go
says so, because a patient who believes a clinician has read their answer will
wait instead of seeking help.

## Screens

Login (phone + OTP) · Home · Ask for help · Messages · Medications · Check-ins ·
Screening and risk · Vaccinations · Emergency · Profile, dependants and past
advice.

## Deliberate choices

- **Severity is a 1–10 slider, not words.** The triage engine weighs the
  number, and a slider gives everyone the same scale regardless of how they
  would describe pain.
- **Declining a screening invitation asks why.** The reason is what tells a
  programme whether uptake is limited by distance, cost, or fear.
- **Emergency location is omitted rather than faked.** Sending `0,0` would put
  an ambulance in the Atlantic; the dispatcher calls back instead. Wiring real
  GPS is the next change here.
- **Six dependencies.** APK size is a stated constraint: the target is a
  low-end Android phone on a metered connection, and every package is weight
  paid before the app has helped anyone once.
