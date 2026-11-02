ALTER TYPE "PaymentPurpose" ADD VALUE 'registration_fee';
ALTER TABLE "users" ADD COLUMN "onboarding_required" BOOLEAN NOT NULL DEFAULT false;
UPDATE "users" SET "onboarding_required" = true WHERE role = 'patient' AND status = 'pending_verification';
ALTER TABLE "patient_profiles" ADD COLUMN "residence" VARCHAR(250), ADD COLUMN "next_of_kin_name" VARCHAR(150), ADD COLUMN "next_of_kin_phone" VARCHAR(20);
CREATE TABLE "patient_enrollments" (
 "user_id" UUID PRIMARY KEY REFERENCES "users"("id") ON DELETE RESTRICT,
 "token_hash" VARCHAR(64) NOT NULL UNIQUE,
 "expires_at" TIMESTAMP(3) NOT NULL,
 "profile_completed_at" TIMESTAMP(3),
 "completed_at" TIMESTAMP(3),
 "bill_id" UUID UNIQUE REFERENCES "care_bills"("id") ON DELETE RESTRICT,
 "consent_version" VARCHAR(60),
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updated_at" TIMESTAMP(3) NOT NULL
);
