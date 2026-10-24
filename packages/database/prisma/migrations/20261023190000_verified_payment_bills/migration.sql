-- Additive only. Existing payment history remains marked 'legacy', not reclassified as verified.
CREATE TABLE "care_bills" (
 "id" UUID PRIMARY KEY, "reference" VARCHAR(40) NOT NULL UNIQUE,
 "payer_user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "issued_by_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "patient_profile_id" UUID NOT NULL REFERENCES "patient_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "consultation_id" UUID UNIQUE REFERENCES "consultation_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "title" VARCHAR(120) NOT NULL, "amount" DECIMAL(12,2) NOT NULL CHECK ("amount" > 0),
 "currency" VARCHAR(3) NOT NULL DEFAULT 'TZS', "purpose" "PaymentPurpose" NOT NULL,
 "status" VARCHAR(20) NOT NULL DEFAULT 'due' CHECK ("status" IN ('due','paid','void')),
 "expires_at" TIMESTAMP(3) NOT NULL, "paid_at" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "care_bills_payer_user_id_status_created_at_idx" ON "care_bills"("payer_user_id","status","created_at");
ALTER TABLE "payment_intents" ADD COLUMN "bill_id" UUID REFERENCES "care_bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 ADD COLUMN "processor" VARCHAR(30) NOT NULL DEFAULT 'legacy',
 ADD COLUMN "environment" VARCHAR(20) NOT NULL DEFAULT 'legacy',
 ADD COLUMN "provider_transaction_id" VARCHAR(120), ADD COLUMN "last_verified_at" TIMESTAMP(3);
CREATE UNIQUE INDEX "payment_intents_one_unresolved_bill" ON "payment_intents"("bill_id")
 WHERE "bill_id" IS NOT NULL AND "status" IN ('pending','requires_action','processing');
ALTER TABLE "payments" ADD COLUMN "processor" VARCHAR(30) NOT NULL DEFAULT 'legacy',
 ADD COLUMN "environment" VARCHAR(20) NOT NULL DEFAULT 'legacy', ADD COLUMN "provider_transaction_id" VARCHAR(120);
CREATE UNIQUE INDEX "payments_provider_transaction_id_key" ON "payments"("provider_transaction_id");
