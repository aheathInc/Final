-- AlterTable
ALTER TABLE "education_articles" ADD COLUMN     "disease_guide" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "sources" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "patient_social_profiles" (
    "user_id" UUID NOT NULL,
    "alias" VARCHAR(60) NOT NULL,
    "consent_version" TEXT,
    "peer_enabled" BOOLEAN NOT NULL DEFAULT false,
    "suspended" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_social_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "health_spaces" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "health_spaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_space_members" (
    "space_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "health_space_members_pkey" PRIMARY KEY ("space_id","user_id")
);

-- CreateTable
CREATE TABLE "health_space_posts" (
    "id" UUID NOT NULL,
    "space_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "parent_id" UUID,
    "body" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "health_space_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "peer_conversations" (
    "id" UUID NOT NULL,
    "requester_id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "pair_key" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "peer_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "peer_messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "request_key" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "peer_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_social_blocks" (
    "user_id" UUID NOT NULL,
    "target_id" UUID NOT NULL,

    CONSTRAINT "patient_social_blocks_pkey" PRIMARY KEY ("user_id","target_id")
);

-- CreateTable
CREATE TABLE "patient_social_reports" (
    "id" UUID NOT NULL,
    "reporter_id" UUID NOT NULL,
    "target_id" UUID NOT NULL,
    "target_kind" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "snapshot" TEXT NOT NULL,
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolution" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_social_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_feedback" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "subject" VARCHAR(150) NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "escalated" BOOLEAN NOT NULL DEFAULT false,
    "history" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "care_chat_consents" (
    "care_thread_id" UUID NOT NULL,
    "accepted" BOOLEAN NOT NULL DEFAULT false,
    "actor_user_id" UUID NOT NULL,
    "version" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "care_chat_consents_pkey" PRIMARY KEY ("care_thread_id")
);

-- CreateIndex
CREATE INDEX "health_space_members_user_id_idx" ON "health_space_members"("user_id");

-- CreateIndex
CREATE INDEX "health_space_posts_space_id_status_created_at_idx" ON "health_space_posts"("space_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "peer_conversations_pair_key_key" ON "peer_conversations"("pair_key");

-- CreateIndex
CREATE INDEX "peer_conversations_recipient_id_status_idx" ON "peer_conversations"("recipient_id", "status");

-- CreateIndex
CREATE INDEX "peer_conversations_requester_id_idx" ON "peer_conversations"("requester_id");

-- CreateIndex
CREATE INDEX "peer_messages_conversation_id_created_at_idx" ON "peer_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "peer_messages_sender_id_request_key_key" ON "peer_messages"("sender_id", "request_key");

-- CreateIndex
CREATE INDEX "patient_social_reports_status_urgent_created_at_idx" ON "patient_social_reports"("status", "urgent", "created_at");

-- CreateIndex
CREATE INDEX "patient_feedback_user_id_created_at_idx" ON "patient_feedback"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "patient_feedback_status_escalated_idx" ON "patient_feedback"("status", "escalated");

-- AddForeignKey
ALTER TABLE "patient_social_profiles" ADD CONSTRAINT "patient_social_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_space_members" ADD CONSTRAINT "health_space_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_space_members" ADD CONSTRAINT "health_space_members_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "health_spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_space_posts" ADD CONSTRAINT "health_space_posts_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_space_posts" ADD CONSTRAINT "health_space_posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_space_posts" ADD CONSTRAINT "health_space_posts_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "health_spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_space_posts" ADD CONSTRAINT "health_space_posts_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "health_space_posts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "peer_conversations" ADD CONSTRAINT "peer_conversations_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "peer_conversations" ADD CONSTRAINT "peer_conversations_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "peer_messages" ADD CONSTRAINT "peer_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "peer_messages" ADD CONSTRAINT "peer_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "peer_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_social_blocks" ADD CONSTRAINT "patient_social_blocks_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_social_blocks" ADD CONSTRAINT "patient_social_blocks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_social_reports" ADD CONSTRAINT "patient_social_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_feedback" ADD CONSTRAINT "patient_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_chat_consents" ADD CONSTRAINT "care_chat_consents_care_thread_id_fkey" FOREIGN KEY ("care_thread_id") REFERENCES "care_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_chat_consents" ADD CONSTRAINT "care_chat_consents_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
