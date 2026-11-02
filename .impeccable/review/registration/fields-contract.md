# Registration field corrections

Ordinary refinement of existing A-Health Flutter Android registration in Operate mode. Preserve incumbent Material/teal theme and surrounding flow. User asked for live place suggestions while typing (example Dodoma) and correction of a false date-of-birth error.

Residence: Tanzania place suggestions after three characters and 650 ms idle, at most five named places with distinguishing context, OSM attribution, loading/empty/failure states, and manual text fallback. Only a place query goes through authenticated enrollment proxy to configurable Photon, without identity/token/GPS. Selection fills residence text only, never invents administrative records. Stale responses are ignored.

DOB: visible DD/MM/YYYY text field with optional native year/calendar picker. One shared controller for typed and picked date; server receives YYYY-MM-DD. DOB, sex and consent have independent errors, and first invalid field scrolls into view. Missing consent must not blame an already valid date. Keep profile draft on errors.

Primary sources: apps/patient-mobile/lib/screens/registration_screen.dart and lib/widgets/residence_field.dart. Evidence: registration/native/profile-top.png, residence-suggestions.png, registration-consent-validation.png, profile-contact.png and registration-fee.png from current source on physical Pixel 4. Synthetic integration responses are labelled test evidence, not a real patient. Native test checks typed date, calendar confirmation, place selection and consent regression. Widget tests also cover debounce, late responses, unavailable search and invalid dates. Live Photon smoke returned genuine Dodoma labels separately.

No new world/comp, browser detector, or global design documents. PRODUCT.md and DESIGN.md remain absent pre-existing; SKILL.md's incumbent-refinement routing exception applies. Review supplied native evidence and source only, no rendering or edits. UI copy and native Material controls remain authoritative.
