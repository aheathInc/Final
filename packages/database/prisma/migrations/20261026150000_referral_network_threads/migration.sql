CREATE TYPE "CommunityNotificationMode" AS ENUM ('all', 'replies', 'muted');
CREATE TYPE "NetworkNotificationKind" AS ENUM ('new_post', 'reply');
ALTER TABLE "community_memberships" ADD COLUMN "notification_mode" "CommunityNotificationMode" NOT NULL DEFAULT 'replies';
ALTER TABLE "discussion_replies" ADD COLUMN "parent_reply_id" UUID;
CREATE UNIQUE INDEX "discussion_replies_id_discussion_id_key" ON "discussion_replies"("id", "discussion_id");
CREATE INDEX "discussion_replies_parent_reply_id_idx" ON "discussion_replies"("parent_reply_id");
ALTER TABLE "discussion_replies" ADD CONSTRAINT "discussion_replies_parent_reply_id_fkey" FOREIGN KEY ("parent_reply_id") REFERENCES "discussion_replies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- A reply can never point into another discussion, even through a direct DB write.
ALTER TABLE "discussion_replies" ADD CONSTRAINT "discussion_replies_parent_same_discussion" FOREIGN KEY ("parent_reply_id", "discussion_id") REFERENCES "discussion_replies"("id", "discussion_id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE "professional_notifications" (
  "id" UUID NOT NULL PRIMARY KEY,
  "recipient_clinician_id" UUID NOT NULL REFERENCES "clinician_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "discussion_id" UUID NOT NULL REFERENCES "discussions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "reply_id" UUID REFERENCES "discussion_replies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "kind" "NetworkNotificationKind" NOT NULL,
  "dedupe_key" VARCHAR(180) NOT NULL,
  "read_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "professional_notifications_dedupe_key_key" ON "professional_notifications"("dedupe_key");
CREATE INDEX "professional_notifications_recipient_clinician_id_read_at_cre_idx" ON "professional_notifications"("recipient_clinician_id", "read_at", "created_at");
CREATE TABLE "digital_referral_messages" (
  "id" UUID NOT NULL PRIMARY KEY,
  "referral_id" UUID NOT NULL REFERENCES "digital_referrals"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "author_clinician_id" UUID NOT NULL REFERENCES "clinician_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "request_key" UUID NOT NULL,
  "body" VARCHAR(4000) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "digital_referral_messages_referral_id_author_clinician_id_req_key" ON "digital_referral_messages"("referral_id", "author_clinician_id", "request_key");
CREATE INDEX "digital_referral_messages_referral_id_created_at_id_idx" ON "digital_referral_messages"("referral_id", "created_at", "id");
