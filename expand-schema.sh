#!/usr/bin/env bash
#
# Expands packages/database from 24 models to cover every domain in the
# restored contract: facilities and departments, the AI layer with its
# inference log, emergency and transport, devices and telemetry, prevention,
# pharmacy and dispensing, diagnostics, the professional network, education,
# families, research, surveillance, insurance, and quality.
#
# One migration, now, while the database is still development-only and holds no
# real data. Retrofitting `version` and `updated_at` onto a live clinical
# database is painful and avoidable — that is why every mutable model here has
# them from the start.
#
# Run from the repo root:
#   bash expand-schema.sh
#
set -euo pipefail

ROOT="$(pwd)"
SCHEMA="$ROOT/packages/database/prisma/schema.prisma"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$SCHEMA" ] || { echo "Schema not found at $SCHEMA"; exit 1; }

cp "$SCHEMA" "$SCHEMA.pre-expand"
echo "backed up to schema.prisma.pre-expand"

node - "$SCHEMA" << 'NODE'
const fs = require('fs');
const path = process.argv[2];
let s = fs.readFileSync(path, 'utf8');

if (s.includes('model AiConversation')) {
  console.log('  already expanded, nothing to do');
  process.exit(0);
}

// Insert lines just before a model's closing brace. Matching `\n}` at column
// zero is safe because Prisma attribute values like @default("{}") never put a
// brace at the start of a line.
function addToModel(name, lines) {
  const re = new RegExp(`(model ${name} \\{[\\s\\S]*?)(\\n\\})`);
  if (!re.test(s)) throw new Error(`model not found: ${name}`);
  s = s.replace(re, (_m, body, close) => `${body}\n${lines}${close}`);
}

function addToEnum(name, values) {
  const re = new RegExp(`(enum ${name} \\{[\\s\\S]*?)(\\n\\})`);
  if (!re.test(s)) throw new Error(`enum not found: ${name}`);
  s = s.replace(re, (_m, body, close) => `${body}\n${values}${close}`);
}

// ---------------------------------------------------------------------------
// Existing enums gain values
// ---------------------------------------------------------------------------
addToEnum('UserRole', '  researcher\n  dispatcher_supervisor');
addToEnum('FacilityType', '  laboratory\n  imaging_centre');

// ---------------------------------------------------------------------------
// Existing models gain fields
// ---------------------------------------------------------------------------
addToModel('Facility', `
  /// How deeply this facility is connected. \`none\` is honest and common: a
  /// facility with no integration must report no queue rather than a guess.
  integrationLevel IntegrationLevel @default(none) @map("integration_level")`);

addToModel('ClinicianProfile', `
  /// Families this clinician carries under the family-doctor tier. Bounded, so
  /// the promise has a delivery mechanism rather than being a slogan.
  familyLoad    Int @default(0) @map("family_load")
  maxFamilyLoad Int @default(0) @map("max_family_load")`);

// ---------------------------------------------------------------------------
// Back-relations on existing models
// ---------------------------------------------------------------------------
addToModel('User', `
  aiConversations   AiConversation[]
  incidentReports   IncidentReport[]
  researchQueries   ResearchQuery[]
  emergencyReports  EmergencyRequest[]  @relation("EmergencyReporter")`);

addToModel('PatientProfile', `
  riskScores            RiskScore[]
  screeningInvitations  ScreeningInvitation[]
  vaccinations          Vaccination[]
  devices               Device[]
  emergencyRequests     EmergencyRequest[]
  investigationOrders   InvestigationOrder[]
  familyMemberships     FamilyMember[]
  insuranceMemberships  InsuranceMembership[]`);

addToModel('ClinicianProfile', `
  discussions            Discussion[]
  discussionReplies      DiscussionReply[]
  communityMemberships   CommunityMembership[]
  secondOpinionsAsked    SecondOpinion[]      @relation("OpinionRequester")
  secondOpinionsAnswered SecondOpinion[]      @relation("OpinionAnswerer")
  ratings                ConsultationRating[]
  familyGpAssignments    FamilyAssignment[]   @relation("FamilyGp")
  familyObgynAssignments FamilyAssignment[]   @relation("FamilyObgyn")
  investigationOrders    InvestigationOrder[]
  incidentReports        IncidentReport[]`);

addToModel('CareThread', `
  investigationOrders InvestigationOrder[]
  secondOpinions      SecondOpinion[]
  discussions         Discussion[]
  aiConversations     AiConversation[]`);

addToModel('Facility', `
  departments         Department[]
  transportUnits      TransportUnit[]
  investigationOrders InvestigationOrder[]
  vaccinations        Vaccination[]
  incidentReports     IncidentReport[]
  emergencyArrivals   EmergencyRequest[]   @relation("EmergencyDestination")`);

addToModel('ConsultationRequest', `
  rating          ConsultationRating?
  insuranceClaims InsuranceClaim[]
  incidentReports IncidentReport[]`);

addToModel('Prescription', `
  dispenseCodes     DispenseCode[]
  dispensingRecords DispensingRecord[]`);

addToModel('PrescriptionItem', `
  dispensingItems DispensingItem[]`);

// ---------------------------------------------------------------------------
// New enums and models
// ---------------------------------------------------------------------------
s = s.trimEnd() + '\n' + String.raw`
// ===========================================================================
// Enums for the expanded domains
// ===========================================================================

enum IntegrationLevel {
  none
  partial
  full
  platform_operated
}

enum AiAudience {
  patient
  clinician
}

enum AiMessageRole {
  user
  assistant
  system
}

enum AiModelStatus {
  active
  shadow
  retired
  not_deployed
}

enum AiInferenceKind {
  chat
  triage
  drug_interaction
  transcription
  synthesis
  risk_score
  image_analysis
  anomaly_detection
  forecast
}

enum EmergencyScale {
  individual
  mass_casualty
}

enum EmergencyCategory {
  medical
  trauma
  obstetric
  road_traffic
  fire
  other
}

enum EmergencySource {
  patient_app
  bystander
  ussd
  sms
  voice
  wearable
  vehicle_sensor
  facility
}

enum EmergencyStatus {
  reported
  triaged
  dispatched
  en_route
  arrived
  resolved
  cancelled
}

enum EmergencyOutcome {
  transported
  treated_on_scene
  refused_care
  false_alarm
  deceased
}

enum TransportStatus {
  available
  dispatched
  en_route
  at_scene
  transporting
  out_of_service
}

enum TransportCapability {
  basic
  advanced
  neonatal
  mass_casualty
}

enum DeviceType {
  wearable_watch
  vehicle_sensor
  bp_monitor
  glucometer
  pulse_oximeter
}

enum DeviceStatus {
  active
  revoked
  lost
}

enum TelemetryMetric {
  heart_rate
  spo2
  systolic
  diastolic
  glucose
  temperature
  steps
  motion
  impact_g
}

enum DeviceAlertType {
  fall_detected
  collision_detected
  heart_rate_abnormal
  spo2_low
  no_motion
  manual_trigger
}

enum DeviceAlertStatus {
  raised
  acknowledged
  escalated
  false_positive
  resolved
}

enum AlertRecipientType {
  treating_clinician
  family_doctor
  emergency_department
  relative
  patient
}

enum RiskBand {
  low
  moderate
  high
  very_high
}

enum InvitationStatus {
  pending
  accepted
  declined
  deferred
  completed
  expired
}

enum VaccinationStatus {
  due
  overdue
  administered
  contraindicated
}

enum StockStatus {
  in_stock
  low_stock
  out_of_stock
  unknown
}

enum DispensingStatus {
  pending
  partial
  complete
  cancelled
}

enum InvestigationType {
  laboratory
  imaging
  pathology
  point_of_care
}

enum InvestigationStatus {
  ordered
  scheduled
  collected
  resulted
  acknowledged
  cancelled
}

enum ResultFlag {
  normal
  low
  high
  critical_low
  critical_high
}

enum SecondOpinionStatus {
  open
  claimed
  answered
  withdrawn
}

enum ContentFormat {
  article
  audio
  video
  interactive
  sms_series
}

enum EducationCategory {
  communicable
  non_communicable
  maternal_child
  mental_health
  prevention
  nutrition
}

enum ReadingLevel {
  basic
  intermediate
  advanced
}

enum SubscriptionTier {
  none
  family_basic
  family_plus
}

enum FamilyRelationship {
  head
  spouse
  child
  parent
  sibling
  dependant
  other
}

enum ResearchQueryStatus {
  queued
  running
  complete
  failed
  rejected
}

enum GeoLevel {
  ward
  district
  region
  national
  continental
}

enum MembershipStatus {
  active
  lapsed
  suspended
  unknown
}

enum ClaimStatus {
  submitted
  under_review
  approved
  rejected
  paid
}

enum IncidentCategory {
  clinical_care
  misconduct
  medication_error
  delayed_response
  data_privacy
  ai_error
  other
}

enum IncidentSeverity {
  low
  moderate
  serious
  catastrophic
}

enum IncidentStatus {
  reported
  under_investigation
  action_taken
  closed
}

// ===========================================================================
// Facilities
// ===========================================================================

model Department {
  id         String    @id @default(uuid()) @db.Uuid
  facilityId String    @map("facility_id") @db.Uuid
  facility   Facility  @relation(fields: [facilityId], references: [id], onDelete: Cascade)
  name       String    @db.VarChar(150)
  specialty  Specialty?
  isActive   Boolean   @default(true) @map("is_active")

  version   Int      @default(1)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@unique([facilityId, name])
  @@map("departments")
}

// ===========================================================================
// AI layer
// ===========================================================================

/// The register the AI governance committee reviews. Every model the platform
/// deploys appears here, including ones not yet in service — a model with no
/// recorded validation must be visible as such rather than absent.
model AiModel {
  id            String        @id @default(uuid()) @db.Uuid
  key           String        @unique @db.VarChar(60)
  displayName   String        @map("display_name") @db.VarChar(120)
  function      String        @db.VarChar(200)
  version       String        @db.VarChar(40)
  status        AiModelStatus @default(not_deployed)
  runtime       String?       @db.VarChar(60)
  contextNotes  String?       @map("context_notes")

  lastValidatedAt  DateTime? @map("last_validated_at")
  accuracySummary  String?   @map("accuracy_summary")
  biasReviewAt     DateTime? @map("bias_review_at")
  governanceNotes  String?   @map("governance_notes")
  approvedById     String?   @map("approved_by_id") @db.Uuid

  inferences AiInference[]

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@index([status])
  @@map("ai_models")
}

model AiConversation {
  id     String @id @default(uuid()) @db.Uuid
  userId String @map("user_id") @db.Uuid
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  audience     AiAudience
  careThreadId String?     @map("care_thread_id") @db.Uuid
  careThread   CareThread? @relation(fields: [careThreadId], references: [id], onDelete: Restrict)

  language     LanguageCode @default(sw)
  channel      Channel      @default(app)
  modelVersion String       @map("model_version") @db.VarChar(60)
  closedAt     DateTime?    @map("closed_at")

  messages AiMessage[]

  version   Int      @default(1)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@index([userId, createdAt])
  @@index([careThreadId])
  @@map("ai_conversations")
}

model AiMessage {
  id             String         @id @default(uuid()) @db.Uuid
  conversationId String         @map("conversation_id") @db.Uuid
  conversation   AiConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  role AiMessageRole
  body String

  /// Guideline passages the answer drew on. An unsourced clinical answer is
  /// not one a clinician can rely on or a committee can review.
  citations Json @default("[]")

  /// True when a red flag was recognised. The client must surface urgent-care
  /// guidance rather than continuing the conversation.
  escalated       Boolean @default(false)
  escalationReason String? @map("escalation_reason")

  modelVersion String?  @map("model_version") @db.VarChar(60)
  latencyMs    Int?     @map("latency_ms")

  version   Int      @default(1)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@index([conversationId, createdAt])
  @@map("ai_messages")
}

/// Every model call, logged. This is what makes continuous accuracy and bias
/// monitoring possible: without a record of inputs, outputs and the version
/// that produced them, there is nothing to audit after a bad recommendation.
model AiInference {
  id      String  @id @default(uuid()) @db.Uuid
  modelId String  @map("model_id") @db.Uuid
  model   AiModel @relation(fields: [modelId], references: [id], onDelete: Restrict)

  kind         AiInferenceKind
  subjectType  String?         @map("subject_type") @db.VarChar(60)
  subjectId    String?         @map("subject_id") @db.Uuid
  requestedById String?        @map("requested_by_id") @db.Uuid

  /// Hashed rather than stored: enough to prove which input produced which
  /// output, without keeping a second copy of clinical text.
  inputHash    String  @map("input_hash") @db.VarChar(64)
  outputSummary Json   @default("{}") @map("output_summary")
  confidence   Float?
  latencyMs    Int?    @map("latency_ms")

  /// Set when a clinician overrode the model. The disagreement rate is the
  /// single most useful signal about whether a model is helping.
  overridden       Boolean @default(false)
  overrideReason   String? @map("override_reason")

  createdAt DateTime @default(now()) @map("created_at")

  @@index([modelId, createdAt])
  @@index([kind, createdAt])
  @@index([overridden, createdAt])
  @@map("ai_inferences")
}

// ===========================================================================
// Emergency and transport
// ===========================================================================

model EmergencyRequest {
  id       String            @id @default(uuid()) @db.Uuid
  scale    EmergencyScale
  category EmergencyCategory @default(other)
  source   EmergencySource
  status   EmergencyStatus   @default(reported)
  outcome  EmergencyOutcome?

  patientProfileId String?         @map("patient_profile_id") @db.Uuid
  patient          PatientProfile? @relation(fields: [patientProfileId], references: [id], onDelete: Restrict)

  reportedByUserId String? @map("reported_by_user_id") @db.Uuid
  reportedBy       User?   @relation("EmergencyReporter", fields: [reportedByUserId], references: [id], onDelete: Restrict)
  reporterPhone    String? @map("reporter_phone") @db.VarChar(20)

  lat Float
  lng Float

  estimatedCasualties Int?    @map("estimated_casualties")
  description         String?

  transportUnitId String?        @map("transport_unit_id") @db.Uuid
  transportUnit   TransportUnit? @relation(fields: [transportUnitId], references: [id], onDelete: Restrict)

  destinationFacilityId String?   @map("destination_facility_id") @db.Uuid
  destinationFacility   Facility? @relation("EmergencyDestination", fields: [destinationFacilityId], references: [id], onDelete: Restrict)

  deviceAlertId String? @unique @map("device_alert_id") @db.Uuid

  reportedAt   DateTime  @default(now()) @map("reported_at")
  dispatchedAt DateTime? @map("dispatched_at")
  arrivedAt    DateTime? @map("arrived_at")
  resolvedAt   DateTime? @map("resolved_at")

  events EmergencyEvent[]

  version   Int      @default(1)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  /// The dispatcher's working queue: open emergencies, most urgent first.
  @@index([status, reportedAt])
  @@index([destinationFacilityId, status])
  @@index([updatedAt])
  @@map("emergency_requests")
}

/// The timeline. An emergency that simply disappears from a screen is the
/// failure this subsystem exists to prevent, so every transition is a row.
model EmergencyEvent {
  id          String           @id @default(uuid()) @db.Uuid
  emergencyId String           @map("emergency_id") @db.Uuid
  emergency   EmergencyRequest @relation(fields: [emergencyId], references: [id], onDelete: Cascade)

  fromStatus EmergencyStatus? @map("from_status")
  toStatus   EmergencyStatus  @map("to_status")
  actorUserId String?         @map("actor_user_id") @db.Uuid
  notes      String?

  occurredAt DateTime @default(now()) @map("occurred_at")

  @@index([emergencyId, occurredAt])
  @@map("emergency_events")
}

model TransportUnit {
  id         String              @id @default(uuid()) @db.Uuid
  callSign   String              @unique @map("call_sign") @db.VarChar(40)
  facilityId String?             @map("facility_id") @db.Uuid
  facility   Facility?           @relation(fields: [facilityId], references: [id], onDelete: Restrict)
  capability TransportCapability @default(basic)
  status     TransportStatus     @default(out_of_service)

  lat               Float?
  lng               Float?
  locationUpdatedAt DateTime? @map("location_updated_at")

  emergencies EmergencyRequest[]
  pings       TransportPing[]

  version   Int      @default(1)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@index([status])
  @@map("transport_units")
}

/// High frequency, low individual value. A candidate for time partitioning and
/// aggressive retention: the live position matters, last month's breadcrumbs
/// do not.
model TransportPing {
  id     String        @id @default(uuid()) @db.Uuid
  unitId String        @map("unit_id") @db.Uuid
  unit   TransportUnit @relation(fields: [unitId], references: [id], onDelete: Cascade)

  lat            Float
  lng            Float
  headingDegrees Float? @map("heading_degrees")
  speedKph       Float? @map("speed_kph")

  recordedAt DateTime @default(now()) @map("recorded_at")

  @@index([unitId, recordedAt])
  @@map("transport_pings")
}

// ===========================================================================
// Devices
// ===========================================================================

model Device {
  id           String     @id @default(uuid()) @db.Uuid
  deviceType   DeviceType @map("device_type")
  serialNumber String     @unique @map("serial_number") @db.VarChar(100)

  patientProfileId String?         @map("patient_profile_id") @db.Uuid
  patient          PatientProfile? @relation(fields: [patientProfileId], references: [id], onDelete: Cascade)

  vehicleRegistration String? @map("vehicle_registration") @db.VarChar(40)
  label               String? @db.VarChar(100)

  /// Hash only. The credential is shown once at registration and never again —
  /// a secret that can raise an emergency is not one to keep retrievable.
  credentialHash String       @map("credential_hash") @db.VarChar(255)
  status         DeviceStatus @default(active)

  lastSeenAt     DateTime? @map("last_seen_at")
  batteryPercent Int?      @map("battery_percent")
  revokedAt      DateTime? @map("revoked_at")

  telemetry DeviceTelemetry[]
  alerts    DeviceAlert[]

  version   Int      @default(1)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@index([patientProfileId, status])
  @@index([updatedAt])
  @@map("devices")
}

/// The highest-volume table in the system. One chronic-disease patient on a
/// watch produces thousands of rows a day, so this is partitioned by month and
/// summarised rather than kept raw forever.
model DeviceTelemetry {
  id       String @id @default(uuid()) @db.Uuid
  deviceId String @map("device_id") @db.Uuid
  device   Device @relation(fields: [deviceId], references: [id], onDelete: Cascade)

  metric TelemetryMetric
  value  Float
  unit   String?         @db.VarChar(20)

  /// The device's own clock. Arrival order carries no meaning when a watch has
  /// buffered offline for hours.
  recordedAt DateTime @map("recorded_at")
  receivedAt DateTime @default(now()) @map("received_at")

  @@index([deviceId, metric, recordedAt])
  @@index([recordedAt])
  @@map("device_telemetry")
}

model DeviceAlert {
  id       String          @id @default(uuid()) @db.Uuid
  deviceId String          @map("device_id") @db.Uuid
  device   Device          @relation(fields: [deviceId], references: [id], onDelete: Cascade)

  alertType  DeviceAlertType   @map("alert_type")
  status     DeviceAlertStatus @default(raised)
  confidence Float?

  lat Float?
  lng Float?

  /// Readings that triggered it, captured with the alert. Reconstructing them
  /// from telemetry later is unreliable once retention has run.
  triggerReadings Json @default("[]") @map("trigger_readings")

  emergencyRequestId String? @map("emergency_request_id") @db.Uuid

  detectedAt     DateTime  @map("detected_at")
  acknowledgedAt DateTime? @map("acknowledged_at")
  resolvedAt     DateTime? @map("resolved_at")

  recipients DeviceAlertRecipient[]

  version   Int      @default(1)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@index([deviceId, detectedAt])
  @@index([status, detectedAt])
  @@map("device_alerts")
}

/// Who was reached, and whether it arrived. A table rather than a JSON blob
/// because "the family doctor was never notified" is a question that has to be
/// answerable after an incident.
model DeviceAlertRecipient {
  id      String      @id @default(uuid()) @db.Uuid
  alertId String      @map("alert_id") @db.Uuid
  alert   DeviceAlert @relation(fields: [alertId], references: [id], onDelete: Cascade)

  recipientType AlertRecipientType @map("recipient_type")
  recipientId   String?            @map("recipient_id") @db.Uuid
  channel       Channel
  delivered     Boolean            @default(false)
  failureCode   String?            @map("failure_code") @db.VarChar(60)
  deliveredAt   DateTime?          @map("delivered_at")

  createdAt DateTime @default(now()) @map("created_at")

  @@index([alertId])
  @@map("device_alert_recipients")
}

// ===========================================================================
// Prevention
// ===========================================================================

model RiskScore {
  id               String         @id @default(uuid()) @db.Uuid
  patientProfileId String         @map("patient_profile_id") @db.Uuid
  patient          PatientProfile @relation(fields: [patientProfileId], references: [id], onDelete: Cascade)

  conditionCode String   @map("condition_code") @db.VarChar(40)
  score         Float
  band          RiskBand

  /// The features that drove the score. A score nobody can interrogate cannot
  /// be acted on responsibly.
  contributingFactors Json @default("[]") @map("contributing_factors")

  modelVersion String   @map("model_version") @db.VarChar(60)
  computedAt   DateTime @default(now()) @map("computed_at")

  version   Int      @default(1)
  updatedAt DateTime @updatedAt @map("updated_at")

  @@unique([patientProfileId, conditionCode])
  @@index([band, computedAt])
  @@index([updatedAt])
  @@map("risk_scores")
}

model ScreeningProgramme {
  id            String  @id @default(uuid()) @db.Uuid
  code          String  @unique @db.VarChar(40)
  name          String  @db.VarChar(150)
  conditionCode String  @map("condition_code") @db.VarChar(40)

  /// Age, sex, risk-band and history rules, evaluated by the invitation engine.
  eligibility Json @default("{}")

  intervalMonths Int     @map("interval_months")
  isActive       Boolean @default(true) @map("is_active")

  invitations ScreeningInvitation[]

  version   Int      @default(1)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@map("screening_programmes")
}

model ScreeningInvitation {
  id          String             @id @default(uuid()) @db.Uuid
  programmeId String             @map("programme_id") @db.Uuid
  programme   ScreeningProgramme @relation(fields: [programmeId], references: [id], onDelete: Restrict)

  patientProfileId String         @map("patient_profile_id") @db.Uuid
  patient          PatientProfile @relation(fields: [patientProfileId], references: [id], onDelete: Cascade)

  status InvitationStatus @default(pending)

  /// Why someone said no is the data that tells you whether uptake is limited
  /// by distance, cost, fear, or not knowing what the test is for.
  declineReason String? @map("decline_reason") @db.VarChar(500)

  appointmentId String?   @map("appointment_id") @db.Uuid
  invitedAt     DateTime  @default(now()) @map("invited_at")
  respondedAt   DateTime? @map("responded_at")
  expiresAt     DateTime? @map("expires_at")
  channel       Channel?

  version   Int      @default(1)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@index([patientProfileId, status])
  @@index([status, expiresAt])
  @@index([updatedAt])
  @@map("screening_invitations")
}

model Vaccination {
  id               String         @id @default(uuid()) @db.Uuid
  patientProfileId String         @map("patient_profile_id") @db.Uuid
  patient          PatientProfile @relation(fields: [patientProfileId], references: [id], onDelete: Cascade)

  vaccineCode String            @map("vaccine_code") @db.VarChar(40)
  doseNumber  Int               @default(1) @map("dose_number")
  status      VaccinationStatus @default(due)

  dueAt          DateTime? @map("due_at")
  administeredAt DateTime? @map("administered_at")

  facilityId String?   @map("facility_id") @db.Uuid
  facility   Facility? @relation(fields: [facilityId], references: [id], onDelete: Restrict)

  batchNumber String? @map("batch_number") @db.VarChar(60)

  version   Int      @default(1)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@unique([patientProfileId, vaccineCode, doseNumber])
  @@index([status, dueAt])
  @@index([updatedAt])
  @@map("vaccinations")
}

// ===========================================================================
// Pharmacy
// ===========================================================================

model Pharmacy {
  id            String  @id @default(uuid()) @db.Uuid
  name          String  @db.VarChar(200)
  licenseNumber String  @unique @map("license_number") @db.VarChar(60)

  /// Only verified, appropriately licensed pharmacies participate. The flag is
  /// checked on every dispensing action, not just at onboarding.
  isVerified Boolean @default(false) @map("is_verified")

  lat          Float?
  lng          Float?
  regionCode   String? @map("region_code") @db.VarChar(20)
  contactPhone String? @map("contact_phone") @db.VarChar(20)
  openingHours String? @map("opening_hours") @db.VarChar(200)
  isActive     Boolean @default(true) @map("is_active")

  stock             PharmacyStock[]
  dispenseCodes     DispenseCode[]
  dispensingRecords DispensingRecord[]

  version   Int      @default(1)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@index([regionCode, isVerified])
  @@map("pharmacies")
}

model PharmacyStock {
  id         String   @id @default(uuid()) @db.Uuid
  pharmacyId String   @map("pharmacy_id") @db.Uuid
  pharmacy   Pharmacy @relation(fields: [pharmacyId], references: [id], onDelete: Cascade)

  medicationName String      @map("medication_name") @db.VarChar(150)
  stockStatus    StockStatus @default(unknown) @map("stock_status")
  unitPrice      Decimal?    @map("unit_price") @db.Decimal(12, 2)
  currency       String?     @db.VarChar(3)

  /// Stock data ages fast. A stale figure sends someone on a journey for
  /// nothing, so the age is always returned alongside the status.
  lastReportedAt DateTime @default(now()) @map("last_reported_at")

  version   Int      @default(1)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@unique([pharmacyId, medicationName])
  @@index([medicationName, stockStatus])
  @@map("pharmacy_stock")
}

model DispenseCode {
  id             String       @id @default(uuid()) @db.Uuid
  prescriptionId String       @map("prescription_id") @db.Uuid
  prescription   Prescription @relation(fields: [prescriptionId], references: [id], onDelete: Cascade)

  /// Hash only, like any other credential presented at a counter.
  codeHash String @unique @map("code_hash") @db.VarChar(255)

  pharmacyId String?   @map("pharmacy_id") @db.Uuid
  pharmacy   Pharmacy? @relation(fields: [pharmacyId], references: [id], onDelete: Restrict)

  expiresAt  DateTime  @map("expires_at")
  redeemedAt DateTime? @map("redeemed_at")

  createdAt DateTime @default(now()) @map("created_at")

  @@index([prescriptionId])
  @@index([expiresAt])
  @@map("dispense_codes")
}

model DispensingRecord {
  id             String       @id @default(uuid()) @db.Uuid
  prescriptionId String       @map("prescription_id") @db.Uuid
  prescription   Prescription @relation(fields: [prescriptionId], references: [id], onDelete: Restrict)

  pharmacyId String   @map("pharmacy_id") @db.Uuid
  pharmacy   Pharmacy @relation(fields: [pharmacyId], references: [id], onDelete: Restrict)

  pharmacistUserId String?          @map("pharmacist_user_id") @db.Uuid
  status           DispensingStatus @default(pending)
  dispensedAt      DateTime?        @map("dispensed_at")

  items DispensingItem[]

  version   Int      @default(1)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@index([prescriptionId])
  @@index([pharmacyId, dispensedAt])
  @@index([updatedAt])
  @@map("dispensing_records")
}

model DispensingItem {
  id           String           @id @default(uuid()) @db.Uuid
  dispensingId String           @map("dispensing_id") @db.Uuid
  dispensing   DispensingRecord @relation(fields: [dispensingId], references: [id], onDelete: Cascade)

  prescriptionItemId String           @map("prescription_item_id") @db.Uuid
  prescriptionItem   PrescriptionItem @relation(fields: [prescriptionItemId], references: [id], onDelete: Restrict)

  quantityDispensed Int @map("quantity_dispensed")

  /// Substitution requires pharmacist review and, where the item differs
  /// clinically, prescriber approval. Silent substitution is never permitted,
  /// which is why the approver is a column and not a note.
  substitutedWith        String? @map("substituted_with") @db.VarChar(150)
  substitutionApprovedBy String? @map("substitution_approved_by") @db.Uuid

  createdAt DateTime @default(now()) @map("created_at")

  @@index([dispensingId])
  @@map("dispensing_items")
}

// ===========================================================================
// Diagnostics
// ===========================================================================

model InvestigationOrder {
  id           String     @id @default(uuid()) @db.Uuid
  careThreadId String     @map("care_thread_id") @db.Uuid
  careThread   CareThread @relation(fields: [careThreadId], references: [id], onDelete: Cascade)

  consultationId String? @map("consultation_id") @db.Uuid

  patientProfileId String         @map("patient_profile_id") @db.Uuid
  patient          PatientProfile @relation(fields: [patientProfileId], references: [id], onDelete: Cascade)

  orderedById String           @map("ordered_by_id") @db.Uuid
  orderedBy   ClinicianProfile @relation(fields: [orderedById], references: [id], onDelete: Restrict)

  facilityId String?   @map("facility_id") @db.Uuid
  facility   Facility? @relation(fields: [facilityId], references: [id], onDelete: Restrict)

  investigationCode String              @map("investigation_code") @db.VarChar(40)
  investigationType InvestigationType   @map("investigation_type")
  urgency           UrgencyLevel        @default(routine)
  status            InvestigationStatus @default(ordered)
  clinicalNotes     String?             @map("clinical_notes")

  narrative     String?
  attachmentKey String? @map("attachment_key")

  /// Set by the server from the reference bounds, never by the reporting lab.
  /// A critical result escalates until a clinician acknowledges it; silence is
  /// never treated as receipt.
  isCritical Boolean @default(false) @map("is_critical")

  acknowledgedById String?   @map("acknowledged_by_id") @db.Uuid
  acknowledgedAt   DateTime? @map("acknowledged_at")

  orderedAt  DateTime  @default(now()) @map("ordered_at")
  resultedAt DateTime? @map("resulted_at")

  values InvestigationValue[]

  version   Int      @default(1)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@index([careThreadId, orderedAt])
  @@index([status, urgency, orderedAt])
  /// Drives the unacknowledged-critical-result escalation worker.
  @@index([isCritical, acknowledgedAt])
  @@index([updatedAt])
  @@map("investigation_orders")
}

model InvestigationValue {
  id      String             @id @default(uuid()) @db.Uuid
  orderId String             @map("order_id") @db.Uuid
  order   InvestigationOrder @relation(fields: [orderId], references: [id], onDelete: Cascade)

  analyte        String     @db.VarChar(120)
  value          String     @db.VarChar(200)
  unit           String?    @db.VarChar(40)
  referenceLow   Float?     @map("reference_low")
  referenceHigh  Float?     @map("reference_high")
  flag           ResultFlag @default(normal)

  createdAt DateTime @default(now()) @map("created_at")

  @@index([orderId])
  @@map("investigation_values")
}

// ===========================================================================
// Professional network
// ===========================================================================

model Community {
  id          String    @id @default(uuid()) @db.Uuid
  name        String    @unique @db.VarChar(150)
  specialty   Specialty
  description String?
  isActive    Boolean   @default(true) @map("is_active")

  memberships CommunityMembership[]
  discussions Discussion[]

  version   Int      @default(1)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@map("communities")
}

model CommunityMembership {
  id          String    @id @default(uuid()) @db.Uuid
  communityId String    @map("community_id") @db.Uuid
  community   Community @relation(fields: [communityId], references: [id], onDelete: Cascade)

  clinicianId String           @map("clinician_id") @db.Uuid
  clinician   ClinicianProfile @relation(fields: [clinicianId], references: [id], onDelete: Cascade)

  role     String   @default("member") @db.VarChar(30)
  joinedAt DateTime @default(now()) @map("joined_at")

  @@unique([communityId, clinicianId])
  @@map("community_memberships")
}

model Discussion {
  id          String    @id @default(uuid()) @db.Uuid
  communityId String    @map("community_id") @db.Uuid
  community   Community @relation(fields: [communityId], references: [id], onDelete: Cascade)

  authorClinicianId String           @map("author_clinician_id") @db.Uuid
  author            ClinicianProfile @relation(fields: [authorClinicianId], references: [id], onDelete: Restrict)

  title String @db.VarChar(200)
  body  String

  isCaseDiscussion Boolean @default(false) @map("is_case_discussion")

  /// Present for case discussions. The thread is de-identified on the way in —
  /// what is shared is the clinical question, not the patient.
  careThreadId String?     @map("care_thread_id") @db.Uuid
  careThread   CareThread? @relation(fields: [careThreadId], references: [id], onDelete: Restrict)

  replyCount Int @default(0) @map("reply_count")

  replies DiscussionReply[]

  version   Int      @default(1)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@index([communityId, createdAt])
  @@index([authorClinicianId])
  @@map("discussions")
}

model DiscussionReply {
  id           String     @id @default(uuid()) @db.Uuid
  discussionId String     @map("discussion_id") @db.Uuid
  discussion   Discussion @relation(fields: [discussionId], references: [id], onDelete: Cascade)

  authorClinicianId String           @map("author_clinician_id") @db.Uuid
  author            ClinicianProfile @relation(fields: [authorClinicianId], references: [id], onDelete: Restrict)

  body String

  version   Int      @default(1)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@index([discussionId, createdAt])
  @@map("discussion_replies")
}

model SecondOpinion {
  id           String     @id @default(uuid()) @db.Uuid
  careThreadId String     @map("care_thread_id") @db.Uuid
  careThread   CareThread @relation(fields: [careThreadId], references: [id], onDelete: Cascade)

  requestedById String           @map("requested_by_id") @db.Uuid
  requestedBy   ClinicianProfile @relation("OpinionRequester", fields: [requestedById], references: [id], onDelete: Restrict)

  answeredById String?           @map("answered_by_id") @db.Uuid
  answeredBy   ClinicianProfile? @relation("OpinionAnswerer", fields: [answeredById], references: [id], onDelete: Restrict)

  specialty Specialty
  question  String
  answer    String?
  status    SecondOpinionStatus @default(open)

  /// Store-and-forward by default. Requiring both clinicians online at once is
  /// what makes specialist access fail outside cities.
  attachmentKeys Json @default("[]") @map("attachment_keys")

  requestedAt DateTime  @default(now()) @map("requested_at")
  answeredAt  DateTime? @map("answered_at")

  version   Int      @default(1)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@index([status, specialty, requestedAt])
  @@index([careThreadId])
  @@map("second_opinions")
}

// ===========================================================================
// Health education
// ===========================================================================

model EducationTopic {
  id       String            @id @default(uuid()) @db.Uuid
  slug     String            @unique @db.VarChar(80)
  name     String            @db.VarChar(150)
  category EducationCategory
  isActive Boolean           @default(true) @map("is_active")

  articles EducationArticle[]

  version   Int      @default(1)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@map("education_topics")
}

/// One row per language, not one row with translations inside it. Content is
/// authored and reviewed per language, and a Swahili article that has been
/// clinically reviewed is a different object from an unreviewed translation.
model EducationArticle {
  id      String         @id @default(uuid()) @db.Uuid
  topicId String         @map("topic_id") @db.Uuid
  topic   EducationTopic @relation(fields: [topicId], references: [id], onDelete: Cascade)

  slug     String        @db.VarChar(120)
  language LanguageCode
  title    String        @db.VarChar(200)
  summary  String
  body     String?
  mediaKey String?       @map("media_key")
  format   ContentFormat @default(article)

  readingLevel ReadingLevel @default(basic) @map("reading_level")

  /// Explicit misinformation counters, used where a myth is widespread enough
  /// that stating the fact alone does not displace it.
  mythVsFact Json @default("[]") @map("myth_vs_fact")

  reviewedById String?   @map("reviewed_by_id") @db.Uuid
  reviewedAt   DateTime? @map("reviewed_at")
  publishedAt  DateTime? @map("published_at")

  version   Int      @default(1)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@unique([slug, language])
  @@index([topicId, language])
  @@index([publishedAt])
  @@map("education_articles")
}

// ===========================================================================
// Families
// ===========================================================================

model Family {
  id               String           @id @default(uuid()) @db.Uuid
  name             String           @db.VarChar(150)
  subscriptionTier SubscriptionTier @default(none) @map("subscription_tier")
  headUserId       String?          @map("head_user_id") @db.Uuid

  members     FamilyMember[]
  assignments FamilyAssignment[]

  version   Int      @default(1)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@index([subscriptionTier])
  @@index([updatedAt])
  @@map("families")
}

model FamilyMember {
  id       String @id @default(uuid()) @db.Uuid
  familyId String @map("family_id") @db.Uuid
  family   Family @relation(fields: [familyId], references: [id], onDelete: Cascade)

  patientProfileId String         @map("patient_profile_id") @db.Uuid
  patient          PatientProfile @relation(fields: [patientProfileId], references: [id], onDelete: Cascade)

  relationship FamilyRelationship

  version   Int      @default(1)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@unique([familyId, patientProfileId])
  @@map("family_members")
}

/// Two assignments, not one. Maternal and reproductive care routed through
/// whoever happens to be free is exactly what this pairing exists to prevent,
/// so the OB/GYN slot is a separate column rather than another row of the same
/// kind.
model FamilyAssignment {
  id       String @id @default(uuid()) @db.Uuid
  familyId String @unique @map("family_id") @db.Uuid
  family   Family @relation(fields: [familyId], references: [id], onDelete: Cascade)

  gpClinicianId String?           @map("gp_clinician_id") @db.Uuid
  gp            ClinicianProfile? @relation("FamilyGp", fields: [gpClinicianId], references: [id], onDelete: Restrict)

  obgynClinicianId String?           @map("obgyn_clinician_id") @db.Uuid
  obgyn            ClinicianProfile? @relation("FamilyObgyn", fields: [obgynClinicianId], references: [id], onDelete: Restrict)

  assignedAt DateTime @default(now()) @map("assigned_at")

  version   Int      @default(1)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@index([gpClinicianId])
  @@index([obgynClinicianId])
  @@map("family_assignments")
}

// ===========================================================================
// Research
// ===========================================================================

model ResearchDataset {
  id          String @id @default(uuid()) @db.Uuid
  name        String @unique @db.VarChar(150)
  description String

  deidentificationMethod String @map("deidentification_method") @db.VarChar(200)
  kAnonymity             Int    @default(5) @map("k_anonymity")

  /// Results below this are suppressed rather than returned. A count of one in
  /// a district is an identity.
  minimumCellSize Int @default(5) @map("minimum_cell_size")

  requiresEthicsApproval Boolean @default(true) @map("requires_ethics_approval")
  recordCount            Int     @default(0) @map("record_count")
  isActive               Boolean @default(true) @map("is_active")

  queries ResearchQuery[]

  version   Int      @default(1)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@map("research_datasets")
}

model ResearchQuery {
  id        String          @id @default(uuid()) @db.Uuid
  datasetId String          @map("dataset_id") @db.Uuid
  dataset   ResearchDataset @relation(fields: [datasetId], references: [id], onDelete: Restrict)

  researcherId String @map("researcher_id") @db.Uuid
  researcher   User   @relation(fields: [researcherId], references: [id], onDelete: Restrict)

  /// Recorded against the query itself, so any published finding can be traced
  /// back to the approval that permitted it.
  ethicsApprovalRef String @map("ethics_approval_ref") @db.VarChar(100)

  spec   Json
  status ResearchQueryStatus @default(queued)
  rows   Json?

  suppressedCells Int     @default(0) @map("suppressed_cells")
  failureReason   String? @map("failure_reason")

  submittedAt DateTime  @default(now()) @map("submitted_at")
  completedAt DateTime? @map("completed_at")

  version   Int      @default(1)
  updatedAt DateTime @updatedAt @map("updated_at")

  @@index([researcherId, submittedAt])
  @@index([status])
  @@map("research_queries")
}

// ===========================================================================
// Surveillance
// ===========================================================================

/// Precomputed rollups. The live query would scan every encounter in a region;
/// the dashboard has to answer in under a second for a ministry meeting to be
/// worth holding.
model SurveillanceRollup {
  id String @id @default(uuid()) @db.Uuid

  level    GeoLevel
  areaCode String   @map("area_code") @db.VarChar(30)

  conditionCode String   @map("condition_code") @db.VarChar(40)
  conditionName String   @map("condition_name") @db.VarChar(150)
  periodStart   DateTime @map("period_start") @db.Date
  periodEnd     DateTime @map("period_end") @db.Date

  count        Int
  rankInArea   Int?   @map("rank_in_area")
  ratePer100k  Float? @map("rate_per_100k")

  /// Modelled expected band. A count outside it is the outbreak signal that
  /// lets an authority act before a local rise becomes an epidemic.
  expectedLow   Float?  @map("expected_low")
  expectedHigh  Float?  @map("expected_high")
  aboveExpected Boolean @default(false) @map("above_expected")

  modelVersion String?  @map("model_version") @db.VarChar(60)
  computedAt   DateTime @default(now()) @map("computed_at")

  @@unique([level, areaCode, conditionCode, periodStart])
  @@index([level, areaCode, periodStart])
  @@index([aboveExpected, periodStart])
  @@map("surveillance_rollups")
}

// ===========================================================================
// Insurance
// ===========================================================================

model InsuranceScheme {
  id       String  @id @default(uuid()) @db.Uuid
  name     String  @unique @db.VarChar(150)
  code     String  @unique @db.VarChar(40)
  isPublic Boolean @default(false) @map("is_public")
  isActive Boolean @default(true) @map("is_active")

  memberships InsuranceMembership[]
  claims      InsuranceClaim[]

  version   Int      @default(1)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@map("insurance_schemes")
}

model InsuranceMembership {
  id       String          @id @default(uuid()) @db.Uuid
  schemeId String          @map("scheme_id") @db.Uuid
  scheme   InsuranceScheme @relation(fields: [schemeId], references: [id], onDelete: Restrict)

  patientProfileId String         @map("patient_profile_id") @db.Uuid
  patient          PatientProfile @relation(fields: [patientProfileId], references: [id], onDelete: Cascade)

  membershipNumber String           @map("membership_number") @db.VarChar(60)
  status           MembershipStatus @default(unknown)
  coveredServices  Json             @default("[]") @map("covered_services")
  validUntil       DateTime?        @map("valid_until") @db.Date

  version   Int      @default(1)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@unique([schemeId, membershipNumber])
  @@index([patientProfileId, status])
  @@map("insurance_memberships")
}

model InsuranceClaim {
  id             String              @id @default(uuid()) @db.Uuid
  consultationId String              @map("consultation_id") @db.Uuid
  consultation   ConsultationRequest @relation(fields: [consultationId], references: [id], onDelete: Restrict)

  schemeId String          @map("scheme_id") @db.Uuid
  scheme   InsuranceScheme @relation(fields: [schemeId], references: [id], onDelete: Restrict)

  status    ClaimStatus @default(submitted)
  itemCodes Json        @default("[]") @map("item_codes")

  /// Amounts are recorded, but no clinical decision anywhere in the platform
  /// reads them. Keeping that separation is what stops the financing model
  /// from shaping the care.
  amountClaimed Decimal? @map("amount_claimed") @db.Decimal(14, 2)
  amountPaid    Decimal? @map("amount_paid") @db.Decimal(14, 2)
  currency      String?  @db.VarChar(3)

  rejectionReason String?   @map("rejection_reason")
  submittedAt     DateTime  @default(now()) @map("submitted_at")
  decidedAt       DateTime? @map("decided_at")

  version   Int      @default(1)
  updatedAt DateTime @updatedAt @map("updated_at")

  @@index([schemeId, status])
  @@index([consultationId])
  @@map("insurance_claims")
}

// ===========================================================================
// Quality
// ===========================================================================

model ConsultationRating {
  id             String              @id @default(uuid()) @db.Uuid
  consultationId String              @unique @map("consultation_id") @db.Uuid
  consultation   ConsultationRequest @relation(fields: [consultationId], references: [id], onDelete: Cascade)

  clinicianId String           @map("clinician_id") @db.Uuid
  clinician   ClinicianProfile @relation(fields: [clinicianId], references: [id], onDelete: Cascade)

  score   Int     @db.SmallInt
  comment String? @db.VarChar(1000)

  version   Int      @default(1)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@index([clinicianId, createdAt])
  @@map("consultation_ratings")
}

model IncidentReport {
  id       String           @id @default(uuid()) @db.Uuid
  category IncidentCategory
  severity IncidentSeverity @default(moderate)
  status   IncidentStatus   @default(reported)

  description String

  reportedByUserId String? @map("reported_by_user_id") @db.Uuid
  reportedBy       User?   @relation(fields: [reportedByUserId], references: [id], onDelete: Restrict)

  /// A reporter who fears identification does not report. Anonymity is a
  /// safety feature, not a loophole.
  anonymous Boolean @default(false)

  consultationId String?              @map("consultation_id") @db.Uuid
  consultation   ConsultationRequest? @relation(fields: [consultationId], references: [id], onDelete: Restrict)

  clinicianId String?           @map("clinician_id") @db.Uuid
  clinician   ClinicianProfile? @relation(fields: [clinicianId], references: [id], onDelete: Restrict)

  facilityId String?   @map("facility_id") @db.Uuid
  facility   Facility? @relation(fields: [facilityId], references: [id], onDelete: Restrict)

  /// Serious and catastrophic reports go straight to clinical and governance
  /// leadership rather than into a customer-service queue.
  escalatedToGovernance Boolean @default(false) @map("escalated_to_governance")

  investigationNotes String?   @map("investigation_notes")
  actionTaken        String?   @map("action_taken")
  reportedAt         DateTime  @default(now()) @map("reported_at")
  closedAt           DateTime? @map("closed_at")

  version   Int      @default(1)
  updatedAt DateTime @updatedAt @map("updated_at")

  @@index([status, severity, reportedAt])
  @@index([clinicianId])
  @@map("incident_reports")
}
`;

fs.writeFileSync(path, s);
console.log('  schema expanded');
NODE

python3 - "$SCHEMA" << 'PY'
import re, sys

src = open(sys.argv[1]).read()
code = "\n".join(l for l in src.splitlines() if not l.strip().startswith("//") and not l.strip().startswith("///"))

models = re.findall(r'^model\s+(\w+)\s*\{', code, re.M)
enums = re.findall(r'^enum\s+(\w+)\s*\{', code, re.M)
print(f"  models: {len(models)} | enums: {len(enums)} | brace balance: {code.count('{') - code.count('}')}")

dupes = {m for m in models if models.count(m) > 1} | {e for e in enums if enums.count(e) > 1}
print(f"  duplicates: {dupes or 'none'}")

scalars = {"String","Int","BigInt","Float","Boolean","DateTime","Json","Decimal","Bytes"}
known = set(models) | set(enums) | scalars
blocks = re.findall(r'^model\s+(\w+)\s*\{(.*?)^\}', code, re.M | re.S)
mf, bad = {}, []
for name, body in blocks:
    fs_ = []
    for line in body.splitlines():
        t = line.strip()
        if not t or t.startswith("@@"):
            continue
        m = re.match(r'(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)', t)
        if not m:
            continue
        fn, ft, lst, _opt, rest = m.groups()
        fs_.append(dict(name=fn, type=ft, list=bool(lst), attrs=rest))
        if ft not in known:
            bad.append(f"{name}.{fn}:{ft}")
    mf[name] = fs_
print(f"  unknown types: {bad or 'none'}")

miss = [f"{a}.{f['name']} -> {f['type']}" for a, fa in mf.items() for f in fa
        if f['type'] in mf and not any(g['type'] == a for g in mf[f['type']])]
print(f"  missing back-relations: {miss or 'none'}")

rel = re.findall(r'@relation\("(\w+)"', code)
unpaired = {n: rel.count(n) for n in set(rel) if rel.count(n) != 2}
print(f"  unpaired relation names: {unpaired or 'none'}")

prob = []
for a, fa in mf.items():
    for f in fa:
        if f['type'] not in mf or f['list'] or 'fields:' not in f['attrs']:
            continue
        backs = [g for g in mf[f['type']] if g['type'] == a]
        if not backs or any(g['list'] for g in backs):
            continue
        fk = re.search(r'fields:\s*\[(\w+)\]', f['attrs']).group(1)
        fkf = next((g for g in fa if g['name'] == fk), None)
        if fkf and '@unique' not in fkf['attrs']:
            prob.append(f"{a}.{fk}")
print(f"  1:1 FKs missing @unique: {prob or 'none'}")

log_only = {"OtpChallenge","RefreshToken","IdempotencyRecord","ChangeLog","AuditLog","NotificationLog",
            "EmergencyEvent","TransportPing","DeviceTelemetry","DeviceAlertRecipient","DispenseCode",
            "DispensingItem","InvestigationValue","CommunityMembership","SurveillanceRollup","AiInference"}
mv = [m for m in models if m not in log_only and not any(f['name'] == 'version' for f in mf[m])]
mu = [m for m in models if m not in log_only and not any(f['name'] == 'updatedAt' for f in mf[m])]
print(f"  missing version: {mv or 'none'}")
print(f"  missing updatedAt: {mu or 'none'}")

if dupes or bad or miss or unpaired or prob or mv or mu:
    sys.exit(1)
PY

echo
echo "Next:"
echo "  pnpm --filter @a-health/database exec prisma format"
echo "  pnpm --filter @a-health/database exec prisma validate"
echo "  pnpm --filter @a-health/database exec prisma migrate dev --name expand_full_domain"
