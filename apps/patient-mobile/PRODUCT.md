# A-Health Patient App — Product Direction

## Product purpose

A-Health Patient helps people in Tanzania reach care and manage the patient
workflows already supported by the platform. It is a Swahili-first mobile
client for finding facilities, starting and following consultations, viewing
available care information, and using the platform's patient services.

The app presents clinical information returned by A-Health services. It does
not diagnose a patient or replace a clinician. The in-app assistant is a
navigation aid and is labelled accordingly.

## Approved experience

The approved direction is **Premium Modern Healthcare UI A**. It should feel
calm, clear, contemporary and dependable, while retaining A-Health's existing
petrol, mint and warm-paper identity. Premium styling must make patient tasks
easier to find without changing what a workflow means or what the service
reports.

The patient can select Kiswahili, English or French for the authored interface;
Kiswahili is the default. Appearance offers System, Light and Dark, with System
as the default and the existing dedicated dark palette retained. Both choices
persist on the device, work offline and apply without restarting the app.
Aurora gradients, refined Bento Cards, readable typography, restrained motion,
responsive navigation and accessibility remain part of the approved direction.

Core experience principles:

- Put the next useful action first: find a facility, start a consultation, or
  access emergency care.
- Keep all current patient destinations reachable from the responsive home
  navigation and service list.
- Show server-provided visit states as supplied; do not infer urgency,
  completion or clinical outcomes from presentation alone.
- Make offline limits explicit. Cached medicines and advice remain readable;
  queued changes stay marked as pending until the server confirms them.
- Keep authentication, API ownership, consent, emergency and clinical safety
  behavior in their existing flows.
- Prefer concise labels in the patient's selected interface language and
  familiar Material controls with accessible touch areas.

## Current workflows

The app currently includes authentication by SMS one-time code; facility
search; consultations and consultation details; appointments; emergency
requests; medicines; diagnostics; check-ins; screening; vaccinations; family
and dependant services; education; referrals; care continuity; front desk;
health history; consent and privacy; feedback; insurance and payments; and
profile management. Consultation conversations open from their related visit.

Language and appearance settings are reachable from Profile and the login
globe icon before authentication. Interface translation preserves clinical
records, patient/clinician-authored content and parameter values; server-authored
medical articles remain in their source language. The profile's preferred
communication language is separate account metadata, not the device UI setting.

The Patient App currently uses Dio/REST, secure session storage, SQLite,
connectivity state and an offline outbox. It does not currently depend on
Riverpod or GraphQL. The V2 visual layer adds no packages and does not replace
these integrations.

## Product boundaries

- Do not replace backend responses with illustrative health data.
- Do not convert an unavailable or unverified state into an empty or completed
  state.
- Do not make emergency controls look like ordinary decorative actions.
- Do not expose development OTP conveniences in profile or release builds.
- Do not suggest that local pending work has been accepted by the server.
