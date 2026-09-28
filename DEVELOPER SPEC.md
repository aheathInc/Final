# African Digital Health Ecosystem — Developer Technical Specification

**Version 1.0 — MVP Build Scope**
**Prepared for:** Development team (2–4 engineers)
**Prepared by:** Lucas Paul Mashibe (Founder / Project Lead)

---

## 1. What We're Building

At its core, this is a **conventional hospital management system (HMS)** — patient records, appointments, and doctor–patient interaction — with a defined set of additional features layered on top to address specific, research-identified gaps in healthcare delivery. It is **not** a from-scratch reinvention of hospital software; standard HMS patterns apply everywhere except where this document says otherwise.

**Do not build toward the full continental vision in this phase.** The investor blueprint describes a 10+ year, continent-wide platform (wearable devices, AI professional networks, real-time disease surveillance, insurance integration, etc.). This spec describes only what a 2–4 person team builds for the **Tanzania pilot MVP**. Section 12 lists what is explicitly out of scope for now.

### 1.1 Problems This MVP Solves

| # | Problem | How the MVP addresses it |
|---|---|---|
| 1 | Long, invisible hospital queues | Real-time doctor availability + queue-length display before the patient commits to waiting |
| 2 | No post-treatment follow-up | In-system patient↔doctor messaging after treatment, with USSD/SMS fallback |
| 3 | Poor medication adherence | AI-generated medication reminders based on the doctor's prescription |
| 4 | Shortage of structured medical research data in Tanzania | A research-access layer over de-identified patient record data |
| 5 | Facility access barriers | Doctor search/booking from anywhere, not just walk-in |

---

## 2. User Roles

| Role | Primary use |
|---|---|
| **Patient** | Registers, views doctor availability/queue, books appointments, receives records, messages doctor post-treatment, gets medication reminders |
| **Doctor** | Manages availability status, sees queue, accesses patient history, documents consultations, messages patients post-treatment |
| **Hospital Admin** | Manages doctor accounts, facility profile, oversees patient flow at the facility level |
| **Researcher** (later in Phase 1, not day one) | Requests and receives access to de-identified aggregate patient data |
| **System Admin** | Platform-wide user and facility management, audit logs |

---

## 3. Core Modules (MVP)

### 3.1 Patient Registration & Digital Record
- Patient profile: demographics, allergies, chronic conditions, emergency contact.
- Longitudinal record: every visit, diagnosis, prescription, and note attached to one patient identity — this is what makes follow-up possible for patients **without** an assigned doctor (see 3.4).
- Record must be viewable by any authorized doctor who treats the patient, not just the doctor who created it.

### 3.2 Doctor Availability & Queue System
This is the first-impression feature and should be built early.

**Flow:**
1. Patient arrives at (or opens the app before heading to) a partner facility.
2. Patient browses doctors at that facility with real-time status: `Available` / `Busy — available in X min` / `Off duty`.
3. Each doctor's current queue length is shown alongside status.
4. Patient books into the queue or an appointment slot directly from this view.

**Data needed:** doctor status (manually toggled by doctor/admin, or inferred from active-consultation state), live queue count per doctor, estimated per-patient consultation time (can start as a static average, refine later).

### 3.3 Appointment Booking
- Standard slot-based or queue-based booking (queue-based is the priority for MVP given the primary use case above).
- Booking confirmation and reminder via app notification, with SMS fallback (see 3.6).

### 3.4 Post-Treatment Follow-Up Messaging
- After a consultation is marked complete, an in-system messaging thread opens between patient and the treating doctor.
- **Must work over USSD/SMS**, not only the smartphone app — this is a hard requirement, not optional, given the target facilities' user base includes feature-phone users.
- Continuity rule to implement in the data model: a patient's follow-up thread is tied to **the doctor who most recently treated them for that condition**, unless/until a "family doctor" assignment exists (flagged as a Phase 2 feature — see Section 12 — but the data model should not preclude it later).

### 3.5 AI Medication Reminders
- Doctor enters prescription (drug, dose, frequency, duration) as part of standard consultation documentation.
- System schedules reminders accordingly and delivers them through the patient's available channel (app push, SMS, or voice call where feasible).
- "AI" here, for MVP scope, means **rule-based scheduling from structured prescription data** — not a general medical AI model. Do not scope an LLM-based clinical assistant into MVP; that is explicitly Phase 2+ (Section 12).

### 3.6 Offline Sync & USSD/SMS Integration
Non-negotiable given target facility connectivity:
- **Offline-first client design**: patient check-in, queue updates, and record entry must queue locally and sync when connectivity returns. Do not assume constant connectivity anywhere in the architecture.
- **USSD/SMS gateway integration** (e.g. Africa's Talking or an equivalent local aggregator) for: appointment confirmations, follow-up messaging fallback, and medication reminders for feature-phone users.

### 3.7 Research Data Access Layer
- De-identification pipeline: strips patient-identifying fields before data is exposed to the research role.
- Researcher-facing query/export interface — even a simple filtered CSV export is sufficient for MVP; do not over-build this.
- Access must be logged and approvable by an admin — no open data access by default.

---

## 4. Data Model (Starting Point)

Core entities — refine with the team, but this is the minimum viable shape:

```
Patient (id, demographics, allergies, chronic_conditions, emergency_contact, created_at)
Doctor (id, name, specialty, facility_id, status, license_verified)
Facility (id, name, location, departments[])
Appointment (id, patient_id, doctor_id, facility_id, status, queue_position, created_at)
Consultation (id, appointment_id, diagnosis, notes, prescriptions[], completed_at)
Prescription (id, consultation_id, drug, dose, frequency, duration, reminder_schedule)
FollowUpMessage (id, patient_id, doctor_id, consultation_id, channel[app|sms|ussd], body, sent_at)
ResearchExportRequest (id, researcher_id, filters, approved_by, exported_at)
```

Note: `Consultation` and `FollowUpMessage` both reference `patient_id` directly (not just through `Appointment`) — this is what preserves continuity of care even as a patient moves between doctors and facilities.

---

## 5. Recommended Technical Approach

Given a 2–4 person team, prioritize **speed of iteration and low operational overhead** over architectural sophistication. Suggested starting stack (the team should validate against actual skills on hand):

- **Backend:** a single monolithic service to start (e.g. Node.js/Express or Django) — do not build microservices with a 4-person team; that overhead will slow you down, not speed you up.
- **Database:** PostgreSQL — relational integrity matters here (patient/doctor/appointment relationships), and it supports offline-sync conflict resolution patterns well.
- **Mobile/frontend:** a single cross-platform codebase (e.g. Flutter or React Native) rather than separate native iOS/Android builds — team size makes maintaining two native codebases impractical.
- **Offline sync:** local SQLite (or equivalent) on-device with a sync queue and conflict-resolution strategy (last-write-wins is acceptable for MVP; flag actual clinical-data conflicts for manual review rather than silently overwriting).
- **USSD/SMS:** integrate via a regional aggregator API rather than building carrier relationships directly.

---

## 6. Non-Functional Requirements

- **Connectivity:** every core patient-facing flow (check-in, queue view, follow-up message) must degrade gracefully offline and sync later. Test explicitly on simulated low/no-connectivity conditions, not just on office wifi.
- **Data protection:** patient records are sensitive by default — role-based access control from day one (a receptionist should not see clinical notes; a researcher should never see identifying fields). Do not treat this as a "add security later" item.
- **Auditability:** every access to a patient record should be logged (who, when) even in MVP — this is cheap to build now and expensive to retrofit.
- **Language:** UI copy should be built with localization in mind from the start (Swahili + English at minimum), even if only English ships first — avoid hardcoding strings in a way that blocks translation later.

---

## 7. Build Sequence (Suggested, for a 2–4 Person Team)

1. **Patient + Doctor + Facility registration**, basic auth, roles.
2. **Doctor availability & queue system** (Section 3.2) — this is the feature patients will notice first; get it solid early.
3. **Appointment/queue booking flow.**
4. **Consultation documentation** (diagnosis, notes, prescriptions) tied to the patient's longitudinal record.
5. **Offline sync layer** — do not leave this until the end; retrofitting offline support onto an online-only app is significantly harder than designing for it from the start.
6. **USSD/SMS integration** for booking confirmations and reminders.
7. **AI medication reminder scheduling** (rule-based, per Section 3.5).
8. **Post-treatment follow-up messaging**, with USSD/SMS fallback.
9. **Research data export layer** — lowest priority of the MVP scope; build last.

---

## 8. Pilot Facility Assumptions

- Target: a small number of partner facilities in Tanzania (urban + at least one lower-connectivity site to force-test offline behavior early).
- Patients will include both smartphone users and feature-phone-only users — every core flow needs a non-smartphone path.

---

## 9. Security & Privacy Baseline

Minimum bar for MVP, not the full framework described in the investor blueprint:
- Encrypted data in transit (TLS) and at rest.
- Role-based access control (Section 6).
- Audit logging on record access.
- No patient-identifying data in the research export layer.

Full-scale cybersecurity governance, formal AI ethics committees, and multi-country compliance frameworks are **Phase 2+ organizational work**, not MVP engineering tasks — don't let that scope creep into the sprint backlog.

---

## 10. What "AI" Means at Each Phase

To avoid scope confusion within the team:

- **MVP (now):** rule-based medication reminder scheduling from structured prescription data. No LLM, no diagnostic AI.
- **Phase 2:** AI-assisted symptom navigation (department routing) and a patient-facing health-education chat assistant — still recommendation-only, never a diagnosis.
- **Phase 3+:** clinical decision support for doctors, disease-trend analytics. Requires clinical validation and governance not yet built — do not attempt in MVP.

---

## 11. Explicitly In Scope for This MVP

- Patient registration & digital record
- Doctor availability/queue system
- Appointment booking
- Consultation documentation
- Post-treatment follow-up messaging (app + USSD/SMS)
- AI (rule-based) medication reminders
- Offline sync
- Basic research data export

## 12. Explicitly Out of Scope for This MVP (Phase 2+)

- Wearable sensor devices / public transport accident detection
- "One family, one doctor" / OB-GYN family assignment (design the data model to allow it later — see Section 4 note — but do not build the assignment logic or UI now)
- Continent-wide healthcare professional network
- Real-time disease surveillance dashboards
- Pharmacy availability search and drug-handoff codes
- Insurance/claims integration
- Telemedicine (video consultation)
- LLM-based clinical AI assistant or diagnostic support
- Multi-country/multi-language expansion beyond Tanzania pilot

---

## 13. Questions the Team Should Resolve Early

- Which USSD/SMS aggregator is available and affordable in Tanzania specifically?
- What is the actual connectivity profile at each pilot facility (test, don't assume)?
- Who verifies doctor licensing/registration for MVP — manual admin process is fine to start, but define it before launch.
- What is the data-retention and deletion policy for patient records — decide before, not after, the first patient registers.
