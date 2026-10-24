-- Additive governed research workspace. No operational clinical data is copied.
CREATE TABLE "researcher_applications" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "kind" VARCHAR(20) NOT NULL,
  "display_name" VARCHAR(150) NOT NULL,
  "institution" VARCHAR(200),
  "credential_reference" VARCHAR(150) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
  "reviewed_by" UUID,
  "review_note" VARCHAR(500),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "researcher_applications_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "researcher_applications_user_id_key" ON "researcher_applications"("user_id");
CREATE INDEX "researcher_applications_status_idx" ON "researcher_applications"("status");
CREATE TABLE "research_studies" (
  "id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "purpose" VARCHAR(3000) NOT NULL,
  "dataset_id" UUID NOT NULL,
  "release_id" UUID,
  "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
  "ethics_reference" VARCHAR(150) NOT NULL,
  "ethics_expires_at" TIMESTAMP(3) NOT NULL,
  "controller_reference" VARCHAR(150) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "allow_export" BOOLEAN NOT NULL DEFAULT FALSE,
  "allow_ecrf" BOOLEAN NOT NULL DEFAULT FALSE,
  "reviewed_by" UUID,
  "review_note" VARCHAR(500),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "research_studies_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "research_studies_owner_id_status_idx" ON "research_studies"("owner_id","status");
CREATE INDEX "research_studies_dataset_id_idx" ON "research_studies"("dataset_id");
CREATE TABLE "research_evidence" (
  "id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "study_id" UUID,
  "source_id" UUID,
  "kind" VARCHAR(30) NOT NULL,
  "sha256" CHAR(64) NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "scan_status" VARCHAR(30) NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "research_evidence_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "research_evidence_owner_id_study_id_idx" ON "research_evidence"("owner_id","study_id");
CREATE INDEX "research_evidence_source_id_idx" ON "research_evidence"("source_id");
CREATE TABLE "research_collections" (
  "id" UUID NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "description" VARCHAR(1500) NOT NULL,
  "domains" JSONB NOT NULL DEFAULT '[]',
  "minimum_cell_size" INTEGER NOT NULL DEFAULT 10,
  "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
  "synthetic_only" BOOLEAN NOT NULL DEFAULT TRUE,
  "latest_release_id" UUID,
  "created_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "research_collections_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "research_collections_name_key" ON "research_collections"("name");
CREATE TABLE "research_source_grants" (
  "id" UUID NOT NULL,
  "dataset_id" UUID NOT NULL,
  "facility_id" UUID NOT NULL,
  "steward_id" UUID NOT NULL,
  "agreement_reference" VARCHAR(150) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
  "created_by" UUID NOT NULL,
  "reviewed_by" UUID,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "research_source_grants_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "research_source_grants_steward_id_dataset_id_idx" ON "research_source_grants"("steward_id","dataset_id");
CREATE TABLE "research_staged_events" (
  "id" UUID NOT NULL,
  "dataset_id" UUID NOT NULL,
  "source_id" UUID NOT NULL,
  "event_hash" CHAR(64) NOT NULL,
  "payload_hash" CHAR(64) NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "research_staged_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "research_staged_events_event_hash_key" ON "research_staged_events"("event_hash");
CREATE INDEX "research_staged_events_dataset_id_source_id_idx" ON "research_staged_events"("dataset_id","source_id");
CREATE TABLE "research_releases" (
  "id" UUID NOT NULL,
  "dataset_id" UUID NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
  "source_ids" JSONB NOT NULL,
  "cells" JSONB NOT NULL DEFAULT '[]',
  "quality" JSONB NOT NULL DEFAULT '{}',
  "minimum_cell_size" INTEGER NOT NULL,
  "content_hash" CHAR(64) NOT NULL,
  "created_by" UUID NOT NULL,
  "reviewed_by" UUID,
  "review_note" VARCHAR(500),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "research_releases_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "research_releases_dataset_id_status_idx" ON "research_releases"("dataset_id","status");
CREATE TABLE "research_export_requests" (
  "id" UUID NOT NULL,
  "study_id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "release_id" UUID NOT NULL,
  "format" VARCHAR(10) NOT NULL,
  "filters" JSONB NOT NULL DEFAULT '{}',
  "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
  "reviewed_by" UUID,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "research_export_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "research_export_requests_owner_id_study_id_idx" ON "research_export_requests"("owner_id","study_id");
CREATE TABLE "research_forms" (
  "id" UUID NOT NULL,
  "study_id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "fields" JSONB NOT NULL DEFAULT '[]',
  "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
  "reviewed_by" UUID,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "research_forms_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "research_forms_study_id_idx" ON "research_forms"("study_id");
CREATE TABLE "research_form_responses" (
  "id" UUID NOT NULL,
  "form_id" UUID NOT NULL,
  "subject_hash" CHAR(64) NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "submitted_by" UUID NOT NULL,
  "consent_reference_hash" CHAR(64) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "research_form_responses_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "research_form_responses_form_id_subject_hash_key" ON "research_form_responses"("form_id","subject_hash");
CREATE TABLE "research_access_keys" (
  "id" UUID NOT NULL,
  "study_id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'active',
  "expires_at" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "research_access_keys_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "research_access_keys_token_hash_key" ON "research_access_keys"("token_hash");
CREATE INDEX "research_access_keys_owner_id_study_id_idx" ON "research_access_keys"("owner_id","study_id");
CREATE TABLE "research_code_mappings" (
  "id" UUID NOT NULL,
  "system" VARCHAR(25) NOT NULL,
  "source_code" VARCHAR(40) NOT NULL,
  "domain" VARCHAR(30) NOT NULL,
  "concept_id" INTEGER NOT NULL,
  "standard_concept" BOOLEAN NOT NULL DEFAULT FALSE,
  "vocabulary_version" VARCHAR(80) NOT NULL,
  "label" VARCHAR(160) NOT NULL,
  "created_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "research_code_mappings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "research_code_mappings_system_source_code_key" ON "research_code_mappings"("system","source_code");
CREATE TABLE "research_throttles" (
  "id" UUID NOT NULL,
  "actor_key" VARCHAR(100) NOT NULL,
  "window_start" TIMESTAMP(3) NOT NULL,
  "hits" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "research_throttles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "research_throttles_actor_key_key" ON "research_throttles"("actor_key");
ALTER TABLE "researcher_applications" ADD CONSTRAINT "researcher_applications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "research_studies" ADD CONSTRAINT "research_studies_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "research_studies" ADD CONSTRAINT "research_studies_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "research_collections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "research_studies" ADD CONSTRAINT "research_studies_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "research_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "research_evidence" ADD CONSTRAINT "research_evidence_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "research_evidence" ADD CONSTRAINT "research_evidence_study_id_fkey" FOREIGN KEY ("study_id") REFERENCES "research_studies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "research_evidence" ADD CONSTRAINT "research_evidence_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "research_source_grants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "research_collections" ADD CONSTRAINT "research_collections_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "research_source_grants" ADD CONSTRAINT "research_source_grants_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "research_collections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "research_source_grants" ADD CONSTRAINT "research_source_grants_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "research_source_grants" ADD CONSTRAINT "research_source_grants_steward_id_fkey" FOREIGN KEY ("steward_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "research_staged_events" ADD CONSTRAINT "research_staged_events_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "research_collections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "research_staged_events" ADD CONSTRAINT "research_staged_events_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "research_source_grants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "research_releases" ADD CONSTRAINT "research_releases_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "research_collections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "research_export_requests" ADD CONSTRAINT "research_export_requests_study_id_fkey" FOREIGN KEY ("study_id") REFERENCES "research_studies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "research_export_requests" ADD CONSTRAINT "research_export_requests_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "research_export_requests" ADD CONSTRAINT "research_export_requests_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "research_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "research_forms" ADD CONSTRAINT "research_forms_study_id_fkey" FOREIGN KEY ("study_id") REFERENCES "research_studies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "research_forms" ADD CONSTRAINT "research_forms_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "research_form_responses" ADD CONSTRAINT "research_form_responses_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "research_forms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "research_form_responses" ADD CONSTRAINT "research_form_responses_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "research_access_keys" ADD CONSTRAINT "research_access_keys_study_id_fkey" FOREIGN KEY ("study_id") REFERENCES "research_studies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "research_access_keys" ADD CONSTRAINT "research_access_keys_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "research_collections" ADD CONSTRAINT "research_minimum_cell_size" CHECK ("minimum_cell_size" >= 10 AND "minimum_cell_size" <= 100);
ALTER TABLE "research_code_mappings" ADD CONSTRAINT "research_concept_id_nonnegative" CHECK ("concept_id" >= 0);
