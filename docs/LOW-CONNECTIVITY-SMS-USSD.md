# Low connectivity, SMS, and USSD

## Offline patient access

The patient app keeps a deliberately small SQLite cache. The medication
adherence schedule and signed consultation summaries are stored with the
authenticated patient account ID and shown with a cached-data label and the
last successful synchronization time. Cached data can be stale. Although the
local schema has a first-aid table, the app does not bundle or populate
first-aid content, so first-aid guidance is not currently available offline.
Appointments, check-in questions, full prescription details, messages, family
records, and other server data are not offline replicas; those views need a
live connection.

Only two patient writes enter the durable outbox: an adherence confirmation and
a response to a noncritical check-in. Each row stores its operation type,
account owner, payload, creation time, status, and a stable idempotency key. It
does not store credentials or authentication tokens. Sync sends the original
key through the existing batch API. A confirmed operation is removed; pending
and failed states remain visible in the patient UI.

Network, HTTP 429, and server failures receive at most three automatic
attempts, with 30- and 60-second delays before the second and third attempts.
After that, the row remains failed. Validation and other permanent 4xx failures
do not retry automatically. A patient can manually retry only failures marked
retryable. A 401 follows the app's normal refresh flow; an unsuccessful refresh
does not bypass authentication.

Consultation requests, appointments, messages, profile changes, screening,
consent, finance, prescriptions, and emergency requests require a live
connection. The emergency screen explicitly reports `ONLINE REQUEST
UNAVAILABLE` and does not queue or claim dispatch. AHP does not dispatch an
emergency vehicle.

Cache reads and outbox sync are scoped to the currently authenticated account.
Rows created by earlier unscoped app versions cannot be safely attributed, so
the local migration leaves them inaccessible to normal reads and sync. Logging
out does not reassign one patient's rows to another patient; a subsequent
account can only read and sync rows carrying its own account ID.

## SMS

The default development provider is `console`. It records a masked recipient
and message length, but does not print the body or deliver a telecom SMS. The
optional `http` provider requires a separately configured aggregator and is
not enabled by this milestone; no external credentials are supplied here.

Existing notification templates cover clinician assignment, completion,
adherence reminders, check-in reminders, and generic screening updates. The
templates avoid diagnoses, medication names/doses, test results, and note text.
The development OTP flow remains the auth service's development mechanism; it
is not evidence of carrier delivery.

The existing inbound SMS endpoint supports `1`/`2` as confirmation of the
patient's most recently due unreported adherence item (`taken`/`missed`). Other
text may be delivered to that patient's most recently updated open care thread
through the existing messaging API. Unknown or inactive numbers are ignored.
SMS is not a private channel; patients should not send sensitive details by
SMS. A local console-provider acceptance verifies template rendering and local
dispatch behavior only, not delivery to a handset or carrier.

## USSD

The repository contains a local USSD session engine behind the gateway's
provider-facing endpoint. It is not a telecom/carrier integration. Sessions
expire after the configured short TTL (180 seconds by default), are bound to
the initiating phone number, and terminate on a caller mismatch. A new or
expired session displays the menu without applying text that could have been
replayed from an earlier session.

The supported menu is:

- `1`: request medical help. The caller enters a short description (up to 500
  characters); the gateway resolves an active patient account from the phone
  number and submits through the ordinary consultation service.
- `2`: perform a consultation status lookup, then return a generic instruction
  to use the app for details.
- `0`: exit.

Unknown input returns the menu. Only active Patient accounts with a patient
profile receive the normal short-lived internal access token. The menu cannot
perform clinician/admin actions, payments/refunds, or prescription changes.
The help request contains health information and passes through the USSD
operator; use this flow only where that channel is approved. The local session
engine and database tests do not prove that a carrier shortcode is provisioned
or available.

## Acceptance limits

Local tests exercise the Flutter SQLite/outbox behavior, notification
templates/provider selection, and gateway USSD session rules. They do not
establish real SMS delivery, a carrier USSD connection, emergency dispatch, or
universal offline availability. Use the online app or an appropriate local
health service for operations outside the explicit offline boundary above.

## Android device acceptance

`ANDROID DEVICE ACCEPTANCE — BLOCKED BY LOCAL ANDROID INFRASTRUCTURE`. No
physical Android device was connected. The existing Android AVD booted far
enough to show its launcher, but the screen displayed
`System UI isn't responding` before AHP was launched; Android shell commands
also failed to respond. This diagnostic did not launch AHP and does not prove
or claim an Android offline end-to-end pass.
