-- CreateEnum
CREATE TYPE "IntegrationLevel" AS ENUM ('none', 'partial', 'full', 'platform_operated');

-- CreateEnum
CREATE TYPE "AiAudience" AS ENUM ('patient', 'clinician');

-- CreateEnum
CREATE TYPE "AiMessageRole" AS ENUM ('user', 'assistant', 'system');

-- CreateEnum
CREATE TYPE "AiModelStatus" AS ENUM ('active', 'shadow', 'retired', 'not_deployed');

-- CreateEnum
CREATE TYPE "AiInferenceKind" AS ENUM ('chat', 'triage', 'drug_interaction', 'transcription', 'synthesis', 'risk_score', 'image_analysis', 'anomaly_detection', 'forecast');

-- CreateEnum
CREATE TYPE "EmergencyScale" AS ENUM ('individual', 'mass_casualty');

-- CreateEnum
CREATE TYPE "EmergencyCategory" AS ENUM ('medical', 'trauma', 'obstetric', 'road_traffic', 'fire', 'other');

-- CreateEnum
CREATE TYPE "EmergencySource" AS ENUM ('patient_app', 'bystander', 'ussd', 'sms', 'voice', 'wearable', 'vehicle_sensor', 'facility');

-- CreateEnum
CREATE TYPE "EmergencyStatus" AS ENUM ('reported', 'triaged', 'dispatched', 'en_route', 'arrived', 'resolved', 'cancelled');

-- CreateEnum
CREATE TYPE "EmergencyOutcome" AS ENUM ('transported', 'treated_on_scene', 'refused_care', 'false_alarm', 'deceased');

-- CreateEnum
CREATE TYPE "TransportStatus" AS ENUM ('available', 'dispatched', 'en_route', 'at_scene', 'transporting', 'out_of_service');

-- CreateEnum
CREATE TYPE "TransportCapability" AS ENUM ('basic', 'advanced', 'neonatal', 'mass_casualty');

-- CreateEnum
CREATE TYPE "DeviceType" AS ENUM ('wearable_watch', 'vehicle_sensor', 'bp_monitor', 'glucometer', 'pulse_oximeter');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('active', 'revoked', 'lost');

-- CreateEnum
CREATE TYPE "TelemetryMetric" AS ENUM ('heart_rate', 'spo2', 'systolic', 'diastolic', 'glucose', 'temperature', 'steps', 'motion', 'impact_g');

-- CreateEnum
CREATE TYPE "DeviceAlertType" AS ENUM ('fall_detected', 'collision_detected', 'heart_rate_abnormal', 'spo2_low', 'no_motion', 'manual_trigger');

-- CreateEnum
CREATE TYPE "DeviceAlertStatus" AS ENUM ('raised', 'acknowledged', 'escalated', 'false_positive', 'resolved');

-- CreateEnum
CREATE TYPE "AlertRecipientType" AS ENUM ('treating_clinician', 'family_doctor', 'emergency_department', 'relative', 'patient');

-- CreateEnum
CREATE TYPE "RiskBand" AS ENUM ('low', 'moderate', 'high', 'very_high');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('pending', 'accepted', 'declined', 'deferred', 'completed', 'expired');

-- CreateEnum
CREATE TYPE "VaccinationStatus" AS ENUM ('due', 'overdue', 'administered', 'contraindicated');

-- CreateEnum
CREATE TYPE "StockStatus" AS ENUM ('in_stock', 'low_stock', 'out_of_stock', 'unknown');

-- CreateEnum
CREATE TYPE "DispensingStatus" AS ENUM ('pending', 'partial', 'complete', 'cancelled');

-- CreateEnum
CREATE TYPE "InvestigationType" AS ENUM ('laboratory', 'imaging', 'pathology', 'point_of_care');

-- CreateEnum
CREATE TYPE "InvestigationStatus" AS ENUM ('ordered', 'scheduled', 'collected', 'resulted', 'acknowledged', 'cancelled');

-- CreateEnum
CREATE TYPE "ResultFlag" AS ENUM ('normal', 'low', 'high', 'critical_low', 'critical_high');

-- CreateEnum
CREATE TYPE "SecondOpinionStatus" AS ENUM ('open', 'claimed', 'answered', 'withdrawn');

-- CreateEnum
CREATE TYPE "ContentFormat" AS ENUM ('article', 'audio', 'video', 'interactive', 'sms_series');

-- CreateEnum
CREATE TYPE "EducationCategory" AS ENUM ('communicable', 'non_communicable', 'maternal_child', 'mental_health', 'prevention', 'nutrition');

-- CreateEnum
CREATE TYPE "ReadingLevel" AS ENUM ('basic', 'intermediate', 'advanced');

-- CreateEnum
CREATE TYPE "SubscriptionTier" AS ENUM ('none', 'family_basic', 'family_plus');

-- CreateEnum
CREATE TYPE "FamilyRelationship" AS ENUM ('head', 'spouse', 'child', 'parent', 'sibling', 'dependant', 'other');

-- CreateEnum
CREATE TYPE "ResearchQueryStatus" AS ENUM ('queued', 'running', 'complete', 'failed', 'rejected');

-- CreateEnum
CREATE TYPE "GeoLevel" AS ENUM ('ward', 'district', 'region', 'national', 'continental');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('active', 'lapsed', 'suspended', 'unknown');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('submitted', 'under_review', 'approved', 'rejected', 'paid');

-- CreateEnum
CREATE TYPE "IncidentCategory" AS ENUM ('clinical_care', 'misconduct', 'medication_error', 'delayed_response', 'data_privacy', 'ai_error', 'other');

-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('low', 'moderate', 'serious', 'catastrophic');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('reported', 'under_investigation', 'action_taken', 'closed');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FacilityType" ADD VALUE 'laboratory';
ALTER TYPE "FacilityType" ADD VALUE 'imaging_centre';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UserRole" ADD VALUE 'researcher';
ALTER TYPE "UserRole" ADD VALUE 'dispatcher_supervisor';

-- AlterTable
ALTER TABLE "clinician_profiles" ADD COLUMN     "family_load" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "max_family_load" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "facilities" ADD COLUMN     "integration_level" "IntegrationLevel" NOT NULL DEFAULT 'none';

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "specialty" "Specialty",
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_models" (
    "id" UUID NOT NULL,
    "key" VARCHAR(60) NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "function" VARCHAR(200) NOT NULL,
    "version" VARCHAR(40) NOT NULL,
    "status" "AiModelStatus" NOT NULL DEFAULT 'not_deployed',
    "runtime" VARCHAR(60),
    "context_notes" TEXT,
    "last_validated_at" TIMESTAMP(3),
    "accuracy_summary" TEXT,
    "bias_review_at" TIMESTAMP(3),
    "governance_notes" TEXT,
    "approved_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_conversations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "audience" "AiAudience" NOT NULL,
    "care_thread_id" UUID,
    "language" "LanguageCode" NOT NULL DEFAULT 'sw',
    "channel" "Channel" NOT NULL DEFAULT 'app',
    "model_version" VARCHAR(60) NOT NULL,
    "closed_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "role" "AiMessageRole" NOT NULL,
    "body" TEXT NOT NULL,
    "citations" JSONB NOT NULL DEFAULT '[]',
    "escalated" BOOLEAN NOT NULL DEFAULT false,
    "escalation_reason" TEXT,
    "model_version" VARCHAR(60),
    "latency_ms" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_inferences" (
    "id" UUID NOT NULL,
    "model_id" UUID NOT NULL,
    "kind" "AiInferenceKind" NOT NULL,
    "subject_type" VARCHAR(60),
    "subject_id" UUID,
    "requested_by_id" UUID,
    "input_hash" VARCHAR(64) NOT NULL,
    "output_summary" JSONB NOT NULL DEFAULT '{}',
    "confidence" DOUBLE PRECISION,
    "latency_ms" INTEGER,
    "overridden" BOOLEAN NOT NULL DEFAULT false,
    "override_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_inferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_requests" (
    "id" UUID NOT NULL,
    "scale" "EmergencyScale" NOT NULL,
    "category" "EmergencyCategory" NOT NULL DEFAULT 'other',
    "source" "EmergencySource" NOT NULL,
    "status" "EmergencyStatus" NOT NULL DEFAULT 'reported',
    "outcome" "EmergencyOutcome",
    "patient_profile_id" UUID,
    "reported_by_user_id" UUID,
    "reporter_phone" VARCHAR(20),
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "estimated_casualties" INTEGER,
    "description" TEXT,
    "transport_unit_id" UUID,
    "destination_facility_id" UUID,
    "device_alert_id" UUID,
    "reported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatched_at" TIMESTAMP(3),
    "arrived_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "emergency_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_events" (
    "id" UUID NOT NULL,
    "emergency_id" UUID NOT NULL,
    "from_status" "EmergencyStatus",
    "to_status" "EmergencyStatus" NOT NULL,
    "actor_user_id" UUID,
    "notes" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "emergency_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_units" (
    "id" UUID NOT NULL,
    "call_sign" VARCHAR(40) NOT NULL,
    "facility_id" UUID,
    "capability" "TransportCapability" NOT NULL DEFAULT 'basic',
    "status" "TransportStatus" NOT NULL DEFAULT 'out_of_service',
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "location_updated_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transport_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_pings" (
    "id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "heading_degrees" DOUBLE PRECISION,
    "speed_kph" DOUBLE PRECISION,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transport_pings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "device_type" "DeviceType" NOT NULL,
    "serial_number" VARCHAR(100) NOT NULL,
    "patient_profile_id" UUID,
    "vehicle_registration" VARCHAR(40),
    "label" VARCHAR(100),
    "credential_hash" VARCHAR(255) NOT NULL,
    "status" "DeviceStatus" NOT NULL DEFAULT 'active',
    "last_seen_at" TIMESTAMP(3),
    "battery_percent" INTEGER,
    "revoked_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_telemetry" (
    "id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "metric" "TelemetryMetric" NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" VARCHAR(20),
    "recorded_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_telemetry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_alerts" (
    "id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "alert_type" "DeviceAlertType" NOT NULL,
    "status" "DeviceAlertStatus" NOT NULL DEFAULT 'raised',
    "confidence" DOUBLE PRECISION,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "trigger_readings" JSONB NOT NULL DEFAULT '[]',
    "emergency_request_id" UUID,
    "detected_at" TIMESTAMP(3) NOT NULL,
    "acknowledged_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_alert_recipients" (
    "id" UUID NOT NULL,
    "alert_id" UUID NOT NULL,
    "recipient_type" "AlertRecipientType" NOT NULL,
    "recipient_id" UUID,
    "channel" "Channel" NOT NULL,
    "delivered" BOOLEAN NOT NULL DEFAULT false,
    "failure_code" VARCHAR(60),
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_alert_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_scores" (
    "id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "condition_code" VARCHAR(40) NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "band" "RiskBand" NOT NULL,
    "contributing_factors" JSONB NOT NULL DEFAULT '[]',
    "model_version" VARCHAR(60) NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "risk_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "screening_programmes" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "condition_code" VARCHAR(40) NOT NULL,
    "eligibility" JSONB NOT NULL DEFAULT '{}',
    "interval_months" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "screening_programmes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "screening_invitations" (
    "id" UUID NOT NULL,
    "programme_id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'pending',
    "decline_reason" VARCHAR(500),
    "appointment_id" UUID,
    "invited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "channel" "Channel",
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "screening_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vaccinations" (
    "id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "vaccine_code" VARCHAR(40) NOT NULL,
    "dose_number" INTEGER NOT NULL DEFAULT 1,
    "status" "VaccinationStatus" NOT NULL DEFAULT 'due',
    "due_at" TIMESTAMP(3),
    "administered_at" TIMESTAMP(3),
    "facility_id" UUID,
    "batch_number" VARCHAR(60),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vaccinations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pharmacies" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "license_number" VARCHAR(60) NOT NULL,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "region_code" VARCHAR(20),
    "contact_phone" VARCHAR(20),
    "opening_hours" VARCHAR(200),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pharmacies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pharmacy_stock" (
    "id" UUID NOT NULL,
    "pharmacy_id" UUID NOT NULL,
    "medication_name" VARCHAR(150) NOT NULL,
    "stock_status" "StockStatus" NOT NULL DEFAULT 'unknown',
    "unit_price" DECIMAL(12,2),
    "currency" VARCHAR(3),
    "last_reported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pharmacy_stock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispense_codes" (
    "id" UUID NOT NULL,
    "prescription_id" UUID NOT NULL,
    "code_hash" VARCHAR(255) NOT NULL,
    "pharmacy_id" UUID,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "redeemed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispense_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispensing_records" (
    "id" UUID NOT NULL,
    "prescription_id" UUID NOT NULL,
    "pharmacy_id" UUID NOT NULL,
    "pharmacist_user_id" UUID,
    "status" "DispensingStatus" NOT NULL DEFAULT 'pending',
    "dispensed_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dispensing_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispensing_items" (
    "id" UUID NOT NULL,
    "dispensing_id" UUID NOT NULL,
    "prescription_item_id" UUID NOT NULL,
    "quantity_dispensed" INTEGER NOT NULL,
    "substituted_with" VARCHAR(150),
    "substitution_approved_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispensing_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investigation_orders" (
    "id" UUID NOT NULL,
    "care_thread_id" UUID NOT NULL,
    "consultation_id" UUID,
    "patient_profile_id" UUID NOT NULL,
    "ordered_by_id" UUID NOT NULL,
    "facility_id" UUID,
    "investigation_code" VARCHAR(40) NOT NULL,
    "investigation_type" "InvestigationType" NOT NULL,
    "urgency" "UrgencyLevel" NOT NULL DEFAULT 'routine',
    "status" "InvestigationStatus" NOT NULL DEFAULT 'ordered',
    "clinical_notes" TEXT,
    "narrative" TEXT,
    "attachment_key" TEXT,
    "is_critical" BOOLEAN NOT NULL DEFAULT false,
    "acknowledged_by_id" UUID,
    "acknowledged_at" TIMESTAMP(3),
    "ordered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resulted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "investigation_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investigation_values" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "analyte" VARCHAR(120) NOT NULL,
    "value" VARCHAR(200) NOT NULL,
    "unit" VARCHAR(40),
    "reference_low" DOUBLE PRECISION,
    "reference_high" DOUBLE PRECISION,
    "flag" "ResultFlag" NOT NULL DEFAULT 'normal',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investigation_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communities" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "specialty" "Specialty" NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "communities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_memberships" (
    "id" UUID NOT NULL,
    "community_id" UUID NOT NULL,
    "clinician_id" UUID NOT NULL,
    "role" VARCHAR(30) NOT NULL DEFAULT 'member',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discussions" (
    "id" UUID NOT NULL,
    "community_id" UUID NOT NULL,
    "author_clinician_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "is_case_discussion" BOOLEAN NOT NULL DEFAULT false,
    "care_thread_id" UUID,
    "reply_count" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discussions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discussion_replies" (
    "id" UUID NOT NULL,
    "discussion_id" UUID NOT NULL,
    "author_clinician_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discussion_replies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "second_opinions" (
    "id" UUID NOT NULL,
    "care_thread_id" UUID NOT NULL,
    "requested_by_id" UUID NOT NULL,
    "answered_by_id" UUID,
    "specialty" "Specialty" NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "status" "SecondOpinionStatus" NOT NULL DEFAULT 'open',
    "attachment_keys" JSONB NOT NULL DEFAULT '[]',
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answered_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "second_opinions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "education_topics" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "category" "EducationCategory" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "education_topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "education_articles" (
    "id" UUID NOT NULL,
    "topic_id" UUID NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "language" "LanguageCode" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "summary" TEXT NOT NULL,
    "body" TEXT,
    "media_key" TEXT,
    "format" "ContentFormat" NOT NULL DEFAULT 'article',
    "reading_level" "ReadingLevel" NOT NULL DEFAULT 'basic',
    "myth_vs_fact" JSONB NOT NULL DEFAULT '[]',
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "education_articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "families" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "subscription_tier" "SubscriptionTier" NOT NULL DEFAULT 'none',
    "head_user_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "families_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "family_members" (
    "id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "relationship" "FamilyRelationship" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "family_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "family_assignments" (
    "id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "gp_clinician_id" UUID,
    "obgyn_clinician_id" UUID,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "family_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_datasets" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "description" TEXT NOT NULL,
    "deidentification_method" VARCHAR(200) NOT NULL,
    "k_anonymity" INTEGER NOT NULL DEFAULT 5,
    "minimum_cell_size" INTEGER NOT NULL DEFAULT 5,
    "requires_ethics_approval" BOOLEAN NOT NULL DEFAULT true,
    "record_count" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "research_datasets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_queries" (
    "id" UUID NOT NULL,
    "dataset_id" UUID NOT NULL,
    "researcher_id" UUID NOT NULL,
    "ethics_approval_ref" VARCHAR(100) NOT NULL,
    "spec" JSONB NOT NULL,
    "status" "ResearchQueryStatus" NOT NULL DEFAULT 'queued',
    "rows" JSONB,
    "suppressed_cells" INTEGER NOT NULL DEFAULT 0,
    "failure_reason" TEXT,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "research_queries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surveillance_rollups" (
    "id" UUID NOT NULL,
    "level" "GeoLevel" NOT NULL,
    "area_code" VARCHAR(30) NOT NULL,
    "condition_code" VARCHAR(40) NOT NULL,
    "condition_name" VARCHAR(150) NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "count" INTEGER NOT NULL,
    "rank_in_area" INTEGER,
    "rate_per_100k" DOUBLE PRECISION,
    "expected_low" DOUBLE PRECISION,
    "expected_high" DOUBLE PRECISION,
    "above_expected" BOOLEAN NOT NULL DEFAULT false,
    "model_version" VARCHAR(60),
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "surveillance_rollups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_schemes" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "insurance_schemes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_memberships" (
    "id" UUID NOT NULL,
    "scheme_id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "membership_number" VARCHAR(60) NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'unknown',
    "covered_services" JSONB NOT NULL DEFAULT '[]',
    "valid_until" DATE,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "insurance_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_claims" (
    "id" UUID NOT NULL,
    "consultation_id" UUID NOT NULL,
    "scheme_id" UUID NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'submitted',
    "item_codes" JSONB NOT NULL DEFAULT '[]',
    "amount_claimed" DECIMAL(14,2),
    "amount_paid" DECIMAL(14,2),
    "currency" VARCHAR(3),
    "rejection_reason" TEXT,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "insurance_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consultation_ratings" (
    "id" UUID NOT NULL,
    "consultation_id" UUID NOT NULL,
    "clinician_id" UUID NOT NULL,
    "score" SMALLINT NOT NULL,
    "comment" VARCHAR(1000),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consultation_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_reports" (
    "id" UUID NOT NULL,
    "category" "IncidentCategory" NOT NULL,
    "severity" "IncidentSeverity" NOT NULL DEFAULT 'moderate',
    "status" "IncidentStatus" NOT NULL DEFAULT 'reported',
    "description" TEXT NOT NULL,
    "reported_by_user_id" UUID,
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "consultation_id" UUID,
    "clinician_id" UUID,
    "facility_id" UUID,
    "escalated_to_governance" BOOLEAN NOT NULL DEFAULT false,
    "investigation_notes" TEXT,
    "action_taken" TEXT,
    "reported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incident_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "departments_facility_id_name_key" ON "departments"("facility_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ai_models_key_key" ON "ai_models"("key");

-- CreateIndex
CREATE INDEX "ai_models_status_idx" ON "ai_models"("status");

-- CreateIndex
CREATE INDEX "ai_conversations_user_id_created_at_idx" ON "ai_conversations"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_conversations_care_thread_id_idx" ON "ai_conversations"("care_thread_id");

-- CreateIndex
CREATE INDEX "ai_messages_conversation_id_created_at_idx" ON "ai_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_inferences_model_id_created_at_idx" ON "ai_inferences"("model_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_inferences_kind_created_at_idx" ON "ai_inferences"("kind", "created_at");

-- CreateIndex
CREATE INDEX "ai_inferences_overridden_created_at_idx" ON "ai_inferences"("overridden", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_requests_device_alert_id_key" ON "emergency_requests"("device_alert_id");

-- CreateIndex
CREATE INDEX "emergency_requests_status_reported_at_idx" ON "emergency_requests"("status", "reported_at");

-- CreateIndex
CREATE INDEX "emergency_requests_destination_facility_id_status_idx" ON "emergency_requests"("destination_facility_id", "status");

-- CreateIndex
CREATE INDEX "emergency_requests_updated_at_idx" ON "emergency_requests"("updated_at");

-- CreateIndex
CREATE INDEX "emergency_events_emergency_id_occurred_at_idx" ON "emergency_events"("emergency_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "transport_units_call_sign_key" ON "transport_units"("call_sign");

-- CreateIndex
CREATE INDEX "transport_units_status_idx" ON "transport_units"("status");

-- CreateIndex
CREATE INDEX "transport_pings_unit_id_recorded_at_idx" ON "transport_pings"("unit_id", "recorded_at");

-- CreateIndex
CREATE UNIQUE INDEX "devices_serial_number_key" ON "devices"("serial_number");

-- CreateIndex
CREATE INDEX "devices_patient_profile_id_status_idx" ON "devices"("patient_profile_id", "status");

-- CreateIndex
CREATE INDEX "devices_updated_at_idx" ON "devices"("updated_at");

-- CreateIndex
CREATE INDEX "device_telemetry_device_id_metric_recorded_at_idx" ON "device_telemetry"("device_id", "metric", "recorded_at");

-- CreateIndex
CREATE INDEX "device_telemetry_recorded_at_idx" ON "device_telemetry"("recorded_at");

-- CreateIndex
CREATE INDEX "device_alerts_device_id_detected_at_idx" ON "device_alerts"("device_id", "detected_at");

-- CreateIndex
CREATE INDEX "device_alerts_status_detected_at_idx" ON "device_alerts"("status", "detected_at");

-- CreateIndex
CREATE INDEX "device_alert_recipients_alert_id_idx" ON "device_alert_recipients"("alert_id");

-- CreateIndex
CREATE INDEX "risk_scores_band_computed_at_idx" ON "risk_scores"("band", "computed_at");

-- CreateIndex
CREATE INDEX "risk_scores_updated_at_idx" ON "risk_scores"("updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "risk_scores_patient_profile_id_condition_code_key" ON "risk_scores"("patient_profile_id", "condition_code");

-- CreateIndex
CREATE UNIQUE INDEX "screening_programmes_code_key" ON "screening_programmes"("code");

-- CreateIndex
CREATE INDEX "screening_invitations_patient_profile_id_status_idx" ON "screening_invitations"("patient_profile_id", "status");

-- CreateIndex
CREATE INDEX "screening_invitations_status_expires_at_idx" ON "screening_invitations"("status", "expires_at");

-- CreateIndex
CREATE INDEX "screening_invitations_updated_at_idx" ON "screening_invitations"("updated_at");

-- CreateIndex
CREATE INDEX "vaccinations_status_due_at_idx" ON "vaccinations"("status", "due_at");

-- CreateIndex
CREATE INDEX "vaccinations_updated_at_idx" ON "vaccinations"("updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "vaccinations_patient_profile_id_vaccine_code_dose_number_key" ON "vaccinations"("patient_profile_id", "vaccine_code", "dose_number");

-- CreateIndex
CREATE UNIQUE INDEX "pharmacies_license_number_key" ON "pharmacies"("license_number");

-- CreateIndex
CREATE INDEX "pharmacies_region_code_is_verified_idx" ON "pharmacies"("region_code", "is_verified");

-- CreateIndex
CREATE INDEX "pharmacy_stock_medication_name_stock_status_idx" ON "pharmacy_stock"("medication_name", "stock_status");

-- CreateIndex
CREATE UNIQUE INDEX "pharmacy_stock_pharmacy_id_medication_name_key" ON "pharmacy_stock"("pharmacy_id", "medication_name");

-- CreateIndex
CREATE UNIQUE INDEX "dispense_codes_code_hash_key" ON "dispense_codes"("code_hash");

-- CreateIndex
CREATE INDEX "dispense_codes_prescription_id_idx" ON "dispense_codes"("prescription_id");

-- CreateIndex
CREATE INDEX "dispense_codes_expires_at_idx" ON "dispense_codes"("expires_at");

-- CreateIndex
CREATE INDEX "dispensing_records_prescription_id_idx" ON "dispensing_records"("prescription_id");

-- CreateIndex
CREATE INDEX "dispensing_records_pharmacy_id_dispensed_at_idx" ON "dispensing_records"("pharmacy_id", "dispensed_at");

-- CreateIndex
CREATE INDEX "dispensing_records_updated_at_idx" ON "dispensing_records"("updated_at");

-- CreateIndex
CREATE INDEX "dispensing_items_dispensing_id_idx" ON "dispensing_items"("dispensing_id");

-- CreateIndex
CREATE INDEX "investigation_orders_care_thread_id_ordered_at_idx" ON "investigation_orders"("care_thread_id", "ordered_at");

-- CreateIndex
CREATE INDEX "investigation_orders_status_urgency_ordered_at_idx" ON "investigation_orders"("status", "urgency", "ordered_at");

-- CreateIndex
CREATE INDEX "investigation_orders_is_critical_acknowledged_at_idx" ON "investigation_orders"("is_critical", "acknowledged_at");

-- CreateIndex
CREATE INDEX "investigation_orders_updated_at_idx" ON "investigation_orders"("updated_at");

-- CreateIndex
CREATE INDEX "investigation_values_order_id_idx" ON "investigation_values"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "communities_name_key" ON "communities"("name");

-- CreateIndex
CREATE UNIQUE INDEX "community_memberships_community_id_clinician_id_key" ON "community_memberships"("community_id", "clinician_id");

-- CreateIndex
CREATE INDEX "discussions_community_id_created_at_idx" ON "discussions"("community_id", "created_at");

-- CreateIndex
CREATE INDEX "discussions_author_clinician_id_idx" ON "discussions"("author_clinician_id");

-- CreateIndex
CREATE INDEX "discussion_replies_discussion_id_created_at_idx" ON "discussion_replies"("discussion_id", "created_at");

-- CreateIndex
CREATE INDEX "second_opinions_status_specialty_requested_at_idx" ON "second_opinions"("status", "specialty", "requested_at");

-- CreateIndex
CREATE INDEX "second_opinions_care_thread_id_idx" ON "second_opinions"("care_thread_id");

-- CreateIndex
CREATE UNIQUE INDEX "education_topics_slug_key" ON "education_topics"("slug");

-- CreateIndex
CREATE INDEX "education_articles_topic_id_language_idx" ON "education_articles"("topic_id", "language");

-- CreateIndex
CREATE INDEX "education_articles_published_at_idx" ON "education_articles"("published_at");

-- CreateIndex
CREATE UNIQUE INDEX "education_articles_slug_language_key" ON "education_articles"("slug", "language");

-- CreateIndex
CREATE INDEX "families_subscription_tier_idx" ON "families"("subscription_tier");

-- CreateIndex
CREATE INDEX "families_updated_at_idx" ON "families"("updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "family_members_family_id_patient_profile_id_key" ON "family_members"("family_id", "patient_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "family_assignments_family_id_key" ON "family_assignments"("family_id");

-- CreateIndex
CREATE INDEX "family_assignments_gp_clinician_id_idx" ON "family_assignments"("gp_clinician_id");

-- CreateIndex
CREATE INDEX "family_assignments_obgyn_clinician_id_idx" ON "family_assignments"("obgyn_clinician_id");

-- CreateIndex
CREATE UNIQUE INDEX "research_datasets_name_key" ON "research_datasets"("name");

-- CreateIndex
CREATE INDEX "research_queries_researcher_id_submitted_at_idx" ON "research_queries"("researcher_id", "submitted_at");

-- CreateIndex
CREATE INDEX "research_queries_status_idx" ON "research_queries"("status");

-- CreateIndex
CREATE INDEX "surveillance_rollups_level_area_code_period_start_idx" ON "surveillance_rollups"("level", "area_code", "period_start");

-- CreateIndex
CREATE INDEX "surveillance_rollups_above_expected_period_start_idx" ON "surveillance_rollups"("above_expected", "period_start");

-- CreateIndex
CREATE UNIQUE INDEX "surveillance_rollups_level_area_code_condition_code_period__key" ON "surveillance_rollups"("level", "area_code", "condition_code", "period_start");

-- CreateIndex
CREATE UNIQUE INDEX "insurance_schemes_name_key" ON "insurance_schemes"("name");

-- CreateIndex
CREATE UNIQUE INDEX "insurance_schemes_code_key" ON "insurance_schemes"("code");

-- CreateIndex
CREATE INDEX "insurance_memberships_patient_profile_id_status_idx" ON "insurance_memberships"("patient_profile_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "insurance_memberships_scheme_id_membership_number_key" ON "insurance_memberships"("scheme_id", "membership_number");

-- CreateIndex
CREATE INDEX "insurance_claims_scheme_id_status_idx" ON "insurance_claims"("scheme_id", "status");

-- CreateIndex
CREATE INDEX "insurance_claims_consultation_id_idx" ON "insurance_claims"("consultation_id");

-- CreateIndex
CREATE UNIQUE INDEX "consultation_ratings_consultation_id_key" ON "consultation_ratings"("consultation_id");

-- CreateIndex
CREATE INDEX "consultation_ratings_clinician_id_created_at_idx" ON "consultation_ratings"("clinician_id", "created_at");

-- CreateIndex
CREATE INDEX "incident_reports_status_severity_reported_at_idx" ON "incident_reports"("status", "severity", "reported_at");

-- CreateIndex
CREATE INDEX "incident_reports_clinician_id_idx" ON "incident_reports"("clinician_id");

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_care_thread_id_fkey" FOREIGN KEY ("care_thread_id") REFERENCES "care_threads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_inferences" ADD CONSTRAINT "ai_inferences_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "ai_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_requests" ADD CONSTRAINT "emergency_requests_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_requests" ADD CONSTRAINT "emergency_requests_reported_by_user_id_fkey" FOREIGN KEY ("reported_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_requests" ADD CONSTRAINT "emergency_requests_transport_unit_id_fkey" FOREIGN KEY ("transport_unit_id") REFERENCES "transport_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_requests" ADD CONSTRAINT "emergency_requests_destination_facility_id_fkey" FOREIGN KEY ("destination_facility_id") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_events" ADD CONSTRAINT "emergency_events_emergency_id_fkey" FOREIGN KEY ("emergency_id") REFERENCES "emergency_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_units" ADD CONSTRAINT "transport_units_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_pings" ADD CONSTRAINT "transport_pings_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "transport_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_telemetry" ADD CONSTRAINT "device_telemetry_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_alerts" ADD CONSTRAINT "device_alerts_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_alert_recipients" ADD CONSTRAINT "device_alert_recipients_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "device_alerts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_scores" ADD CONSTRAINT "risk_scores_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screening_invitations" ADD CONSTRAINT "screening_invitations_programme_id_fkey" FOREIGN KEY ("programme_id") REFERENCES "screening_programmes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screening_invitations" ADD CONSTRAINT "screening_invitations_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaccinations" ADD CONSTRAINT "vaccinations_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaccinations" ADD CONSTRAINT "vaccinations_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacy_stock" ADD CONSTRAINT "pharmacy_stock_pharmacy_id_fkey" FOREIGN KEY ("pharmacy_id") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispense_codes" ADD CONSTRAINT "dispense_codes_prescription_id_fkey" FOREIGN KEY ("prescription_id") REFERENCES "prescriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispense_codes" ADD CONSTRAINT "dispense_codes_pharmacy_id_fkey" FOREIGN KEY ("pharmacy_id") REFERENCES "pharmacies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispensing_records" ADD CONSTRAINT "dispensing_records_prescription_id_fkey" FOREIGN KEY ("prescription_id") REFERENCES "prescriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispensing_records" ADD CONSTRAINT "dispensing_records_pharmacy_id_fkey" FOREIGN KEY ("pharmacy_id") REFERENCES "pharmacies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispensing_items" ADD CONSTRAINT "dispensing_items_dispensing_id_fkey" FOREIGN KEY ("dispensing_id") REFERENCES "dispensing_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispensing_items" ADD CONSTRAINT "dispensing_items_prescription_item_id_fkey" FOREIGN KEY ("prescription_item_id") REFERENCES "prescription_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_orders" ADD CONSTRAINT "investigation_orders_care_thread_id_fkey" FOREIGN KEY ("care_thread_id") REFERENCES "care_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_orders" ADD CONSTRAINT "investigation_orders_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_orders" ADD CONSTRAINT "investigation_orders_ordered_by_id_fkey" FOREIGN KEY ("ordered_by_id") REFERENCES "clinician_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_orders" ADD CONSTRAINT "investigation_orders_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_values" ADD CONSTRAINT "investigation_values_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "investigation_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_memberships" ADD CONSTRAINT "community_memberships_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_memberships" ADD CONSTRAINT "community_memberships_clinician_id_fkey" FOREIGN KEY ("clinician_id") REFERENCES "clinician_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discussions" ADD CONSTRAINT "discussions_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discussions" ADD CONSTRAINT "discussions_author_clinician_id_fkey" FOREIGN KEY ("author_clinician_id") REFERENCES "clinician_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discussions" ADD CONSTRAINT "discussions_care_thread_id_fkey" FOREIGN KEY ("care_thread_id") REFERENCES "care_threads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discussion_replies" ADD CONSTRAINT "discussion_replies_discussion_id_fkey" FOREIGN KEY ("discussion_id") REFERENCES "discussions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discussion_replies" ADD CONSTRAINT "discussion_replies_author_clinician_id_fkey" FOREIGN KEY ("author_clinician_id") REFERENCES "clinician_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "second_opinions" ADD CONSTRAINT "second_opinions_care_thread_id_fkey" FOREIGN KEY ("care_thread_id") REFERENCES "care_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "second_opinions" ADD CONSTRAINT "second_opinions_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "clinician_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "second_opinions" ADD CONSTRAINT "second_opinions_answered_by_id_fkey" FOREIGN KEY ("answered_by_id") REFERENCES "clinician_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "education_articles" ADD CONSTRAINT "education_articles_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "education_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_assignments" ADD CONSTRAINT "family_assignments_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_assignments" ADD CONSTRAINT "family_assignments_gp_clinician_id_fkey" FOREIGN KEY ("gp_clinician_id") REFERENCES "clinician_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_assignments" ADD CONSTRAINT "family_assignments_obgyn_clinician_id_fkey" FOREIGN KEY ("obgyn_clinician_id") REFERENCES "clinician_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_queries" ADD CONSTRAINT "research_queries_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "research_datasets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_queries" ADD CONSTRAINT "research_queries_researcher_id_fkey" FOREIGN KEY ("researcher_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_memberships" ADD CONSTRAINT "insurance_memberships_scheme_id_fkey" FOREIGN KEY ("scheme_id") REFERENCES "insurance_schemes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_memberships" ADD CONSTRAINT "insurance_memberships_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_claims" ADD CONSTRAINT "insurance_claims_consultation_id_fkey" FOREIGN KEY ("consultation_id") REFERENCES "consultation_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_claims" ADD CONSTRAINT "insurance_claims_scheme_id_fkey" FOREIGN KEY ("scheme_id") REFERENCES "insurance_schemes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_ratings" ADD CONSTRAINT "consultation_ratings_consultation_id_fkey" FOREIGN KEY ("consultation_id") REFERENCES "consultation_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_ratings" ADD CONSTRAINT "consultation_ratings_clinician_id_fkey" FOREIGN KEY ("clinician_id") REFERENCES "clinician_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_reported_by_user_id_fkey" FOREIGN KEY ("reported_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_consultation_id_fkey" FOREIGN KEY ("consultation_id") REFERENCES "consultation_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_clinician_id_fkey" FOREIGN KEY ("clinician_id") REFERENCES "clinician_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
