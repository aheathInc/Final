CREATE TYPE "DigitalReferralStatus" AS ENUM (
  'draft', 'submitted', 'received', 'accepted', 'declined', 'in_care', 'completed', 'cancelled', 'expired'
);
CREATE TYPE "DigitalReferralPriority" AS ENUM ('routine', 'urgent', 'emergency');
CREATE TYPE "DigitalReferralOutcomeStatus" AS ENUM ('care_provided', 'redirected', 'unable_to_complete');

CREATE TABLE "digital_referrals" (
  "id" UUID NOT NULL,
  "patient_profile_id" UUID NOT NULL,
  "consultation_id" UUID NOT NULL,
  "source_clinician_id" UUID NOT NULL,
  "source_facility_id" UUID NOT NULL,
  "source_department_id" UUID,
  "destination_facility_id" UUID NOT NULL,
  "destination_department_id" UUID,
  "destination_clinician_id" UUID,
  "received_by_clinician_id" UUID,
  "patient_consent_id" UUID NOT NULL,
  "purpose" VARCHAR(1000) NOT NULL,
  "clinical_summary" VARCHAR(4000) NOT NULL,
  "priority" "DigitalReferralPriority" NOT NULL DEFAULT 'routine',
  "status" "DigitalReferralStatus" NOT NULL DEFAULT 'draft',
  "expires_at" TIMESTAMP(3) NOT NULL,
  "submitted_at" TIMESTAMP(3),
  "received_at" TIMESTAMP(3),
  "accepted_at" TIMESTAMP(3),
  "declined_at" TIMESTAMP(3),
  "decline_reason" VARCHAR(500),
  "care_started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "cancelled_at" TIMESTAMP(3),
  "cancellation_reason" VARCHAR(100),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "digital_referrals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "digital_referrals_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "digital_referrals_consultation_id_fkey" FOREIGN KEY ("consultation_id") REFERENCES "consultation_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "digital_referrals_source_clinician_id_fkey" FOREIGN KEY ("source_clinician_id") REFERENCES "clinician_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "digital_referrals_source_facility_id_fkey" FOREIGN KEY ("source_facility_id") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "digital_referrals_source_department_id_fkey" FOREIGN KEY ("source_department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "digital_referrals_destination_facility_id_fkey" FOREIGN KEY ("destination_facility_id") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "digital_referrals_destination_department_id_fkey" FOREIGN KEY ("destination_department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "digital_referrals_destination_clinician_id_fkey" FOREIGN KEY ("destination_clinician_id") REFERENCES "clinician_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "digital_referrals_received_by_clinician_id_fkey" FOREIGN KEY ("received_by_clinician_id") REFERENCES "clinician_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "digital_referrals_patient_consent_id_fkey" FOREIGN KEY ("patient_consent_id") REFERENCES "patient_consents"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "digital_referrals_patient_created_idx" ON "digital_referrals"("patient_profile_id", "created_at");
CREATE INDEX "digital_referrals_source_status_created_idx" ON "digital_referrals"("source_clinician_id", "status", "created_at");
CREATE INDEX "digital_referrals_destination_inbox_idx" ON "digital_referrals"("destination_facility_id", "destination_department_id", "status", "created_at");
CREATE INDEX "digital_referrals_dest_clin_status_idx" ON "digital_referrals"("destination_clinician_id", "status", "created_at");
CREATE INDEX "digital_referrals_consent_status_idx" ON "digital_referrals"("patient_consent_id", "status");
CREATE INDEX "digital_referrals_status_expires_idx" ON "digital_referrals"("status", "expires_at");

CREATE TABLE "digital_referral_outcomes" (
  "id" UUID NOT NULL,
  "referral_id" UUID NOT NULL,
  "receiving_clinician_id" UUID NOT NULL,
  "status" "DigitalReferralOutcomeStatus" NOT NULL,
  "follow_up_recommendation" VARCHAR(1000),
  "patient_instructions" VARCHAR(1000),
  "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "digital_referral_outcomes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "digital_referral_outcomes_referral_id_key" UNIQUE ("referral_id"),
  CONSTRAINT "digital_referral_outcomes_referral_id_fkey" FOREIGN KEY ("referral_id") REFERENCES "digital_referrals"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "digital_referral_outcomes_receiving_clinician_id_fkey" FOREIGN KEY ("receiving_clinician_id") REFERENCES "clinician_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
