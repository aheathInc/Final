-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('mobile_money', 'card', 'cash', 'insurance');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('mpesa', 'tigo_pesa', 'airtel_money', 'card_gateway', 'manual');

-- CreateEnum
CREATE TYPE "PaymentPurpose" AS ENUM ('consultation_fee', 'pharmacy_purchase', 'insurance_copay', 'subscription', 'other');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'requires_action', 'processing', 'succeeded', 'failed', 'cancelled', 'refunded', 'partially_refunded');

-- CreateTable
CREATE TABLE "payment_intents" (
    "id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'TZS',
    "method" "PaymentMethod" NOT NULL,
    "provider" "PaymentProvider",
    "purpose" "PaymentPurpose" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "consultation_id" UUID,
    "dispensing_id" UUID,
    "insurance_claim_id" UUID,
    "payer_user_id" UUID,
    "payer_phone" VARCHAR(20),
    "provider_reference" VARCHAR(120),
    "client_action" JSONB,
    "payment_id" UUID,
    "expires_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "payment_intent_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'TZS',
    "method" "PaymentMethod" NOT NULL,
    "provider" "PaymentProvider",
    "provider_reference" VARCHAR(120),
    "purpose" "PaymentPurpose" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'succeeded',
    "consultation_id" UUID,
    "payer_user_id" UUID,
    "refunded_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "settled_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_refunds" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "issued_by_id" UUID,
    "provider_reference" VARCHAR(120),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_intents_provider_reference_key" ON "payment_intents"("provider_reference");

-- CreateIndex
CREATE UNIQUE INDEX "payment_intents_payment_id_key" ON "payment_intents"("payment_id");

-- CreateIndex
CREATE INDEX "payment_intents_status_created_at_idx" ON "payment_intents"("status", "created_at");

-- CreateIndex
CREATE INDEX "payment_intents_consultation_id_idx" ON "payment_intents"("consultation_id");

-- CreateIndex
CREATE INDEX "payment_intents_updated_at_idx" ON "payment_intents"("updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_payment_intent_id_key" ON "payments"("payment_intent_id");

-- CreateIndex
CREATE INDEX "payments_status_settled_at_idx" ON "payments"("status", "settled_at");

-- CreateIndex
CREATE INDEX "payments_consultation_id_idx" ON "payments"("consultation_id");

-- CreateIndex
CREATE INDEX "payment_refunds_payment_id_idx" ON "payment_refunds"("payment_id");

-- AddForeignKey
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_consultation_id_fkey" FOREIGN KEY ("consultation_id") REFERENCES "consultation_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_payer_user_id_fkey" FOREIGN KEY ("payer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_consultation_id_fkey" FOREIGN KEY ("consultation_id") REFERENCES "consultation_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
