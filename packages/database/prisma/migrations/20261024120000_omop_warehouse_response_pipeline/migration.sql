-- Additive governance metadata only. OMOP data lives in a separately provisioned warehouse database.

ALTER TABLE "research_studies" ADD COLUMN "allow_row_level" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "research_form_responses" ADD COLUMN "status" VARCHAR(20) NOT NULL DEFAULT 'active', ADD COLUMN "withdrawn_at" TIMESTAMP(3), ADD COLUMN "withdrawal_code" VARCHAR(40);

CREATE TABLE "research_omop_batches" (
  "id" UUID NOT NULL,
  "dataset_id" UUID NOT NULL,
  "source_id" UUID NOT NULL,
  "request_key" VARCHAR(120) NOT NULL,
  "payload_hash" CHAR(64) NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "input_rows" INTEGER NOT NULL,
  "synthetic" BOOLEAN NOT NULL,
  "submitted_by" UUID NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'accepted',
  CONSTRAINT "research_omop_batches_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "research_collections"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "research_omop_batches_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "research_source_grants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "research_omop_batches_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "research_omop_batches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "research_omop_batches_source_id_request_key_key" ON "research_omop_batches" ("source_id", "request_key");

CREATE INDEX "research_omop_batches_dataset_id_source_id_idx" ON "research_omop_batches" ("dataset_id", "source_id");

CREATE TABLE "research_omop_builds" (
  "id" UUID NOT NULL,
  "dataset_id" UUID NOT NULL,
  "source_id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "batch_ids" JSONB NOT NULL DEFAULT '[]',
  "source_fingerprint" CHAR(64) NOT NULL,
  "date_policy" VARCHAR(40) NOT NULL,
  "status" VARCHAR(30) NOT NULL DEFAULT 'queued',
  "warehouse_schema" VARCHAR(63),
  "vocabulary_version" VARCHAR(80),
  "manifest_hash" CHAR(64),
  "quality" JSONB NOT NULL DEFAULT '{}',
  "cells" JSONB NOT NULL DEFAULT '[]',
  "withheld_cells" INTEGER NOT NULL DEFAULT 0,
  "person_count" INTEGER NOT NULL DEFAULT 0,
  "release_id" UUID,
  "error_code" VARCHAR(80),
  "lease_token" UUID,
  "lease_expires_at" TIMESTAMP(3),
  "reviewed_by" UUID,
  "review_note" VARCHAR(500),
  CONSTRAINT "research_omop_builds_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "research_collections"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "research_omop_builds_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "research_source_grants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "research_omop_builds_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "research_omop_builds_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "research_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "research_omop_builds_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "research_omop_builds_dataset_id_status_idx" ON "research_omop_builds" ("dataset_id", "status");

CREATE TABLE "research_response_snapshots" (
  "id" UUID NOT NULL,
  "form_id" UUID NOT NULL,
  "study_id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "form_version" INTEGER NOT NULL,
  "response_fingerprint" CHAR(64) NOT NULL,
  "spec_hash" CHAR(64) NOT NULL,
  "bins" JSONB NOT NULL DEFAULT '{}',
  "cells" JSONB NOT NULL DEFAULT '[]',
  "suppressed_fields" JSONB NOT NULL DEFAULT '[]',
  "response_count" INTEGER NOT NULL,
  "minimum_cell_size" INTEGER NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "content_hash" CHAR(64) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
  "reviewed_by" UUID,
  "review_note" VARCHAR(500),
  CONSTRAINT "research_response_snapshots_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "research_forms"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "research_response_snapshots_study_id_fkey" FOREIGN KEY ("study_id") REFERENCES "research_studies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "research_response_snapshots_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "research_response_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "research_response_snapshots_form_id_status_idx" ON "research_response_snapshots" ("form_id", "status");

CREATE TABLE "research_output_requests" (
  "id" UUID NOT NULL,
  "study_id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "kind" VARCHAR(30) NOT NULL,
  "snapshot_id" UUID,
  "build_id" UUID,
  "format" VARCHAR(20) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
  "reviewed_by" UUID,
  "review_note" VARCHAR(500),
  "expires_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "research_output_requests_study_id_fkey" FOREIGN KEY ("study_id") REFERENCES "research_studies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "research_output_requests_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "research_output_requests_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "research_response_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "research_output_requests_build_id_fkey" FOREIGN KEY ("build_id") REFERENCES "research_omop_builds"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "research_output_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "research_output_requests_owner_id_study_id_idx" ON "research_output_requests" ("owner_id", "study_id");

CREATE INDEX "research_output_requests_status_idx" ON "research_output_requests" ("status");
