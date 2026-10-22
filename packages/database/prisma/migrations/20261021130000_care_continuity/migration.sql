-- Additive; preserves legacy doses/reports. No backfill invents clinical timing.
CREATE TABLE "medication_reminder_plans" (
 "id" UUID NOT NULL, "prescription_item_id" UUID NOT NULL,
 "timezone" VARCHAR(80) NOT NULL, "start_date" DATE NOT NULL, "times" JSONB NOT NULL,
 "status" VARCHAR(12) NOT NULL DEFAULT 'active', "configured_by_id" UUID NOT NULL,
 "configured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "version" INTEGER NOT NULL DEFAULT 1, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updated_at" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "medication_reminder_plans_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "reminder_plan_status_check" CHECK ("status" IN ('active','paused','cancelled')),
 CONSTRAINT "medication_reminder_plans_prescription_item_id_fkey" FOREIGN KEY ("prescription_item_id") REFERENCES "prescription_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "medication_reminder_plans_prescription_item_id_key" ON "medication_reminder_plans"("prescription_item_id");
CREATE INDEX "medication_reminder_plans_status_idx" ON "medication_reminder_plans"("status");
ALTER TABLE "adherence_logs" ADD COLUMN "reminder_plan_id" UUID, ADD COLUMN "superseded_at" TIMESTAMP(3);
ALTER TABLE "adherence_logs" ADD CONSTRAINT "adherence_logs_reminder_plan_id_fkey" FOREIGN KEY ("reminder_plan_id") REFERENCES "medication_reminder_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- New explicit doses only; legacy rows are not deduplicated or deleted.
CREATE UNIQUE INDEX "adherence_explicit_plan_slot_key" ON "adherence_logs"("reminder_plan_id","scheduled_at") WHERE "superseded_at" IS NULL AND "reminder_plan_id" IS NOT NULL;
ALTER TABLE "check_ins" ADD COLUMN "review_note" VARCHAR(2000);
ALTER TABLE "notification_logs" ADD COLUMN "dedupe_key" VARCHAR(180), ADD COLUMN "claim_token" UUID, ADD COLUMN "claim_until" TIMESTAMP(3);
CREATE UNIQUE INDEX "notification_logs_dedupe_key_key" ON "notification_logs"("dedupe_key");
CREATE TABLE "care_reminder_preferences" (
 "id" UUID NOT NULL, "patient_profile_id" UUID NOT NULL, "sms_enabled" BOOLEAN NOT NULL DEFAULT false,
 "updated_by_id" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "updated_at" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "care_reminder_preferences_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "care_reminder_preferences_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "care_reminder_preferences_patient_profile_id_key" ON "care_reminder_preferences"("patient_profile_id");
CREATE TABLE "care_reminders" (
 "id" UUID NOT NULL, "patient_profile_id" UUID NOT NULL, "adherence_log_id" UUID, "check_in_id" UUID, "notification_id" UUID,
 "due_at" TIMESTAMP(3) NOT NULL, "expires_at" TIMESTAMP(3) NOT NULL, "read_at" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "care_reminders_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "care_reminder_exactly_one_subject" CHECK (("adherence_log_id" IS NOT NULL)::int + ("check_in_id" IS NOT NULL)::int = 1),
 CONSTRAINT "care_reminders_patient_profile_id_fkey" FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "care_reminders_adherence_log_id_fkey" FOREIGN KEY ("adherence_log_id") REFERENCES "adherence_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "care_reminders_check_in_id_fkey" FOREIGN KEY ("check_in_id") REFERENCES "check_ins"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "care_reminders_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notification_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "care_reminders_adherence_log_id_key" ON "care_reminders"("adherence_log_id");
CREATE UNIQUE INDEX "care_reminders_check_in_id_key" ON "care_reminders"("check_in_id");
CREATE UNIQUE INDEX "care_reminders_notification_id_key" ON "care_reminders"("notification_id");
CREATE INDEX "care_reminders_patient_profile_id_due_at_idx" ON "care_reminders"("patient_profile_id","due_at");
CREATE TABLE "care_contacts" (
 "id" UUID NOT NULL, "follow_up_cycle_id" UUID NOT NULL, "request_key" UUID NOT NULL,
 "scheduled_at" TIMESTAMP(3) NOT NULL, "channel" VARCHAR(12) NOT NULL, "purpose" VARCHAR(500) NOT NULL,
 "status" VARCHAR(20) NOT NULL DEFAULT 'scheduled', "note" VARCHAR(2000), "completed_at" TIMESTAMP(3),
 "recorded_by_id" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1,
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "care_contacts_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "care_contact_channel_check" CHECK ("channel" IN ('phone','chat')),
 CONSTRAINT "care_contact_status_check" CHECK ("status" IN ('scheduled','completed','no_answer','cancelled')),
 CONSTRAINT "care_contacts_follow_up_cycle_id_fkey" FOREIGN KEY ("follow_up_cycle_id") REFERENCES "follow_up_cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "care_contacts_follow_up_cycle_id_request_key_key" ON "care_contacts"("follow_up_cycle_id","request_key");
CREATE INDEX "care_contacts_follow_up_cycle_id_scheduled_at_idx" ON "care_contacts"("follow_up_cycle_id","scheduled_at");
