-- CreateTable
CREATE TABLE "realtime_tickets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "ticket_hash" VARCHAR(255) NOT NULL,
    "device_id" VARCHAR(128),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "realtime_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "realtime_tickets_ticket_hash_key" ON "realtime_tickets"("ticket_hash");

-- CreateIndex
CREATE INDEX "realtime_tickets_expires_at_idx" ON "realtime_tickets"("expires_at");

-- AddForeignKey
ALTER TABLE "realtime_tickets" ADD CONSTRAINT "realtime_tickets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
