-- Safe forward-only pharmacy handoff and inventory extension.
-- Existing qualitative stock, prescriptions and dispensing history are retained.

ALTER TABLE "prescriptions"
  ADD COLUMN "valid_until" TIMESTAMP(3);

ALTER TABLE "prescription_items"
  ADD COLUMN "quantity_prescribed" INTEGER;

ALTER TABLE "pharmacies"
  ADD COLUMN "facility_id" UUID;

CREATE UNIQUE INDEX "pharmacies_facility_id_key" ON "pharmacies"("facility_id");

ALTER TABLE "pharmacies"
  ADD CONSTRAINT "pharmacies_facility_id_fkey"
  FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "pharmacy_stock"
  ADD COLUMN "quantity_on_hand" INTEGER;

ALTER TABLE "dispense_codes"
  ADD COLUMN "revoked_at" TIMESTAMP(3);

CREATE INDEX "dispense_codes_prescription_id_revoked_at_idx"
  ON "dispense_codes"("prescription_id", "revoked_at");

CREATE TABLE "pharmacy_memberships" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "pharmacy_id" UUID NOT NULL,
  "professional_license_number" VARCHAR(60) NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "is_verified" BOOLEAN NOT NULL DEFAULT false,
  "verified_at" TIMESTAMP(3),
  "verified_by_user_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pharmacy_memberships_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pharmacy_memberships_verification_check"
    CHECK (NOT "is_verified" OR ("verified_at" IS NOT NULL AND "verified_by_user_id" IS NOT NULL AND btrim("professional_license_number") <> ''))
);

CREATE UNIQUE INDEX "pharmacy_memberships_user_id_pharmacy_id_key"
  ON "pharmacy_memberships"("user_id", "pharmacy_id");
CREATE INDEX "pharmacy_memberships_pharmacy_id_is_active_is_verified_idx"
  ON "pharmacy_memberships"("pharmacy_id", "is_active", "is_verified");

ALTER TABLE "pharmacy_memberships"
  ADD CONSTRAINT "pharmacy_memberships_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pharmacy_memberships"
  ADD CONSTRAINT "pharmacy_memberships_pharmacy_id_fkey"
  FOREIGN KEY ("pharmacy_id") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pharmacy_memberships"
  ADD CONSTRAINT "pharmacy_memberships_verified_by_user_id_fkey"
  FOREIGN KEY ("verified_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "dispensing_records"
  ADD COLUMN "handoff_id" UUID,
  ADD COLUMN "idempotency_key" VARCHAR(128),
  ADD COLUMN "idempotency_request_hash" VARCHAR(64);

CREATE UNIQUE INDEX "dispensing_records_idempotency_key_key"
  ON "dispensing_records"("idempotency_key");
CREATE INDEX "dispensing_records_handoff_id_idx" ON "dispensing_records"("handoff_id");

ALTER TABLE "dispensing_records"
  ADD CONSTRAINT "dispensing_records_handoff_id_fkey"
  FOREIGN KEY ("handoff_id") REFERENCES "dispense_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "dispensing_items"
  ADD COLUMN "pharmacy_stock_id" UUID;

ALTER TABLE "dispensing_items"
  ADD CONSTRAINT "dispensing_items_pharmacy_stock_id_fkey"
  FOREIGN KEY ("pharmacy_stock_id") REFERENCES "pharmacy_stock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "prescription_items"
  ADD CONSTRAINT "prescription_items_quantity_prescribed_positive_check"
  CHECK ("quantity_prescribed" IS NULL OR "quantity_prescribed" > 0);
ALTER TABLE "pharmacy_stock"
  ADD CONSTRAINT "pharmacy_stock_quantity_on_hand_nonnegative_check"
  CHECK ("quantity_on_hand" IS NULL OR "quantity_on_hand" >= 0);
ALTER TABLE "dispensing_items"
  ADD CONSTRAINT "dispensing_items_quantity_positive_check"
  CHECK ("quantity_dispensed" > 0);
