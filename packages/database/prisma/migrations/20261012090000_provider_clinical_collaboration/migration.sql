CREATE TYPE "ClinicalCollaborationStatus" AS ENUM ('requested', 'accepted', 'declined', 'revoked', 'expired');
CREATE TYPE "ClinicalCollaborationScope" AS ENUM ('consultation_summary');

ALTER TABLE "clinician_profiles"
  ADD COLUMN "department_id" UUID;

ALTER TABLE "clinician_profiles"
  ADD CONSTRAINT "clinician_profiles_department_id_fkey"
  FOREIGN KEY ("department_id") REFERENCES "departments"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "clinician_profiles_department_id_idx" ON "clinician_profiles"("department_id");

CREATE TABLE "provider_clinical_collaborations" (
  "id" UUID NOT NULL,
  "consultation_id" UUID NOT NULL,
  "care_thread_id" UUID NOT NULL,
  "requester_clinician_id" UUID NOT NULL,
  "invited_clinician_id" UUID NOT NULL,
  "requester_facility_id" UUID,
  "requester_department_id" UUID,
  "invited_facility_id" UUID,
  "invited_department_id" UUID,
  "patient_consent_id" UUID,
  "scope" "ClinicalCollaborationScope" NOT NULL DEFAULT 'consultation_summary',
  "status" "ClinicalCollaborationStatus" NOT NULL DEFAULT 'requested',
  "question" VARCHAR(4000) NOT NULL,
  "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "responded_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "revoked_by_user_id" UUID,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "provider_clinical_collaborations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "provider_clinical_collaborations_consultation_id_fkey"
    FOREIGN KEY ("consultation_id") REFERENCES "consultation_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "provider_clinical_collaborations_care_thread_id_fkey"
    FOREIGN KEY ("care_thread_id") REFERENCES "care_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "provider_clinical_collaborations_requester_clinician_id_fkey"
    FOREIGN KEY ("requester_clinician_id") REFERENCES "clinician_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "provider_clinical_collaborations_invited_clinician_id_fkey"
    FOREIGN KEY ("invited_clinician_id") REFERENCES "clinician_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "provider_clinical_collaborations_patient_consent_id_fkey"
    FOREIGN KEY ("patient_consent_id") REFERENCES "patient_consents"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "provider_clinical_collaborations_consultation_id_status_idx"
  ON "provider_clinical_collaborations"("consultation_id", "status");
CREATE INDEX "provider_clinical_collaborations_requester_clinician_id_status_requested_at_idx"
  ON "provider_clinical_collaborations"("requester_clinician_id", "status", "requested_at");
CREATE INDEX "provider_clinical_collaborations_invited_clinician_id_status_requested_at_idx"
  ON "provider_clinical_collaborations"("invited_clinician_id", "status", "requested_at");
CREATE INDEX "provider_clinical_collaborations_patient_consent_id_status_idx"
  ON "provider_clinical_collaborations"("patient_consent_id", "status");
CREATE INDEX "provider_clinical_collaborations_status_expires_at_idx"
  ON "provider_clinical_collaborations"("status", "expires_at");

CREATE TABLE "provider_clinical_collaboration_messages" (
  "id" UUID NOT NULL,
  "collaboration_id" UUID NOT NULL,
  "author_clinician_id" UUID NOT NULL,
  "body" VARCHAR(8000) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_clinical_collaboration_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "provider_clinical_collaboration_messages_collaboration_id_fkey"
    FOREIGN KEY ("collaboration_id") REFERENCES "provider_clinical_collaborations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "provider_clinical_collaboration_messages_author_clinician_id_fkey"
    FOREIGN KEY ("author_clinician_id") REFERENCES "clinician_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "provider_clinical_collaboration_messages_collaboration_id_created_at_idx"
  ON "provider_clinical_collaboration_messages"("collaboration_id", "created_at");
