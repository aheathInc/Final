-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('patient', 'clinician', 'pharmacist', 'lab_technician', 'dispatcher', 'facility_admin', 'platform_admin');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'suspended', 'pending_verification', 'deactivated');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('pending', 'verified', 'rejected');

-- CreateEnum
CREATE TYPE "Sex" AS ENUM ('male', 'female', 'other');

-- CreateEnum
CREATE TYPE "LanguageCode" AS ENUM ('sw', 'en', 'fr', 'ha', 'am');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('app', 'sms', 'ussd', 'voice', 'web');

-- CreateEnum
CREATE TYPE "Specialty" AS ENUM ('general_practice', 'internal_medicine', 'paediatrics', 'obstetrics_gynaecology', 'surgery', 'oncology', 'psychiatry', 'dermatology', 'other');

-- CreateEnum
CREATE TYPE "UrgencyLevel" AS ENUM ('routine', 'urgent', 'emergency');

-- CreateEnum
CREATE TYPE "ConsultationStatus" AS ENUM ('pending', 'offered', 'matched', 'in_progress', 'completed', 'escalated', 'cancelled');

-- CreateEnum
CREATE TYPE "ConsultationModality" AS ENUM ('chat', 'voice', 'video', 'async');

-- CreateEnum
CREATE TYPE "CareThreadStatus" AS ENUM ('open', 'closed');

-- CreateEnum
CREATE TYPE "CareThreadOutcome" AS ENUM ('recovered', 'referred_out', 'lost_to_follow_up', 'deceased');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('booked', 'started', 'completed', 'cancelled', 'no_show');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('offered', 'accepted', 'declined', 'expired');

-- CreateEnum
CREATE TYPE "PrescriptionStatus" AS ENUM ('active', 'completed', 'discontinued');

-- CreateEnum
CREATE TYPE "AdherenceStatus" AS ENUM ('taken', 'missed', 'delayed', 'unreported');

-- CreateEnum
CREATE TYPE "FollowUpFrequency" AS ENUM ('daily', 'twice_daily', 'weekly', 'custom');

-- CreateEnum
CREATE TYPE "FollowUpStatus" AS ENUM ('active', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "FollowUpOutcome" AS ENUM ('recovered', 'escalated', 'lost_to_follow_up');

-- CreateEnum
CREATE TYPE "CheckInStatus" AS ENUM ('scheduled', 'responded', 'missed');

-- CreateEnum
CREATE TYPE "FacilityType" AS ENUM ('hospital', 'clinic', 'pharmacy', 'transport_partner');

-- CreateEnum
CREATE TYPE "AttachmentType" AS ENUM ('voice_note', 'image', 'document');

-- CreateEnum
CREATE TYPE "ChangeOp" AS ENUM ('create', 'update', 'delete');

-- CreateEnum
CREATE TYPE "ConsentScope" AS ENUM ('full_history', 'current_thread', 'medications_only', 'investigations_only', 'emergency_minimum');

-- CreateEnum
CREATE TYPE "ConsentGranteeType" AS ENUM ('clinician', 'facility', 'researcher', 'emergency_responder');

-- CreateEnum
CREATE TYPE "RecordType" AS ENUM ('lab_result', 'imaging', 'pathology', 'discharge_summary', 'vaccination', 'prior_history', 'referral_letter', 'other');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('queued', 'sent', 'delivered', 'failed');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "phone_number" VARCHAR(20) NOT NULL,
    "role" "UserRole" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'pending_verification',
    "full_name" VARCHAR(150),
    "email" VARCHAR(150),
    "password_hash" VARCHAR(255),
    "mfa_secret" VARCHAR(255),
    "preferred_language" "LanguageCode" NOT NULL DEFAULT 'sw',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "guardian_user_id" UUID,
    "full_name" VARCHAR(150) NOT NULL,
    "date_of_birth" DATE,
    "sex" "Sex",
    "chronic_conditions" JSONB NOT NULL DEFAULT '[]',
    "allergies" JSONB NOT NULL DEFAULT '[]',
    "blood_type" VARCHAR(5),
    "default_lat" DOUBLE PRECISION,
    "default_lng" DOUBLE PRECISION,
    "region_code" VARCHAR(20),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinician_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "facility_id" UUID,
    "license_number" VARCHAR(50) NOT NULL,
    "specialty" "Specialty" NOT NULL,
    "verification_status" "VerificationStatus" NOT NULL DEFAULT 'pending',
    "rejection_reason" TEXT,
    "verification_docs" JSONB NOT NULL DEFAULT '[]',
    "languages_spoken" JSONB NOT NULL DEFAULT '[]',
    "is_available" BOOLEAN NOT NULL DEFAULT false,
    "available_until" TIMESTAMP(3),
    "current_load" INTEGER NOT NULL DEFAULT 0,
    "rating_avg" DECIMAL(3,2),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinician_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facilities" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "type" "FacilityType" NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "region_code" VARCHAR(20),
    "contact_phone" VARCHAR(20),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "facilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_challenges" (
    "id" UUID NOT NULL,
    "phone_number" VARCHAR(20) NOT NULL,
    "code_hash" VARCHAR(255) NOT NULL,
    "delivery_channel" "Channel" NOT NULL DEFAULT 'sms',
    "purpose" VARCHAR(40) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "family_id" UUID NOT NULL,
    "device_id" VARCHAR(128),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slots" (
    "id" UUID NOT NULL,
    "clinician_id" UUID NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "modality" "ConsultationModality" NOT NULL DEFAULT 'chat',
    "is_booked" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" UUID NOT NULL,
    "slot_id" UUID NOT NULL,
    "care_thread_id" UUID,
    "patient_profile_id" UUID NOT NULL,
    "clinician_id" UUID NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "modality" "ConsultationModality" NOT NULL DEFAULT 'chat',
    "reason" TEXT,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'booked',
    "cancelled_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "care_threads" (
    "id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "primary_clinician_id" UUID,
    "status" "CareThreadStatus" NOT NULL DEFAULT 'open',
    "reason_summary" VARCHAR(300),
    "outcome" "CareThreadOutcome",
    "outcome_notes" TEXT,
    "latest_consultation_id" UUID,
    "open_consultation_count" INTEGER NOT NULL DEFAULT 0,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "care_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consultation_requests" (
    "id" UUID NOT NULL,
    "care_thread_id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "assigned_clinician_id" UUID,
    "referred_from_consultation_id" UUID,
    "appointment_id" UUID,
    "channel" "Channel" NOT NULL,
    "modality" "ConsultationModality" NOT NULL DEFAULT 'chat',
    "symptom_text" TEXT,
    "structured_symptoms" JSONB NOT NULL DEFAULT '[]',
    "voice_note_key" TEXT,
    "request_lat" DOUBLE PRECISION,
    "request_lng" DOUBLE PRECISION,
    "urgency_level" "UrgencyLevel" NOT NULL,
    "triage_rule_version" VARCHAR(40) NOT NULL,
    "status" "ConsultationStatus" NOT NULL DEFAULT 'pending',
    "sla_deadline_at" TIMESTAMP(3) NOT NULL,
    "escalation_count" INTEGER NOT NULL DEFAULT 0,
    "client_created_at" TIMESTAMP(3),
    "accepted_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consultation_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consultation_offers" (
    "id" UUID NOT NULL,
    "consultation_id" UUID NOT NULL,
    "clinician_id" UUID NOT NULL,
    "rank_score" DECIMAL(6,4) NOT NULL,
    "rank_weights" JSONB NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'offered',
    "decline_reason" VARCHAR(60),
    "offered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consultation_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consultation_notes" (
    "id" UUID NOT NULL,
    "consultation_id" UUID NOT NULL,
    "care_thread_id" UUID NOT NULL,
    "diagnosis_text" TEXT NOT NULL,
    "diagnosis_codes" JSONB NOT NULL DEFAULT '[]',
    "advice_text" TEXT NOT NULL,
    "red_flags_discussed" JSONB NOT NULL DEFAULT '[]',
    "referred_specialist_id" UUID,
    "signed_by_clinician_id" UUID NOT NULL,
    "signed_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consultation_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "care_thread_id" UUID NOT NULL,
    "consultation_id" UUID,
    "sender_user_id" UUID NOT NULL,
    "body" TEXT,
    "attachment_key" TEXT,
    "attachment_type" "AttachmentType",
    "delivered_via" "Channel" NOT NULL DEFAULT 'app',
    "read_at" TIMESTAMP(3),
    "client_created_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescriptions" (
    "id" UUID NOT NULL,
    "care_thread_id" UUID NOT NULL,
    "consultation_id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "prescribed_by_id" UUID NOT NULL,
    "status" "PrescriptionStatus" NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prescriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescription_items" (
    "id" UUID NOT NULL,
    "prescription_id" UUID NOT NULL,
    "medication_name" VARCHAR(150) NOT NULL,
    "dosage" VARCHAR(50) NOT NULL,
    "frequency_per_day" INTEGER NOT NULL,
    "duration_days" INTEGER NOT NULL,
    "instructions" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prescription_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adherence_logs" (
    "id" UUID NOT NULL,
    "prescription_item_id" UUID NOT NULL,
    "prescription_id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "medication_name" VARCHAR(150) NOT NULL,
    "dosage" VARCHAR(50) NOT NULL,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "reported_status" "AdherenceStatus" NOT NULL DEFAULT 'unreported',
    "reported_at" TIMESTAMP(3),
    "note" VARCHAR(500),
    "channel" "Channel",
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "adherence_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follow_up_cycles" (
    "id" UUID NOT NULL,
    "care_thread_id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "clinician_id" UUID NOT NULL,
    "source_consultation_id" UUID NOT NULL,
    "frequency" "FollowUpFrequency" NOT NULL,
    "custom_cron" VARCHAR(120),
    "questionnaire_key" VARCHAR(80),
    "recovery_criteria" JSONB NOT NULL DEFAULT '{}',
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "FollowUpStatus" NOT NULL DEFAULT 'active',
    "outcome" "FollowUpOutcome",
    "open_deviation_count" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "follow_up_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "check_ins" (
    "id" UUID NOT NULL,
    "follow_up_cycle_id" UUID NOT NULL,
    "care_thread_id" UUID NOT NULL,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "status" "CheckInStatus" NOT NULL DEFAULT 'scheduled',
    "questions" JSONB NOT NULL DEFAULT '[]',
    "responses" JSONB,
    "is_deviation" BOOLEAN NOT NULL DEFAULT false,
    "deviation_reasons" JSONB NOT NULL DEFAULT '[]',
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMP(3),
    "responded_at" TIMESTAMP(3),
    "channel" "Channel",
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "check_ins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_consents" (
    "id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "grantee_type" "ConsentGranteeType" NOT NULL,
    "grantee_clinician_id" UUID,
    "grantee_facility_id" UUID,
    "care_thread_id" UUID,
    "scope" "ConsentScope" NOT NULL,
    "allowed" BOOLEAN NOT NULL DEFAULT true,
    "break_glass" BOOLEAN NOT NULL DEFAULT false,
    "reason" VARCHAR(500),
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medical_records" (
    "id" UUID NOT NULL,
    "patient_profile_id" UUID NOT NULL,
    "care_thread_id" UUID,
    "record_type" "RecordType" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT,
    "structured" JSONB NOT NULL DEFAULT '{}',
    "attachment_key" TEXT,
    "attachment_type" "AttachmentType",
    "source_facility_id" UUID,
    "recorded_by_id" UUID,
    "is_critical" BOOLEAN NOT NULL DEFAULT false,
    "acknowledged_at" TIMESTAMP(3),
    "recorded_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medical_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "key" VARCHAR(64) NOT NULL,
    "user_id" UUID,
    "method" VARCHAR(10) NOT NULL,
    "path" VARCHAR(300) NOT NULL,
    "request_hash" VARCHAR(64) NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "locked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "change_log" (
    "seq" BIGSERIAL NOT NULL,
    "entity" VARCHAR(60) NOT NULL,
    "entity_id" UUID NOT NULL,
    "op" "ChangeOp" NOT NULL,
    "version" INTEGER NOT NULL,
    "patient_profile_id" UUID,
    "clinician_id" UUID,
    "care_thread_id" UUID,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_log_pkey" PRIMARY KEY ("seq")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "seq" BIGSERIAL NOT NULL,
    "actor_user_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(60) NOT NULL,
    "entity_id" UUID,
    "reason" VARCHAR(500),
    "ip_address" VARCHAR(45),
    "request_id" VARCHAR(64),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "prev_hash" VARCHAR(64),
    "hash" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("seq")
);

-- CreateTable
CREATE TABLE "notification_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "channel" "Channel" NOT NULL,
    "template_key" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "NotificationStatus" NOT NULL DEFAULT 'queued',
    "provider_ref" VARCHAR(120),
    "failure_code" VARCHAR(60),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_number_key" ON "users"("phone_number");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_status_role_idx" ON "users"("status", "role");

-- CreateIndex
CREATE INDEX "users_updated_at_idx" ON "users"("updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "patient_profiles_user_id_key" ON "patient_profiles"("user_id");

-- CreateIndex
CREATE INDEX "patient_profiles_guardian_user_id_idx" ON "patient_profiles"("guardian_user_id");

-- CreateIndex
CREATE INDEX "patient_profiles_region_code_idx" ON "patient_profiles"("region_code");

-- CreateIndex
CREATE INDEX "patient_profiles_updated_at_idx" ON "patient_profiles"("updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "clinician_profiles_user_id_key" ON "clinician_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "clinician_profiles_license_number_key" ON "clinician_profiles"("license_number");

-- CreateIndex
CREATE INDEX "clinician_profiles_verification_status_is_available_special_idx" ON "clinician_profiles"("verification_status", "is_available", "specialty");

-- CreateIndex
CREATE INDEX "clinician_profiles_updated_at_idx" ON "clinician_profiles"("updated_at");

-- CreateIndex
CREATE INDEX "facilities_region_code_type_idx" ON "facilities"("region_code", "type");

-- CreateIndex
CREATE INDEX "otp_challenges_phone_number_created_at_idx" ON "otp_challenges"("phone_number", "created_at");

-- CreateIndex
CREATE INDEX "otp_challenges_expires_at_idx" ON "otp_challenges"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_revoked_at_idx" ON "refresh_tokens"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE INDEX "slots_clinician_id_starts_at_is_booked_idx" ON "slots"("clinician_id", "starts_at", "is_booked");

-- CreateIndex
CREATE UNIQUE INDEX "slots_clinician_id_starts_at_key" ON "slots"("clinician_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_slot_id_key" ON "appointments"("slot_id");

-- CreateIndex
CREATE INDEX "appointments_patient_profile_id_starts_at_idx" ON "appointments"("patient_profile_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointments_clinician_id_starts_at_idx" ON "appointments"("clinician_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointments_status_starts_at_idx" ON "appointments"("status", "starts_at");

-- CreateIndex
CREATE INDEX "appointments_updated_at_idx" ON "appointments"("updated_at");

-- CreateIndex
CREATE INDEX "care_threads_patient_profile_id_status_idx" ON "care_threads"("patient_profile_id", "status");

-- CreateIndex
CREATE INDEX "care_threads_primary_clinician_id_status_idx" ON "care_threads"("primary_clinician_id", "status");

-- CreateIndex
CREATE INDEX "care_threads_updated_at_idx" ON "care_threads"("updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "consultation_requests_appointment_id_key" ON "consultation_requests"("appointment_id");

-- CreateIndex
CREATE INDEX "consultation_requests_status_urgency_level_sla_deadline_at_idx" ON "consultation_requests"("status", "urgency_level", "sla_deadline_at");

-- CreateIndex
CREATE INDEX "consultation_requests_assigned_clinician_id_status_idx" ON "consultation_requests"("assigned_clinician_id", "status");

-- CreateIndex
CREATE INDEX "consultation_requests_care_thread_id_created_at_idx" ON "consultation_requests"("care_thread_id", "created_at");

-- CreateIndex
CREATE INDEX "consultation_requests_updated_at_idx" ON "consultation_requests"("updated_at");

-- CreateIndex
CREATE INDEX "consultation_offers_clinician_id_status_expires_at_idx" ON "consultation_offers"("clinician_id", "status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "consultation_offers_consultation_id_clinician_id_key" ON "consultation_offers"("consultation_id", "clinician_id");

-- CreateIndex
CREATE UNIQUE INDEX "consultation_notes_consultation_id_key" ON "consultation_notes"("consultation_id");

-- CreateIndex
CREATE INDEX "consultation_notes_care_thread_id_signed_at_idx" ON "consultation_notes"("care_thread_id", "signed_at");

-- CreateIndex
CREATE INDEX "consultation_notes_signed_by_clinician_id_idx" ON "consultation_notes"("signed_by_clinician_id");

-- CreateIndex
CREATE INDEX "messages_care_thread_id_created_at_idx" ON "messages"("care_thread_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_consultation_id_created_at_idx" ON "messages"("consultation_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_updated_at_idx" ON "messages"("updated_at");

-- CreateIndex
CREATE INDEX "prescriptions_patient_profile_id_status_idx" ON "prescriptions"("patient_profile_id", "status");

-- CreateIndex
CREATE INDEX "prescriptions_updated_at_idx" ON "prescriptions"("updated_at");

-- CreateIndex
CREATE INDEX "prescription_items_prescription_id_idx" ON "prescription_items"("prescription_id");

-- CreateIndex
CREATE INDEX "adherence_logs_patient_profile_id_scheduled_at_idx" ON "adherence_logs"("patient_profile_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "adherence_logs_prescription_id_reported_status_idx" ON "adherence_logs"("prescription_id", "reported_status");

-- CreateIndex
CREATE INDEX "adherence_logs_scheduled_at_reported_status_idx" ON "adherence_logs"("scheduled_at", "reported_status");

-- CreateIndex
CREATE INDEX "adherence_logs_updated_at_idx" ON "adherence_logs"("updated_at");

-- CreateIndex
CREATE INDEX "follow_up_cycles_patient_profile_id_status_idx" ON "follow_up_cycles"("patient_profile_id", "status");

-- CreateIndex
CREATE INDEX "follow_up_cycles_clinician_id_status_idx" ON "follow_up_cycles"("clinician_id", "status");

-- CreateIndex
CREATE INDEX "follow_up_cycles_updated_at_idx" ON "follow_up_cycles"("updated_at");

-- CreateIndex
CREATE INDEX "check_ins_follow_up_cycle_id_scheduled_at_idx" ON "check_ins"("follow_up_cycle_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "check_ins_status_scheduled_at_idx" ON "check_ins"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "check_ins_is_deviation_reviewed_at_idx" ON "check_ins"("is_deviation", "reviewed_at");

-- CreateIndex
CREATE INDEX "check_ins_updated_at_idx" ON "check_ins"("updated_at");

-- CreateIndex
CREATE INDEX "patient_consents_patient_profile_id_allowed_revoked_at_idx" ON "patient_consents"("patient_profile_id", "allowed", "revoked_at");

-- CreateIndex
CREATE INDEX "patient_consents_grantee_clinician_id_allowed_idx" ON "patient_consents"("grantee_clinician_id", "allowed");

-- CreateIndex
CREATE INDEX "patient_consents_updated_at_idx" ON "patient_consents"("updated_at");

-- CreateIndex
CREATE INDEX "medical_records_patient_profile_id_recorded_at_idx" ON "medical_records"("patient_profile_id", "recorded_at");

-- CreateIndex
CREATE INDEX "medical_records_care_thread_id_record_type_idx" ON "medical_records"("care_thread_id", "record_type");

-- CreateIndex
CREATE INDEX "medical_records_is_critical_acknowledged_at_idx" ON "medical_records"("is_critical", "acknowledged_at");

-- CreateIndex
CREATE INDEX "medical_records_updated_at_idx" ON "medical_records"("updated_at");

-- CreateIndex
CREATE INDEX "idempotency_records_expires_at_idx" ON "idempotency_records"("expires_at");

-- CreateIndex
CREATE INDEX "change_log_patient_profile_id_seq_idx" ON "change_log"("patient_profile_id", "seq");

-- CreateIndex
CREATE INDEX "change_log_clinician_id_seq_idx" ON "change_log"("clinician_id", "seq");

-- CreateIndex
CREATE INDEX "change_log_entity_entity_id_idx" ON "change_log"("entity", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_created_at_idx" ON "audit_logs"("entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");

-- CreateIndex
CREATE INDEX "notification_logs_user_id_created_at_idx" ON "notification_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "notification_logs_status_created_at_idx" ON "notification_logs"("status", "created_at");

-- AddForeignKey
ALTER TABLE "patient_profiles" ADD CONSTRAINT "patient_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_profiles" ADD CONSTRAINT "patient_profiles_guardian_user_id_fkey" FOREIGN KEY ("guardian_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinician_profiles" ADD CONSTRAINT "clinician_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinician_profiles" ADD CONSTRAINT "clinician_profiles_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slots" ADD CONSTRAINT "slots_clinician_id_fkey" FOREIGN KEY ("clinician_id") REFERENCES "clinician_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_care_thread_id_fkey" FOREIGN KEY ("care_thread_id") REFERENCES "care_threads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_clinician_id_fkey" FOREIGN KEY ("clinician_id") REFERENCES "clinician_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_threads" ADD CONSTRAINT "care_threads_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_threads" ADD CONSTRAINT "care_threads_primary_clinician_id_fkey" FOREIGN KEY ("primary_clinician_id") REFERENCES "clinician_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_requests" ADD CONSTRAINT "consultation_requests_care_thread_id_fkey" FOREIGN KEY ("care_thread_id") REFERENCES "care_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_requests" ADD CONSTRAINT "consultation_requests_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_requests" ADD CONSTRAINT "consultation_requests_assigned_clinician_id_fkey" FOREIGN KEY ("assigned_clinician_id") REFERENCES "clinician_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_requests" ADD CONSTRAINT "consultation_requests_referred_from_consultation_id_fkey" FOREIGN KEY ("referred_from_consultation_id") REFERENCES "consultation_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_requests" ADD CONSTRAINT "consultation_requests_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_offers" ADD CONSTRAINT "consultation_offers_consultation_id_fkey" FOREIGN KEY ("consultation_id") REFERENCES "consultation_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_offers" ADD CONSTRAINT "consultation_offers_clinician_id_fkey" FOREIGN KEY ("clinician_id") REFERENCES "clinician_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_notes" ADD CONSTRAINT "consultation_notes_consultation_id_fkey" FOREIGN KEY ("consultation_id") REFERENCES "consultation_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_notes" ADD CONSTRAINT "consultation_notes_care_thread_id_fkey" FOREIGN KEY ("care_thread_id") REFERENCES "care_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_notes" ADD CONSTRAINT "consultation_notes_referred_specialist_id_fkey" FOREIGN KEY ("referred_specialist_id") REFERENCES "clinician_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_notes" ADD CONSTRAINT "consultation_notes_signed_by_clinician_id_fkey" FOREIGN KEY ("signed_by_clinician_id") REFERENCES "clinician_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_care_thread_id_fkey" FOREIGN KEY ("care_thread_id") REFERENCES "care_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_consultation_id_fkey" FOREIGN KEY ("consultation_id") REFERENCES "consultation_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_care_thread_id_fkey" FOREIGN KEY ("care_thread_id") REFERENCES "care_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_consultation_id_fkey" FOREIGN KEY ("consultation_id") REFERENCES "consultation_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_prescribed_by_id_fkey" FOREIGN KEY ("prescribed_by_id") REFERENCES "clinician_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_items" ADD CONSTRAINT "prescription_items_prescription_id_fkey" FOREIGN KEY ("prescription_id") REFERENCES "prescriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adherence_logs" ADD CONSTRAINT "adherence_logs_prescription_item_id_fkey" FOREIGN KEY ("prescription_item_id") REFERENCES "prescription_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adherence_logs" ADD CONSTRAINT "adherence_logs_prescription_id_fkey" FOREIGN KEY ("prescription_id") REFERENCES "prescriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adherence_logs" ADD CONSTRAINT "adherence_logs_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_up_cycles" ADD CONSTRAINT "follow_up_cycles_care_thread_id_fkey" FOREIGN KEY ("care_thread_id") REFERENCES "care_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_up_cycles" ADD CONSTRAINT "follow_up_cycles_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_up_cycles" ADD CONSTRAINT "follow_up_cycles_clinician_id_fkey" FOREIGN KEY ("clinician_id") REFERENCES "clinician_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_up_cycles" ADD CONSTRAINT "follow_up_cycles_source_consultation_id_fkey" FOREIGN KEY ("source_consultation_id") REFERENCES "consultation_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_follow_up_cycle_id_fkey" FOREIGN KEY ("follow_up_cycle_id") REFERENCES "follow_up_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_care_thread_id_fkey" FOREIGN KEY ("care_thread_id") REFERENCES "care_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "clinician_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_consents" ADD CONSTRAINT "patient_consents_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_consents" ADD CONSTRAINT "patient_consents_grantee_clinician_id_fkey" FOREIGN KEY ("grantee_clinician_id") REFERENCES "clinician_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_consents" ADD CONSTRAINT "patient_consents_grantee_facility_id_fkey" FOREIGN KEY ("grantee_facility_id") REFERENCES "facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_consents" ADD CONSTRAINT "patient_consents_care_thread_id_fkey" FOREIGN KEY ("care_thread_id") REFERENCES "care_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_records" ADD CONSTRAINT "medical_records_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_records" ADD CONSTRAINT "medical_records_care_thread_id_fkey" FOREIGN KEY ("care_thread_id") REFERENCES "care_threads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_records" ADD CONSTRAINT "medical_records_source_facility_id_fkey" FOREIGN KEY ("source_facility_id") REFERENCES "facilities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_records" ADD CONSTRAINT "medical_records_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "clinician_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
