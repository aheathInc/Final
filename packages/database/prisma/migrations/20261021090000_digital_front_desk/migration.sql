-- Additive. Existing facilities remain disabled until a policy is reviewed.
ALTER TABLE "facilities" ADD COLUMN "digital_desk_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "desk_payment_required" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "desk_insurance_required" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "departments" ADD COLUMN "navigation_aliases" JSONB NOT NULL DEFAULT '[]';
CREATE TYPE "FrontDeskVisitStatus" AS ENUM ('preregistered','awaiting_review','waiting','called','in_consultation','completed','cancelled');
CREATE TYPE "FrontDeskTriageStatus" AS ENUM ('pending','cleared','escalated');
CREATE TYPE "FrontDeskAdministrativeCheck" AS ENUM ('pending','manually_verified','not_required');
CREATE TABLE "front_desk_visits" (
  "id" UUID PRIMARY KEY,
  "ticket_number" SERIAL NOT NULL,
  "patient_profile_id" UUID NOT NULL REFERENCES "patient_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "created_by_user_id" UUID NOT NULL,
  "facility_id" UUID NOT NULL REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "department_id" UUID NOT NULL REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "requested_clinician_id" UUID REFERENCES "clinician_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "assigned_clinician_id" UUID REFERENCES "clinician_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "consultation_id" UUID REFERENCES "consultation_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "status" "FrontDeskVisitStatus" NOT NULL DEFAULT 'preregistered',
  "purpose" VARCHAR(2000) NOT NULL,
  "department_share_at" TIMESTAMP(3) NOT NULL,
  "checked_in_at" TIMESTAMP(3),
  "administrative_at" TIMESTAMP(3), "administrative_by" UUID,
  "payment_required" BOOLEAN NOT NULL, "insurance_required" BOOLEAN NOT NULL,
  "payment_check" "FrontDeskAdministrativeCheck" NOT NULL DEFAULT 'pending',
  "insurance_check" "FrontDeskAdministrativeCheck" NOT NULL DEFAULT 'pending',
  "payment_reference" VARCHAR(120), "insurance_reference" VARCHAR(120),
  "triage_status" "FrontDeskTriageStatus" NOT NULL DEFAULT 'pending',
  "triage_by" UUID, "triage_at" TIMESTAMP(3),
  "ready_at" TIMESTAMP(3), "called_at" TIMESTAMP(3), "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3), "cancelled_at" TIMESTAMP(3),
  "request_key" UUID NOT NULL, "request_hash" CHAR(64) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "desk_payment_requirement" CHECK (NOT "payment_required" OR "payment_check" <> 'not_required'),
  CONSTRAINT "desk_insurance_requirement" CHECK (NOT "insurance_required" OR "insurance_check" <> 'not_required'),
  CONSTRAINT "desk_ready_gate" CHECK (
    "status" NOT IN ('waiting','called','in_consultation','completed') OR
    ("checked_in_at" IS NOT NULL AND "administrative_at" IS NOT NULL AND "administrative_by" IS NOT NULL
     AND "triage_status" = 'cleared' AND "triage_by" IS NOT NULL AND "triage_at" IS NOT NULL
     AND "payment_check" <> 'pending' AND "insurance_check" <> 'pending' AND "ready_at" IS NOT NULL)),
  CONSTRAINT "desk_called_gate" CHECK ("status" NOT IN ('called','in_consultation','completed') OR
    ("assigned_clinician_id" IS NOT NULL AND "called_at" IS NOT NULL)),
  CONSTRAINT "desk_consultation_gate" CHECK ("status" NOT IN ('in_consultation','completed') OR
    ("consultation_id" IS NOT NULL AND "started_at" IS NOT NULL)),
  CONSTRAINT "desk_completed_gate" CHECK ("status" <> 'completed' OR "completed_at" IS NOT NULL),
  CONSTRAINT "desk_cancelled_gate" CHECK ("status" <> 'cancelled' OR "cancelled_at" IS NOT NULL)
);
CREATE UNIQUE INDEX "front_desk_visits_ticket_number_key" ON "front_desk_visits"("ticket_number");
CREATE UNIQUE INDEX "front_desk_visits_consultation_id_key" ON "front_desk_visits"("consultation_id");
CREATE UNIQUE INDEX "front_desk_visits_patient_profile_id_request_key_key" ON "front_desk_visits"("patient_profile_id","request_key");
CREATE INDEX "front_desk_queue_order_idx" ON "front_desk_visits"("facility_id","department_id","status","ready_at","id");
CREATE INDEX "front_desk_visits_patient_profile_id_created_at_idx" ON "front_desk_visits"("patient_profile_id","created_at");
CREATE INDEX "front_desk_visits_assigned_clinician_id_status_idx" ON "front_desk_visits"("assigned_clinician_id","status");
-- Database backstops for concurrent writes (partial indexes cannot be expressed in Prisma 6).
CREATE UNIQUE INDEX "front_desk_one_active_patient_facility" ON "front_desk_visits"("patient_profile_id","facility_id")
  WHERE "status" NOT IN ('completed','cancelled');
CREATE UNIQUE INDEX "front_desk_one_called_patient_per_clinician" ON "front_desk_visits"("assigned_clinician_id")
  WHERE "assigned_clinician_id" IS NOT NULL AND "status" IN ('called','in_consultation');
