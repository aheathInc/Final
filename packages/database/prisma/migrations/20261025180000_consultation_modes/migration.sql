CREATE TYPE "ConsultationMode" AS ENUM ('hospital', 'remote');
ALTER TYPE "ConsultationModality" ADD VALUE 'in_person';
ALTER TABLE "consultation_requests"
  ADD COLUMN "consultation_mode" "ConsultationMode" NOT NULL DEFAULT 'remote',
  ADD COLUMN "facility_id" UUID,
  ADD COLUMN "facility_name" VARCHAR(200),
  ADD COLUMN "requested_clinician_id" UUID,
  ADD COLUMN "consultation_fee_amount" INTEGER,
  ADD COLUMN "fee_policy_version" VARCHAR(40);
ALTER TABLE "consultation_requests" ADD CONSTRAINT "consultation_fee_nonnegative"
  CHECK ("consultation_fee_amount" IS NULL OR "consultation_fee_amount" >= 0);
CREATE TABLE "consultation_calls" (
  "id" UUID NOT NULL PRIMARY KEY, "consultation_id" UUID NOT NULL,
  "caller_user_id" UUID NOT NULL, "answerer_user_id" UUID,
  "offer" TEXT, "answer" TEXT,
  "ended_at" TIMESTAMP(3), "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "consultation_calls_consultation_id_fkey" FOREIGN KEY ("consultation_id") REFERENCES "consultation_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "consultation_calls_consultation_id_expires_at_idx" ON "consultation_calls"("consultation_id", "expires_at");
ALTER TABLE "consultation_requests" ADD CONSTRAINT "consultation_requests_facility_id_fkey"
  FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "consultation_requests_facility_id_consultation_mode_status_idx"
  ON "consultation_requests"("facility_id", "consultation_mode", "status");
