ALTER TABLE "adherence_logs" ADD COLUMN "skip_reason" VARCHAR(40), ADD COLUMN "snoozed_until" TIMESTAMP(3), ADD COLUMN "snooze_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "prescription_items" ADD COLUMN "medication_image_url" VARCHAR(1000), ADD COLUMN "medication_education" VARCHAR(3000);
CREATE TABLE "medication_supplies" (
 "id" UUID NOT NULL, "patient_profile_id" UUID NOT NULL, "prescription_item_id" UUID NOT NULL,
 "baseline_quantity" DECIMAL(12,3) NOT NULL, "units_per_dose" DECIMAL(12,3), "unit_label" VARCHAR(30) NOT NULL,
 "low_stock_threshold" DECIMAL(12,3) NOT NULL, "baseline_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updated_by_id" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1,
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "medication_supplies_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "medication_supplies_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "medication_supplies_prescription_item_id_fkey" FOREIGN KEY ("prescription_item_id") REFERENCES "prescription_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "medication_supplies_nonnegative" CHECK ("baseline_quantity">=0 AND "low_stock_threshold">=0 AND ("units_per_dose" IS NULL OR "units_per_dose">0))
);
CREATE UNIQUE INDEX "medication_supplies_patient_profile_id_prescription_item_id_key" ON "medication_supplies"("patient_profile_id","prescription_item_id");
