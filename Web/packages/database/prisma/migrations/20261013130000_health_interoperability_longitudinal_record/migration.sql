CREATE TYPE "ExternalHealthSystemStatus" AS ENUM ('pending', 'active', 'suspended');
CREATE TYPE "ExternalIdentityStatus" AS ENUM ('confirmed', 'ambiguous', 'unmatched');
CREATE TYPE "ExternalResourceValidationStatus" AS ENUM ('accepted', 'quarantined');

CREATE TABLE "external_health_systems" (
  "id" UUID NOT NULL,
  "system_key" VARCHAR(60) NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "identifier" VARCHAR(255) NOT NULL,
  "facility_id" UUID NOT NULL,
  "status" "ExternalHealthSystemStatus" NOT NULL DEFAULT 'pending',
  "supported_types" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "auth_config_ref" VARCHAR(120) NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "activated_by_user_id" UUID,
  "activated_at" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "external_health_systems_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "external_patient_identities" (
  "id" UUID NOT NULL,
  "external_system_id" UUID NOT NULL,
  "external_patient_id" VARCHAR(180) NOT NULL,
  "status" "ExternalIdentityStatus" NOT NULL DEFAULT 'unmatched',
  "patient_profile_id" UUID,
  "candidate_profile_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "reviewed_by_user_id" UUID,
  "reviewed_at" TIMESTAMP(3),
  "evidence_reference" VARCHAR(120),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "external_patient_identities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "external_fhir_resources" (
  "id" UUID NOT NULL,
  "external_system_id" UUID NOT NULL,
  "identity_id" UUID,
  "patient_profile_id" UUID,
  "resource_type" VARCHAR(40) NOT NULL,
  "external_resource_id" VARCHAR(180) NOT NULL,
  "resource_version" VARCHAR(80),
  "source_last_updated" TIMESTAMP(3),
  "clinical_event_at" TIMESTAMP(3),
  "validation_status" "ExternalResourceValidationStatus" NOT NULL DEFAULT 'quarantined',
  "resource_payload" JSONB NOT NULL,
  "payload_hash" CHAR(64) NOT NULL,
  "transformation_version" VARCHAR(40) NOT NULL DEFAULT 'fhir-r4-subset-v1',
  "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "external_fhir_resources_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "external_health_systems_system_key_key" ON "external_health_systems"("system_key");
CREATE UNIQUE INDEX "external_health_systems_identifier_key" ON "external_health_systems"("identifier");
CREATE INDEX "external_health_systems_facility_id_status_idx" ON "external_health_systems"("facility_id", "status");
CREATE UNIQUE INDEX "external_patient_identities_external_system_id_external_patient_id_key" ON "external_patient_identities"("external_system_id", "external_patient_id");
CREATE UNIQUE INDEX "external_patient_identities_system_patient_key" ON "external_patient_identities"("external_system_id", "patient_profile_id");
CREATE INDEX "external_patient_identities_status_created_at_idx" ON "external_patient_identities"("status", "created_at");
CREATE INDEX "external_patient_identities_patient_profile_id_status_idx" ON "external_patient_identities"("patient_profile_id", "status");
CREATE INDEX "external_fhir_resources_patient_profile_id_clinical_event_at_idx" ON "external_fhir_resources"("patient_profile_id", "clinical_event_at");
CREATE INDEX "external_fhir_resources_external_system_id_resource_type_external_resource_id_imported_at_idx" ON "external_fhir_resources"("external_system_id", "resource_type", "external_resource_id", "imported_at");
CREATE INDEX "external_fhir_resources_identity_id_validation_status_idx" ON "external_fhir_resources"("identity_id", "validation_status");

ALTER TABLE "external_health_systems" ADD CONSTRAINT "external_health_systems_facility_id_fkey"
  FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "external_health_systems" ADD CONSTRAINT "external_health_systems_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "external_health_systems" ADD CONSTRAINT "external_health_systems_activated_by_user_id_fkey"
  FOREIGN KEY ("activated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "external_patient_identities" ADD CONSTRAINT "external_patient_identities_external_system_id_fkey"
  FOREIGN KEY ("external_system_id") REFERENCES "external_health_systems"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "external_patient_identities" ADD CONSTRAINT "external_patient_identities_patient_profile_id_fkey"
  FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "external_patient_identities" ADD CONSTRAINT "external_patient_identities_reviewed_by_user_id_fkey"
  FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "external_fhir_resources" ADD CONSTRAINT "external_fhir_resources_external_system_id_fkey"
  FOREIGN KEY ("external_system_id") REFERENCES "external_health_systems"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "external_fhir_resources" ADD CONSTRAINT "external_fhir_resources_identity_id_fkey"
  FOREIGN KEY ("identity_id") REFERENCES "external_patient_identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "external_fhir_resources" ADD CONSTRAINT "external_fhir_resources_patient_profile_id_fkey"
  FOREIGN KEY ("patient_profile_id") REFERENCES "patient_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
