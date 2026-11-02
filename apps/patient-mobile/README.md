# A-health patient app

Flutter, Android first. The app a patient uses to reach a clinician, follow
their treatment, and get help in an emergency.

## Running it

The Android and iOS platform folders are already included. From the repository
root:

```bash
cd apps/patient-mobile
flutter pub get
flutter run
```

### Android over USB (local backend)

Start the backend with `pnpm dev:local` from the repository root. Connect the
phone, enable USB debugging, and accept its debugging prompt. In PowerShell,
use the device serial shown by `adb devices -l`:

```powershell
$deviceSerial = '<DEVICE_SERIAL>'
foreach ($port in 4001..4025) {
  adb -s $deviceSerial reverse "tcp:$port" "tcp:$port"
}
cd apps/patient-mobile
flutter run -d $deviceSerial --dart-define=API_HOST=127.0.0.1
```

USB forwarding connects the phone's loopback ports to this computer's backend;
Wi-Fi is not required. Keep USB connected and repeat the forwarding commands
after reconnecting the phone or restarting ADB. Debug installs use the package
`com.example.a_health_patient.debug`. The local login screen offers
`Ingia kama tester wa ndani`, which requests and verifies a real development
OTP for the seeded local patient; it requires local OTP echo on the backend.

To verify the live backend from the connected phone, run from this directory:

```powershell
flutter test integration_test/patient_ai_navigation_live_test.dart -d $deviceSerial --dart-define=API_HOST=127.0.0.1
```

Run the normal `flutter run` command again afterward to restore the app entry
point in place of the test runner.

### Android over Wi-Fi

An Android emulator reaches your machine on `10.0.2.2`, not `localhost`.
A real phone connecting over Wi-Fi uses your computer's LAN IP, for example:

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
