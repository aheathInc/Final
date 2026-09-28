-- CreateTable
CREATE TABLE "ussd_sessions" (
    "id" UUID NOT NULL,
    "session_id" VARCHAR(100) NOT NULL,
    "phone_number" VARCHAR(20) NOT NULL,
    "menu_state" VARCHAR(60) NOT NULL DEFAULT 'root',
    "context" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ussd_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ussd_sessions_session_id_key" ON "ussd_sessions"("session_id");

-- CreateIndex
CREATE INDEX "ussd_sessions_expires_at_idx" ON "ussd_sessions"("expires_at");
