-- CreateEnum
CREATE TYPE "RulesetStatus" AS ENUM ('draft', 'active', 'retired');

-- CreateTable
CREATE TABLE "triage_rulesets" (
    "id" UUID NOT NULL,
    "label" VARCHAR(40) NOT NULL,
    "status" "RulesetStatus" NOT NULL DEFAULT 'draft',
    "rules" JSONB NOT NULL,
    "sla_seconds" JSONB NOT NULL,
    "notes" TEXT,
    "created_by_id" UUID NOT NULL,
    "activated_by_id" UUID,
    "activated_at" TIMESTAMP(3),
    "retired_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "triage_rulesets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "triage_rulesets_label_key" ON "triage_rulesets"("label");

-- CreateIndex
CREATE INDEX "triage_rulesets_status_idx" ON "triage_rulesets"("status");

-- AddForeignKey
ALTER TABLE "triage_rulesets" ADD CONSTRAINT "triage_rulesets_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "triage_rulesets" ADD CONSTRAINT "triage_rulesets_activated_by_id_fkey" FOREIGN KEY ("activated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
