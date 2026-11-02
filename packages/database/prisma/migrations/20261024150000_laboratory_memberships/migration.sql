CREATE TABLE "laboratory_memberships" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "facility_id" UUID NOT NULL,
  "assigned_by_user_id" UUID NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "laboratory_memberships_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "laboratory_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "laboratory_memberships_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "laboratory_memberships_assigned_by_user_id_fkey" FOREIGN KEY ("assigned_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "laboratory_memberships_user_id_facility_id_key" ON "laboratory_memberships"("user_id", "facility_id");
CREATE INDEX "laboratory_memberships_facility_id_is_active_idx" ON "laboratory_memberships"("facility_id", "is_active");
